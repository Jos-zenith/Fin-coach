import { formatDateLong, monthKey } from '../dates'
import { formatINR, formatPct } from '../format'
import { bucketOf, type Category, type LeakDecision, type Rule } from '../types'
import { completeMonths, dtiBand, type GoalProjection, type Model } from './model'
import type { ResolvedTxn } from './resolve'

export interface MonthStats {
  key: string
  label: string
  income: number
  essential: number
  flexible: number
  excluded: number
  spending: number
  surplus: number
  savingsRate: number | null
  byCategory: Partial<Record<Category, number>>
  complete: boolean
  txnCount: number
  /** bank balance before the first and after the last transaction of the month, when statements carry balances */
  openingBalance: number | null
  closingBalance: number | null
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/**
 * Calendar-month totals. Income = salary + other credits that are not transfers or repayments.
 * Savings rate = (income − essential − flexible) ÷ income.
 */
export function monthlyStats(active: ResolvedTxn[], period: { start: string; end: string } | null): MonthStats[] {
  const map = new Map<string, MonthStats>()
  const full = new Set(completeMonths(period))
  for (const t of active) {
    const key = monthKey(t.date)
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: monthLabel(key),
        income: 0,
        essential: 0,
        flexible: 0,
        excluded: 0,
        spending: 0,
        surplus: 0,
        savingsRate: null,
        byCategory: {},
        complete: full.has(key),
        txnCount: 0,
        openingBalance: null,
        closingBalance: null,
      })
    }
    const s = map.get(key)!
    s.txnCount++
    for (const l of t.lines) {
      const b = bucketOf(l.category)
      const signed = t.direction === 'debit' ? l.amount : b === 'income' ? l.amount : -l.amount
      if (b === 'income') s.income += signed
      else if (b === 'essential') s.essential += signed
      else if (b === 'flexible') s.flexible += signed
      else s.excluded += l.amount
      if (b === 'essential' || b === 'flexible') s.byCategory[l.category] = (s.byCategory[l.category] ?? 0) + signed
    }
  }
  // balances from bank statements (not cards, not SMS without balance)
  const withBal = active.filter((t) => t.balanceAfter != null && t.statementType !== 'card')
  for (const s of map.values()) {
    const days = [...new Set(withBal.filter((t) => monthKey(t.date) === s.key).map((t) => t.date))].sort()
    if (!days.length) continue
    s.openingBalance = dayBounds(withBal.filter((t) => t.date === days[0])).start
    s.closingBalance = dayBounds(withBal.filter((t) => t.date === days[days.length - 1])).end
  }
  const out = [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const s of out) {
    s.essential = Math.max(0, s.essential)
    s.flexible = Math.max(0, s.flexible)
    s.spending = s.essential + s.flexible
    s.surplus = s.income - s.spending
    s.savingsRate = s.income > 0 ? s.surplus / s.income : null
  }
  return out
}

/**
 * Start and end balance of one day, independent of the order rows are stored in.
 * The first row of the day satisfies: (its balance − its signed amount) + the day's net = some row's balance.
 */
export function dayBounds(day: ResolvedTxn[]): { start: number; end: number } {
  const signed = (t: ResolvedTxn) => (t.direction === 'credit' ? t.amount : -t.amount)
  const net = day.reduce((a, t) => a + signed(t), 0)
  const balances = day.map((t) => t.balanceAfter!)
  for (const t of day) {
    const start = t.balanceAfter! - signed(t)
    if (balances.some((b) => Math.abs(b - (start + net)) < 1)) return { start, end: start + net }
  }
  // no consistent chain (missing rows): fall back to the extremes of what we have
  const t0 = day[0]
  return { start: t0.balanceAfter! - signed(t0), end: balances[balances.length - 1] }
}

export interface ChangeItem {
  tone: 'good' | 'warn' | 'neutral'
  text: string
}

export interface MissionReview {
  current: MonthStats
  previous: MonthStats | null
  partial: boolean
  /** survival runway at the month's opening and closing balance (essential burn from the baseline) */
  runwayStart: number | null
  runwayEnd: number | null
  lifestyleStart: number | null
  lifestyleEnd: number | null
  /** emergency-fund progress at the month's opening and closing balance */
  efStart: number | null
  efEnd: number | null
  balancesKnown: boolean
  emiLoad: number | null
  changes: ChangeItem[]
  drifted: { category: Category; from: number; to: number }[]
  corrections: { rules: number; reclassified: number; noiseRemoved: number }
  goals: GoalProjection[]
  nextAction: string
}

