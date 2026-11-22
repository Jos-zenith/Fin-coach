import Papa from 'papaparse'
import { dateFromJS, parseDate } from '../dates'
import { reconcile, type Reconciliation } from './reconcile'

// ---------------------------------------------------------------------------
// Rows in, column map out. No bank has the same layout, so everything here is
// "detect, show the user, let them override".
// ---------------------------------------------------------------------------

export type Cell = string
export type Rows = Cell[][]

export function rowsFromCSVText(text: string): Rows {
  const clean = text.replace(/^\uFEFF/, '')
  const res = Papa.parse<string[]>(clean, { skipEmptyLines: false })
  return (res.data as unknown[][]).map((r) => r.map((c) => (c == null ? '' : String(c).trim())))
}

export interface ColumnMap {
  date: number | null
  postedDate: number | null
  narration: number | null
  reference: number | null
  debit: number | null
  credit: number | null
  amount: number | null
  drcr: number | null
  balance: number | null
}

export const EMPTY_MAP: ColumnMap = {
  date: null,
  postedDate: null,
  narration: null,
  reference: null,
  debit: null,
  credit: null,
  amount: null,
  drcr: null,
  balance: null,
}

export type AmountMode = 'split' | 'single'
export type SingleSign = 'negative_debit' | 'positive_debit'
export type TemplateId = 'hdfc' | 'icici' | 'sbi' | 'axis' | 'generic'

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  hdfc: 'HDFC-style (Date, Narration, Withdrawal / Deposit Amt)',
  icici: 'ICICI-style (Transaction Date, Transaction Remarks, Withdrawal / Deposit Amount)',
  sbi: 'SBI-style (Txn Date, Description, Debit / Credit)',
  axis: 'Axis-style (Tran Date, Particulars, DR / CR, BAL)',
  generic: 'Other layout',
}

export interface Detection {
  headerRow: number
  headers: string[]
  map: ColumnMap
  amountMode: AmountMode
  template: TemplateId
  /** how sure we are the header row is a real header */
  confident: boolean
}

