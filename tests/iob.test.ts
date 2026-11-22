import { describe, expect, it } from 'vitest'
import { analyzePdf, detectPdfLayout, repairDirections } from '../src/lib/agents/ingestion'
import { buildTxns } from '../src/lib/ingest/build'
import { balanceOrder, parsePdfLines } from '../src/lib/ingest/pdf'

// Indian Overseas Bank layout, newest first, as pdf.js groups it: the single-line cells (ref, type, amounts)
// are vertically centred, so they land on their own line between the two lines of date/particulars.
// Names, account numbers and amounts are made up.
const HEADER = [
  'Page 1 of 2',
  'Report Generation Date & Time : 22-11-2026 11:14:36',
  'STATEMENT OF THE ACCOUNT FOR THE PERIOD OF : 2026-05-22 to 2026-11-22',
  'CUSTOMER DETAILS',
  'Customer ID  : 500000000  Branch Address :',
  'IFS Code  : IOBA0000001',
  'Date(Value  Particulars  Ref No.  Transaction  Debit(Rs)  Credit(Rs)  Balance(Rs)',
  'Date)  /Cheque No  Type',
]
const PDFJS = [
  ...HEADER,
  '22-Nov-26  UPI/111255225492/DR/ MAGIS FOODS',
  'S69300283  Transfer  20.00  -  9,277.21',
  '(22-Nov-26)  /YES/na',
  '22-Nov-26  UPI/111255207567/DR/ ANNAI CAFE',
  'S69255144  Transfer  180.00  -  9,297.21',
  '(22-Nov-26)  /HDF/na',
  '01-Aug-26  Int.Pd:01-05-2026 to 31-07-2026:',
  'S12838336  Transfer  -  20.00  9,477.21',
  '(01-Aug-26)  500000000000001',
  '01-Jul-26  UPI/110126620176/ Coursera/ICI/Pay via',
  'S55542677  Transfer  1.00-  9,457.21',
  '(01-Jul-26)  R',
  'Page 2 of 2',
  '24-May-26  UPI/161640921446/ Google Play/uti',
  'S42840888  Transfer  89.00  -  9,458.21',
  '(24-May-26)  /MandateEx',
  '23-May-26  CHRGS- SMS ALERT JAN TO MAR',
  'S93484078  Transfer  135.41  -  9,547.21',
  '(23-May-26)  2026',
  '22-May-26  UPI/855841479640/DR/R VARUN',
  'S67814392  Transfer  400.00  -  9,682.62',
  '(22-May-26)  KUMAR/ICI/Payment f',
  '22-May-26  UPI/650837336899/CR/A KUMAR',
  'S60195593  Transfer  -  10,000.00  10,082.62',
  '(22-May-26)  SHARMA/HDF/UPI',
  '825.41  10,020.00',
  'Effective available balance as on 22-11-2026 11:14:36 is INR 9,277.21',
  '**This is a computer generated statement and does not require a signature.',
]

