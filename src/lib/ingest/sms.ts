import { parseDate, todayISO } from '../dates'
import { MANDATE_HINT } from './merchants'
import type { RawRecord } from './statement'

export interface UnparsedSms {
  text: string
  reason: string
}

export interface SmsResult {
  records: RawRecord[]
  unparsed: UnparsedSms[]
}

const BANKS: [RegExp, string][] = [
  [/hdfc/i, 'HDFC Bank'],
  [/icici/i, 'ICICI Bank'],
  [/\bsbi\b|state bank/i, 'SBI'],
  [/axis/i, 'Axis Bank'],
  [/kotak/i, 'Kotak Bank'],
  [/yes ?bank/i, 'Yes Bank'],
  [/idfc/i, 'IDFC First'],
  [/\bpnb\b|punjab national/i, 'PNB'],
  [/bank of baroda|\bbob\b/i, 'Bank of Baroda'],
  [/canara/i, 'Canara Bank'],
  [/indusind/i, 'IndusInd Bank'],
  [/federal/i, 'Federal Bank'],
  [/\brbl\b/i, 'RBL Bank'],
  [/paytm payments/i, 'Paytm Payments Bank'],
]

const CURRENCY = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi
const MONTH_DATE =
  /(\d{1,2}[-/. ]?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-/. ]?\d{2,4})/i
const ISO_DATE = /(\d{4}-\d{1,2}-\d{1,2})/
const NUM_DATE = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/

const SENDER_LINE = /^\s*(?:[A-Z]{2}-)?[A-Z0-9]{4,10}\s*$/
const TIMESTAMP_LINE = /^\s*(?:\d{1,2}:\d{2}\s*(?:am|pm)?|today|yesterday|\d{1,2} \w{3,9}(?: \d{4})?)\s*$/i

function splitMessages(input: string): string[] {
  const text = input.replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  let chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean)
  if (chunks.length === 1 && chunks[0].includes('\n')) {
    const lines = chunks[0].split('\n').map((l) => l.trim()).filter(Boolean)
    const withAmount = lines.filter((l) => /(?:rs\.?|inr|₹)\s*[\d,]+|(?:debited|credited)\s+(?:by|for|with)\s*[\d,]+/i.test(l))
    // one message per line when every line is a self-contained transaction
    if (withAmount.length >= 2 && withAmount.length >= lines.length - 1) chunks = lines
  }
  return chunks
    .map((c) =>
      c
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !SENDER_LINE.test(l) && !TIMESTAMP_LINE.test(l))
        .join(' '),
    )
    .filter(Boolean)
}

function findAmount(msg: string): number | null {
  CURRENCY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CURRENCY.exec(msg))) {
    const before = msg.slice(Math.max(0, m.index - 22), m.index)
    if (/(bal(?:ance)?|avl|available|limit|lmt|total due|min(?:imum)? due)[^a-z]*$/i.test(before)) continue
    const v = parseFloat(m[1].replace(/,/g, ''))
    if (Number.isFinite(v) && v > 0) return v
  }
  // "debited by 356.0 on date ..." (no currency symbol)
  const bare = msg.match(/\b(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d{1,2})?)\b/i)
  if (bare) {
    const v = parseFloat(bare[1].replace(/,/g, ''))
    if (v > 0) return v
  }
  return null
}

function findBalance(msg: string): number | null {
  const m = msg.match(
    /(?:avl\.?|available|closing)\s*(?:bal(?:ance)?)\.?\s*(?:is|:|-)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  )
  if (!m) return null
  const v = parseFloat(m[1].replace(/,/g, ''))
  return Number.isFinite(v) ? v : null
}

function findDirection(msg: string): 'debit' | 'credit' | null {
  const debit =
    /\b(debited|debit|spent|sent|paid|withdrawn|purchase|deducted|transferred to)\b|(?:used|using)\s+(?:your\s+)?(?:\w+\s+)?card/i
  const credit = /\b(credited|credit alert|received|deposited|refund(?:ed)?)\b/i
  const d = msg.search(debit)
  const c = msg.search(credit)
  if (d === -1 && c === -1) return null
  if (d === -1) return 'credit'
  if (c === -1) return 'debit'
  return d < c ? 'debit' : 'credit'
}

function findDate(msg: string): string | null {
  for (const re of [MONTH_DATE, ISO_DATE, NUM_DATE]) {
    const m = msg.match(re)
    if (m) {
      const d = parseDate(m[1])
      if (d) return d
    }
  }
  return null
}

function findMask(msg: string): string | null {
  const m = msg.match(
    /(?:a\/c|acct?|account|card)\s*(?:no\.?|number|ending|ending with)?\s*[:\-]?\s*(?:[x*]+\s*)?(\d{3,4})\b/i,
  )
  return m ? `XX${m[1]}` : null
}

function findReference(msg: string): string | null {
  const m =
    msg.match(/(?:ref(?:erence)?\.?(?:\s*no\.?)?|refno|rrn|upi(?:\s*ref(?:\s*no)?)?)[:.\s-]*(\d{9,14})/i) ??
    msg.match(/(?<!\d)(\d{12})(?!\d)/)
  return m ? m[1] : null
}

