import { describe, expect, it } from 'vitest'
import { buildModel, completeMonths, projectGoals } from '../src/lib/engine/model'
import { buildNudges, computePace, payCycle } from '../src/lib/engine/nudges'
import { findRule, resolveTxn } from '../src/lib/engine/resolve'
import { buildMissionReview, reviewToMarkdown } from '../src/lib/engine/review'
import { buildTxns } from '../src/lib/ingest/build'
import { parsePdfLines } from '../src/lib/ingest/pdf'
import { parseSmsBlock } from '../src/lib/ingest/sms'
import { sampleProfile, sampleTxns } from '../src/lib/sample'
import { DEFAULT_PROFILE, DEFAULT_SIM, type Rule } from '../src/lib/types'

const TODAY = '2026-11-21'
const txns = sampleTxns('2026-11-01T00:00:00Z')
const learned: Rule = { id: 'k', matchType: 'contains', matchField: 'vpa', token: 'karthik.v@okicici', category: 'Dining', createdAt: '2026-11-21T10:00:00Z' }
const model = (sim = DEFAULT_SIM, rules: Rule[] = [learned], profile = sampleProfile()) =>
  buildModel({ txns, rules, profile, sim, today: TODAY })

describe('1 · PDF ingestion (text lines → transactions)', () => {
  const lines = [
    'HDFC BANK LTD  Statement of account',
    'Date  Narration  Chq./Ref.No.  Value Dt  Withdrawal Amt.  Deposit Amt.  Closing Balance',
    'Opening Balance  44,450.00',
    '01/08/26  NEFT CR-CITI0000002-ACME TECHNOLOGIES-SALARY AUG  CITIN2608  01/08/26  68,000.00  1,12,450.00',
    '03/08/26  UPI-RAMESH IYER-ramesh.iyer58@okhdfcbank-  0000621234567890  03/08/26  26,000.00  86,450.00',
    'HDFC0001234-621234567890-FLAT RENT AUG',
    '05/08/26  ACH D- BAJAJ FINANCE LTD-P407712  05/08/26  3,850.00  82,600.00',
    '09/08/26  UPI-NETFLIX-netflixupi@hdfcbank  09/08/26  499.00  82,101.00',
    '12/08/26  REVERSAL OF CHARGES  12/08/26',
    'Page 1 of 2',
  ]
  const res = parsePdfLines(lines, { statementType: 'bank' })
  it('reads dated rows, joins wrapped narrations and uses the balance to tell debit from credit', () => {
    expect(res.records).toHaveLength(4)
    expect(res.records[0]).toMatchObject({ date: '2026-08-01', amount: 68000, direction: 'credit', balanceAfter: 112450, directionFrom: 'balance' })
    expect(res.records[1]).toMatchObject({ amount: 26000, direction: 'debit' })
    expect(res.records[1].rawDescription).toContain('FLAT RENT AUG')
    expect(res.records[3]).toMatchObject({ amount: 499, direction: 'debit', balanceAfter: 82101 })
  })
  it('reports dated lines it could not use', () => {
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0].reason).toMatch(/no amount/)
  })
  it('flows through the same sanitizer', () => {
    const built = buildTxns(res.records, { source: 'csv', statementType: 'bank', batchId: 'p', importedAt: 'now' })
    expect(built.txns[0].autoCategory).toBe('Salary')
    expect(built.txns[1].autoCategory).toBe('Rent')
    expect(built.txns[2].autoCategory).toBe('EMI')
    expect(built.txns[3].autoCategory).toBe('Subscriptions')
  })
  it('handles card statements with Cr markers', () => {
    const card = parsePdfLines(['02/08/2026  AMAZON PAY INDIA  1,499.00', '15/08/2026  PAYMENT RECEIVED - THANK YOU  18,420.00 Cr'], { statementType: 'card' })
    expect(card.records.map((r) => r.direction)).toEqual(['debit', 'credit'])
  })
})

