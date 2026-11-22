import { diffDays } from '../dates'
import type { Flag, Source, Txn } from '../types'
import { hash } from './ids'
import { classifyBaseline } from './sanitize'
import type { RawRecord } from './statement'

export interface BuildOptions {
  source: Source
  statementType: 'bank' | 'card' | null
  bank?: string | null
  accountMask?: string | null
  batchId: string
  importedAt: string
}

export interface BuildResult {
  /** New records to store (includes cross-source duplicates, flagged and excluded from maths). */
  txns: Txn[]
  /** Exact re-imports that were already in the database. */
  alreadyImported: number
  /** Near-duplicates of an existing record from a different source (e.g. SMS for a statement row). */
  duplicatesFlagged: number
  /** Existing SMS records that a richer statement row now replaces; the caller flags them as duplicates. */
  supersededIds: string[]
}

function normDesc(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80)
}

function merchantKey(t: Pick<Txn, 'merchantGuess' | 'vpa'>): string | null {
  const m = (t.merchantGuess ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (m) return m
  return t.vpa ? t.vpa.split('@')[0].replace(/[^a-z0-9]+/g, '') : null
}

/** 12-digit UPI reference (UTR/RRN) carried by a record, from its reference field or narration. */
function utrOf(t: Pick<Txn, 'reference' | 'rawDescription'>): string | null {
  const ref = (t.reference ?? '').replace(/\D/g, '')
  const found = ref.length >= 12 ? ref.slice(-12) : (t.rawDescription.match(/(?<!\d)(\d{12})(?!\d)/)?.[1] ?? null)
  return found && !/^0+$/.test(found) ? found : null
}

function sameCounterparty(a: Txn, b: Txn): boolean {
  if (a.reference && b.reference && a.reference === b.reference) return true
  // the same UPI payment seen in a PhonePe statement and in the bank statement (banks may zero-pad it)
  const ua = utrOf(a)
  const ub = utrOf(b)
  if (ua && ub) return ua === ub
  const ka = merchantKey(a)
  const kb = merchantKey(b)
  if (!ka || !kb) return true // nothing to contradict the match
  return ka === kb || ka.includes(kb) || kb.includes(ka)
}

/** Turns parsed records into stored transactions, applying the sanitizer and de-duplication. */
export function buildTxns(records: RawRecord[], opts: BuildOptions, existing: Txn[] = []): BuildResult {
  const existingIds = new Set(existing.map((t) => t.id))
  const seen = new Map<string, number>()
  const out: Txn[] = []
  let alreadyImported = 0
  let duplicatesFlagged = 0
  const supersededIds: string[] = []

  for (const r of records) {
    const key = `${r.date}|${r.amount.toFixed(2)}|${r.direction}|${normDesc(r.reference ?? '')}|${normDesc(r.rawDescription)}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    const id = `${hash(key)}-${n}`
    if (existingIds.has(id)) {
      alreadyImported++
      continue
    }

    const base = classifyBaseline({
      rawDescription: r.classifyText ?? r.rawDescription,
      direction: r.direction,
      amount: r.amount,
      statementType: opts.statementType,
    })
    const flags: Flag[] = [...base.flags]
    let reviewReason = base.reviewReason
    let reason = base.reason
    let confidence = base.confidence
    // UPI app statements name the person but show no UPI ID, so the VPA test cannot fire
    if (r.personHint && base.category == null && (reviewReason == null || reviewReason === 'uncategorized')) {
      reviewReason = 'potential_p2p'
      if (!flags.includes('needs_review')) flags.push('needs_review')
      confidence = 'low'
      reason =
        r.direction === 'debit'
          ? 'Paid to a person, not a business. Could be a split, rent share, repayment or gift, so it is not excluded automatically.'
          : 'Money from a person. If it pays you back for something, Runway nets it against that spending once you confirm.'
    }
    if (r.missingDate) {
      if (!flags.includes('needs_review')) flags.push('needs_review')
      reviewReason = 'missing_date'
    }

    const txn: Txn = {
      id,
      source: opts.source,
      statementType: opts.statementType,
      bank: r.bank ?? opts.bank ?? null,
      accountMask: r.accountMask ?? opts.accountMask ?? null,
      date: r.date,
      postedDate: r.postedDate,
      rawDescription: r.rawDescription,
      merchantGuess: base.merchant ?? r.merchantHint ?? null,
      vpa: base.vpa,
      reference: r.reference ?? base.reference,
      amount: r.amount,
      direction: r.direction,
      balanceAfter: r.balanceAfter,
      autoCategory: base.category,
      autoReason: r.missingDate
        ? `${reason} The message had no readable date, so the import date was used.`
        : reason,
      autoConfidence: confidence,
      flags,
      reviewReason,
      importedAt: opts.importedAt,
      batchId: opts.batchId,
    }

    // Near-duplicate: same amount and direction within a day, from a different source, same counterparty.
    const twin = existing.find(
      (e) =>
        !e.flags.includes('duplicate') &&
        e.source !== txn.source &&
        e.direction === txn.direction &&
        Math.abs(e.amount - txn.amount) < 0.005 &&
        Math.abs(diffDays(e.date, txn.date)) <= 1 &&
        sameCounterparty(e, txn),
    )
    if (twin) {
      duplicatesFlagged++
      if (twin.source === 'sms' && txn.source !== 'sms') {
        // statement rows carry more detail than an SMS, so keep the new row and retire the SMS copy
        supersededIds.push(twin.id)
      } else {
        txn.flags = [...txn.flags.filter((f) => f !== 'needs_review'), 'duplicate']
        txn.reviewReason = null
      }
    }
    out.push(txn)
  }
  return { txns: out, alreadyImported, duplicatesFlagged, supersededIds }
}
