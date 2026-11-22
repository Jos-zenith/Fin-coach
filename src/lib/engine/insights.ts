import { DAYS_PER_MONTH, diffDays, formatDateShort, monthKey } from '../dates'
import { formatINR } from '../format'
import type { Reconciliation } from '../ingest/reconcile'
import { DEFAULT_SIM, type FlexibleCategory, type Profile, type SimState } from '../types'
import { averagingBasis, computeScenario, type Model, type Scenario } from './model'
import type { Leak } from './recurring'

/** How much monthly spending must fall before anything can be saved. null when there is already a surplus. */
export function breakEvenGap(s: Scenario): number | null {
  return s.surplus != null && s.surplus < 0 ? -s.surplus : null
}

export interface Plan {
  sim: Partial<SimState>
  steps: string[]
  leaks: Leak[]
  category: FlexibleCategory | null
  scenario: Scenario
  surplusGain: number | null
  lifestyleGainDays: number | null
  /** days the emergency fund arrives sooner; null if neither side has a date */
  efSoonerDays: number | null
  /** the plan makes a goal reachable that was not */
  unlocks: boolean
}

const CUTTABLE: FlexibleCategory[] = ['Dining', 'Food delivery', 'Shopping', 'Entertainment', 'Travel']

/**
 * One concrete "try this": cancel drains that look unused or unrecognised, and trim the largest
 * day-to-day category by 30%. Generic actions only, never a product.
 */
export function suggestPlan(model: Model): Plan | null {
  if (!model.hasTransactions && model.base.fs <= 0) return null
  const leaks = model.leaks.filter((l) => l.kind !== 'possible_duplicate' && (l.unused || (l.category == null && (l.isNew || l.kind === 'mandate'))))
  const top = model.base.flexible.filter((l) => CUTTABLE.includes(l.category) && l.amount >= 1000).sort((a, b) => b.amount - a.amount)[0]
  if (!leaks.length && !top) return null
  const sim: Partial<SimState> = {
    ...DEFAULT_SIM,
    disabledLeaks: leaks.map((l) => l.id),
    catCut: top ? { category: top.category, pct: 30 } : DEFAULT_SIM.catCut,
  }
  const scenario = computeScenario(model.ctx, sim)
  const base = model.baseline
  const steps: string[] = []
  if (leaks.length) steps.push(`Cancel ${leaks.map((l) => l.label).join(' and ')}`)
  if (top) steps.push(`cut ${top.category === 'Dining' ? 'dining out' : top.category.toLowerCase()} by 30%`)
  const efSooner = base.emergency.date && scenario.emergency.date && scenario.emergency.status === 'on_track' ? diffDays(base.emergency.date, scenario.emergency.date) : null
  return {
    sim,
    steps,
    leaks,
    category: top?.category ?? null,
    scenario,
    surplusGain: scenario.surplus != null && base.surplus != null ? scenario.surplus - base.surplus : null,
    lifestyleGainDays: scenario.lifestyle != null && base.lifestyle != null ? (scenario.lifestyle - base.lifestyle) * DAYS_PER_MONTH : null,
    efSoonerDays: efSooner,
    unlocks: base.emergency.status !== 'on_track' && scenario.emergency.status === 'on_track',
  }
}

/** Unreviewed debits count as spending until classified. This is how much that is per month. */
export function unreviewedMonthly(model: Model): number {
  const basis = averagingBasis(model.active)
  let total = 0
  for (const t of basis.txns) if (t.direction === 'debit' && t.category == null) total += t.amount
  return total / basis.months
}

/** Lifestyle runway if every unreviewed debit turned out not to be spending: the top of the honest range. */
export function lifestyleRange(model: Model, s: Scenario): { low: number; high: number; unreviewed: number } | null {
  const u = unreviewedMonthly(model)
  if (s.cash == null || s.lifestyle == null || u < 100 || s.burn - u <= 0) return null
  return { low: s.lifestyle, high: Math.max(0, s.cash) / (s.burn - u), unreviewed: u }
}