describe('2 · correction loop', () => {
  it('UPI-ID-only rules match the VPA and nothing else', () => {
    const rule: Rule = { id: 'v', matchType: 'contains', matchField: 'vpa', token: 'karthik.v@okicici', category: 'P2P split', createdAt: 'x' }
    const karthik = txns.find((t) => t.vpa === 'karthik.v@okicici')!
    const other = txns.find((t) => t.rawDescription.includes('KARTHIK') === false && t.vpa)!
    expect(findRule(karthik, [rule])?.id).toBe('v')
    expect(findRule(other, [rule])).toBeNull()
    const merchantOnly: Rule = { ...rule, matchField: 'merchant', token: 'okicici' }
    expect(findRule(karthik, [merchantOnly])).toBeNull()
  })
  it('a manual split spreads one transaction across categories', () => {
    const big = txns.find((t) => t.rawDescription.includes('GENIE RETAIL'))!
    const rule: Rule = { id: 'm', matchType: 'txn', token: big.id, category: 'Shopping', splits: [{ category: 'Groceries', amount: 500 }], createdAt: 'x' }
    const r = resolveTxn(big, [rule], new Set())
    expect(r.lines).toEqual([
      { category: 'Groceries', amount: 500 },
      { category: 'Shopping', amount: big.amount - 500 },
    ])
  })
  it('a newly pasted SMS matching a rule is categorized by it', () => {
    const sms = parseSmsBlock('Rs 1,200 debited from A/c XX2210 on 18-11-26 to karthik.v@okicici UPI Ref 612399999999', TODAY)
    const built = buildTxns(sms.records, { source: 'sms', statementType: 'bank', batchId: 's', importedAt: 'now' }, txns)
    const rule: Rule = { id: 'v', matchType: 'contains', matchField: 'vpa', token: 'karthik.v@okicici', category: 'Dining', createdAt: 'x' }
    expect(resolveTxn(built.txns[0], [rule], new Set()).category).toBe('Dining')
  })
})

describe('3 · recurring payments, change and unused alerts', () => {
  const m = model()
  const leak = (re: RegExp) => m.leaks.find((l) => re.test(l.label))!
  it('price increase', () => expect(leak(/netflix/i).priceChange).toMatchObject({ from: 499, to: 649 }))
  it('possibly unused: a membership with no matching usage for 60+ days', () => {
    const gold = leak(/zomato gold/i)
    expect(gold.unused).toBe(true)
    expect(gold.usage?.daysSince).toBeGreaterThanOrEqual(60)
    expect(leak(/swiggy one/i).unused).toBe(false)
  })
  it('new recurring charge from an unrecognised mandate', () => {
    const l = leak(/learnify/i)
    expect(l.isNew).toBe(true)
    expect(l.category).toBeNull()
  })
  it('fixed-cost increase on an essential bill, and EMIs present', () => {
    const act = m.series.find((s) => /act/i.test(s.label))!
    expect(act.priceChange).toMatchObject({ from: 1049, to: 1149 })
    expect(m.base.essential.find((l) => l.category === 'EMI')!.amount).toBe(8050)
  })
})

describe('4 · persistent profile: averages ignore the partial month', () => {
  it('uses whole calendar months only', () => {
    expect(completeMonths({ start: '2026-08-01', end: '2026-11-16' })).toEqual(['2026-08', '2026-09', '2026-10'])
    const m = model()
    expect(m.base.months).toBe(3)
    expect(m.base.basis.partialExcluded).toBe(true)
    expect(m.base.essential.find((l) => l.category === 'Rent')!.amount).toBe(13000)
  })
})

describe('5 · goals and what-if', () => {
  it('explicit contributions first, the rest shared; target dates compared', () => {
    const goals = projectGoals(
      [
        { id: 'a', name: 'EF', kind: 'emergency', target: 100000, saved: 40000, targetDate: '2027-06-01', explicit: null, missing: [] },
        { id: 'b', name: 'Trip', kind: 'custom', target: 30000, saved: 0, targetDate: '2027-01-01', explicit: 5000, missing: [] },
      ],
      15000,
      '2026-11-01',
      0,
    )
    expect(goals[1].contribution).toBe(5000)
    expect(goals[0].contribution).toBe(10000)
    expect(goals[0].months).toBeCloseTo(6, 5)
    expect(goals[1].vsTarget).toBe('behind')
    expect(goals[1].required).toBeGreaterThan(5000)
  })
  it('cutting dining by 30% lowers flexible spend by exactly 30% of dining', () => {
    const base = model()
    const cut = model({ ...DEFAULT_SIM, catCut: { category: 'Dining', pct: 30 } })
    const dining = base.base.flexible.find((l) => l.category === 'Dining')!.amount
    expect(base.current.fs - cut.current.fs).toBeCloseTo(dining * 0.3, 2)
    expect(cut.current.surplus! - base.current.surplus!).toBeCloseTo(dining * 0.3, 2)
  })
  it('a rent increase lowers survival runway and surplus', () => {
    const base = model()
    const up = model({ ...DEFAULT_SIM, rentStressPct: 10 })
    expect(up.current.survival!).toBeLessThan(base.current.survival!)
    expect(base.current.surplus! - up.current.surplus!).toBeCloseTo(1300, 2)
  })
  it('an income interruption drains cash and delays the emergency fund', () => {
    const base = model()
    const gap = model({ ...DEFAULT_SIM, incomeGapMonths: 2 })
    expect(gap.current.cashAfterGap).toBeCloseTo(base.current.cash! - 2 * base.current.burn, 2)
    expect(gap.current.emergency.date! > base.current.emergency.date!).toBe(true)
  })
  it('an emergency expense reduces cash and runway immediately', () => {
    const base = model()
    const shock = model({ ...DEFAULT_SIM, shockExpense: 40000 })
    expect(shock.current.cash).toBe(base.current.cash! - 40000)
    expect(shock.current.survival).toBeCloseTo((base.current.cash! - 40000) / base.current.emb, 4)
  })
})

