import type { Category, Direction, Flag, ReviewReason } from '../types'
import { INVESTMENT_HINT, matchMerchant } from './merchants'
import { looksLikePerson } from './upiapp'

// ---------------------------------------------------------------------------
// VPA / narration extraction
// ---------------------------------------------------------------------------

// No hyphen in the handle: narrations use "-" as a field separator, so "NAME-handle@psp" must not merge.
const VPA_RE = /(?<![a-z0-9._])([a-z0-9][a-z0-9._]*@[a-z][a-z0-9]*)/i
const REF_RE = /(?<!\d)(\d{12})(?!\d)/

const NOISE_TOKEN =
  /^((?:neft|imps|rtgs|nach|ach|ecs|upi) ?(?:cr|dr|d|c)?|upi|dr|cr|p2m|p2p|p2a|bbps|billpay|to transfer|by transfer|transfer|trf|imps|neft|rtgs|ach|ecs|nach|pos|atw|atm|payment|payment from .*|payment to .*|paid via .*|upi payment|upi mandate|na|null|nil|ref|refno)$/i
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/
const BANK_CODE_RE = /^(yesb|icic|hdfc|sbin|utib|kkbk|punb|ibkl|barb|cnrb|ubin|indb|fdrl|idfb|ratn|aubl|jsfb|airp|paytm)$/i
const MASKED_RE = /[x*]{3,}|\d{4,6}[x*]{2,}\d{2,4}/i

export interface Extracted {
  vpa: string | null
  reference: string | null
  /** Cleaned counterparty text before brand lookup */
  counterparty: string | null
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim()
}

function prettyHandle(vpa: string): string {
  const handle = vpa.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+$/, '').trim()
  return handle ? titleCase(handle) : vpa
}

/**
 * Pulls the VPA, 12-digit UPI reference and counterparty out of the many narration shapes banks emit:
 *  UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-412345678901-UPI
 *  UPI/412345678901/NA/swiggy@icici/ICICI Bank
 *  TO TRANSFER-UPI/DR/412345678901/RAHUL K/YESB/rahul.k@ybl/Payment f
 *  IMPS-412345678901-RAHUL KUMAR-HDFC-XXXXXXXX1234-RENT
 *  ACH D- BAJAJ FINANCE LTD-123456
 *  POS 412345XXXXXX1234 AMAZON PAY IN
 */
export function extractFromNarration(raw: string): Extracted {
  const text = raw.replace(/\s+/g, ' ').trim()
  const vpaMatch = text.match(VPA_RE)
  const vpa = vpaMatch ? vpaMatch[1].toLowerCase() : null
  const refMatch = text.match(REF_RE)
  const reference = refMatch ? refMatch[1] : null

  let body = vpa ? text.replace(vpaMatch![1], '/') : text
  body = body.replace(/^\s*(ach|ecs|nach)\s*(?:dr|cr|d|c)\b\.?\s*[-:]?\s*/i, '')
  body = body.replace(/^\s*(pos|atw)\s+\S*[x*]{2,}\S*\s*/i, '')
  // keep short hyphenated words ("E-TICKETING", "T-SHIRT") intact; other hyphens are field separators
  body = body.replace(/\b([a-z])-(?=[a-z]{3,})/gi, '$1__HY__')

  const tokens = body
    .split(/[/|~]+|-+/)
    .map((t) => t.replace(/__HY__/g, '-').trim())
    .filter(Boolean)
    .filter((t) => !NOISE_TOKEN.test(t))
    .filter((t) => !/^\d[\d\s]*$/.test(t))
    .filter((t) => !IFSC_RE.test(t))
    .filter((t) => !BANK_CODE_RE.test(t))
    .filter((t) => !MASKED_RE.test(t))
    .filter((t) => /[a-z]/i.test(t))

  let counterparty: string | null = tokens.length ? tokens[0] : null
  // Narrations like "UPI-SWIGGY-SWIGGY" repeat the name; strip trailing noise words.
  if (counterparty) counterparty = counterparty.replace(/\s{2,}/g, ' ').slice(0, 48).trim()
  if (!counterparty && vpa) counterparty = prettyHandle(vpa)
  return { vpa, reference, counterparty }
}

// ---------------------------------------------------------------------------
// Noise rules
// ---------------------------------------------------------------------------

const CC_REPAYMENT_RE = new RegExp(
  [
    '\\bcred\\b',
    'cred\\.club',
    'credit ?card',
    '\\bcc ?(?:bill|payment|pmt|pay)\\b',
    'card ?(?:bill|payment|pmt|repayment|dues?)\\b',
    'payment received',
    'ccpay|cardpay|cardbill',
    '\\bbbps\\b.*\\bcard\\b',
    'billdesk.*\\bcard\\b',
    'autopay.*\\bcard\\b',
    '\\bsbi ?card\\b',
    '\\bamex\\b|american express',
    '\\b(?:hdfc|icici|axis|kotak|yes|idfc|rbl|indusind|au) ?(?:bank )?cc\\b',
  ].join('|'),
  'i',
)
const SELF_TRANSFER_RE =
  /\b(self|own acc(?:ount|t)?|my acc(?:ount|t)?|sweep|fd (?:booking|closure|opening)|rd (?:installment|booking)|a\/c transfer|transfer to own|trf to own)\b/i

// handles that belong to merchants, QR codes or businesses, not people
const MERCHANT_HANDLE_RE =
  /(pay|store|shop|mart|cafe|foods?|restaurant|enterprise|trader|traders|merch|billdesk|razorpay|paytmqr|bharatpe|gpay-|\bq\d{6,}|ltd|pvt|services|tech|hotel|bakery|medical|pharma|kirana|stores|sweets|upi\d|bill|recharge|insur|bank|fund)/i
