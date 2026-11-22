import { parseDate } from '../dates'
import { reconcile, type Reconciliation } from './reconcile'
import type { RawRecord } from './statement'

// ---------------------------------------------------------------------------
// PDF statements. Text is extracted in the browser with pdf.js (bundled, no network).
// Layouts vary a lot, so this is best-effort: every guess is shown and can be corrected.
// ---------------------------------------------------------------------------

export class PdfPasswordError extends Error {
  constructor(public reason: 'needed' | 'wrong') {
    super(reason === 'needed' ? 'This PDF is password-protected.' : 'That password did not open the PDF.')
  }
}

/** Reads every page into visual lines (text items that share a baseline, left to right). */
export async function pdfToLines(file: File, password?: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = new Uint8Array(await file.arrayBuffer())
  let doc
  try {
    doc = await pdfjs.getDocument({ data, password: password || undefined }).promise
  } catch (e) {
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') throw new PdfPasswordError(err.code === 2 ? 'wrong' : 'needed')
    throw new Error('Could not read this PDF. It may be damaged or not a statement.')
  }
  const lines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const rows: { y: number; items: { x: number; w: number; s: string }[] }[] = []
    for (const it of content.items as { str: string; transform: number[]; width: number }[]) {
      if (!it.str || !it.str.trim()) continue
      const x = it.transform[4]
      const y = it.transform[5]
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5)
      if (!row) rows.push((row = { y, items: [] }))
      row.items.push({ x, w: it.width, s: it.str })
    }
    rows.sort((a, b) => b.y - a.y)
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x)
      let line = ''
      let end = -Infinity
      for (const it of r.items) {
        // a wide gap is a column break: keep it visible as two spaces
        line += line ? (it.x - end > 8 ? '  ' : ' ') + it.s.trim() : it.s.trim()
        end = it.x + it.w
      }
      lines.push(line)
    }
  }
  if (!lines.some((l) => /\d/.test(l))) throw new Error('No text found. This looks like a scanned PDF, which needs OCR. Use CSV or SMS paste instead.')
  return lines
}

const DATE_START =
  /^(\d{1,2}[/\-.](?:\d{1,2}|[A-Za-z]{3,9})[/\-.]\d{2,4}|\d{1,2} [A-Za-z]{3,9},? \d{2,4}|[A-Za-z]{3,9} \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})\b/
const DATE_ANY = /^(\d{1,2}[/\-.](?:\d{1,2}|[A-Za-z]{3,9})[/\-.]\d{2,4}|\d{1,2} [A-Za-z]{3,9},? \d{2,4}|\d{4}-\d{2}-\d{2})\s*/
/** Amounts in statements carry paise: 1,250.00 / 68000.00 / 412.00 Dr */
const MONEY = /(?<![\w/.])-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}(?:\s?(?:cr|dr)\b)?(?![\w/])/gi
const NOISE_LINE =
  /\b(page \d+|statement of account|statement summary|closing balance|total|generated on|account (?:no|number)|customer id|ifsc|branch|available balance|computer generated|does not require a signature)\b/i
const CREDIT_HINT = /\b(cr|credit|salary|neft cr|by transfer|refund|reversal|interest|int\.?\s?pd|deposit|received|cashback)\b/i
/** value date printed under the transaction date: "(22-Nov-26)" */
const VALUE_DATE = /\(\s*\d{1,2}[/\-.](?:\d{1,2}|[A-Za-z]{3,9})[/\-.]\d{2,4}\s*\)/g
/** reference-number and transaction-type columns that sit between the narration and the amounts */
const REF_COLUMN = /(?<![\w/-])[A-Z]{1,2}\d{7,10}(?![\w/])/g
const TYPE_COLUMN = /(^|\s{2,})(Transfer|TRF|Clearing)(?=\s{2,}|$)/gi
/** UPI narrations that carry the direction: "UPI/111255225492/DR/ MAGIS FOODS" */
const UPI_DIR = /\bUPI\/(?:\d{6,}\/)?(DR|CR)\//i

export interface PdfRow extends RawRecord {
  /** how the debit/credit direction was decided */
  directionFrom: 'marker' | 'balance' | 'guess' | 'card'
}

