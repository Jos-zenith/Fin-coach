import { describe, expect, it } from 'vitest'
import { analyzePdf, detectPdfLayout } from '../src/lib/agents/ingestion'
import { buildTxns } from '../src/lib/ingest/build'
import { isUpiAppStatement, looksLikePerson, parseUpiAppLines } from '../src/lib/ingest/upiapp'
import { buildModel } from '../src/lib/engine/model'
import { DEFAULT_PROFILE, DEFAULT_SIM } from '../src/lib/types'

// Synthetic PhonePe statement, laid out the way pdf.js returns its lines (names and IDs are made up).
const LINES = [
  'Transaction Statement for +919000000000',
  'Feb 01, 2025 - Jul 31, 2025',
  'Date  Transaction Details  Type  Amount',
  'Feb 01, 2025  Paid to ANNAI CAFE  Debit  INR 120.00',
  '01:13 PM  Transaction ID : T2502011313529759369951',
  'UTR No : 222896109718',
  'Debited from XX1234',
  'Feb 01, 2025  Paid to RAVI KUMAR S  Debit  INR 500.00',
  '03:42 PM  Transaction ID : T2502011542090604179847',
  'UTR No : 303837229127',
  'Debited from XX1234',
  'Feb 04, 2025  Received from RAVI KUMAR S  Credit  INR 400.00',
  '05:33 PM  Transaction ID : T2502041733090318244587',
  'UTR No : 503524185273',
  'Credited to XX1234',
  'Page 1 of 3',
  'This is a system generated statement. For any queries, contact us at https://support.phonepe.com/statement.',
  'Date  Transaction Details  Type  Amount',
  'Feb 05, 2025  Paid to ******4497  Debit  INR 150.00',
  '05:57 PM  Transaction ID : T2502051757267565046377',
  'UTR No : 469031222302',
  'Debited from XX1234',
  // the date on its own baseline
  'Feb 10, 2025',
  'Paid to ZEPTO MARKETPLACE PRIVATE LIMITED  Debit  INR 478.54',
  '06:07 PM  Transaction ID : T2502101807277817406348',
  'UTR No : 415639400051',
  'Debited from XX1234',
  'Mar 28, 2025  Refund Received  Credit  INR 765.00',
  '11:55 PM  Transaction ID : OM2503252329410817410680',
  'UTR No : 508762610763',
  'Credited to XX1234',
  'Mar 28, 2025  Payment Received  Credit  INR 765.00',
  '11:55 PM  Transaction ID : T2503282355148802700028',
  'UTR No : 508762610763',
  'Credited to XX1234',
  'Page 2 of 3',
  'Date  Transaction Details  Type  Amount',
  'Apr 21, 2025  Paid  Debit  INR 1143.60',
  '08:10 PM  Transaction ID : OMO2504212010348926754479',
  'UTR No : 049108098313',
  'Debited from XX1234',
  'May 01, 2025  Paid - Mobile Recharge  Debit  INR 33.00',
  '07:56 PM  Transaction ID : NB25050119555974655895762',
  'UTR No : 249572704622',
  'Debited from XX1234',
  // a large amount wraps: "INR" on one line, the number on the next
  'Jun 18, 2025  Received from ******0113  Credit  INR',
  '01:28 PM  Transaction ID : T2506181328504853091048  20000.00',
  'UTR No : 548213548881',
  'Credited to XX1234',
  'Jul 06, 2025  Paid to Swiggy  Debit  INR 210.00',
  '06:14 PM  Transaction ID : T2507061814414907680972',
  'UTR No : 678508348013',
  'Debited from XX1234',
  'Page 3 of 3',
  'This is an automatically generated statement. Customer(s) are requested to immediately notify PhonePe in case of any',
  'errors in the statement at https://support.phonepe.com/statement.',
  'Do not fall prey to fictitious offers of winning prizes, money circulation schemes and cheap funds, etc. through SMS,',
  'emails and calls.',
]