function norm(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const RE = {
  posted: /^value (date|dt)|^posting date|^post date/,
  date: /^(txn|transaction|tran|trans|booking)? ?date( inr)?$|^date of (txn|transaction)$/,
  narration: /(narration|description|particulars|remarks|details|merchant)/,
  reference: /(chq|cheque|\bref\b|reference|\butr\b)/,
  debit: /(withdrawal|debit|\bdr\b|paid out|amount debited)/,
  credit: /(deposit|credit|\bcr\b|paid in|amount credited)/,
  balance: /(balance|\bbal\b)/,
  amount: /^((txn|transaction) )?(amount|amt)( inr)?$/,
  drcr: /^(dr ?\/ ?cr|cr ?\/ ?dr|type|(txn|transaction) type)$/,
}

function firstMatch(headers: string[], re: RegExp, taken: Set<number>): number | null {
  for (let i = 0; i < headers.length; i++) {
    if (taken.has(i)) continue
    if (headers[i] && re.test(headers[i])) return i
  }
  return null
}

export function mapHeaders(rawHeaders: string[]): { map: ColumnMap; matched: number } {
  const headers = rawHeaders.map(norm)
  const taken = new Set<number>()
  const take = (re: RegExp): number | null => {
    const i = firstMatch(headers, re, taken)
    if (i != null) taken.add(i)
    return i
  }
  const map: ColumnMap = { ...EMPTY_MAP }
  map.postedDate = take(RE.posted)
  map.date = take(RE.date)
  if (map.date == null) map.date = take(/date/)
  map.reference = take(RE.reference)
  map.narration = take(RE.narration)
  map.balance = take(RE.balance)
  map.debit = take(RE.debit)
  map.credit = take(RE.credit)
  if (map.debit == null && map.credit == null) {
    map.amount = take(RE.amount)
    map.drcr = take(RE.drcr)
  }
  const matched = Object.values(map).filter((v) => v != null).length
  return { map, matched }
}

export function detectTemplate(headers: string[]): TemplateId {
  const h = headers.map(norm).join('|')
  if (h.includes('transaction remarks')) return 'icici'
  if (h.includes('narration') && /chq|ref/.test(h)) return 'hdfc'
  if (h.includes('txn date') && h.includes('description')) return 'sbi'
  const cols = headers.map(norm)
  if (h.includes('particulars') && (cols.includes('dr') || cols.includes('cr')) && (h.includes('tran date') || cols.includes('sol') || cols.includes('bal'))) return 'axis'
  return 'generic'
}

/** Finds the header row (banks put address / account blocks above it) and maps columns. */
export function detectLayout(rows: Rows): Detection | null {
  if (!rows.length) return null
  let best = { row: 0, score: -1 }
  const limit = Math.min(rows.length, 40)
  for (let i = 0; i < limit; i++) {
    const { map, matched } = mapHeaders(rows[i])
    const hasMoney = map.debit != null || map.credit != null || map.amount != null
    const score = matched + (map.date != null && hasMoney ? 3 : 0)
    if (score > best.score) best = { row: i, score }
  }
  const headers = rows[best.row] ?? []
  const { map } = mapHeaders(headers)
  const hasMoney = map.debit != null || map.credit != null || map.amount != null
  const confident = map.date != null && hasMoney
  return {
    headerRow: best.row,
    headers,
    map,
    amountMode: map.amount != null && map.debit == null && map.credit == null ? 'single' : 'split',
    template: detectTemplate(headers),
    confident,
  }
}

// ---------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------

/** Excel date serials sometimes survive as plain numbers (e.g. 46137). */
function excelSerialToISO(n: number): string | null {
  if (n < 30000 || n > 60000) return null
  return dateFromJS(new Date(Math.round((n - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000))
}

export function parseCellDate(cell: string, monthFirst: boolean): string | null {
  const s = (cell ?? '').trim()
  if (!s) return null
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(parseFloat(s))
  return parseDate(s, { monthFirst })
}

export interface MoneyCell {
  value: number
  /** set when the cell itself carried a Dr/Cr suffix or negative sign */
  sign: 'debit' | 'credit' | 'negative' | null
}

export function parseMoney(cell: string | undefined): MoneyCell | null {
  if (cell == null) return null
  let s = String(cell).trim()
  if (!s || /^(-|—|na|n\/a|nil|null)$/i.test(s)) return null
  let sign: MoneyCell['sign'] = null
  if (/\bdr\.?$/i.test(s)) {
    sign = 'debit'
    s = s.replace(/\s*dr\.?$/i, '')
  } else if (/\bcr\.?$/i.test(s)) {
    sign = 'credit'
    s = s.replace(/\s*cr\.?$/i, '')
  }
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s)
  s = s.replace(/[()₹]|rs\.?|inr/gi, '').replace(/,/g, '').replace(/\s/g, '').replace(/^-|-$/g, '')
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.?$/.test(s)) return null
  const value = parseFloat(s)
  if (!Number.isFinite(value)) return null
  return { value, sign: sign ?? (negative ? 'negative' : null) }
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

export interface RawRecord {
  date: string
  postedDate: string | null
  rawDescription: string
  reference: string | null
  amount: number
  direction: 'debit' | 'credit'
  balanceAfter: number | null
  bank?: string | null
  accountMask?: string | null
  /** parser hint for the merchant (SMS) */
  merchantHint?: string | null
  /** cleaner text for classification when the raw text carries boilerplate (SMS) */
  classifyText?: string
  missingDate?: boolean
  /** the parser saw a person's name or a masked phone number as the payee (UPI app statements) */
  personHint?: boolean
}

export interface ParseOptions {
  headerRow: number
  map: ColumnMap
  amountMode: AmountMode
  singleSign: SingleSign
  monthFirst: boolean
}

export interface SkippedRow {
  /** 1-based row number in the file, as a spreadsheet would show it */
  row: number
  reason: string
  raw: string
}

export interface ParseResult {
  records: RawRecord[]
  skipped: SkippedRow[]
  range: { start: string; end: string } | null
  /** null when the file has no balance column */
  reconciliation: Reconciliation | null
}

function cellAt(row: Cell[], idx: number | null): string {
  return idx == null ? '' : (row[idx] ?? '').trim()
}

export function parseStatementRows(rows: Rows, opts: ParseOptions): ParseResult {
  const records: RawRecord[] = []
  const skipped: SkippedRow[] = []
  const { map } = opts

  for (let r = opts.headerRow + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.every((c) => !c || !c.trim())) continue
    const raw = row.filter(Boolean).join(' | ').slice(0, 160)
    const rowNo = r + 1

    if (map.date == null) {
      skipped.push({ row: rowNo, reason: 'No date column mapped', raw })
      continue
    }
    const date = parseCellDate(cellAt(row, map.date), opts.monthFirst)
    if (!date) {
      skipped.push({ row: rowNo, reason: 'Date not readable (header, total or footer row?)', raw })
      continue
    }
    const postedDate = parseCellDate(cellAt(row, map.postedDate), opts.monthFirst)

    let amount = 0
    let direction: 'debit' | 'credit' | null = null

    if (opts.amountMode === 'split') {
      const dr = parseMoney(cellAt(row, map.debit))
      const cr = parseMoney(cellAt(row, map.credit))
      if (dr && dr.value > 0) {
        amount = dr.value
        direction = 'debit'
      } else if (cr && cr.value > 0) {
        amount = cr.value
        direction = 'credit'
      }
    } else {
      const m = parseMoney(cellAt(row, map.amount))
      if (m && m.value > 0) {
        amount = m.value
        const drcrCell = cellAt(row, map.drcr)
        if (m.sign === 'debit' || /^(dr|debit|d|w|withdrawal)\b/i.test(drcrCell)) direction = 'debit'
        else if (m.sign === 'credit' || /^(cr|credit|c|deposit)\b/i.test(drcrCell)) direction = 'credit'
        else if (opts.singleSign === 'negative_debit') direction = m.sign === 'negative' ? 'debit' : 'credit'
        else direction = m.sign === 'negative' ? 'credit' : 'debit'
      }
    }

    if (!direction || amount <= 0) {
      skipped.push({ row: rowNo, reason: 'No debit or credit amount on this row', raw })
      continue
    }

    const bal = parseMoney(cellAt(row, map.balance))
    records.push({
      date,
      postedDate,
      rawDescription: cellAt(row, map.narration) || '(no description)',
      reference: cellAt(row, map.reference) || null,
      amount: Math.round(amount * 100) / 100,
      direction,
      balanceAfter: bal ? bal.value : null,
    })
  }

  const reconciliation = reconcile(records)
  records.sort((a, b) => a.date.localeCompare(b.date))
  const range = records.length ? { start: records[0].date, end: records[records.length - 1].date } : null
  return { records, skipped, range, reconciliation }
}