describe('6 · drift nudges paced by payday', () => {
  it('pay cycles start on payday, not the 1st', () => {
    expect(payCycle('2026-11-16', 25)).toMatchObject({ start: '2026-10-25', end: '2026-11-25', days: 31 })
    expect(payCycle('2026-11-16', 1)).toMatchObject({ start: '2026-11-01', end: '2026-12-01', days: 30 })
    // payday 31 clamps to the month's last day
    expect(payCycle('2027-02-28', 31).start).toBe('2027-02-28')
    expect(payCycle('2027-02-27', 31).start).toBe('2027-01-31')
  })
  it('flags dining running ahead of pace, with a goal-date consequence', () => {
    const m = model()
    const pace = computePace(m, DEFAULT_SIM)!
    expect(pace.asOf).toBe('2026-11-16')
    expect(pace.daysIn).toBe(16)
    const dining = pace.rows.find((r) => r.category === 'Dining')!
    expect(dining.status).toBe('red')
    const nudges = buildNudges(m, sampleProfile(), pace, {})
    const n = nudges.find((x) => x.id.startsWith('pace:Dining'))!
    expect(n.title).toMatch(/^Dining: ₹[\d,]+ spent vs ₹[\d,]+ usual for the whole cycle, with \d+ days still to go\.$/)
    expect(n.consequence).toMatch(/emergency fund slips about \d+ days/)
    expect(nudges.some((x) => x.kind === 'unused')).toBe(true)
    expect(nudges.some((x) => x.kind === 'fixed_cost')).toBe(true)
    expect(nudges.some((x) => x.kind === 'new_charge')).toBe(true)
    expect(nudges.every((x) => x.action.label.length > 0)).toBe(true)
  })
  it('warns when runway drops below the user threshold, and praises cancellations', () => {
    const m = model(DEFAULT_SIM, [learned], { ...sampleProfile(), runwayAlertMonths: 6 })
    const gold = m.leaks.find((l) => /zomato gold/i.test(l.label))!
    const nudges = buildNudges(m, { ...sampleProfile(), runwayAlertMonths: 6 }, null, { [gold.id]: 'cancel' })
    expect(nudges.some((x) => x.kind === 'runway')).toBe(true)
    expect(nudges.some((x) => x.kind === 'positive')).toBe(true)
  })
})

describe('7 · monthly review', () => {
  const m = model()
  const r = buildMissionReview(m, [learned], {})!
  it('reviews the last complete month with runway movement from balances', () => {
    expect(r.current.key).toBe('2026-10')
    expect(r.balancesKnown).toBe(true)
    expect(r.runwayStart).not.toBeNull()
    expect(r.efEnd).not.toBeNull()
  })
  it('lists what changed, corrections learned and goal status', () => {
    const text = r.changes.map((c) => c.text).join(' | ')
    expect(text).toMatch(/Netflix went up/)
    expect(text).toMatch(/New recurring charge/)
    expect(text).toMatch(/Zomato Gold shows no/)
    expect(r.corrections.rules).toBe(1)
    expect(r.corrections.reclassified).toBeGreaterThan(0)
    expect(r.goals.map((g) => g.name)).toEqual(['Emergency fund', 'Family trip to Goa'])
  })
  it('exports to Markdown with the guardrail line', () => {
    const md = reviewToMarkdown(r)
    expect(md).toMatch(/^# Runway monthly review: October 2026/)
    expect(md).toContain('Not investment advice')
  })
})

describe('8 · guardrails in data', () => {
  it('investment-style debits are never presented as leaks', () => {
    expect(model().leaks.some((l) => /sip|bse/i.test(l.label))).toBe(false)
  })
  it('the default profile has no product or fund fields', () => {
    expect(Object.keys(DEFAULT_PROFILE).join(' ')).not.toMatch(/fund_name|scheme|product|security/i)
  })
})
