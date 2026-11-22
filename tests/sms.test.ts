import { describe, expect, it } from 'vitest'
import { buildTxns } from '../src/lib/ingest/build'
import { parseSmsBlock, parseSmsMessage } from '../src/lib/ingest/sms'
import type { RawRecord } from '../src/lib/ingest/statement'

const TODAY = '2026-11-21'
const one = (msg: string) => {
  const r = parseSmsMessage(msg, TODAY)
  if ('reason' in r) throw new Error(`unparsed: ${r.reason}`)
  return r as RawRecord
}

describe('SMS formats', () => {
  it('1. Axis-style "debited by … trf to"', () => {
    const r = one('A/c XX1234 debited by ₹356.00 on 26Apr26 trf to Swiggy Refno 612345678901. Not you? Call 1800')
    expect(r).toMatchObject({ amount: 356, direction: 'debit', date: '2026-04-26', accountMask: 'XX1234', reference: '612345678901', merchantHint: 'Swiggy' })
  })
  it('2. "Rs … debited from A/c … ; Merchant"', () => {
    const r = one('Rs 598.10 debited from A/c XX280 on 02-Jun-26; Dominos Pizza')
    expect(r).toMatchObject({ amount: 598.1, direction: 'debit', date: '2026-06-02', merchantHint: 'Dominos Pizza' })
  })
  it('3. UPI to a personal VPA with no date', () => {
    const r = one('Rs 5,000 debited by UPI to rahul.k@okbank')
    expect(r).toMatchObject({ amount: 5000, direction: 'debit', missingDate: true, date: TODAY })
    expect(r.merchantHint).toBe('rahul.k@okbank')
  })
  it('4. plain credit', () => {
    const r = one('Rs 1,372 credited to A/c XX1234 on 12-05-26')
    expect(r).toMatchObject({ amount: 1372, direction: 'credit', date: '2026-05-12', accountMask: 'XX1234' })
  })
  it('5. HDFC "Sent Rs … From … To … On"', () => {
    const r = one('Sent Rs.356.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 26/04/26\nRef 612345678901\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808')
    expect(r).toMatchObject({ amount: 356, direction: 'debit', date: '2026-04-26', bank: 'HDFC Bank', merchantHint: 'SWIGGY', reference: '612345678901' })
  })
  it('6. HDFC credit alert from a VPA', () => {
    const r = one('Credit Alert! Rs.68000.00 credited to HDFC Bank A/c XX1234 on 01-05-26 from VPA acme.payroll@hdfcbank (UPI 612345678902)')
    expect(r).toMatchObject({ amount: 68000, direction: 'credit', date: '2026-05-01' })
    expect(r.merchantHint).toBe('acme.payroll@hdfcbank')
  })
  it('7. SBI "Dear UPI user … debited by 356.0 on date"', () => {
    const r = one('Dear UPI user A/C X1234 debited by 356.0 on date 26Apr26 trf to SWIGGY Refno 612345678903. If not u? call 1800111109. -SBI')
    expect(r).toMatchObject({ amount: 356, direction: 'debit', date: '2026-04-26', bank: 'SBI', merchantHint: 'SWIGGY' })
  })
  it('8. ICICI "Acct … debited for Rs …; X credited"', () => {
    const r = one('ICICI Bank Acct XX123 debited for Rs 356.00 on 26-Apr-26; SWIGGY credited. UPI:612345678904. Call 18002662 for dispute.')
    expect(r).toMatchObject({ amount: 356, direction: 'debit', date: '2026-04-26', bank: 'ICICI Bank', merchantHint: 'SWIGGY' })
  })
  it('9. Kotak "Sent Rs … to vpa"', () => {
    const r = one('Sent Rs.149.00 from Kotak Bank AC X1234 to swiggyone@icici on 20-10-26.UPI Ref 612345678905. Not you, https://kotak.com/KBANKT/Fraud')
    expect(r).toMatchObject({ amount: 149, direction: 'debit', date: '2026-10-20', bank: 'Kotak Bank' })
  })
  it('10. Axis "INR … debited … UPI/P2M/ref/MERCHANT"', () => {
    const r = one('INR 356.00 debited from A/c no. XX1234 on 26-04-26 15:43:11 UPI/P2M/612345678906/SWIGGY Not you? SMS BLOCK 1234 to 9951860002 Axis Bank')
    expect(r).toMatchObject({ amount: 356, direction: 'debit', date: '2026-04-26', merchantHint: 'SWIGGY', bank: 'Axis Bank' })
  })
  it('11. card spend with available limit (limit is not the amount)', () => {
    const r = one('Rs 1,250.00 spent on HDFC Bank Card XX4412 at AMAZON on 2026-04-26:13:21:09. Avl Lmt Rs 1,48,750.00')
    expect(r).toMatchObject({ amount: 1250, direction: 'debit', date: '2026-04-26', merchantHint: 'AMAZON' })
  })
  it('12. balance is not mistaken for the amount', () => {
    const r = one('Your A/c XX1234 is debited for Rs.499.00 on 09-10-26 towards NETFLIX UPI AUTOPAY. Avl Bal Rs.62,101.00')
    expect(r).toMatchObject({ amount: 499, direction: 'debit', balanceAfter: 62101 })
  })
})