function drift(cur: MonthStats, prev: MonthStats) {
  const out: { category: Category; from: number; to: number }[] = []
  for (const [cat, v] of Object.entries(cur.byCategory)) {
    if (bucketOf(cat as Category) !== 'flexible') continue
    const from = prev.byCategory[cat as Category] ?? 0
    const to = v ?? 0
    if (to - from >= 500 && to > from * 1.2) out.push({ category: cat as Category, from, to })
  }
  return out.sort((a, b) => b.to - b.from - (a.to - a.from))
}

export function buildMissionReview(model: Model, rules: Rule[] = [], decisions: Record<string, LeakDecision> = {}): MissionReview | null {
  const months = monthlyStats(model.active, model.base.period)
  if (!months.length) return null
  const complete = months.filter((m) => m.complete)
  const current = complete.length ? complete[complete.length - 1] : months[months.length - 1]
  const idx = months.findIndex((m) => m.key === current.key)
  const previous = idx > 0 ? months[idx - 1] : null

  const emb = model.baseline.emb
  const burn = model.baseline.burn
  const efTarget = model.baseline.emergency.target
  const div = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null)
  const balancesKnown = current.openingBalance != null && current.closingBalance != null

  // --- what changed
  const changes: ChangeItem[] = []
  const drifted = previous ? drift(current, previous) : []
  if (previous) {
    const df = current.flexible - previous.flexible
    if (Math.abs(df) >= 100) changes.push({ tone: df < 0 ? 'good' : 'warn', text: `Flexible spending ${df < 0 ? 'decreased' : 'increased'} by ${formatINR(Math.abs(df))}.` })
    if (current.savingsRate != null && previous.savingsRate != null) {
      const pp = (current.savingsRate - previous.savingsRate) * 100
      if (Math.abs(pp) >= 0.5) changes.push({ tone: pp > 0 ? 'good' : 'warn', text: `Savings rate ${pp > 0 ? 'rose' : 'fell'} by ${Math.abs(pp).toFixed(1)} percentage points.` })
    }
  }
  for (const d of drifted.slice(0, 3)) changes.push({ tone: 'warn', text: `${d.category} drifted up from ${formatINR(d.from)} to ${formatINR(d.to)}.` })
  for (const l of model.leaks) {
    if (l.isNew) changes.push({ tone: 'warn', text: `New recurring charge: ${l.label}, ${formatINR(l.monthly)}/month.` })
    if (l.priceChange) changes.push({ tone: 'warn', text: `${l.label} went up from ${formatINR(l.priceChange.from)} to ${formatINR(l.priceChange.to)}.` })
    if (l.priceDrop) changes.push({ tone: 'good', text: `${l.label} went down from ${formatINR(l.priceDrop.from)} to ${formatINR(l.priceDrop.to)}.` })
    if (l.unused && l.usage) changes.push({ tone: 'warn', text: `${l.label} shows no ${l.usage.label.toLowerCase()} in ${l.usage.daysSince} days.` })
    if (decisions[l.id] === 'cancel') changes.push({ tone: 'good', text: `${l.label} marked to cancel (${formatINR(l.monthly)}/month).` })
  }
  for (const s of model.series) {
    if (s.priceChange && s.category && bucketOf(s.category) === 'essential')
      changes.push({ tone: 'warn', text: `Essential cost up: ${s.label} from ${formatINR(s.priceChange.from)} to ${formatINR(s.priceChange.to)}.` })
  }

  // --- corrections learned
  const reclassified = model.resolved.filter((t) => t.classSource === 'rule' || t.classSource === 'user').length
  const noiseRemoved = model.active
    .filter((t) => monthKey(t.date) === current.key)
    .reduce((a, t) => a + t.lines.filter((l) => bucketOf(l.category) === 'excluded').reduce((x, l) => x + l.amount, 0), 0)

  // --- one next mission, grounded in this data, in priority order
  const ef = model.baseline.emergency
  const unknownNew = model.leaks.find((l) => (l.isNew || l.kind === 'mandate') && l.category == null && !decisions[l.id])
  const unused = model.leaks.find((l) => l.unused && !decisions[l.id])
  const hike = model.leaks.find((l) => l.priceChange && !decisions[l.id])
  const unclassified = current.byCategory['Other'] ?? 0
  const dti = model.baseline.dti
  let nextAction: string
  if (model.reviewCount > 0 && current.flexible > 0 && unclassified / current.flexible > 0.15) {
    nextAction = `${model.reviewCount} transactions are still unclassified, and ${formatINR(unclassified)} of this month's flexible spend sits in "Other". Classify them in Review so the runway number reflects real habits.`
  } else if (current.income > 0 && current.surplus < 0) {
    nextAction = `You spent ${formatINR(-current.surplus)} more than came in during ${current.label}. Try a cap on ${drifted[0]?.category ?? 'your largest flexible category'} in the simulator.`
  } else if (unknownNew) {
    nextAction = `Review the ${formatINR(unknownNew.monthly)} unrecognised mandate "${unknownNew.label}" in Leak Radar. Runway cannot tell what it pays for.`
  } else if (unused) {
    nextAction = `${unused.label} costs ${formatINR(unused.monthly)}/month with no ${unused.usage?.label.toLowerCase()} in ${unused.usage?.daysSince} days. Decide whether to keep it.`
  } else if (drifted.length && ef.date) {
    const d = drifted[0]
    const cut = Math.min(30, Math.max(10, Math.round(((d.to - d.from) / d.to) * 100 / 5) * 5))
    nextAction = `Reduce ${d.category} spend by ${cut}% to protect your emergency-fund date of ${formatDateLong(ef.date)}.`
  } else if (hike?.priceChange) {
    nextAction = `${hike.label} went from ${formatINR(hike.priceChange.from)} to ${formatINR(hike.priceChange.to)} a month. Decide in Leak Radar whether it is still worth keeping.`
  } else if (dti != null && dtiBand(dti) !== 'ok') {
    nextAction = `EMIs take ${formatPct(dti)} of take-home pay, above the 35% caution mark. Avoid new EMIs until existing ones close.`
  } else {
    nextAction = 'No pressing issue in this month’s data. Re-import next month’s statement to keep the runway current.'
  }

  return {
    current,
    previous,
    partial: !current.complete,
    runwayStart: div(current.openingBalance, emb),
    runwayEnd: div(current.closingBalance, emb),
    lifestyleStart: div(current.openingBalance, burn),
    lifestyleEnd: div(current.closingBalance, burn),
    efStart: div(current.openingBalance, efTarget),
    efEnd: div(current.closingBalance, efTarget),
    balancesKnown,
    emiLoad: model.baseline.dti,
    changes,
    drifted,
    corrections: { rules: rules.length, reclassified, noiseRemoved },
    goals: [model.baseline.emergency, ...model.baseline.goals],
    nextAction,
  }
}