const NAME_HANDLE_RE = /^[a-z]+(?:[._-][a-z]+)*\d{0,4}$/i
const PHONE_HANDLE_RE = /^\d{10}$/

export function looksPersonalVPA(vpa: string): boolean {
  const handle = vpa.split('@')[0]
  if (PHONE_HANDLE_RE.test(handle)) return true
  if (MERCHANT_HANDLE_RE.test(handle)) return false
  return handle.length >= 3 && NAME_HANDLE_RE.test(handle)
}

export interface Baseline {
  merchant: string | null
  vpa: string | null
  reference: string | null
  category: Category | null
  flags: Flag[]
  reviewReason: ReviewReason | null
  reason: string
  confidence: 'high' | 'medium' | 'low' | null
}

export interface BaselineInput {
  rawDescription: string
  direction: Direction
  amount: number
  statementType?: 'bank' | 'card' | null
}

/** Deterministic classification applied at import time. User rules sit on top of this later. */
export function classifyBaseline(input: BaselineInput): Baseline {
  const { rawDescription: raw, direction, amount } = input
  const ex = extractFromNarration(raw)
  const searchText = `${raw} ${ex.vpa ?? ''}`
  const flags: Flag[] = []
  let category: Category | null = null
  let merchant: string | null = ex.counterparty ? titleCase(ex.counterparty) : null
  let reviewReason: ReviewReason | null = null
  let reason = ''
  let confidence: Baseline['confidence'] = null

  const ccMatch = searchText.match(CC_REPAYMENT_RE)
  const cardStatementPayment =
    input.statementType === 'card' &&
    direction === 'credit' &&
    /payment|thank|received|autopay|bbps|neft|imps|upi/i.test(raw)

  if (ccMatch || cardStatementPayment) {
    category = 'CC repayment'
    flags.push('cc_repayment')
    merchant = merchant ?? 'Card bill payment'
    reason = ccMatch
      ? `Card-bill pattern "${ccMatch[0].trim()}" found. Card purchases are counted from the card itself, so the bill payment is excluded to avoid double-counting.`
      : 'Payment credited on a card statement. Excluded so it is not counted as income.'
    confidence = 'high'
  } else if (SELF_TRANSFER_RE.test(searchText)) {
    category = 'Self-transfer'
    flags.push('self_transfer')
    reason = `Own-account keyword "${searchText.match(SELF_TRANSFER_RE)![0]}" found. Moving money between your own accounts is not spending.`
    confidence = 'medium'
  } else {
    const hit = matchMerchant(searchText, direction)
    if (hit) {
      category = hit.category
      if (!GENERIC_NAMES.has(hit.name) || hit.name === 'Interest') merchant = hit.name
      else merchant = merchant ?? hit.name
      reason = `Matched the built-in merchant list (${hit.name} → ${hit.category}).`
      confidence = GENERIC_NAMES.has(hit.name) ? 'medium' : 'high'
    } else if (INVESTMENT_HINT.test(searchText) && direction === 'debit') {
      reviewReason = 'investment_like'
      reason = 'Looks like a recurring investment-style debit. Tell Runway whether it should count as spending.'
    } else if (ex.vpa && looksPersonalVPA(ex.vpa)) {
      reviewReason = 'potential_p2p'
      reason = `Payment to a personal-looking UPI ID (${ex.vpa}). Could be rent share, a repayment or a gift, so it is not excluded automatically.`
      confidence = 'low'
    } else if (
      ex.vpa &&
      !MERCHANT_HANDLE_RE.test(ex.vpa.split('@')[0]) &&
      amount % 100 === 0 &&
      amount >= 500
    ) {
      reviewReason = 'potential_p2p'
      reason = `Round amount to ${ex.vpa}. Possibly a transfer to a person.`
      confidence = 'low'
    } else if (!ex.vpa && /\bupi\b/i.test(raw) && ex.counterparty && looksLikePerson(ex.counterparty)) {
      // banks such as IOB print the payee's name but no UPI ID
      reviewReason = 'potential_p2p'
      reason = `UPI ${direction === 'debit' ? 'payment to' : 'money from'} what looks like a person (${titleCase(ex.counterparty)}), not a business. Could be a split, rent share, repayment or gift, so it is not excluded automatically.`
      confidence = 'low'
    } else if (!ex.vpa && direction === 'debit' && /^\s*(imps|neft|rtgs)\b/i.test(raw)) {
      reviewReason = 'potential_p2p'
      reason = 'Bank transfer (IMPS/NEFT/RTGS) to an account Runway does not recognise.'
      confidence = 'low'
    } else if (direction === 'debit') {
      reviewReason = 'uncategorized'
      reason = 'No known merchant or pattern. Counted as flexible spend until you classify it.'
    } else {
      reason = 'Credit with no known source. Shown as other income; it does not change take-home pay.'
    }
  }

  if (reviewReason) flags.push('needs_review')
  return { merchant, vpa: ex.vpa, reference: ex.reference, category, flags, reviewReason, reason, confidence }
}

const GENERIC_NAMES = new Set([
  'Salary', 'Interest', 'Refund', 'Home loan', 'Loan EMI', 'Rent', 'Society maintenance', 'Groceries',
  'Food delivery', 'Dining', 'Subscription', 'Fitness', 'Rental subscription', 'Entertainment', 'Travel',
  'Transport', 'Telecom', 'Electricity', 'Water / gas', 'Insurance', 'Shopping', 'Family', 'Health',
  'Education', 'Personal care',
])
