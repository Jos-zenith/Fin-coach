import { findRule } from '../engine/resolve'
import { formatINR } from '../format'
import { buildTxns } from '../ingest/build'
import { balanceOrder, parsePdfLines, type PdfRow } from '../ingest/pdf'
import { reconcile, type Reconciliation } from '../ingest/reconcile'
import { parseSmsBlock } from '../ingest/sms'
import { isUpiAppStatement, parseUpiAppLines, upiAppName } from '../ingest/upiapp'
import { parseStatementRows, type Detection, type ParseOptions, type RawRecord, type Rows } from '../ingest/statement'
import type { Rule, Txn } from '../types'
import { Tracer } from './types'

const recText = (r: Reconciliation | null) =>
  r == null
    ? 'no balance column'
    : r.ok
      ? `passed (${r.checked} rows; opening ${formatINR(r.identity.opening)} + credits ${formatINR(r.identity.credits)} − debits ${formatINR(r.identity.debits)} = closing ${formatINR(r.identity.closing)}${r.identity.stated ? ', matches the printed balances' : ''})`
      : r.breaks.length
        ? `failed at ${r.breaks.length} row${r.breaks.length === 1 ? '' : 's'}, first near ${r.breaks[0].date}, difference ${formatINR(Math.abs(r.breaks[0].gap))}`
        : r.identity.stated && !r.identity.stated.matches
          ? `rows chain, but do not match the printed ${r.identity.stated.closing != null ? `closing balance of ${formatINR(r.identity.stated.closing)}` : 'opening balance'}: rows may be missing at the start or end`
          : 'opening + credits − debits does not equal closing'

const score = (r: Reconciliation | null, parsed: number) => (r ? r.matched * 1000 - r.breaks.length * 10 : 0) + parsed

/**
 * A row whose balance only adds up with the opposite direction was mis-read (common in PDFs and
 * single-amount CSVs). Flip it. Deterministic: the running balance decides, not a guess.
 */
export function repairDirections<T extends RawRecord>(rowsInFileOrder: T[]): { rows: T[]; flipped: number[] } {
  const rows = rowsInFileOrder.map((r) => ({ ...r }))
  const flipped: number[] = []
  // walk in time order: many banks (IOB, SBI online) list newest first
  const newestFirst = balanceOrder(rows) === 'newest_first'
  const idx = rows.map((_, i) => i)
  if (newestFirst) idx.reverse()
  for (let k = 1; k < idx.length; k++) {
    const i = idx[k]
    const prev = rows[idx[k - 1]].balanceAfter
    const r = rows[i]
    if (prev == null || r.balanceAfter == null) continue
    const asIs = prev + (r.direction === 'credit' ? r.amount : -r.amount)
    const other = prev + (r.direction === 'credit' ? -r.amount : r.amount)
    if (Math.abs(asIs - r.balanceAfter) >= 1 && Math.abs(other - r.balanceAfter) < 1) {
      r.direction = r.direction === 'credit' ? 'debit' : 'credit'
      flipped.push(i)
    }
  }
  return { rows, flipped }
}

export interface FlagSummary {
  total: number
  classified: number
  review: number
  duplicates: number
  alreadyImported: number
  cardRepayments: number
  selfTransfers: number
  p2p: number
  ruleMatches: number
}

/** Runs the sanitizer over records (no saving) and counts what the user should know about. */
export function flagRecords(records: RawRecord[], source: Txn['source'], statementType: 'bank' | 'card' | null, existing: Txn[], rules: Rule[]): FlagSummary {
  const built = buildTxns(records, { source, statementType, batchId: 'agent', importedAt: '' }, existing)
  const t = built.txns
  return {
    total: t.length,
    classified: t.filter((x) => x.autoCategory != null || findRule(x, rules)).length,
    review: t.filter((x) => x.flags.includes('needs_review') && !findRule(x, rules)).length,
    duplicates: built.duplicatesFlagged,
    alreadyImported: built.alreadyImported,
    cardRepayments: t.filter((x) => x.flags.includes('cc_repayment')).length,
    selfTransfers: t.filter((x) => x.flags.includes('self_transfer')).length,
    p2p: t.filter((x) => x.reviewReason === 'potential_p2p').length,
    ruleMatches: t.filter((x) => findRule(x, rules)).length,
  }
}