describe('SMS block handling', () => {
  it('splits a pasted block, parses the good ones and lists the rest with reasons', () => {
    const block = [
      'A/c XX1234 debited by ₹356.00 on 26Apr26 trf to Swiggy Refno 612345678901',
      '',
      '123456 is your OTP for txn of Rs 2,000 at AMAZON. Do not share.',
      '',
      'Your UPI mandate for Rs 199 will be debited on 05-11-26 for SPOTIFY',
      '',
      'Rs 1,372 credited to A/c XX1234 on 12-05-26',
      '',
      'Hi there, hope you are well',
    ].join('\n')
    const res = parseSmsBlock(block, TODAY)
    expect(res.records).toHaveLength(2)
    expect(res.unparsed).toHaveLength(3)
    expect(res.unparsed.map((u) => u.reason)).toEqual([
      expect.stringMatching(/OTP/),
      expect.stringMatching(/Upcoming|Not a completed/),
      expect.stringMatching(/No amount/),
    ])
  })
  it('treats one-message-per-line pastes as separate messages', () => {
    const res = parseSmsBlock(
      'Rs 598.10 debited from A/c XX280 on 02-Jun-26; Dominos Pizza\nRs 1,372 credited to A/c XX1234 on 12-05-26',
      TODAY,
    )
    expect(res.records).toHaveLength(2)
  })
  it('classifies SMS through the same sanitizer and flags missing dates', () => {
    const res = parseSmsBlock('Rs 5,000 debited by UPI to rahul.k@okbank\n\nRs 598.10 debited from A/c XX280 on 02-Jun-26; Dominos Pizza', TODAY)
    const { txns } = buildTxns(res.records, { source: 'sms', statementType: 'bank', batchId: 's', importedAt: 'now' })
    expect(txns[0].reviewReason).toBe('missing_date')
    expect(txns[0].vpa).toBe('rahul.k@okbank')
    expect(txns[1].autoCategory).toBe('Dining')
  })
  it('marks an SMS that repeats a statement row as a duplicate', () => {
    const csv = buildTxns(
      [{ date: '2026-04-26', postedDate: null, rawDescription: 'UPI-SWIGGY-swiggy@icici-ICIC0DC0099-612345678901-FOOD', reference: null, amount: 356, direction: 'debit', balanceAfter: null }],
      { source: 'csv', statementType: 'bank', batchId: 'c', importedAt: 'now' },
    )
    const sms = parseSmsBlock('A/c XX1234 debited by ₹356.00 on 26Apr26 trf to Swiggy Refno 612345678901', TODAY)
    const built = buildTxns(sms.records, { source: 'sms', statementType: 'bank', batchId: 's', importedAt: 'now' }, csv.txns)
    expect(built.duplicatesFlagged).toBe(1)
    expect(built.txns[0].flags).toContain('duplicate')
  })
})