describe('PhonePe statement PDF', () => {
  const res = parseUpiAppLines(LINES)

  it('is detected as a UPI app statement, not a bank layout', () => {
    expect(isUpiAppStatement(LINES)).toBe(true)
    expect(detectPdfLayout(LINES)).toBe('PhonePe statement')
  })

  it('reads every payment with the printed direction, the UTR as reference, and the statement period', () => {
    expect(res.period).toEqual({ start: '2025-02-01', end: '2025-07-31' })
    expect(res.records.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ['2025-02-01', 'debit', 120],
      ['2025-02-01', 'debit', 500],
      ['2025-02-04', 'credit', 400],
      ['2025-02-05', 'debit', 150],
      ['2025-02-10', 'debit', 478.54],
      ['2025-03-28', 'credit', 765],
      ['2025-04-21', 'debit', 1143.6],
      ['2025-05-01', 'debit', 33],
      ['2025-06-18', 'credit', 20000],
      ['2025-07-06', 'debit', 210],
    ])
    expect(res.records.every((r) => r.directionFrom === 'marker' && r.balanceAfter == null)).toBe(true)
    expect(res.records[0]).toMatchObject({ rawDescription: 'Paid to ANNAI CAFE', reference: '222896109718', accountMask: 'XX1234' })
    expect(res.records[3].merchantHint).toBe('Contact ending 4497')
    expect(res.records[7].rawDescription).toBe('Paid - Mobile Recharge')
  })

  it('drops a refund PhonePe lists twice under one UTR, and says why', () => {
    expect(res.records.filter((r) => r.reference === '508762610763')).toHaveLength(1)
    expect(res.skipped.some((s) => /Same UTR 508762610763/.test(s.reason))).toBe(true)
  })

  it('keeps footers, headers and the phone number out of descriptions', () => {
    const text = res.records.map((r) => r.rawDescription).join(' ')
    expect(text).not.toMatch(/system generated|Page \d|Transaction ID|UTR|\+91|Debited from|\d{1,2}:\d{2}/)
  })

  it('tells people from businesses', () => {
    expect(looksLikePerson('RAVI KUMAR S')).toBe(true)
    expect(looksLikePerson('******4497')).toBe(true)
    for (const b of ['ANNAI CAFE', 'ZEPTO MARKETPLACE PRIVATE LIMITED', 'Mobile Recharge', 'IRCTC UTS', 'M S LOYOLA HOTELS', 'N&H Enterprises', 'User'])
      expect(looksLikePerson(b), b).toBe(false)
  })

  it('marks people for review and nets a friend paying you back against the original spend', () => {
    const { txns } = buildTxns(res.records, { source: 'pdf', statementType: 'bank', batchId: 'b', importedAt: 'now' })
    const paid = txns.find((t) => t.amount === 500)!
    const back = txns.find((t) => t.amount === 400)!
    expect(paid.reviewReason).toBe('potential_p2p')
    expect(back.reviewReason).toBe('potential_p2p')
    expect(txns.find((t) => t.amount === 210)!.autoCategory).toBe('Food delivery')
    const model = buildModel({ txns, rules: [], profile: DEFAULT_PROFILE, sim: DEFAULT_SIM, today: '2025-08-01' })
    expect(model.resolved.find((t) => t.id === back.id)!.reason).toMatch(/paying you back for your payment of ₹500/)
  })

  it('the agent reports the layout and does not invent a balance check', () => {
    const a = analyzePdf(LINES, 'statement.pdf', 'bank', 3, [], [])
    expect(a.layout).toBe('PhonePe statement')
    expect(a.rows).toHaveLength(10)
    expect(a.reconciliation).toBeNull()
    expect(a.trace.done().verification.join(' ')).toMatch(/no running balance/)
  })

  it('does not double-count a payment already imported from the bank statement (same UTR, zero-padded)', () => {
    const bank = buildTxns(
      [{ date: '2025-02-01', postedDate: null, rawDescription: 'UPI-ANNAI CAFE-annaicafe@ybl-YESB0YBLUPI-222896109718-PAY', reference: '0000222896109718', amount: 120, direction: 'debit', balanceAfter: 5000 }],
      { source: 'csv', statementType: 'bank', batchId: 'a', importedAt: 'now' },
    )
    const again = buildTxns(res.records, { source: 'pdf', statementType: 'bank', batchId: 'b', importedAt: 'now' }, bank.txns)
    expect(again.duplicatesFlagged).toBe(1)
    expect(again.txns.find((t) => t.amount === 120)!.flags).toContain('duplicate')
  })
})

describe('generic PDF parser', () => {
  it('also reads month-first dates such as "Feb 01, 2025"', async () => {
    const { parsePdfLines } = await import('../src/lib/ingest/pdf')
    const r = parsePdfLines(['Feb 01, 2025  AMAZON PAY INDIA  1,250.00  10,000.00', 'Feb 02, 2025  SALARY CREDIT  50,000.00  60,000.00'], { statementType: 'bank' })
    expect(r.records.map((x) => [x.date, x.amount])).toEqual([['2025-02-01', 1250], ['2025-02-02', 50000]])
  })
})
