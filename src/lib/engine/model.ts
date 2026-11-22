import { addDays, DAYS_PER_MONTH, daysInMonth, diffDays, monthKey, spanMonths, todayISO } from '../dates'
import {
  bucketOf,
  DEFAULT_SIM,
  ESSENTIAL_CATEGORIES,
  EXCLUDED_CATEGORIES,
  FLEXIBLE_CATEGORIES,
  LINE_TO_CATEGORY,
  type Category,
  type EssentialCategory,
  type ExcludedCategory,
  type FlexibleCategory,
  type Profile,
  type ProfileLines,
  type Rule,
  type SimState,
  type Txn,
} from '../types'
import {
  annotateLeaks,
  detectSalary,
  detectSeries,
  leaksFromSeries,
  possibleDuplicateCharges,
  type Leak,
  type SalaryDetection,
  type Series,
} from './recurring'
import { findReimbursements, resolveTxn, type ResolvedTxn } from './resolve'

export const GOAL_CAP_MONTHS = 120
export const DTI_CAUTION = 0.35
export const DTI_HIGH = 0.4

export type ValueSource = 'statements' | 'you' | 'none'

export interface BurnLine<C extends string = string> {
  category: C
  amount: number
  source: ValueSource
  /** what the statements alone imply, for comparison when the user typed an override */
  fromStatements: number
}

export interface Baseline {
  months: number
  period: { start: string; end: string } | null
  /** months used for averages: whole calendar months when the data has any, else the full span */
  basis: { months: string[]; partialExcluded: boolean }
  essential: BurnLine<EssentialCategory>[]
  flexible: BurnLine<FlexibleCategory>[]
  emb: number
  fs: number
  fsSource: ValueSource
  /** user typed a total flexible figure; the category lines are statement-only detail */
  flexibleOverride: number | null
}

/** Pure: monthly averages per category from resolved transactions. Refund credits net off their category. */
export function monthlyByCategory(active: ResolvedTxn[], months: number): Record<Category, number> {
  const totals = {} as Record<Category, number>
  for (const t of active) {
    for (const l of t.lines) {
      const sign = t.direction === 'debit' ? 1 : bucketOf(l.category) === 'income' ? 1 : -1
      totals[l.category] = (totals[l.category] ?? 0) + sign * l.amount
    }
  }
  const out = {} as Record<Category, number>
  for (const [k, v] of Object.entries(totals)) out[k as Category] = Math.max(0, v) / months
  return out
}

