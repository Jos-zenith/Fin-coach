import { describe, expect, it } from 'vitest'
import { assumptions, breakEvenGap, lifestyleRange, suggestPlan } from '../src/lib/engine/insights'
import { buildModel } from '../src/lib/engine/model'
import { reconcile } from '../src/lib/ingest/reconcile'
import { sampleProfile, sampleTxns } from '../src/lib/sample'
import { DEFAULT_PROFILE, DEFAULT_SIM } from '../src/lib/types'

const r = (date: string, amount: number, direction: 'debit' | 'credit', balanceAfter: number) => ({ date, amount, direction, balanceAfter })

describe('balance reconciliation', () => {
  it('passes a complete oldest-first statement', () => {
    const rec = reconcile([r('2026-08-01', 68000, 'credit', 112450), r('2026-08-03', 26000, 'debit', 86450), r('2026-08-05', 3850, 'debit', 82600)])!
    expect(rec).toMatchObject({ ok: true, checked: 2, matched: 2, order: 'oldest_first' })
  })
  it('handles newest-first statements', () => {
    const rec = reconcile([r('2026-08-05', 3850, 'debit', 82600), r('2026-08-03', 26000, 'debit', 86450), r('2026-08-01', 68000, 'credit', 112450)])!
    expect(rec).toMatchObject({ ok: true, order: 'newest_first' })
  })
  it('catches a missing row and says where and by how much', () => {
    // a ₹499 debit between 3 Aug and 5 Aug is missing from the file
    const rec = reconcile([r('2026-08-01', 68000, 'credit', 112450), r('2026-08-03', 26000, 'debit', 86450), r('2026-08-05', 3850, 'debit', 82101)])!
    expect(rec.ok).toBe(false)
    expect(rec.breaks[0]).toMatchObject({ date: '2026-08-05', gap: -499 })
  })
  it('returns null without balances', () => {
    expect(reconcile([{ date: '2026-08-01', amount: 1, direction: 'debit', balanceAfter: null }])).toBeNull()
  })
})

