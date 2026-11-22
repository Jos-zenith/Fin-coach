import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTxns } from '../src/lib/ingest/build'
import { detectLayout, parseMoney, parseStatementRows, rowsFromCSVText } from '../src/lib/ingest/statement'
import { parseDate } from '../src/lib/dates'

const fixture = (name: string) => rowsFromCSVText(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

function parse(name: string, singleSign: 'negative_debit' | 'positive_debit' = 'negative_debit') {
  const rows = fixture(name)
  const det = detectLayout(rows)!
  const res = parseStatementRows(rows, {
    headerRow: det.headerRow,
    map: det.map,
    amountMode: det.amountMode,
    singleSign,
    monthFirst: false,
  })
  return { det, res }
}

describe('dates', () => {
  it('reads Indian statement and SMS date shapes', () => {
    expect(parseDate('26/04/2026')).toBe('2026-04-26')
    expect(parseDate('26-04-26')).toBe('2026-04-26')
    expect(parseDate('26Apr26')).toBe('2026-04-26')
    expect(parseDate('02-Jun-26')).toBe('2026-06-02')
    expect(parseDate('1 Aug 2026')).toBe('2026-08-01')
    expect(parseDate('2026-08-01')).toBe('2026-08-01')
    expect(parseDate('04/05/2026', { monthFirst: true })).toBe('2026-04-05')
    expect(parseDate('32/08/2026')).toBeNull()
    expect(parseDate('this row is junk')).toBeNull()
  })
})

describe('money cells', () => {
  it('handles lakh commas, Dr/Cr suffixes, signs and blanks', () => {
    expect(parseMoney('"1,12,450.00"'.replace(/"/g, ''))?.value).toBe(112450)
    expect(parseMoney('412.00 Dr')).toEqual({ value: 412, sign: 'debit' })
    expect(parseMoney('18,420.00 Cr')).toEqual({ value: 18420, sign: 'credit' })
    expect(parseMoney('-1299.00')).toEqual({ value: 1299, sign: 'negative' })
    expect(parseMoney('(250.00)')?.sign).toBe('negative')
    expect(parseMoney('₹ 1,000')?.value).toBe(1000)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('-')).toBeNull()
  })
})

describe('HDFC-style statement', () => {
  const { det, res } = parse('hdfc.csv')
  it('finds the header below the address block and maps columns', () => {
    expect(det.headerRow).toBe(4)
    expect(det.template).toBe('hdfc')
    expect(det.confident).toBe(true)
    expect(det.map.date).toBe(0)
    expect(det.map.narration).toBe(1)
    expect(det.map.reference).toBe(2)
    expect(det.map.postedDate).toBe(3)
    expect(det.map.debit).toBe(4)
    expect(det.map.credit).toBe(5)
    expect(det.map.balance).toBe(6)
  })
  it('parses valid rows and reports the junk ones instead of dropping them silently', () => {
    expect(res.records).toHaveLength(6)
    // file lines 11 ("this row is junk") and 14 ("**Statement Summary**")
    expect(res.skipped.map((s) => s.row)).toEqual([11, 14])
    const salary = res.records[0]
    expect(salary).toMatchObject({ date: '2026-08-01', amount: 68000, direction: 'credit', balanceAfter: 112450 })
    expect(res.records[1]).toMatchObject({ amount: 26000, direction: 'debit' })
    expect(res.range).toEqual({ start: '2026-08-01', end: '2026-08-16' })
  })
  it('classifies the rows through the sanitizer', () => {
    const { txns } = buildTxns(res.records, { source: 'csv', statementType: 'bank', batchId: 'b', importedAt: 'now' })
    const by = (s: string) => txns.find((t) => t.rawDescription.includes(s))!
    expect(by('SALARY').autoCategory).toBe('Salary')
    expect(by('FLAT RENT').autoCategory).toBe('Rent')
    expect(by('FLAT RENT').vpa).toBe('ramesh.iyer58@okhdfcbank')
    expect(by('FLAT RENT').merchantGuess).toBe('Ramesh Iyer')
    expect(by('BAJAJ').autoCategory).toBe('EMI')
    expect(by('NETFLIX').autoCategory).toBe('Subscriptions')
    expect(by('CRED CLUB').autoCategory).toBe('CC repayment')
    expect(by('CRED CLUB').flags).toContain('cc_repayment')
    expect(by('SWIGGY').autoCategory).toBe('Food delivery')
  })
  it('is idempotent: re-importing the same file adds nothing', () => {
    const first = buildTxns(res.records, { source: 'csv', statementType: 'bank', batchId: 'a', importedAt: 'now' })
    const again = buildTxns(res.records, { source: 'csv', statementType: 'bank', batchId: 'b', importedAt: 'later' }, first.txns)
    expect(again.txns).toHaveLength(0)
    expect(again.alreadyImported).toBe(6)
  })
})

describe('ICICI-style statement', () => {
  const { det, res } = parse('icici.csv')
  it('prefers Transaction Date over Value Date and maps remarks', () => {
    expect(det.template).toBe('icici')
    expect(det.map.date).toBe(2)
    expect(det.map.postedDate).toBe(1)
    expect(det.map.narration).toBe(4)
    expect(det.map.debit).toBe(5)
    expect(det.map.credit).toBe(6)
  })
  it('parses rows, zero-amount columns and flags an impossible date', () => {
    expect(res.records).toHaveLength(4)
    expect(res.records[0]).toMatchObject({ amount: 68000, direction: 'credit' })
    expect(res.records[2]).toMatchObject({ amount: 512, direction: 'debit' })
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0].reason).toMatch(/Date not readable/)
  })
  it('extracts the VPA from slash-delimited narrations', () => {
    const { txns } = buildTxns(res.records, { source: 'csv', statementType: 'bank', batchId: 'b', importedAt: 'now' })
    expect(txns[2].vpa).toBe('zepto.rzp@axisbank')
    expect(txns[2].autoCategory).toBe('Groceries')
    expect(txns[3].autoCategory).toBe('Utilities')
  })
})

describe('SBI-style statement', () => {
  const { det, res } = parse('sbi.csv')
  it('maps Txn Date / Description / Debit / Credit', () => {
    expect(det.template).toBe('sbi')
    expect(det.map.date).toBe(0)
    expect(det.map.narration).toBe(2)
    expect(det.map.debit).toBe(4)
    expect(det.map.credit).toBe(5)
  })
  it('parses "1 Aug 2026" dates and flags a personal UPI transfer for review', () => {
    expect(res.records).toHaveLength(4)
    expect(res.records[0].date).toBe('2026-08-01')
    const { txns } = buildTxns(res.records, { source: 'csv', statementType: 'bank', batchId: 'b', importedAt: 'now' })
    expect(txns[1].autoCategory).toBe('Family Support')
    const dinner = txns[2]
    expect(dinner.vpa).toBe('karthik.v@okicici')
    expect(dinner.autoCategory).toBeNull()
    expect(dinner.reviewReason).toBe('potential_p2p')
    expect(dinner.flags).toContain('needs_review')
    expect(txns[3].autoCategory).toBe('Transport')
  })
})

describe('credit-card statement with a single amount column', () => {
  const { det, res } = parse('card.csv', 'positive_debit')
  it('uses one amount column with Dr/Cr suffixes and signs', () => {
    expect(det.amountMode).toBe('single')
    expect(res.records.map((r) => r.direction)).toEqual(['debit', 'debit', 'debit', 'credit', 'credit'])
  })
  it('excludes the card payment so the bank-side bill is not double-counted', () => {
    const { txns } = buildTxns(res.records, { source: 'csv', statementType: 'card', batchId: 'b', importedAt: 'now' })
    expect(txns.find((t) => t.rawDescription.startsWith('PAYMENT RECEIVED'))!.autoCategory).toBe('CC repayment')
    expect(txns.find((t) => t.rawDescription.startsWith('MAKEMYTRIP'))!.autoCategory).toBe('Travel')
  })
})

describe('Axis-style statement', () => {
  const { det, res } = parse('axis.csv')
  it('detects the Axis layout and its DR / CR / BAL columns', () => {
    expect(det.template).toBe('axis')
    expect(det.map.date).toBe(0)
    expect(det.map.narration).toBe(2)
    expect(det.map.debit).toBe(3)
    expect(det.map.credit).toBe(4)
    expect(det.map.balance).toBe(5)
  })
  it('parses rows, lists the totals rows as skipped, and passes Opening + Credits − Debits = Closing', () => {
    expect(res.records).toHaveLength(4)
    expect(res.skipped.map((s) => s.raw)).toEqual([expect.stringContaining('TRANSACTION TOTAL'), expect.stringContaining('CLOSING BALANCE')])
    expect(res.reconciliation).toMatchObject({ ok: true, identity: { opening: 44450, credits: 68000, debits: 17349, closing: 95101, ok: true } })
  })
})