/** A calendar month counts as complete when the data runs from its first week to its last week. */
export function completeMonths(period: { start: string; end: string } | null): string[] {
  if (!period) return []
  const out: string[] = []
  let [y, m] = period.start.split('-').map(Number)
  const endKey = monthKey(period.end)
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (key > endKey) break
    const first = `${key}-06`
    const last = `${key}-${String(daysInMonth(y, m) - 5).padStart(2, '0')}`
    if (period.start <= first && period.end >= last) out.push(key)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/** The transactions monthly averages are based on: whole months if available, so a mid-month download does not skew rent or EMIs. */
export function averagingBasis(active: ResolvedTxn[]) {
  const dates = active.map((t) => t.date).sort()
  const period = dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
  const full = completeMonths(period)
  if (full.length) {
    const set = new Set(full)
    return { period, months: full.length, txns: active.filter((t) => set.has(monthKey(t.date))), keys: full, partialExcluded: active.some((t) => !set.has(monthKey(t.date))) }
  }
  return { period, months: period ? spanMonths(period.start, period.end) : 1, txns: active, keys: [] as string[], partialExcluded: false }
}

export function computeBaseline(active: ResolvedTxn[], profile: ProfileLines): Baseline {
  const basis = averagingBasis(active)
  const avg = monthlyByCategory(basis.txns, basis.months)

  const overrideFor: Partial<Record<EssentialCategory, number | null>> = {}
  for (const [key, cat] of Object.entries(LINE_TO_CATEGORY)) {
    overrideFor[cat] = profile[key as keyof typeof LINE_TO_CATEGORY]
  }

  const essential = ESSENTIAL_CATEGORIES.map((category) => {
    const fromStatements = avg[category] ?? 0
    const o = overrideFor[category]
    const useOverride = o != null
    return {
      category,
      amount: useOverride ? o! : fromStatements,
      source: (useOverride ? 'you' : fromStatements > 0 ? 'statements' : 'none') as ValueSource,
      fromStatements,
    }
  })
  const flexible = FLEXIBLE_CATEGORIES.map((category) => {
    const fromStatements = avg[category] ?? 0
    return {
      category,
      amount: fromStatements,
      source: (fromStatements > 0 ? 'statements' : 'none') as ValueSource,
      fromStatements,
    }
  })
  const fsStatements = flexible.reduce((a, l) => a + l.amount, 0)
  const emb = essential.reduce((a, l) => a + l.amount, 0)
  const fs = profile.flexible ?? fsStatements
  return {
    months: basis.months,
    period: basis.period,
    basis: { months: basis.keys, partialExcluded: basis.partialExcluded },
    essential,
    flexible,
    emb,
    fs,
    fsSource: profile.flexible != null ? 'you' : fsStatements > 0 ? 'statements' : 'none',
    flexibleOverride: profile.flexible,
  }
}

export function accessibleCash(profile: Profile): number | null {
  if (profile.accessibleCash == null) return null
  const fd = profile.includeFD ? Math.max(0, profile.fdAmount) * (1 - profile.fdHaircutPct / 100) : 0
  return profile.accessibleCash + fd
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export type GoalStatus = 'reached' | 'on_track' | 'not_achievable' | 'incomplete'

/**
 * Months to goal = offset + (target − saved) / contribution. Capped at 120 months; never a negative date.
 * `offsetMonths` delays the start (e.g. months without income in a scenario).
 */
export function goalMath(
  target: number | null,
  saved: number | null,
  contribution: number | null,
  today: string,
  offsetMonths = 0,
): { status: GoalStatus; gap: number | null; months: number | null; date: string | null } {
  if (target == null || saved == null) return { status: 'incomplete', gap: null, months: null, date: null }
  const gap = target - saved
  if (gap <= 0 && offsetMonths === 0) return { status: 'reached', gap: 0, months: 0, date: today }
  if (gap <= 0) return { status: 'on_track', gap: 0, months: offsetMonths, date: addDays(today, Math.ceil(offsetMonths * DAYS_PER_MONTH)) }
  if (contribution == null) return { status: 'incomplete', gap, months: null, date: null }
  if (contribution <= 0) return { status: 'not_achievable', gap, months: null, date: null }
  const months = offsetMonths + gap / contribution
  if (months > GOAL_CAP_MONTHS) return { status: 'not_achievable', gap, months: null, date: null }
  return { status: 'on_track', gap, months, date: addDays(today, Math.ceil(months * DAYS_PER_MONTH)) }
}

export interface GoalProjection {
  id: string
  name: string
  kind: 'emergency' | 'custom' | 'debt'
  target: number | null
  saved: number | null
  gap: number | null
  contribution: number | null
  contributionSource: 'you' | 'shared' | 'none'
  /** asked for more than the surplus could give */
  capped: boolean
  status: GoalStatus
  months: number | null
  date: string | null
  targetDate: string | null
  /** monthly amount needed to hit the target date, if one is set */
  required: number | null
  vsTarget: 'ahead' | 'on_time' | 'behind' | null
  daysVsTarget: number | null
  missing: string[]
}

interface GoalInput {
  id: string
  name: string
  kind: GoalProjection['kind']
  target: number | null
  saved: number | null
  targetDate: string | null
  explicit: number | null
  missing: string[]
}

/**
 * Surplus allocation, in order (emergency fund first, then goals as listed):
 * explicit monthly contributions are honoured first while surplus lasts; items without one share what is left equally.
 */
export function projectGoals(items: GoalInput[], surplus: number | null, today: string, offsetMonths: number): GoalProjection[] {
  let available = surplus == null ? 0 : Math.max(0, surplus)
  const alloc = new Map<string, { c: number; src: GoalProjection['contributionSource']; capped: boolean }>()
  const open = (i: GoalInput) => i.target != null && i.saved != null && i.target - i.saved > 0
  for (const i of items) {
    if (i.explicit != null && open(i)) {
      const c = Math.min(i.explicit, available)
      available -= c
      alloc.set(i.id, { c, src: 'you', capped: i.explicit > c + 0.5 })
    }
  }
  const sharers = items.filter((i) => i.explicit == null && open(i))
  for (const i of sharers) alloc.set(i.id, { c: sharers.length ? available / sharers.length : 0, src: 'shared', capped: false })

  return items.map((i) => {
    const a = alloc.get(i.id)
    const missing = [...i.missing]
    if (surplus == null) missing.push('take-home pay')
    const contribution = surplus == null ? null : (a?.c ?? 0)
    const gm = goalMath(i.target, i.saved, contribution, today, offsetMonths)
    const status: GoalStatus = missing.length && gm.status !== 'reached' ? 'incomplete' : gm.status
    let required: number | null = null
    let vsTarget: GoalProjection['vsTarget'] = null
    let daysVsTarget: number | null = null
    if (i.targetDate && gm.gap != null && gm.gap > 0) {
      const monthsLeft = diffDays(i.targetDate, today) / DAYS_PER_MONTH - offsetMonths
      required = monthsLeft > 0 ? gm.gap / monthsLeft : null
    }
    if (i.targetDate && status !== 'incomplete') {
      if (status === 'reached') vsTarget = 'ahead'
      else if (status === 'not_achievable' || !gm.date) vsTarget = 'behind'
      else {
        daysVsTarget = diffDays(i.targetDate, gm.date)
        vsTarget = daysVsTarget > 3 ? 'ahead' : daysVsTarget >= -3 ? 'on_time' : 'behind'
      }
    }
    return {
      id: i.id,
      name: i.name,
      kind: i.kind,
      target: i.target,
      saved: i.saved,
      gap: gm.gap,
      contribution,
      contributionSource: a?.src ?? 'none',
      capped: a?.capped ?? false,
      status,
      months: gm.months,
      date: status === 'incomplete' ? null : gm.date,
      targetDate: i.targetDate,
      required,
      vsTarget,
      daysVsTarget,
      missing,
    }
  })
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface Scenario {
  /** accessible cash after any emergency expense */
  cash: number | null
  /** cash left after the income gap (equals cash when there is no gap) */
  cashAfterGap: number | null
  /** months into the gap when cash runs out, if it does */
  runsOutAfter: number | null
  takeHome: number | null
  emb: number
  fs: number
  burn: number
  rentAdd: number
  emiAdd: number
  extraEssential: number
  leakCut: number
  catCutAmount: number
  cutAmount: number
  survival: number | null
  lifestyle: number | null
  surplus: number | null
  dti: number | null
  emi: number
  emergency: GoalProjection
  goals: GoalProjection[]
}

export interface ScenarioContext {
  base: Baseline
  cash: number | null
  takeHome: number | null
  profile: Profile
  leaks: Leak[]
  today: string
}

export function computeScenario(ctx: ScenarioContext, simIn: Partial<SimState>): Scenario {
  const sim = { ...DEFAULT_SIM, ...simIn, catCut: { ...DEFAULT_SIM.catCut, ...(simIn.catCut ?? {}) } }
  const { base, takeHome, profile } = ctx
  const rentLine = base.essential.find((l) => l.category === 'Rent')?.amount ?? 0
  const emiLine = base.essential.find((l) => l.category === 'EMI')?.amount ?? 0
  const rentAdd = rentLine * (sim.rentStressPct / 100)
  const emiAdd = emiLine * (sim.emiStressPct / 100)
  const extraEssential = Math.max(0, sim.extraEssential || 0)
  const emb = base.emb + rentAdd + emiAdd + extraEssential

  const disabled = new Set(sim.disabledLeaks)
  const leakCut = Math.min(
    base.fs,
    ctx.leaks.filter((l) => disabled.has(l.id) && l.kind !== 'possible_duplicate').reduce((a, l) => a + l.monthly, 0),
  )
  let fs = base.fs - leakCut
  const catLine = base.flexible.find((l) => l.category === sim.catCut.category)?.amount ?? 0
  const catCutAmount = Math.min(fs, catLine * (sim.catCut.pct / 100))
  fs -= catCutAmount
  const cutAmount = fs * (sim.cutPct / 100)
  fs -= cutAmount
  const burn = emb + fs

  const cash = ctx.cash != null ? ctx.cash - sim.shockExpense : null
  const gap = sim.incomeGapMonths
  const cashAfterGap = cash != null ? cash - gap * burn : null
  const runsOutAfter = cash != null && gap > 0 && burn > 0 && cash < gap * burn ? Math.max(0, cash / burn) : null
  const survival = cashAfterGap != null && emb > 0 ? Math.max(0, cashAfterGap) / emb : null
  const lifestyle = cashAfterGap != null && burn > 0 ? Math.max(0, cashAfterGap) / burn : null
  const surplus = takeHome != null ? takeHome - emb - fs : null
  const emi = emiLine + emiAdd
  const dti = takeHome != null && takeHome > 0 ? emi / takeHome : null

  // goals: emergency fund first, then the user's goals in order
  const ef = profile.emergency
  const efTarget = ef.targetOverride ?? (emb > 0 ? ef.months * emb : null)
  const efBalanceBase = ef.balance ?? ctx.cash
  const efSaved = efBalanceBase != null ? efBalanceBase - sim.shockExpense - gap * burn : null
  const efMissing: string[] = []
  if (efTarget == null) efMissing.push('essential expenses')
  if (efBalanceBase == null) efMissing.push('accessible cash')
  const items: GoalInput[] = [
    { id: 'emergency', name: 'Emergency fund', kind: 'emergency', target: efTarget, saved: efSaved, targetDate: ef.targetDate, explicit: ef.monthlyContribution, missing: efMissing },
    ...profile.goals.map((g) => ({
      id: g.id,
      name: g.name || (g.type === 'debt' ? 'Card debt payoff' : 'Goal'),
      kind: g.type,
      target: g.target,
      saved: g.saved ?? 0,
      targetDate: g.targetDate,
      explicit: g.monthlyContribution,
      missing: g.target == null ? ['target amount'] : [],
    })),
  ]
  const goals = projectGoals(items, surplus, ctx.today, gap)

  return {
    cash,
    cashAfterGap,
    runsOutAfter,
    takeHome,
    emb,
    fs,
    burn,
    rentAdd,
    emiAdd,
    extraEssential,
    leakCut,
    catCutAmount,
    cutAmount,
    survival,
    lifestyle,
    surplus,
    dti,
    emi,
    emergency: goals[0],
    goals: goals.slice(1),
  }
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

export interface NoiseSummary {
  /** total excluded amount, debits + credits */
  removed: number
  excludedDebits: number
  excludedCredits: number
  count: number
  byCategory: Record<ExcludedCategory, number>
  duplicates: number
  /** bank-side card bill payments matched to the card statement's "payment received" */
  cardBillPairs: number
  cardBillPayments: number
  /** monthly: every debit as the bank shows it vs what Runway counts as spending */
  apparentMonthly: number
  trueMonthly: number
}

export function noiseSummary(resolved: ResolvedTxn[], basisTxns: ResolvedTxn[], months: number): NoiseSummary {
  const byCategory = Object.fromEntries(EXCLUDED_CATEGORIES.map((c) => [c, 0])) as Record<ExcludedCategory, number>
  let excludedDebits = 0
  let excludedCredits = 0
  let count = 0
  let duplicates = 0
  for (const t of resolved) {
    if (t.flags.includes('duplicate')) {
      duplicates++
      continue
    }
    let touched = false
    for (const l of t.lines) {
      if (bucketOf(l.category) === 'excluded') {
        byCategory[l.category as ExcludedCategory] += l.amount
        if (t.direction === 'debit') excludedDebits += l.amount
        else excludedCredits += l.amount
        touched = true
      }
    }
    if (touched) count++
  }
  let allDebits = 0
  let countedDebits = 0
  for (const t of basisTxns) {
    if (t.direction !== 'debit') continue
    allDebits += t.amount
    for (const l of t.lines) {
      const b = bucketOf(l.category)
      if (b === 'essential' || b === 'flexible') countedDebits += l.amount
    }
  }
  return {
    removed: excludedDebits + excludedCredits,
    excludedDebits,
    excludedCredits,
    count,
    byCategory,
    duplicates,
    cardBillPairs: 0,
    cardBillPayments: 0,
    apparentMonthly: allDebits / months,
    trueMonthly: countedDebits / months,
  }
}

// ---------------------------------------------------------------------------
// The whole model
// ---------------------------------------------------------------------------

export interface Model {
  resolved: ResolvedTxn[]
  active: ResolvedTxn[]
  hasTransactions: boolean
  base: Baseline
  salary: SalaryDetection | null
  takeHome: number | null
  takeHomeSource: ValueSource
  payday: number | null
  cash: number | null
  /** the latest transaction date: "today" as far as the data knows */
  asOf: string | null
  series: Series[]
  leaks: Leak[]
  noise: NoiseSummary
  reviewCount: number
  autoClassified: number
  current: Scenario
  baseline: Scenario
  commitments: number
  ctx: ScenarioContext
}

export interface ModelInput {
  txns: Txn[]
  rules: Rule[]
  profile: Profile
  sim: Partial<SimState>
  today?: string
}

export function buildModel({ txns, rules, profile, sim, today = todayISO() }: ModelInput): Model {
  const none = new Set<string>()
  const first = txns.map((t) => resolveTxn(t, rules, none))
  const salary = detectSalary(first)
  const reimb = findReimbursements(first)
  const resolved = txns.map((t) => resolveTxn(t, rules, salary?.ids ?? none, reimb))

  const series = detectSeries(resolved)
  const recurringIds = new Set(series.flatMap((s) => s.txns.map((t) => t.id)))
  for (const t of resolved) {
    if (recurringIds.has(t.id)) {
      t.isRecurring = true
      if (!t.effectiveFlags.includes('recurring')) t.effectiveFlags.push('recurring')
    }
  }

  const active = resolved.filter((t) => !t.flags.includes('duplicate'))
  const pairs = pairCardBills(active)
  const asOf = active.length ? active.reduce((a, t) => (t.date > a ? t.date : a), active[0].date) : null
  const leaks = annotateLeaks([...leaksFromSeries(series), ...possibleDuplicateCharges(resolved)], active, asOf)

  const base = computeBaseline(active, profile)
  const basis = averagingBasis(active)
  const cash = accessibleCash(profile)
  const takeHome = profile.takeHome ?? salary?.takeHome ?? null
  const ctx: ScenarioContext = { base, cash, takeHome, profile, leaks, today }
  const subs = leaks.filter((l) => l.kind !== 'possible_duplicate').reduce((a, l) => a + l.monthly, 0)
  const emiLine = base.essential.find((l) => l.category === 'EMI')?.amount ?? 0

  return {
    resolved,
    active,
    hasTransactions: active.length > 0,
    base,
    salary,
    takeHome,
    takeHomeSource: profile.takeHome != null ? 'you' : salary ? 'statements' : 'none',
    payday: profile.payday ?? salary?.payday ?? null,
    cash,
    asOf,
    series,
    leaks,
    noise: { ...noiseSummary(resolved, basis.txns, base.months), cardBillPairs: pairs.paired, cardBillPayments: pairs.payments },
    reviewCount: resolved.filter((t) => t.needsReview).length,
    autoClassified: active.filter((t) => t.category != null).length,
    current: computeScenario(ctx, sim),
    baseline: computeScenario(ctx, DEFAULT_SIM),
    commitments: emiLine + subs,
    ctx,
  }
}

/** Days of lifestyle runway a monthly cost uses up each month: cost ÷ daily burn. */
export function daysOfRunwayPerMonth(monthly: number, burn: number): number | null {
  if (burn <= 0) return null
  return monthly / (burn / DAYS_PER_MONTH)
}

/** Extra days of lifestyle runway if a monthly cost disappeared. */
export function runwayGainDays(monthly: number, cash: number | null, burn: number): number | null {
  if (cash == null || burn <= 0 || monthly <= 0) return null
  const after = burn - monthly
  if (after <= 0) return null
  return (cash / after - cash / burn) * DAYS_PER_MONTH
}

export type DtiBand = 'ok' | 'caution' | 'high'
export function dtiBand(dti: number): DtiBand {
  if (dti > DTI_HIGH) return 'high'
  if (dti >= DTI_CAUTION) return 'caution'
  return 'ok'
}

export function isFlexible(c: Category): c is FlexibleCategory {
  return bucketOf(c) === 'flexible'
}

/**
 * Pairs each bank-side card bill payment with the card statement's "payment received" credit
 * (same amount, within 5 days) and says so on both rows: the money moved once, and is counted once.
 */
export function pairCardBills(active: ResolvedTxn[]): { paired: number; payments: number } {
  const bankPays = active.filter((t) => t.direction === 'debit' && t.category === 'CC repayment' && t.statementType !== 'card')
  const cardCredits = active.filter((t) => t.direction === 'credit' && t.category === 'CC repayment' && t.statementType === 'card')
  const used = new Set<string>()
  let paired = 0
  for (const b of bankPays) {
    const c = cardCredits.find((x) => !used.has(x.id) && Math.abs(x.amount - b.amount) < 1 && Math.abs(diffDays(x.date, b.date)) <= 5)
    if (!c) continue
    used.add(c.id)
    paired++
    b.reason += ` Paired with the card statement's payment received on ${c.date}: the card purchases are counted from the card, so this bill is not counted again.`
    c.reason += ` Paired with your bank's card bill payment on ${b.date}.`
  }
  return { paired, payments: bankPays.length }
}