describe('Indian Overseas Bank PDF (newest first)', () => {
  const res = parsePdfLines(PDFJS, { statementType: 'bank' })

  it('reads every row, newest first, with the direction from the "-" in the empty column', () => {
    expect(res.records.map((r) => [r.date, r.direction, r.amount, r.balanceAfter])).toEqual([
      ['2026-11-22', 'debit', 20, 9277.21],
      ['2026-11-22', 'debit', 180, 9297.21],
      ['2026-08-01', 'credit', 20, 9477.21],
      ['2026-07-01', 'debit', 1, 9457.21],
      ['2026-05-24', 'debit', 89, 9458.21],
      ['2026-05-23', 'debit', 135.41, 9547.21],
      ['2026-05-22', 'debit', 400, 9682.62],
      ['2026-05-22', 'credit', 10000, 10082.62],
    ])
    expect(res.records.every((r) => r.directionFrom === 'marker')).toBe(true)
  })

  it('reconciles newest-first and matches the printed available balance', () => {
    expect(balanceOrder(res.records)).toBe('newest_first')
    expect(res.stated.closing).toBe(9277.21)
    expect(res.reconciliation).toMatchObject({ ok: true, order: 'newest_first', identity: { opening: 82.62, credits: 10020, debits: 825.41, closing: 9277.21, ok: true } })
    expect(res.reconciliation!.identity.stated?.matches).toBe(true)
  })

  it('keeps value dates, ref numbers, "Transfer" and footers out of the narration', () => {
    const d = res.records.map((r) => r.rawDescription)
    expect(d[0]).toBe('UPI/111255225492/DR/ MAGIS FOODS/YES/na')
    expect(d.join(' ')).not.toMatch(/\(\d{2}-[A-Z][a-z]{2}-\d{2}\)|S\d{8}|Transfer|available balance|computer generated/)
  })

  it('gives clean merchants and the UPI reference', () => {
    const { txns } = buildTxns(res.records, { source: 'pdf', statementType: 'bank', batchId: 'b', importedAt: 'now' })
    expect(txns[0].merchantGuess).toBe('Magis Foods')
    expect(txns[0].reference).toBe('111255225492')
    expect(txns[1].merchantGuess).toBe('Annai Cafe')
  })

  it('classifies neighbourhood shops and treats named people as possible transfers, not leaks', () => {
    const { txns } = buildTxns(res.records, { source: 'pdf', statementType: 'bank', batchId: 'b', importedAt: 'now' })
    const by = (s: string) => txns.find((t) => t.rawDescription.includes(s))!
    expect(by('MAGIS FOODS').autoCategory).toBe('Dining')
    expect(by('ANNAI CAFE').autoCategory).toBe('Dining')
    expect(by('Google Play').autoCategory).toBe('Subscriptions')
    expect(by('CHRGS').merchantGuess).toBe('Bank charges')
    expect(by('R VARUN').reviewReason).toBe('potential_p2p')
    expect(by('A KUMAR').reviewReason).toBe('potential_p2p')
  })

  it('is labelled, and the agent does not "repair" correct newest-first rows', () => {
    expect(detectPdfLayout(PDFJS)).toBe('Indian Overseas Bank')
    expect(repairDirections(res.records).flipped).toEqual([])
    const a = analyzePdf(PDFJS, 'Account Statement.pdf', 'bank', 2, [], [])
    expect(a.repaired).toEqual([])
    expect(a.reconciliation?.ok).toBe(true)
  })

  it('also reads the other grouping, where the amounts share a line with the narration tail or wrap', () => {
    const other = parsePdfLines(
      [
        ...HEADER,
        '22-Nov-26',
        '(22-Nov-26)',
        'UPI/111255225492/DR/ MAGIS FOODS',
        '/YES/na S69300283 Transfer 20.00 - 9,277.21',
        '22-Nov-26',
        '(22-Nov-26)',
        'UPI/111255207567/DR/ ANNAI CAFE',
        '/HDF/na S69255144 Transfer 180.00',
        '- 9,297.21',
        '01-Aug-26',
        '(01-Aug-26)',
        'Int.Pd:01-05-2026 to 31-07-2026:',
        '500000000000001 S12838336 Transfer',
        '- 20.00 9,477.21',
      ],
      { statementType: 'bank' },
    )
    expect(other.records.map((r) => [r.direction, r.amount, r.balanceAfter])).toEqual([
      ['debit', 20, 9277.21],
      ['debit', 180, 9297.21],
      ['credit', 20, 9477.21],
    ])
  })
})

describe('oldest-first statements still settle directions from the balance', () => {
  it('uses the opening balance and the running balance when there is no marker', () => {
    const r = parsePdfLines(
      ['Opening Balance 1,000.00', '01/08/26  SALARY ACME  5,000.00  6,000.00', '02/08/26  ZOMATO ORDER  250.00  5,750.00', '03/08/26  NEFT RAVI  1,000.00  6,750.00'],
      { statementType: 'bank' },
    )
    expect(r.records.map((x) => [x.direction, x.directionFrom])).toEqual([
      ['credit', 'balance'],
      ['debit', 'balance'],
      ['credit', 'balance'],
    ])
  })
})
