import { describe, expect, it } from 'vitest'
import { checkRequest, ungroundedNumbers } from '../src/lib/agents/guardrails'
import { analyzeCsv, analyzePdf, repairDirections } from '../src/lib/agents/ingestion'
import { redact } from '../src/lib/agents/llm'
import { parseAmount, parseRequest, solveRequiredCut, summarize } from '../src/lib/agents/planner'
import { handle } from '../src/lib/agents/supervisor'
import { buildTriage } from '../src/lib/agents/triage'
import { formatDateLong } from '../src/lib/dates'
import { buildModel } from '../src/lib/engine/model'
import { detectLayout, rowsFromCSVText } from '../src/lib/ingest/statement'
import { sampleProfile, sampleTxns } from '../src/lib/sample'
import { DEFAULT_SIM } from '../src/lib/types'

const TODAY = '2026-11-22'
const txns = sampleTxns('2026-11-01T00:00:00Z')
const profile = sampleProfile()
const model = buildModel({ txns, rules: [], profile, sim: DEFAULT_SIM, today: TODAY })
const ctx = { model, profile, rules: [], decisions: {}, nudges: [] }

describe('Goal Planner: understanding', () => {
  it('reads amounts the way people write them', () => {
    expect(parseAmount('₹3,500')).toBe(3500)
    expect(parseAmount('3.5k')).toBe(3500)
    expect(parseAmount('Rs 50,000')).toBe(50000)
    expect(parseAmount('1.2 lakh')).toBe(120000)
  })
  it('“My rent is going up ₹3,500. Can I still build my emergency fund by December 2027?”', () => {
    const i = parseRequest('My rent is going up ₹3,500. Can I still build my emergency fund by December 2027?', model, profile)
    expect(i).toMatchObject({ kind: 'scenario', goalRef: 'emergency', deadline: '2027-12-31', protect: true })
    if (i.kind !== 'scenario') throw new Error()
    expect(i.sim.extraEssential).toBe(3500)
    expect(i.levers).toEqual(['Rent +₹3,500/month'])
  })
  it('“My parents need ₹4,000 per month. What can I cut without missing my Goa trip?”', () => {
    const i = parseRequest('My parents need ₹4,000 per month. What can I cut without missing my Goa trip?', model, profile)
    expect(i).toMatchObject({ kind: 'scenario', goalRef: 'goal-goa', protect: true })
    if (i.kind !== 'scenario') throw new Error()
    expect(i.sim.extraEssential).toBe(4000)
  })
  it('the four mandatory presets in plain words', () => {
    const cut = parseRequest('What if I cut dining out by 30%?', model, profile)
    expect(cut.kind === 'scenario' && cut.sim.catCut).toEqual({ category: 'Dining', pct: 30 })
    const rent = parseRequest('What if rent goes up by 10%?', model, profile)
    expect(rent.kind === 'scenario' && rent.sim.rentStressPct).toBe(10)
    const gap = parseRequest('What if I lose my salary for two months?', model, profile)
    expect(gap.kind === 'scenario' && gap.sim.incomeGapMonths).toBe(2)
    const shock = parseRequest('What if I get a ₹50,000 medical bill?', model, profile)
    expect(shock.kind === 'scenario' && shock.sim.shockExpense).toBe(50000)
  })
  it('caps and cancellations', () => {
    const i = parseRequest('Cancel the flagged subscriptions and cap dining at ₹2,000', model, profile)
    if (i.kind !== 'scenario') throw new Error('expected scenario')
    expect(i.caps).toEqual([{ category: 'Dining', amount: 2000 }])
    expect(i.levers.join(' ')).toMatch(/Zomato Gold/)
  })
  it('information questions route to the right specialist', () => {
    expect(parseRequest('What is my runway?', model, profile).kind).toBe('runway')
    expect(parseRequest('Which subscriptions should I review?', model, profile).kind).toBe('leaks')
    expect(parseRequest('Where am I overspending this cycle?', model, profile).kind).toBe('drift')
  })
})