export interface PdfParseResult {
  records: PdfRow[]
  skipped: { line: string; reason: string }[]
  range: { start: string; end: string } | null
  reconciliation: Reconciliation | null
  stated: { opening: number | null; closing: number | null }
}

function money(tok: string) {
  const sign = /cr\b/i.test(tok) ? 'credit' : /dr\b/i.test(tok) ? 'debit' : null
  const value = parseFloat(tok.replace(/cr|dr/gi, '').replace(/[,\s-]/g, ''))
  return { value: Math.abs(value), sign: sign as 'credit' | 'debit' | null, negative: /^\s*-/.test(tok) }
}

/**
 * Split Debit / Credit columns print "-" (or leave a gap) in the empty one:
 *   "20.00  -  1,007.75"  → debit       "-  300.00  1,407.75" → credit
 * Returns null when the line gives no such hint.
 */
function placeholderSide(line: string, amountTok: string, balanceTok: string): 'debit' | 'credit' | null {
  // whole tokens only, so "1.00" is not found inside "31.00"
  const at = (tok: string, last: boolean) => {
    const hits: number[] = []
    for (let i = line.indexOf(tok); i >= 0; i = line.indexOf(tok, i + 1)) {
      const prev = line[i - 1] ?? ' '
      const next = line[i + tok.length] ?? ' '
      if (!/[\d,.]/.test(prev) && !/[\d,]/.test(next) && !(next === '.' && /\d/.test(line[i + tok.length + 1] ?? ''))) hits.push(i)
    }
    return hits.length ? (last ? hits[hits.length - 1] : hits[0]) : -1
  }
  const a = at(amountTok, false)
  const b = at(balanceTok, true)
  if (a < 0 || b <= a) return null
  const between = line.slice(a + amountTok.length, b)
  const before = line.slice(0, a)
  if (/^-?\s+-\s*$|^-\s*$/.test(between)) return 'debit'
  if (/(^|\s)-\s*$/.test(before) && !/-/.test(between)) return 'credit'
  return null
}

