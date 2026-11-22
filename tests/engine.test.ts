import { describe, expect, it } from 'vitest'
import { buildTxns } from '../src/lib/ingest/build'
import type { RawRecord } from '../src/lib/ingest/statement'
import { buildModel, daysOfRunwayPerMonth, dtiBand, goalMath, runwayGainDays } from '../src/lib/engine/model'
import { buildMissionReview } from '../src/lib/engine/review'
import { findRule, resolveTxn } from '../src/lib/engine/resolve'
import { DEFAULT_PROFILE, DEFAULT_SIM, type Profile, type Rule, type Txn } from '../src/lib/types'

const TODAY = '2026-11-01'

/** Three clean months with hand-checkable numbers. */
function handTxns(): Txn[] {
  const recs: RawRecord[] = []
  const add = (date: string, desc: string, amount: number, direction: 'debit' | 'credit') =>
    recs.push({ date, postedDate: null, rawDescription: desc, reference: null, amount, direction, balanceAfter: null })
  for (const m of ['08', '09', '10']) {
    add(`2026-${m}-01`, 'NEFT CR-ACME TECHNOLOGIES-SALARY', 60000, 'credit')
    add(`2026-${m}-03`, 'UPI-LANDLORD-landlord.rent@okaxis-HDFC0001-612300000001-RENT', 15000, 'debit')
    add(`2026-${m}-05`, 'ACH D- BAJAJ FINANCE LTD-EMI', 6000, 'debit')
    add(`2026-${m}-10`, 'UPI-BIGBASKET-bigbasket@ybl-YESB0-612300000002-ORDER', 4000, 'debit')
    add(`2026-${m}-12`, 'UPI-AIRTEL-airtelpostpaid@icici-ICIC0-612300000003-POSTPAID', 1000, 'debit')
    add(`2026-${m}-14`, 'UPI-SWIGGY-swiggy@icici-ICIC0-612300000004-FOOD', 3000, 'debit')
    add(`2026-${m}-20`, 'UPI-NETFLIX-netflixupi@hdfcbank-HDFC0-612300000005-UPI AUTOPAY', 500, 'debit')
    add(`2026-${m}-22`, 'POS 4592XXXXXXXX1121 MYNTRA DESIGNS', 3500, 'debit')
    add(`2026-${m}-25`, 'CRED CLUB-HDFC CC XX4412 BILL PAYMENT', 9000, 'debit')
  }
  add('2026-10-31', 'UPI-SWIGGY-swiggy@icici-ICIC0-612300000006-FOOD', 0.01, 'debit') // extends the period to 31 Oct
  return buildTxns(recs, { source: 'csv', statementType: 'bank', batchId: 'h', importedAt: 'now' }).txns
}

const profile = (p: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, accessibleCash: 100000, ...p })

describe('core formulas (hand-checked)', () => {
  // EMB = rent 15000 + EMI 6000 + groceries 4000 + utilities 1000 = 26000
  // FS  = swiggy 3000 + netflix 500 + myntra 3500 = 7000 (+0.01/3)
  const m = buildModel({ txns: handTxns(), rules: [], profile: profile(), sim: DEFAULT_SIM, today: TODAY })

  it('averages over whole months and detects salary + payday', () => {
    expect(m.base.months).toBe(3)
    expect(m.takeHome).toBe(60000)
    expect(m.payday).toBe(1)
  })
  it('essential monthly burn', () => {
    expect(m.base.emb).toBeCloseTo(26000, 0)
  })
  it('flexible spend excludes the card bill', () => {
    expect(m.base.fs).toBeCloseTo(7000, 0)
    expect(m.noise.byCategory['CC repayment']).toBe(27000)
  })
  it('survival and lifestyle runway', () => {
    expect(m.current.survival).toBeCloseTo(100000 / 26000, 3) // 3.85
    expect(m.current.lifestyle).toBeCloseTo(100000 / 33000, 2) // 3.03
  })
  it('surplus and DTI', () => {
    expect(m.current.surplus).toBeCloseTo(60000 - 26000 - 7000, 0) // 27000
    expect(m.current.dti).toBeCloseTo(0.1, 3)
  })
  it('emergency goal: 6 × EMB, saved = accessible cash', () => {
    // target 156000, gap 56000, 56000 / 27000 = 2.07 months
    expect(m.current.emergency.target).toBeCloseTo(156000, 0)
    expect(m.current.emergency.months).toBeCloseTo(56000 / 27000, 2)
    expect(m.current.emergency.status).toBe('on_track')
    // 2.074 months × 30.4375 = 63.1 days, rounded up so the date is never optimistic
    expect(m.current.emergency.date).toBe('2027-01-04')
  })
  it('apparent vs true spend shows the noise', () => {
    expect(m.noise.apparentMonthly - m.noise.trueMonthly).toBeCloseTo(9000, 0)
  })
})