describe('Goal Planner: deterministic solving', () => {
  it('finds the smallest cut that meets a deadline, and the result really meets it', () => {
    const sim = { ...DEFAULT_SIM, extraEssential: 3500 }
    const pct = solveRequiredCut(model, sim, 'emergency', '2027-12-31')!
    expect(pct).toBeGreaterThan(0)
    expect(summarize(model, '', { ...sim, cutPct: pct }, 'emergency', '2027-12-31').meetsDeadline).toBe(true)
    expect(summarize(model, '', { ...sim, cutPct: pct - 1 }, 'emergency', '2027-12-31').meetsDeadline).toBe(false)
  })
})

describe('Supervisor', () => {
  it('blocks product advice and logs the guardrail', () => {
    expect(checkRequest('Which mutual fund should I buy with my surplus?').allowed).toBe(false)
    expect(checkRequest('Should I take a personal loan?').allowed).toBe(false)
    expect(checkRequest('What if I cut dining by 30%?').allowed).toBe(true)
    const r = handle('Which stocks should I invest in?', ctx)
    expect(r.trace.status).toBe('blocked')
    expect(r.trace.guardrails.some((g) => !g.passed)).toBe(true)
  })
  it('answers with tool calls, grounded numbers and an approval gate for plans', () => {
    const r = handle('My rent is going up ₹3,500. Can I still build my emergency fund by December 2027?', ctx)
    expect(r.trace.agent).toBe('Goal Planner')
    expect(r.trace.calls.map((c) => c.tool)).toEqual(expect.arrayContaining(['run_what_if_simulation', 'solve_required_adjustments', 'rank_scenarios']))
    expect(r.trace.verification.join(' ')).toMatch(/every figure in the answer comes from a tool output/)
    expect(r.trace.approval).toBe('required')
    expect(r.options.length).toBeGreaterThanOrEqual(2)
    expect(r.options[0].meets).toBe(true)
  })
  it('says that every option includes the new cost, and quotes the dashboard date it differs from', () => {
    const r = handle('My parents need ₹4,000 a month. Can I still build my emergency fund by December 2027?', ctx)
    const text = r.text.join(' ')
    const today = model.baseline.emergency.date!
    expect(text).toMatch(/Every option below already includes Family support \+₹4,000\/month/)
    expect(text).toContain(`by ${formatDateLong(today)}`)
    expect(r.options.find((o) => /^Keep current spending/.test(o.label))?.label).toMatch(/absorb Family support \+₹4,000\/month/)
    expect(r.trace.verification.join(' ')).toMatch(/every figure/)
  })
  it('every runway answer is grounded', () => {
    const r = handle('What is my runway?', ctx)
    expect(r.trace.verification.join(' ')).toMatch(/every figure/)
    expect(r.text.join(' ')).toMatch(/3\.5 months/)
  })
  it('the grounding check catches an invented number', () => {
    expect(ungroundedNumbers('Your runway is 9.9 months and you save ₹77,777', [{ runway: 3.46, surplus: 11651 }])).toEqual(['9.9 months', '₹77,777'])
  })
})