/** Plain-text export of the briefing, for sharing or archiving. */
export function reviewToMarkdown(r: MissionReview): string {
  const c = r.current
  const p = r.previous
  const row = (label: string, a: number | null | undefined, b: number | null | undefined, f: (n: number) => string) =>
    `| ${label} | ${a != null ? f(a) : '—'} | ${b != null ? f(b) : '—'} |`
  const goal = (g: GoalProjection) =>
    `- ${g.name}: ${g.status === 'on_track' && g.date ? `projected ${formatDateLong(g.date)}` : g.status.replace('_', ' ')}${g.targetDate ? `, target ${formatDateLong(g.targetDate)} (${g.vsTarget ?? '—'})` : ''}`
  return [
    `# Runway monthly review: ${c.label}${r.partial ? ' (partial month)' : ''}`,
    '',
    `**Next mission:** ${r.nextAction}`,
    '',
    `| | ${p?.label ?? 'Previous'} | ${c.label} |`,
    '|---|---:|---:|',
    row('Income', p?.income, c.income, formatINR),
    row('Essentials', p?.essential, c.essential, formatINR),
    row('Flexible spending', p?.flexible, c.flexible, formatINR),
    row('Surplus', p?.surplus, c.surplus, formatINR),
    row('Net savings rate', p?.savingsRate, c.savingsRate, (n) => formatPct(n, 1)),
    '',
    r.balancesKnown ? `Survival runway: ${r.runwayStart?.toFixed(1)} → ${r.runwayEnd?.toFixed(1)} months. Emergency fund: ${formatPct(r.efStart ?? 0)} → ${formatPct(r.efEnd ?? 0)} of target.` : 'Statement balances not available for runway start/end.',
    '',
    '## What changed',
    ...(r.changes.length ? r.changes.map((x) => `- ${x.text}`) : ['- Nothing notable.']),
    '',
    '## Corrections learned',
    `- ${r.corrections.rules} rules, ${r.corrections.reclassified} transactions classified by your corrections, ${formatINR(r.corrections.noiseRemoved)} of noise removed this month.`,
    '',
    '## Goals',
    ...r.goals.map(goal),
    '',
    '_Educational cash-flow simulation only. Not investment advice. Runway does not recommend specific securities, funds, or financial products._',
  ].join('\n')
}