function flagLines(f: FlagSummary): string[] {
  const out = [`Classified ${f.classified} of ${f.total}; ${f.review} need review`]
  const bits = [
    f.cardRepayments && `${f.cardRepayments} card repayment${f.cardRepayments > 1 ? 's' : ''}`,
    f.selfTransfers && `${f.selfTransfers} self-transfer${f.selfTransfers > 1 ? 's' : ''}`,
    f.p2p && `${f.p2p} possible P2P transfer${f.p2p > 1 ? 's' : ''}`,
    f.duplicates && `${f.duplicates} duplicate${f.duplicates > 1 ? 's' : ''} of rows already loaded`,
    f.alreadyImported && `${f.alreadyImported} already imported`,
    f.ruleMatches && `${f.ruleMatches} matched your saved rules`,
  ].filter(Boolean)
  if (bits.length) out.push(`Flagged: ${bits.join(', ')}`)
  return out
}

// ---------------------------------------------------------------------------
// CSV / Excel
// ---------------------------------------------------------------------------

export interface CsvAgentResult {
  options: ParseOptions
  reconciliation: Reconciliation | null
  corrected: string | null
  trace: Tracer
}

export function analyzeCsv(rows: Rows, det: Detection, fileName: string, statementType: 'bank' | 'card', existing: Txn[], rules: Rule[]): CsvAgentResult {
  const tr = new Tracer('Ingestion & Reconciliation', 'Statement file loaded', fileName)
  tr.plan('Detect the statement layout', 'Extract rows with the detected column map', 'Verify running balances', 'If they do not reconcile, retry with alternate assumptions', 'Flag duplicates, card repayments, self-transfers and P2P', 'Ask the user only about what is still unresolved')
  tr.call('detect_statement_layout', { file: fileName }, () => det, (d) => `${d.template === 'generic' ? 'unknown' : d.template.toUpperCase() + '-style'} layout, header on line ${d.headerRow + 1}${d.confident ? '' : ' (low confidence)'}`, (d) => ({ template: d.template, headerRow: d.headerRow + 1, amountMode: d.amountMode }))

  const base: ParseOptions = { headerRow: det.headerRow, map: det.map, amountMode: det.amountMode, singleSign: statementType === 'card' ? 'positive_debit' : 'negative_debit', monthFirst: false }
  const first = tr.call('extract_transactions', { source: 'csv', ...summarizeOpts(base) }, () => parseStatementRows(rows, base), (p) => `${p.records.length} rows, ${p.skipped.length} skipped`)
  const firstRec = tr.call('verify_balance_integrity', { attempt: 1 }, () => first.reconciliation, recText)
  let best = { opts: base, parsed: first, rec: firstRec, label: null as string | null }

  if (statementType === 'bank' && firstRec && !firstRec.ok) {
    const alts: { label: string; opts: ParseOptions }[] = [{ label: 'dates read month-first', opts: { ...base, monthFirst: true } }]
    if (base.amountMode === 'single') alts.push({ label: 'opposite sign convention', opts: { ...base, singleSign: base.singleSign === 'negative_debit' ? 'positive_debit' : 'negative_debit' } })
    if (base.amountMode === 'split' && base.map.debit != null && base.map.credit != null)
      alts.push({ label: 'debit and credit columns swapped', opts: { ...base, map: { ...base.map, debit: base.map.credit, credit: base.map.debit } } })
    for (const a of alts) {
      const p = tr.call('extract_transactions', { retry: a.label }, () => parseStatementRows(rows, a.opts), (x) => `${x.records.length} rows, ${x.skipped.length} skipped`)
      const r = tr.call('verify_balance_integrity', { retry: a.label }, () => p.reconciliation, recText)
      if (score(r, p.records.length) > score(best.rec, best.parsed.records.length)) best = { opts: a.opts, parsed: p, rec: r, label: a.label }
    }
    if (best.label) tr.verify(`Retry with ${best.label} improved the balance check: ${recText(best.rec)}`)
    else tr.verify('No alternate assumption reconciled better; keeping the detected mapping')
  } else if (firstRec?.ok) {
    tr.verify(`Running balances reconcile across ${firstRec.checked} rows: no rows appear to be missing`)
  }

  const flags = tr.call('flag_records', { rows: best.parsed.records.length }, () => flagRecords(best.parsed.records, 'csv', statementType, existing, rules), (f) => flagLines(f).join('; '), (f) => f)
  tr.result(`${best.parsed.records.length} transactions extracted, ${best.parsed.skipped.length} non-transaction rows listed`, `Balance check: ${recText(best.rec)}`, ...flagLines(flags))
  if (best.rec && !best.rec.ok) tr.result(`User review needed: the balance still breaks near ${best.rec.breaks[0].date}; check the column mapping or the file`).status('needs_user')
  else if (best.label) tr.status('corrected')
  tr.local().guard('No statement content sent to any model', true)
  return { options: best.opts, reconciliation: best.rec, corrected: best.label, trace: tr }
}

