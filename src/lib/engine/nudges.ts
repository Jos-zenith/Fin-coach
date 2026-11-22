import { DAYS_PER_MONTH, daysInMonth, diffDays, toISO } from '../dates'
import { formatINR } from '../format'
import { bucketOf, FLEXIBLE_CATEGORIES, type FlexibleCategory, type LeakDecision, type Profile, type SimState } from '../types'
import { runwayGainDays, type Model } from './model'

export type PaceStatus = 'green' | 'amber' | 'red'

export interface PaceRow {
  category: FlexibleCategory
  spent: number
  budget: number
  /** share of the budget used so far */
  used: number
  ratio: number
  status: PaceStatus
  /** spend by the end of the cycle at today's pace */
  projected: number
  overshoot: number
  /** days the emergency-fund date moves if this pace holds; null if there is no contribution to shift */
  goalShiftDays: number | null
}

export interface PaceReport {
  asOf: string
  cycleStart: string
  cycleEnd: string
  cycleDays: number
  daysIn: number
  /** fraction of the pay cycle elapsed */
  elapsed: number
  rows: PaceRow[]
  tooEarly: boolean
  /** card statements exist, but none reach into this cycle: card spending is missing from pace */
  cardGap: boolean
}

export const PACE_AMBER = 0.9
export const PACE_RED = 1.1

function clampDay(y: number, m: number, d: number) {
  return toISO(y, m, Math.min(d, daysInMonth(y, m)))!
}

/** The pay cycle that contains `asOf`, anchored on payday (not the 1st of the month). */
export function payCycle(asOf: string, payday: number) {
  let [y, m] = asOf.split('-').map(Number)
  let start = clampDay(y, m, payday)
  if (start > asOf) {
    m -= 1
    if (m < 1) {
      m = 12
      y -= 1
    }
    start = clampDay(y, m, payday)
  }
  let ny = y
  let nm = m + 1
  if (nm > 12) {
    nm = 1
    ny += 1
  }
  const end = clampDay(ny, nm, payday)
  return { start, end, days: diffDays(end, start) }
}

/**
 * pace ratio = (spent ÷ budget) ÷ (days since payday ÷ days in cycle).
 * Budget = the category's usual monthly spend, after any cut planned in the simulator.
 */
export function computePace(model: Model, sim: SimState): PaceReport | null {
  if (!model.asOf || !model.hasTransactions) return null
  const payday = model.payday ?? 1
  const cyc = payCycle(model.asOf, payday)
  const daysIn = diffDays(model.asOf, cyc.start) + 1
  const elapsed = Math.min(1, daysIn / cyc.days)
  // Pace is about day-to-day spending. Recurring charges (subscriptions, mandates) land on fixed days,
  // so they would always look "ahead of pace"; they are tracked in Leak Radar instead and left out here.
  const spentBy: Partial<Record<FlexibleCategory, number>> = {}
  for (const t of model.active) {
    if (t.date < cyc.start || t.date > model.asOf || t.isRecurring) continue
    for (const l of t.lines) {
      if (bucketOf(l.category) !== 'flexible') continue
      const sign = t.direction === 'debit' ? 1 : -1
      spentBy[l.category as FlexibleCategory] = (spentBy[l.category as FlexibleCategory] ?? 0) + sign * l.amount
    }
  }
  const recurringBy: Partial<Record<FlexibleCategory, number>> = {}
  for (const s of model.series) {
    const cat = (s.category ?? 'Other') as FlexibleCategory
    if (bucketOf(cat) !== 'flexible') continue
    recurringBy[cat] = (recurringBy[cat] ?? 0) + s.monthly
  }
  const contribution = model.baseline.emergency.contribution
  const rows: PaceRow[] = []
  for (const category of FLEXIBLE_CATEGORIES) {
    if (category === 'Subscriptions') continue
    const usual = Math.max(0, (model.base.flexible.find((l) => l.category === category)?.amount ?? 0) - (recurringBy[category] ?? 0))
    const catCut = sim.catCut.category === category ? sim.catCut.pct / 100 : 0
    const budget = usual * (1 - catCut) * (1 - sim.cutPct / 100)
    const spent = Math.max(0, spentBy[category] ?? 0)
    if (budget < 200 && spent < 200) continue
    const used = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0
    const ratio = elapsed > 0 ? used / elapsed : 0
    const projected = elapsed > 0 ? spent / elapsed : spent
    const overshoot = Math.max(0, projected - budget)
    rows.push({
      category,
      spent,
      budget,
      used,
      ratio,
      status: ratio > PACE_RED ? 'red' : ratio >= PACE_AMBER ? 'amber' : 'green',
      projected,
      overshoot,
      goalShiftDays: contribution && contribution > 0 ? (overshoot / contribution) * DAYS_PER_MONTH : null,
    })
  }
  rows.sort((a, b) => b.ratio - a.ratio)
  const card = model.active.filter((t) => t.statementType === 'card')
  const cardGap = card.length > 0 && !card.some((t) => t.date >= cyc.start && t.direction === 'debit')
  return { asOf: model.asOf, cycleStart: cyc.start, cycleEnd: cyc.end, cycleDays: cyc.days, daysIn, elapsed, rows, tooEarly: daysIn < 3, cardGap }
}