describe('recurring detection does not over-claim', () => {
  it('two similar restaurant bills a month apart are not a subscription', () => {
    const m = buildModel({ txns: sampleTxns('2026-11-01T00:00:00Z'), rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    expect(m.series.some((s) => s.category === 'Dining')).toBe(false)
    expect(m.series.some((s) => /learnify/i.test(s.label))).toBe(true) // marked ACH mandate: still detected
  })
})

describe('dashboard honesty', () => {
  const txns = sampleTxns('2026-11-01T00:00:00Z')
  it('the baseline never moves with the simulator', () => {
    const a = buildModel({ txns, rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    const b = buildModel({ txns, rules: [], profile: sampleProfile(), sim: { ...DEFAULT_SIM, cutPct: 40, rentStressPct: 20 }, today: '2026-11-22' })
    expect(b.baseline).toEqual(a.baseline)
    expect(b.current.fs).toBeLessThan(a.current.fs)
  })
  it('break-even gap appears only when spending exceeds take-home', () => {
    const tight = buildModel({ txns: [], rules: [], profile: { ...DEFAULT_PROFILE, takeHome: 40000, accessibleCash: 50000, rent: 30000, flexible: 16500 }, sim: DEFAULT_SIM })
    expect(breakEvenGap(tight.baseline)).toBe(6500)
    const m = buildModel({ txns, rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    expect(breakEvenGap(m.baseline)).toBeNull()
  })
  it('lifestyle runway is shown as a range while transactions are unreviewed', () => {
    const m = buildModel({ txns, rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    const range = lifestyleRange(m, m.baseline)!
    expect(range.low).toBeCloseTo(m.baseline.lifestyle!, 6)
    expect(range.high).toBeGreaterThan(range.low)
    expect(range.unreviewed).toBeGreaterThan(0)
  })
  it('the plan names only generic actions and pre-fills the simulator', () => {
    const m = buildModel({ txns, rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    const plan = suggestPlan(m)!
    expect(plan.steps.join(' ')).toMatch(/Cancel .*Zomato Gold/)
    expect(plan.sim.disabledLeaks!.length).toBeGreaterThan(0)
    expect(plan.steps.join(' ')).not.toMatch(/fund|scheme|stock|deposit|invest/i)
  })
  it('assumptions mention averaging, cash, unreviewed spend, reconciliation and the EMI rule of thumb', () => {
    const m = buildModel({ txns, rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    const text = assumptions(m, sampleProfile(), [{ label: 'Sample', rec: { ok: true, checked: 150, matched: 150, breaks: [], order: 'oldest_first', identity: { opening: 0, credits: 0, debits: 0, closing: 0, ok: true, stated: null } } }]).map((a) => a.text).join(' ')
    expect(text).toMatch(/complete months/)
    expect(text).toMatch(/Accessible cash/)
    expect(text).toMatch(/unreviewed/)
    expect(text).toMatch(/reconcile/)
    expect(text).toMatch(/reimbursement/)
    expect(text).toMatch(/rules of thumb/)
  })
})

describe('monthly runway movement does not depend on row order', () => {
  it('finds the true start and end of a day even when rows are stored shuffled', async () => {
    const { dayBounds } = await import('../src/lib/engine/review')
    const day = [
      { amount: 400, direction: 'debit', balanceAfter: 167600 }, // grocery after salary
      { amount: 68000, direction: 'credit', balanceAfter: 168000 }, // salary first
      { amount: 13000, direction: 'debit', balanceAfter: 154600 },
    ] as never[]
    expect(dayBounds(day)).toEqual({ start: 100000, end: 154600 })
  })
  it('the sample month opening and closing balances match the bank rows', async () => {
    const { buildMissionReview } = await import('../src/lib/engine/review')
    const m = buildModel({ txns: [...sampleTxns('2026-11-01T00:00:00Z')].reverse(), rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    const r = buildMissionReview(m)!
    expect(r.current.key).toBe('2026-10')
    // closing − opening must equal the net of October's bank rows, whatever order they are stored in
    const net = m.active.filter((t) => t.date.startsWith('2026-10') && t.balanceAfter != null && t.statementType !== 'card').reduce((x, t) => x + (t.direction === 'credit' ? t.amount : -t.amount), 0)
    expect(r.current.closingBalance! - r.current.openingBalance!).toBeCloseTo(net, 2)
  })
})

describe('statement identity: Opening + Credits − Debits = Closing', () => {
  it('passes a complete statement and matches printed balances', async () => {
    const { parsePdfLines } = await import('../src/lib/ingest/pdf')
    const res = parsePdfLines(['Opening Balance 44,450.00', '01/08/26  SALARY  68,000.00  1,12,450.00', '03/08/26  RENT SHARE  13,000.00  99,450.00', 'Closing Balance 99,450.00'], { statementType: 'bank' })
    expect(res.reconciliation).toMatchObject({ ok: true, identity: { opening: 44450, credits: 68000, debits: 13000, closing: 99450, ok: true, stated: { matches: true } } })
  })
  it('catches a missing last row that the row chain alone cannot see', async () => {
    const { parsePdfLines } = await import('../src/lib/ingest/pdf')
    // the 09/08 Netflix row was dropped by a bad extraction: rows still chain, but the printed closing is ₹499 lower
    const res = parsePdfLines(['Opening Balance 44,450.00', '01/08/26  SALARY  68,000.00  1,12,450.00', '03/08/26  RENT SHARE  13,000.00  99,450.00', 'Closing Balance 98,951.00'], { statementType: 'bank' })
    expect(res.reconciliation!.breaks).toHaveLength(0)
    expect(res.reconciliation!.identity.stated).toMatchObject({ matches: false, closing: 98951 })
    expect(res.reconciliation!.ok).toBe(false)
  })
})

describe('card bill pairing', () => {
  it('pairs every bank-side card bill with the card statement payment, and says so on the row', () => {
    const m = buildModel({ txns: sampleTxns('2026-11-01T00:00:00Z'), rules: [], profile: sampleProfile(), sim: DEFAULT_SIM, today: '2026-11-22' })
    expect(m.noise.cardBillPayments).toBeGreaterThan(0)
    expect(m.noise.cardBillPairs).toBe(m.noise.cardBillPayments)
    const bill = m.resolved.find((t) => t.category === 'CC repayment' && t.statementType !== 'card')!
    expect(bill.reason).toMatch(/Paired with the card statement's payment received/)
  })
})