describe('simulator', () => {
  const txns = handTxns()
  const base = buildModel({ txns, rules: [], profile: profile(), sim: DEFAULT_SIM, today: TODAY })
  const netflix = base.leaks.find((l) => l.label === 'Netflix')!

  it('flexible cut moves lifestyle runway and surplus, not survival runway', () => {
    const m = buildModel({ txns, rules: [], profile: profile(), sim: { ...DEFAULT_SIM, cutPct: 20 }, today: TODAY })
    expect(m.current.survival).toBeCloseTo(base.current.survival!, 6)
    expect(m.current.fs).toBeCloseTo(base.current.fs * 0.8, 2)
    expect(m.current.lifestyle!).toBeGreaterThan(base.current.lifestyle!)
    expect(m.current.surplus!).toBeCloseTo(base.current.surplus! + base.current.fs * 0.2, 2)
  })
  it('cancelling a leak removes its monthly amount before the % cut', () => {
    const m = buildModel({ txns, rules: [], profile: profile(), sim: { ...DEFAULT_SIM, disabledLeaks: [netflix.id], cutPct: 10 }, today: TODAY })
    expect(m.current.leakCut).toBe(500)
    expect(m.current.fs).toBeCloseTo((base.base.fs - 500) * 0.9, 2)
  })
  it('rent and EMI stress move survival runway', () => {
    const m = buildModel({ txns, rules: [], profile: profile(), sim: { ...DEFAULT_SIM, rentStressPct: 20, emiStressPct: 10 }, today: TODAY })
    expect(m.current.emb).toBeCloseTo(26000 + 3000 + 600, 0)
    expect(m.current.survival).toBeCloseTo(100000 / 29600, 3)
    expect(m.current.dti).toBeCloseTo(6600 / 60000, 4)
  })
  it('a contribution above the surplus is capped and reported', () => {
    const m = buildModel({ txns, rules: [], profile: profile({ emergency: { ...DEFAULT_PROFILE.emergency, monthlyContribution: 50000 } }), sim: DEFAULT_SIM, today: TODAY })
    expect(m.current.emergency.contribution).toBeCloseTo(m.current.surplus!, 2)
    expect(m.current.emergency.capped).toBe(true)
  })
})

describe('goal edge cases', () => {
  it('reached, negative surplus, zero surplus, beyond 120 months, missing data', () => {
    expect(goalMath(100, 150, 10, TODAY).status).toBe('reached')
    expect(goalMath(1000, 0, -50, TODAY).status).toBe('not_achievable')
    expect(goalMath(1000, 0, 0, TODAY).status).toBe('not_achievable')
    expect(goalMath(1_21_000, 0, 1000, TODAY)).toMatchObject({ status: 'not_achievable', date: null })
    expect(goalMath(1_20_000, 0, 1000, TODAY).status).toBe('on_track')
    expect(goalMath(null, 0, 1000, TODAY).status).toBe('incomplete')
  })
  it('custom goal without a target is incomplete, not a fake date', () => {
    const goal = { id: 'g', name: 'Car', type: 'custom' as const, target: null, saved: null, targetDate: null, monthlyContribution: null }
    const m = buildModel({ txns: handTxns(), rules: [], profile: profile({ goals: [goal] }), sim: DEFAULT_SIM, today: TODAY })
    expect(m.current.goals[0].status).toBe('incomplete')
    expect(m.current.goals[0].date).toBeNull()
    expect(m.current.goals[0].missing).toContain('target amount')
  })
  it('works from the manual profile alone, with no transactions', () => {
    const m = buildModel({ txns: [], rules: [], profile: profile({ takeHome: 50000, rent: 15000, emi: 5000, groceries: 4000, flexible: 10000 }), sim: DEFAULT_SIM, today: TODAY })
    expect(m.base.emb).toBe(24000)
    expect(m.current.survival).toBeCloseTo(100000 / 24000, 4)
    expect(m.current.lifestyle).toBeCloseTo(100000 / 34000, 4)
    expect(m.current.surplus).toBe(16000)
  })
})