export type NudgeKind = 'pace' | 'goal_delay' | 'fixed_cost' | 'price' | 'unused' | 'new_charge' | 'runway' | 'positive'

export interface Nudge {
  /** stable id; it changes when the underlying numbers change, so a dismissed nudge can come back with new facts */
  id: string
  kind: NudgeKind
  tone: 'alert' | 'warn' | 'good'
  title: string
  consequence: string
  action: { label: string; route: 'simulator' | 'leaks' | 'review' | 'profile' | 'mission' | 'overview'; param?: string }
  severity: number
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export function buildNudges(
  model: Model,
  profile: Profile,
  pace: PaceReport | null,
  decisions: Record<string, LeakDecision>,
): Nudge[] {
  const out: Nudge[] = []
  const efDate = model.baseline.emergency.date

  // 1. category pace against the pay cycle
  if (pace && !pace.tooEarly) {
    const left = Math.max(0, pace.cycleDays - pace.daysIn)
    for (const r of pace.rows.filter((r) => r.status !== 'green' && r.spent >= 300)) {
      const shift = r.goalShiftDays != null && r.goalShiftDays >= 1 ? ` Your emergency fund slips about ${Math.round(r.goalShiftDays)} days.` : ''
      out.push({
        id: `pace:${r.category}:${pace.cycleStart}:${r.status}`,
        kind: 'pace',
        tone: r.status === 'red' ? 'alert' : 'warn',
        title: `${r.category}: ${formatINR(r.spent)} spent vs ${formatINR(r.budget)} usual for the whole cycle, with ${left} days still to go.`,
        consequence: `At this pace the cycle ends near ${formatINR(r.projected)}, ${formatINR(r.overshoot)} more than usual.${shift}`,
        action: { label: `Cap ${r.category} in the simulator`, route: 'simulator' },
        severity: r.status === 'red' ? 80 + Math.min(15, r.ratio * 5) : 50,
      })
    }
    // 2. combined goal delay
    const totalShift = pace.rows.reduce((a, r) => a + (r.goalShiftDays ?? 0), 0)
    if (totalShift >= 3 && efDate) {
      out.push({
        id: `goal:${pace.cycleStart}:${Math.round(totalShift / 5)}`,
        kind: 'goal_delay',
        tone: 'warn',
        title: `At this pace, your emergency-fund date shifts by ${Math.round(totalShift)} days.`,
        consequence: `Overspending in ${pace.rows.filter((r) => r.overshoot > 0).map((r) => r.category).join(', ')} this cycle eats into the ${formatINR(model.baseline.emergency.contribution ?? 0)}/month that goes to the fund.`,
        action: { label: 'See the goal date in the simulator', route: 'simulator' },
        severity: 70,
      })
    }
  }

  // 3. fixed costs that went up (rent, EMIs, bills, plans)
  for (const s of model.series) {
    if (!s.priceChange || !s.category || bucketOf(s.category) !== 'essential') continue
    out.push({
      id: `fixed:${s.key}:${s.priceChange.to}`,
      kind: 'fixed_cost',
      tone: 'warn',
      title: `${s.label} increased by ${formatINR(s.priceChange.to - s.priceChange.from)}/month.`,
      consequence: `${formatINR(s.priceChange.from)} → ${formatINR(s.priceChange.to)}. An essential going up shortens your survival runway.`,
      action: { label: 'Check it in Review', route: 'review' },
      severity: 60,
    })
  }

  // 4. recurring drains: price rises, unused memberships, new charges
  for (const l of model.leaks) {
    if (decisions[l.id] === 'keep' || decisions[l.id] === 'cancel') continue
    const gain = runwayGainDays(l.monthly, model.baseline.cash, model.baseline.burn)
    const gainText = gain != null ? ` Cancelling saves ${formatINR(l.monthly)}/month and adds about ${gain < 1 ? 'less than a day' : `${Math.round(gain)} days`} of lifestyle runway.` : ''
    if (l.priceChange) {
      out.push({
        id: `price:${l.id}:${l.priceChange.to}`,
        kind: 'price',
        tone: 'warn',
        title: `${l.label} increased from ${formatINR(l.priceChange.from)} to ${formatINR(l.priceChange.to)} per month.`,
        consequence: `That is ${formatINR((l.priceChange.to - l.priceChange.from) * 12)} more a year.${gainText}`,
        action: { label: 'Decide in Leak Radar', route: 'leaks' },
        severity: 55,
      })
    }
    if (l.unused && l.usage) {
      out.push({
        id: `unused:${l.id}`,
        kind: 'unused',
        tone: 'warn',
        title: `This ${formatINR(l.monthly)} ${l.label} membership has no matching usage in the last ${l.usage.daysSince} days.`,
        consequence: `No ${l.usage.label.toLowerCase()} since ${l.usage.lastUsed ?? 'it started'}.${gainText}`,
        action: { label: 'Review it in Leak Radar', route: 'leaks' },
        severity: 65,
      })
    }
    if (l.isNew && l.kind !== 'possible_duplicate') {
      out.push({
        id: `new:${l.id}`,
        kind: 'new_charge',
        tone: 'warn',
        title: `A new recurring charge of ${formatINR(l.monthly)} was detected: ${l.label}.`,
        consequence: `First charged on ${l.firstDate}${l.category == null ? ', from a merchant Runway does not recognise' : ''}.${gainText}`,
        action: { label: 'Investigate in Leak Radar', route: 'leaks' },
        severity: l.category == null ? 75 : 50,
      })
    }
  }

  // 5. runway below the user's threshold
  const s = model.baseline.survival
  if (s != null && s < profile.runwayAlertMonths) {
    out.push({
      id: `runway:${s.toFixed(1)}`,
      kind: 'runway',
      tone: 'alert',
      title: `Your survival runway is ${s.toFixed(1)} months, below your ${profile.runwayAlertMonths}-month alert.`,
      consequence: `If income stopped today, cash would cover essentials for about ${Math.round(s * DAYS_PER_MONTH)} days.`,
      action: { label: 'Try changes in the simulator', route: 'simulator' },
      severity: 90,
    })
  }

  // 6. positive reinforcement
  const cancelled = model.leaks.filter((l) => decisions[l.id] === 'cancel')
  if (cancelled.length) {
    const total = cancelled.reduce((a, l) => a + l.monthly, 0)
    const gain = runwayGainDays(total, model.baseline.cash, model.baseline.burn)
    out.push({
      id: `good:cancel:${cancelled.map((l) => l.id).join(',')}`,
      kind: 'positive',
      tone: 'good',
      title: `Cancelling ${cancelled.length === 1 ? cancelled[0].label : `${cancelled.length} subscriptions`} frees ${formatINR(total)}/month.`,
      consequence: `That adds about ${gain != null ? (gain < 1 ? 'less than a day' : `${Math.round(gain)} days`) : '—'} of lifestyle runway once the charges stop.`,
      action: { label: 'See the effect in the simulator', route: 'simulator' },
      severity: 20,
    })
  }
  // only praise categories where spending is actually visible this cycle; ₹0 may just mean missing data
  const good = pace?.rows.filter((r) => r.status === 'green' && r.budget >= 1000 && r.spent > 0 && r.ratio < 0.7 && !pace.tooEarly) ?? []
  if (good.length && pace) {
    out.push({
      id: `good:pace:${pace.cycleStart}`,
      kind: 'positive',
      tone: 'good',
      title: `${good.map((r) => r.category).join(', ')} ${good.length === 1 ? 'is' : 'are'} well under pace this cycle.`,
      consequence: `${pct(good[0].used)} of the usual ${good[0].category} spend used with ${pct(pace.elapsed)} of the cycle gone.`,
      action: { label: 'See all categories', route: 'overview' },
      severity: 10,
    })
  }

  return out.sort((a, b) => b.severity - a.severity)
}

/** Days until the next payday from asOf, for display. */
export function daysToPayday(p: PaceReport): number {
  return Math.max(0, diffDays(p.cycleEnd, p.asOf))
}