/** Turns extracted lines into transactions. Pure, so it can be tested without a PDF. */
export function parsePdfLines(lines: string[], opts: { statementType: 'bank' | 'card'; monthFirst?: boolean }): PdfParseResult {
  const records: PdfRow[] = []
  const skipped: PdfParseResult['skipped'] = []
  // balances printed on the statement, for the Opening + Credits − Debits = Closing check
  let statedOpening: number | null = null
  let statedClosing: number | null = null

  interface Cand { date: string; text: string; tokens: string[]; moneyLine: string; raw: string }
  let cand: Cand | null = null

  const finish = () => {
    if (!cand) return
    const c = cand
    cand = null
    const toks = c.tokens.map((t) => ({ tok: t, ...money(t) })).filter((t) => Number.isFinite(t.value))
    if (!toks.length) {
      skipped.push({ line: c.raw, reason: 'Date found but no amount' })
      return
    }
    let balance: number | null = null
    let balanceTok: string | null = null
    let amountTok = toks[0]
    if (toks.length >= 2 && opts.statementType === 'bank') {
      balance = toks[toks.length - 1].value
      balanceTok = toks[toks.length - 1].tok
      const middle = toks.slice(0, -1).filter((t) => t.value > 0)
      if (!middle.length) {
        skipped.push({ line: c.raw, reason: 'Only zero amounts on this row' })
        return
      }
      amountTok = middle[0]
    } else if (toks.length >= 2) {
      amountTok = toks[toks.length - 1]
    }
    const amount = amountTok.value
    const text = c.text
      .replace(VALUE_DATE, ' ')
      .replace(TYPE_COLUMN, ' ')
      .replace(REF_COLUMN, ' ')
      .replace(/(^|\s)-(?=\s|$)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+\//g, '/')
      .trim()
    let direction: 'debit' | 'credit'
    let directionFrom: PdfRow['directionFrom']
    const side = balanceTok ? placeholderSide(c.moneyLine, amountTok.tok, balanceTok) : null
    const upi = text.match(UPI_DIR)
    if (amountTok.sign) {
      direction = amountTok.sign
      directionFrom = 'marker'
    } else if (side) {
      direction = side
      directionFrom = 'marker'
    } else if (upi) {
      direction = upi[1].toUpperCase() === 'DR' ? 'debit' : 'credit'
      directionFrom = 'marker'
    } else if (opts.statementType === 'card') {
      direction = amountTok.negative || CREDIT_HINT.test(text) ? 'credit' : 'debit'
      directionFrom = 'card'
    } else {
      // settled from the running balance after all rows are read, once the file's order is known
      direction = CREDIT_HINT.test(text) ? 'credit' : 'debit'
      directionFrom = 'guess'
    }
    records.push({
      date: c.date,
      postedDate: null,
      rawDescription: text || '(no description)',
      reference: null,
      amount,
      direction,
      balanceAfter: balance,
      directionFrom,
    })
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/opening balance/i.test(line)) {
      const t = line.match(MONEY)
      if (t) statedOpening = money(t[t.length - 1]).value
      continue
    }
    if (/closing balance|available balance/i.test(line)) {
      const t = line.match(MONEY)
      if (t) statedClosing = money(t[t.length - 1]).value
      finish()
      continue
    }
    const dm = line.match(DATE_START)
    const date = dm ? parseDate(dm[1].replace(/,/g, ''), { monthFirst: opts.monthFirst }) : null
    if (date) {
      finish()
      let rest = line.slice(dm![0].length).trim()
      // a value date right after the transaction date
      rest = rest.replace(DATE_ANY, (m) => (parseDate(m.trim().replace(/,/g, '')) ? '' : m))
      const tokens = rest.match(MONEY) ?? []
      cand = { date, text: rest.replace(MONEY, ' ').trim(), tokens, moneyLine: tokens.length ? rest : '', raw: line }
    } else if (cand) {
      if (NOISE_LINE.test(line)) {
        finish()
        continue
      }
      const tokens = line.match(MONEY) ?? []
      if (!cand.tokens.length && tokens.length) {
        cand.tokens.push(...tokens)
        cand.moneyLine = line
      } else if (cand.tokens.length === 1 && tokens.length && /^[-\s\d,.]+$/.test(line)) {
        // the amount columns wrapped: "… Transfer 100.00" then "- 4,139.74" on the next line
        cand.tokens.push(...tokens)
        cand.moneyLine += '  ' + line
      }
      cand.text += '  ' + line.replace(MONEY, ' ').trim()
      cand.raw += ' ' + line
    }
  }
  finish()
  settleFromBalances(records, statedOpening)
  const dates = records.map((r) => r.date).sort()
  return { records, skipped, range: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null, reconciliation: reconcile(records, { opening: statedOpening, closing: statedClosing }), stated: { opening: statedOpening, closing: statedClosing } }
}

/** Is the file oldest-first or newest-first? Counts consecutive pairs the balances can explain either way. */
export function balanceOrder(rows: { amount: number; balanceAfter: number | null }[]): 'oldest_first' | 'newest_first' {
  const explains = (prev: number, r: { amount: number; balanceAfter: number | null }) =>
    r.balanceAfter != null && (Math.abs(prev - r.amount - r.balanceAfter) < 1 || Math.abs(prev + r.amount - r.balanceAfter) < 1)
  let fwd = 0
  let rev = 0
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].balanceAfter
    const b = rows[i].balanceAfter
    if (a != null && explains(a, rows[i])) fwd++
    if (b != null && explains(b, rows[i - 1])) rev++
  }
  return rev > fwd ? 'newest_first' : 'oldest_first'
}

/** Replaces word-guessed directions with what the running balance proves, in the file's real order. */
function settleFromBalances(records: PdfRow[], opening: number | null) {
  if (records.filter((r) => r.balanceAfter != null).length < 2) return
  const chrono = balanceOrder(records) === 'oldest_first' ? records : [...records].reverse()
  let prev: number | null = opening
  for (const r of chrono) {
    if (r.balanceAfter == null) {
      prev = null
      continue
    }
    if (prev != null && r.directionFrom === 'guess') {
      if (Math.abs(prev - r.amount - r.balanceAfter) < 1) {
        r.direction = 'debit'
        r.directionFrom = 'balance'
      } else if (Math.abs(prev + r.amount - r.balanceAfter) < 1) {
        r.direction = 'credit'
        r.directionFrom = 'balance'
      }
    }
    prev = r.balanceAfter
  }
}