export interface Assumption {
  kind: 'data' | 'method' | 'limit'
  text: string
}

/** Plain list of what the numbers rest on, for the monthly review and the guardrails. */
export function assumptions(model: Model, profile: Profile, reconciliations: { label: string; rec: Reconciliation }[]): Assumption[] {
  const out: Assumption[] = []
  const b = model.base
  if (b.basis.months.length) {
    out.push({ kind: 'method', text: `Monthly figures are averages of ${b.basis.months.length} complete month${b.basis.months.length === 1 ? '' : 's'} (${b.basis.months.map((k) => formatDateShort(`${k}-01`).slice(2)).join(', ')})${b.basis.partialExcluded ? '; the partial current month is left out of averages.' : '.'}` })
  } else if (b.period) {
    out.push({ kind: 'method', text: `Monthly figures are averaged over ${b.months.toFixed(1)} months of data, with no complete calendar month yet.` })
  }
  out.push({ kind: 'data', text: profile.accessibleCash != null ? `Accessible cash of ${formatINR(profile.accessibleCash)} is the figure you entered${profile.includeFD ? `, plus FDs at ${100 - profile.fdHaircutPct}%` : ''}. Investments, retirement accounts and credit limits are not counted.` : 'Accessible cash has not been entered, so runway cannot be calculated.' })
  out.push({ kind: 'data', text: model.takeHomeSource === 'statements' && model.salary ? `Take-home pay of ${formatINR(model.salary.takeHome)} was detected from repeating credits (“${model.salary.label}”).` : model.takeHomeSource === 'you' ? 'Take-home pay is the figure you entered.' : 'Take-home pay is unknown, so surplus and goal dates cannot be calculated.' })
  const u = unreviewedMonthly(model)
  if (model.reviewCount > 0) out.push({ kind: 'limit', text: `${model.reviewCount} transactions are unreviewed; ${formatINR(u)}/month of them is counted as flexible spending until you classify it.` })
  const netted = model.resolved.filter((t) => t.direction === 'credit' && t.classSource === 'detected' && t.category !== 'Salary').length
  if (netted) out.push({ kind: 'method', text: `${netted} incoming transfer${netted === 1 ? ' was' : 's were'} treated as reimbursements and netted against the matching spending, not counted as income.` })
  const card = model.active.filter((t) => t.statementType === 'card')
  if (model.noise.byCategory['CC repayment'] > 0 && !card.length) out.push({ kind: 'limit', text: 'Card bills are excluded to avoid double-counting, but no card statement is loaded, so card purchases are missing.' })
  else if (card.length) {
    const last = card.reduce((a, t) => (t.date > a ? t.date : a), card[0].date)
    if (model.asOf && monthKey(last) < monthKey(model.asOf)) out.push({ kind: 'limit', text: `The card statement ends ${formatDateShort(last)}; card spending after that is not included.` })
  }
  for (const r of reconciliations) {
    out.push({
      kind: r.rec.ok ? 'data' : 'limit',
      text: r.rec.ok
        ? `${r.label}: running balances reconcile across all ${r.rec.checked} consecutive rows, so no rows appear to be missing.`
        : `${r.label}: ${r.rec.breaks.length} place${r.rec.breaks.length === 1 ? '' : 's'} where the running balance does not add up (first near ${formatDateShort(r.rec.breaks[0].date)}). Rows may be missing or mis-read.`,
    })
  }
  out.push({ kind: 'method', text: 'Recurring charges are found from repeating debits 25–35 days apart. A repeat is not proof of an active mandate.' })
  out.push({ kind: 'limit', text: 'No interest, returns, inflation or tax is modelled. Goal dates assume the same contribution every month and are rounded up.' })
  out.push({ kind: 'limit', text: 'The 35% / 40% EMI-load marks are rules of thumb, not regulatory limits.' })
  return out
}