describe('Ingestion agent: self-correction', () => {
  it('retries with swapped debit/credit columns when balances do not reconcile', () => {
    const csv = ['Date,Narration,Debit,Credit,Balance', '01/08/2026,SALARY ACME,68000.00,,112450.00', '03/08/2026,UPI RENT,,26000.00,86450.00', '05/08/2026,ACH D BAJAJ EMI,,3850.00,82600.00'].join('\n')
    const rows = rowsFromCSVText(csv)
    const res = analyzeCsv(rows, detectLayout(rows)!, 'mislabelled.csv', 'bank', [], [])
    expect(res.corrected).toBe('debit and credit columns swapped')
    expect(res.reconciliation?.ok).toBe(true)
    expect(res.trace.event.status).toBe('corrected')
    expect(res.trace.event.calls.filter((c) => c.tool === 'verify_balance_integrity').length).toBeGreaterThan(1)
  })
  it('repairs a mis-marked direction in a PDF from the running balance', () => {
    const lines = ['Opening Balance 44,450.00', '01/08/26  SALARY  68,000.00  1,12,450.00', '09/08/26  NETFLIX  499.00 Cr  1,11,951.00']
    const res = analyzePdf(lines, 'stmt.pdf', 'bank', 1, [], [])
    expect(res.repaired).toEqual([1])
    expect(res.rows[1].direction).toBe('debit')
    expect(res.reconciliation?.ok).toBe(true)
    expect(res.trace.event.verification.join(' ')).toMatch(/corrected 1 direction/)
  })
  it('repairDirections never flips a row that already adds up', () => {
    const rows = [
      { date: 'a', amount: 100, direction: 'credit' as const, balanceAfter: 100, postedDate: null, rawDescription: '', reference: null },
      { date: 'b', amount: 40, direction: 'debit' as const, balanceAfter: 60, postedDate: null, rawDescription: '', reference: null },
    ]
    expect(repairDirections(rows).flipped).toEqual([])
  })
})

describe('Triage agent', () => {
  it('asks only consequential questions, ranked by monthly impact, each mapped to a rule', () => {
    const items = buildTriage(model, {})
    expect(items.length).toBeGreaterThan(0)
    expect(items.map((i) => i.kind)).toEqual(expect.arrayContaining(['reimbursement', 'unknown_recurring', 'savings_debit']))
    for (let i = 1; i < items.length; i++) expect(items[i - 1].impact).toBeGreaterThanOrEqual(items[i].impact)
    const reimb = items.find((i) => i.kind === 'reimbursement')!
    expect(reimb.question).toMatch(/received ₹600 back from karthik\.v@okicici/)
    expect(reimb.confirm.rules[0]).toMatchObject({ matchField: 'vpa', token: 'karthik.v@okicici' })
  })
  it('a decided question does not come back', () => {
    const items = buildTriage(model, {})
    const decided = { [items[0].id]: 'confirmed' as const }
    expect(buildTriage(model, decided).some((i) => i.id === items[0].id)).toBe(false)
  })
})

describe('Ask Runway redaction contract', () => {
  it('sends the question and names only: no narrations, UPI IDs, amounts, balances or account numbers', () => {
    const ctxOut = redact('Can I still reach Goa if rent rises ₹3,500?', model, profile, TODAY)
    const json = JSON.stringify(ctxOut)
    expect(ctxOut).toMatchObject({ raw_narration: null, account_number: null, balance: null, full_statement: null })
    expect(json).not.toMatch(/@ok|@ybl|@icici|@hdfcbank/) // no UPI IDs
    expect(json).not.toMatch(/XX\d{4}|UPI-|NEFT|ACH D/) // no account masks or narrations
    expect(json).not.toMatch(/124600|68000|11651/) // no cash, salary or surplus
  })
})

describe('SEBI-style guardrail coverage', () => {
  const blocked = [
    'Which mutual fund should I buy?',
    'Should I put my surplus in an FD?',
    'Is an FD better than keeping cash in savings?',
    'Should I take a personal loan to clear my card?',
    'Best SIP to start with ₹5,000?',
    'Where should I invest ₹10,000?',
    'Should I buy gold this Diwali?',
    'Recommend a term plan for me',
    'What stocks are good right now?',
    'Park my emergency fund in a liquid scheme?',
  ]
  const allowed = [
    'What if I cut dining by 30%?',
    'What if my loan EMI rises ₹2,000?',
    'What if I stop my SIP?',
    'Which subscriptions should I review?',
    'Can I still reach my goal if rent rises ₹3,500?',
    'Should I cancel Netflix?',
    'What is my runway?',
  ]
  it.each(blocked)('blocks: %s', (q) => expect(checkRequest(q).allowed).toBe(false))
  it.each(allowed)('allows: %s', (q) => expect(checkRequest(q).allowed).toBe(true))
})