function summarizeOpts(o: ParseOptions) {
  return { headerRow: o.headerRow + 1, amountMode: o.amountMode, monthFirst: o.monthFirst, singleSign: o.singleSign }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function detectPdfLayout(lines: string[]): string {
  if (isUpiAppStatement(lines)) return upiAppName(lines)
  const head = lines.slice(0, 30).join(' ').toLowerCase()
  if (head.includes('narration') && /withdrawal/.test(head)) return 'HDFC-style'
  if (head.includes('transaction remarks')) return 'ICICI-style'
  if (head.includes('txn date') && head.includes('description')) return 'SBI-style'
  if (/\bioba0\d{6}\b|indian overseas bank/.test(head)) return 'Indian Overseas Bank'
  if (head.includes('particulars') && /debit ?\(rs\.?\)|credit ?\(rs\.?\)/.test(head)) return 'Particulars / Debit / Credit / Balance'
  if (/credit card|card number|minimum amount due|total amount due/.test(head)) return 'Credit-card statement'
  return 'unknown layout'
}

export interface PdfAgentResult {
  rows: PdfRow[]
  stated: { opening: number | null; closing: number | null }
  skipped: { line: string; reason: string }[]
  range: { start: string; end: string } | null
  /** indexes the agent flipped using the running balance */
  repaired: number[]
  reconciliation: Reconciliation | null
  layout: string
  trace: Tracer
}

export function analyzePdf(lines: string[], fileName: string, statementType: 'bank' | 'card', pages: number | null, existing: Txn[], rules: Rule[]): PdfAgentResult {
  const tr = new Tracer('Ingestion & Reconciliation', 'PDF statement opened', `${fileName}${pages ? `, ${pages} page${pages > 1 ? 's' : ''}` : ''}`)
  tr.plan('Detect the layout', 'Extract dated rows and join wrapped narrations', 'Verify running balances', 'If they break, repair debit/credit directions from the balance and re-check', 'Flag review items')
  const layout = tr.call('detect_statement_layout', { file: fileName }, () => detectPdfLayout(lines), (l) => l)
  const upiApp = isUpiAppStatement(lines)
  const parsed = upiApp
    ? tr.call('extract_transactions', { source: 'pdf', layout, lines: lines.length }, () => ({ ...parseUpiAppLines(lines), reconciliation: null, stated: { opening: null, closing: null } }), (p) => `${p.records.length} payments read; direction taken from the printed "Debited from" / "Credited to"; ${p.skipped.length} line${p.skipped.length === 1 ? '' : 's'} set aside`)
    : tr.call('extract_transactions', { source: 'pdf', lines: lines.length, statementType }, () => parsePdfLines(lines, { statementType }), (p) => `${p.records.length} candidate rows, ${p.skipped.length} dated lines without an amount`)
  if (upiApp) tr.verify('UPI app statements have no running balance, so the balance check does not apply; each payment carries its UTR, which also prevents double-counting with your bank statement')
  let rows = parsed.records
  let repaired: number[] = []
  let rec = tr.call('verify_balance_integrity', { attempt: 1 }, () => (statementType === 'bank' ? reconcile(rows, parsed.stated) : null), recText)
  if (statementType === 'bank' && rec && !rec.ok) {
    const fix = tr.call('repair_directions_from_balance', { rows: rows.length }, () => repairDirections(rows), (f) => (f.flipped.length ? `flipped ${f.flipped.length} row${f.flipped.length > 1 ? 's' : ''} whose balance only adds up the other way` : 'no row could be repaired this way'))
    if (fix.flipped.length) {
      rows = fix.rows
      repaired = fix.flipped
      rec = tr.call('verify_balance_integrity', { attempt: 2 }, () => reconcile(rows, parsed.stated), recText)
      tr.verify(`Retry: corrected ${fix.flipped.length} direction${fix.flipped.length > 1 ? 's' : ''} from the running balance → ${recText(rec)}`)
    }
  } else if (rec?.ok) tr.verify(`Running balances reconcile across ${rec.checked} rows`)
  const guessed = rows.filter((r, i) => r.directionFrom === 'guess' && !repaired.includes(i)).length
  const flags = tr.call('flag_records', { rows: rows.length }, () => flagRecords(rows, 'pdf', statementType, existing, rules), (f) => flagLines(f).join('; '), (f) => f)
  tr.result(`${rows.length} transactions extracted (${layout})`, `Balance check: ${recText(rec)}`, ...flagLines(flags))
  if (guessed) tr.result(`${guessed} debit/credit direction${guessed > 1 ? 's were' : ' was'} guessed from words; marked for you to check`)
  if (rec && !rec.ok) tr.result(`User review needed: the balance still breaks near ${rec.breaks[0].date}`).status('needs_user')
  else if (repaired.length) tr.status('corrected')
  else if (guessed) tr.status('needs_user')
  tr.local().guard('PDF read in the browser; nothing uploaded', true)
  return { rows, skipped: parsed.skipped, range: parsed.range, stated: parsed.stated, repaired, reconciliation: rec, layout, trace: tr }
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export function analyzeSms(text: string, existing: Txn[], rules: Rule[]) {
  const tr = new Tracer('Ingestion & Reconciliation', 'SMS pasted', `${text.split(/\n\s*\n|\n/).filter((l) => l.trim()).length} lines`)
  tr.plan('Split the paste into messages', 'Extract amount, direction, date, account, reference and counterparty', 'Skip OTPs, failed payments and reminders, with a reason', 'Match against statement rows already loaded', 'Apply saved rules')
  const parsed = tr.call('extract_transactions', { source: 'sms' }, () => parseSmsBlock(text), (p) => `${p.records.length} understood, ${p.unparsed.length} not understood`)
  const flags = tr.call('flag_records', { rows: parsed.records.length }, () => flagRecords(parsed.records, 'sms', 'bank', existing, rules), (f) => flagLines(f).join('; '), (f) => f)
  tr.result(`${parsed.records.length} transactions read from SMS`, ...parsed.unparsed.map((u) => `Not imported: ${u.reason}`), ...flagLines(flags))
  if (flags.duplicates) tr.verify(`${flags.duplicates} message${flags.duplicates > 1 ? 's' : ''} matched an existing statement row and will not be counted twice`)
  tr.local()
  return { parsed, flags, trace: tr }
}