const BAD_COUNTERPARTY =
  /^(a\/c|acct?|account|your|card|bank|upi|ref|avl|available|rs|inr|not you|if not|hdfc|icici|sbi|axis|kotak|date|info)\b/i

function cleanCounterparty(s: string | undefined | null): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').replace(/[.;,:]+$/, '').trim()
  if (t.length < 2 || BAD_COUNTERPARTY.test(t) || /^[\d\s.,]+$/.test(t)) return null
  return t.slice(0, 48)
}

function findCounterparty(msg: string): { name: string | null; vpa: string | null } {
  const vpaM = msg.match(/(?<![a-z0-9._])([a-z0-9][a-z0-9._]*@[a-z][a-z0-9]*)/i)
  const vpa = vpaM ? vpaM[1].toLowerCase() : null
  // "to rahul.k@okbank" / "from VPA acme@hdfcbank": the VPA itself is the counterparty
  if (vpa) {
    const before = msg.slice(0, vpaM!.index).toLowerCase()
    if (/\b(to|from|by|vpa|payee)\s*$/.test(before)) return { name: vpa, vpa }
  }

  const patterns: RegExp[] = [
    /UPI\/(?:P2M|P2P|P2A)\/\d+\/([^/.]+?)(?:[./]|\s|$)/i,
    /(?:trf|transfer(?:red)?)\s+to\s+(.+?)(?=\s+(?:ref|refno|on|via|upi|if|not|avl|available)\b|\s*[.;,]|$)/i,
    /;\s*([^;.]+?)\s*(?:credited|debited)?\s*(?:[.;]|$)/i,
    /\bat\s+(.+?)(?=\s+(?:on|ref|via|using|avl|available)\b|\s*[.;,]|$)/i,
    /\bto\s+(?!a\/c|acct?|account)(.+?)(?=\s+(?:on|ref|refno|via|upi|if|avl|available)\b|\s*[.;,(]|$)/i,
    /\b(?:from|by)\s+(?!a\/c|acct?|account|hdfc|icici|sbi|axis|kotak)(.+?)(?=\s+(?:on|ref|refno|via|upi|if|avl|available)\b|\s*[.;,(]|$)/i,
    /\bInfo[:\-]\s*(.+?)(?=\s*[.;]|$)/i,
  ]
  for (const re of patterns) {
    const m = msg.match(re)
    const name = cleanCounterparty(m?.[1])
    if (name) {
      // "to rahul.k@okbank" returns the vpa itself; keep it as the counterparty text
      return { name, vpa }
    }
  }
  return { name: vpa, vpa }
}

function findBank(msg: string): string | null {
  // a merchant's VPA (swiggy@icici) or a link says nothing about the user's own bank
  const text = msg.replace(/\S+@\S+/g, ' ').replace(/https?:\/\/\S+/g, ' ')
  for (const [re, name] of BANKS) if (re.test(text)) return name
  return null
}

const NOT_A_TRANSACTION =
  /\bwill be (?:debited|charged|auto)|upcoming|scheduled for|mandate (?:created|registered|revoked|request)|collect request|requested money|due (?:on|by|date)|minimum (?:amount )?due|e-?statement|pre-?approved|offer|click|http/i

export function parseSmsMessage(msg: string, today: string = todayISO()): RawRecord | UnparsedSms {
  const text = msg.replace(/\s+/g, ' ').trim()
  if (/\b(otp|one[- ]time password|verification code)\b/i.test(text))
    return { text, reason: 'Looks like an OTP message, so it was skipped' }
  if (/\b(failed|declined|unsuccessful|could not be processed)\b/i.test(text))
    return { text, reason: 'Looks like a failed transaction, so it was skipped' }
  if (NOT_A_TRANSACTION.test(text) && !/\b(debited|credited|sent|spent|paid|received)\b/i.test(text))
    return { text, reason: 'Not a completed transaction (alert, offer or reminder)' }
  if (/\bwill be (?:debited|charged)\b/i.test(text))
    return { text, reason: 'Upcoming debit notice, not a completed transaction' }

  const amount = findAmount(text)
  if (amount == null) return { text, reason: 'No amount found' }
  const direction = findDirection(text)
  if (!direction) return { text, reason: 'Could not tell if money went out or came in' }

  const date = findDate(text)
  const { name, vpa } = findCounterparty(text)
  const mandate = MANDATE_HINT.test(text) ? (text.match(MANDATE_HINT)?.[0] ?? '') : ''
  const classifyText = [name, vpa && vpa !== name ? vpa : '', mandate].filter(Boolean).join(' ')

  return {
    date: date ?? today,
    postedDate: null,
    rawDescription: text.slice(0, 400),
    reference: findReference(text),
    amount: Math.round(amount * 100) / 100,
    direction,
    balanceAfter: findBalance(text),
    bank: findBank(text),
    accountMask: findMask(text),
    merchantHint: name,
    classifyText: classifyText || undefined,
    missingDate: date == null,
  }
}

export function parseSmsBlock(input: string, today: string = todayISO()): SmsResult {
  const records: RawRecord[] = []
  const unparsed: UnparsedSms[] = []
  for (const msg of splitMessages(input)) {
    const res = parseSmsMessage(msg, today)
    if ('reason' in res) unparsed.push(res)
    else records.push(res)
  }
  return { records, unparsed }
}