describe('rules and the correction loop', () => {
  const txns = handTxns()
  const swiggy = txns.find((t) => t.merchantGuess === 'Swiggy')!

  it('a contains rule reclassifies every matching transaction, and the newest rule wins', () => {
    const older: Rule = { id: 'r1', matchType: 'contains', token: 'swiggy', category: 'Dining', createdAt: '2026-11-01T00:00:00Z' }
    const newer: Rule = { id: 'r2', matchType: 'contains', token: 'swiggy', category: 'Groceries', createdAt: '2026-11-02T00:00:00Z' }
    expect(findRule(swiggy, [older, newer])!.id).toBe('r2')
    const m = buildModel({ txns, rules: [older], profile: profile(), sim: DEFAULT_SIM, today: TODAY })
    expect(m.resolved.filter((t) => t.merchantGuess === 'Swiggy').every((t) => t.category === 'Dining' && t.classSource === 'rule')).toBe(true)
  })
  it('a single-transaction pin beats a contains rule', () => {
    const rule: Rule = { id: 'r1', matchType: 'contains', token: 'swiggy', category: 'Dining', createdAt: '2026-11-03T00:00:00Z' }
    const pin: Rule = { id: 'p1', matchType: 'txn', token: swiggy.id, category: 'Ignored', createdAt: '2026-11-01T00:00:00Z' }
    const r = resolveTxn(swiggy, [rule, pin], new Set())
    expect(r.category).toBe('Ignored')
    expect(r.classSource).toBe('user')
  })
  it('P2P split with my share keeps the share and excludes the rest', () => {
    const rent = txns.find((t) => t.autoCategory === 'Rent')!
    const rule: Rule = { id: 's', matchType: 'contains', token: 'landlord', category: 'P2P split', myShare: 7500, shareCategory: 'Rent', createdAt: 'x' }
    const r = resolveTxn(rent, [rule], new Set())
    expect(r.lines).toEqual([
      { category: 'Rent', amount: 7500 },
      { category: 'P2P split', amount: 7500 },
    ])
    const m = buildModel({ txns, rules: [rule], profile: profile(), sim: DEFAULT_SIM, today: TODAY })
    expect(m.base.emb).toBeCloseTo(26000 - 7500, 0)
  })
  it('recalculates 1,000 transactions well under 200 ms', () => {
    const many: Txn[] = []
    for (let i = 0; i < 1000; i++) many.push({ ...txns[i % txns.length], id: `t${i}` })
    const rule: Rule = { id: 'r', matchType: 'contains', token: 'swiggy', category: 'Dining', createdAt: 'x' }
    buildModel({ txns: many, rules: [rule], profile: profile(), sim: DEFAULT_SIM, today: TODAY })
    const t0 = performance.now()
    buildModel({ txns: many, rules: [rule], profile: profile(), sim: DEFAULT_SIM, today: TODAY })
    expect(performance.now() - t0).toBeLessThan(200)
  })
})

describe('leak radar', () => {
  const m = buildModel({ txns: handTxns(), rules: [], profile: profile(), sim: DEFAULT_SIM, today: TODAY })
  it('finds the monthly subscription but not rent, EMI or frequent merchants', () => {
    const labels = m.leaks.map((l) => l.label)
    expect(labels).toContain('Netflix')
    expect(labels).not.toContain('Rent')
    expect(m.leaks.find((l) => l.label === 'Netflix')!.confidence).toBe('high')
    expect(m.resolved.find((t) => t.autoCategory === 'Rent')!.isRecurring).toBe(true)
  })
  it('expresses cost in days of runway', () => {
    expect(daysOfRunwayPerMonth(500, 33000)).toBeCloseTo(500 / (33000 / 30.4375), 4)
    expect(runwayGainDays(500, 100000, 33000)!).toBeGreaterThan(0)
  })
  it('DTI bands use 35% / 40%', () => {
    expect(dtiBand(0.2)).toBe('ok')
    expect(dtiBand(0.35)).toBe('caution')
    expect(dtiBand(0.41)).toBe('high')
  })
})

describe('mission review', () => {
  it('compares the last complete month with the one before', () => {
    const m = buildModel({ txns: handTxns(), rules: [], profile: profile(), sim: DEFAULT_SIM, today: TODAY })
    const r = buildMissionReview(m)!
    expect(r.current.key).toBe('2026-10')
    expect(r.previous!.key).toBe('2026-09')
    expect(r.current.income).toBe(60000)
    expect(r.current.essential).toBe(26000)
    expect(r.current.savingsRate).toBeCloseTo((60000 - 26000 - 7000.01) / 60000, 4)
    expect(r.nextAction.length).toBeGreaterThan(20)
  })
})
