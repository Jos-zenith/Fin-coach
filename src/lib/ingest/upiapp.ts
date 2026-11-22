import { parseDate } from '../dates'
import type { RawRecord } from './statement'

// ---------------------------------------------------------------------------
// UPI-app statements (PhonePe "Transaction Statement" PDFs). Unlike bank statements they
// have no balance column; each payment is a block like
//
//   Feb 01, 2025   Paid to ANNAI CAFE                         Debit   INR 120.00
//   01:13 PM       Transaction ID : T2502011313529759369951
//                  UTR No : 222896109718
//                  Debited from XX4970
//
// Large amounts wrap ("INR" / "20000.00"), and pages end with a footer. The direction is
// printed in words ("Debited from" / "Credited to"), so it is never guessed.
// ---------------------------------------------------------------------------

export interface UpiAppRow extends RawRecord {
  directionFrom: 'marker'
}

export interface UpiAppParseResult {
  records: UpiAppRow[]
  skipped: { line: string; reason: string }[]
  range: { start: string; end: string } | null
  /** statement period printed in the header, when found */
  period: { start: string; end: string } | null
}

/** "Feb 01, 2025" (PhonePe) or "01 Feb, 2025" (GPay-style) at the start of a line */
const HEAD_DATE = /^([A-Za-z]{3,9} \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9},? \d{4})\b/
const PERIOD = /^([A-Za-z]{3,9} \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9},? \d{4})\s*[-–]\s*([A-Za-z]{3,9} \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9},? \d{4})\s*$/
const FOOTER =
  /^(page \d+ of \d+|date\s+transaction details\s+type\s+amount)$|system generated statement|automatically generated statement|support\.phonepe\.com|phonepe\.com\/|do not fall prey|^emails and calls|contents of this email|received this message by mistake|recipient's details|errors in the statement|transaction statement for/i

const TIME = /\b\d{1,2}:\d{2}\s?[AP]M\b/i
const TXN_ID = /Transaction ID\s*:?\s*([A-Z0-9]+)/i
const UTR = /UTR No\.?\s*:?\s*(\d{6,})/i
const ACCOUNT = /\b(Debited from|Credited to)\s+([A-Z]{0,4}\d{2,6}|[A-Za-z][\w ]{0,30}?(?=\s{2,}|$))/i
const TYPE_WORD = /\b(Debit|Credit)\b(?=\s*(?:INR|₹|Rs\.?|$))/i
const AMOUNT_AFTER_CCY = /(?:INR|₹|Rs\.?)\s*(\d[\d,]*(?:\.\d{1,2})?)/i
const ANY_DECIMAL = /(?<![\d.])(\d[\d,]*\.\d{2})(?![\d.])/
const VERB = /^(Paid to|Received from|Money sent to|Money received from|Refund Received|Payment Received|Cashback Received|Paid\s*-|Paid)\s*(.*)$/i

/** True when the extracted lines look like a PhonePe-style UPI app statement. */
export function isUpiAppStatement(lines: string[]): boolean {
  const text = lines.slice(0, 400).join('\n')
  const ids = (text.match(/Transaction ID\s*:/gi) ?? []).length
  const utrs = (text.match(/UTR No\.?\s*:/gi) ?? []).length
  const verbs = (text.match(/\b(Paid to|Received from)\b/gi) ?? []).length
  return ids >= 2 && utrs >= 2 && verbs >= 2
}

export function upiAppName(lines: string[]): string {
  return /phonepe/i.test(lines.join(' ')) ? 'PhonePe statement' : 'UPI app statement'
}

const BUSINESS =
  /\b(cafe|caf[eé]|hotels?|kitchen|enterprises?|agency|agencies|stores?|mart|market|supermarket|super market|pharmacy|pharmacies|medicals?|ltd|limited|pvt|private|llp|bakery|cent(?:er|re)|mess|shop|stall|traders?|xerox|prints?|juice|foods?|kadai|bhavan|kfc|mall|railways?|metro|irctc|uts|vodafone|idea|airtel|jio|zepto|zeptonow|blinkit|swiggy|zomato|bookmyshow|pvr|inox|croma|jockey|starbucks|cleaners|hardware|electricals?|electronics?\w*|entertainment|india|briyani|biriyani?|biriya|dhaba|coffee|tea|chai|milk|fruits?|sweets|station|service|auto|hub|aerohub|pump|shrine|cathedral|church|plaza|shawarma|masala|express|groceries|grocery|general|retail|dishes|bar|jigarthanda|restaurant|hospitality|corp|tourism|catering|recharge|udemy|amazon|flipkart|myntra|apollo|mcdonalds|mc donalds|dot com|tickets?|travels?|motors|clinic|hospital|labs?|school|college|academy|institute|society|trust|associates|solutions|systems|technologies|studio|salon|gym|fitness)\b/i

/** A payee shown by name or masked phone number, with nothing that suggests a business. */
export function looksLikePerson(payee: string): boolean {
  const p = payee.trim()
  if (!p) return false
  if (/^[*xX•]{3,}\d{2,6}$/.test(p)) return true
  if (/\d/.test(p) || BUSINESS.test(p)) return false
  const words = p.replace(/\./g, ' ').split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 5 && /^[A-Za-z .']+$/.test(p) && !/^user$/i.test(p)
}

function cleanAmount(s: string): number {
  return Math.round(parseFloat(s.replace(/,/g, '')) * 100) / 100
}

function headDate(s: string): string | null {
  return parseDate(s.replace(/,/g, ''))
}

export function parseUpiAppLines(lines: string[]): UpiAppParseResult {
  const records: UpiAppRow[] = []
  const skipped: UpiAppParseResult['skipped'] = []
  let period: UpiAppParseResult['period'] = null
  let block: { date: string; parts: string[] } | null = null
  const seenUtr = new Map<string, number>()

  const finish = () => {
    if (!block) return
    const b = block
    block = null
    const raw = b.parts.join('  ').replace(/\s+/g, ' ').trim()
    let t = b.parts.join('  ')
    const utr = t.match(UTR)?.[1] ?? null
    const txnId = t.match(TXN_ID)?.[1] ?? null
    const acct = t.match(ACCOUNT)
    t = t.replace(UTR, ' ').replace(TXN_ID, ' ').replace(ACCOUNT, ' ').replace(TIME, ' ')

    let direction: 'debit' | 'credit' | null = acct ? (/^debited/i.test(acct[1]) ? 'debit' : 'credit') : null
    const typeWord = t.match(TYPE_WORD)
    if (!direction && typeWord) direction = /^debit/i.test(typeWord[1]) ? 'debit' : 'credit'
    t = t.replace(TYPE_WORD, ' ')

    let amount: number | null = null
    const ccy = t.match(AMOUNT_AFTER_CCY)
    if (ccy) {
      amount = cleanAmount(ccy[1])
      t = t.replace(AMOUNT_AFTER_CCY, ' ')
    } else {
      // the amount cell wrapped: "INR" on one line, the number on the next
      const dec = t.match(ANY_DECIMAL)
      if (dec) {
        amount = cleanAmount(dec[1])
        t = t.replace(ANY_DECIMAL, ' ')
      }
    }
    t = t.replace(/\b(INR|Rs\.?)\b|₹/gi, ' ').replace(/\s+/g, ' ').trim()

    const verb = t.match(VERB)
    const verbWord = verb ? verb[1].replace(/\s*-$/, '').trim() : ''
    let payee = verb ? verb[2].replace(/^[-:\s]+/, '').trim() : t
    if (!direction && verb) direction = /^(received|money received|refund|payment received|cashback)/i.test(verbWord) ? 'credit' : 'debit'

    if (amount == null || !(amount > 0)) {
      skipped.push({ line: raw.slice(0, 160), reason: 'Date found but no amount' })
      return
    }
    if (!direction) {
      skipped.push({ line: raw.slice(0, 160), reason: 'Could not tell whether money went out or came in' })
      return
    }
    // PhonePe sometimes lists one refund twice ("Refund Received" and "Payment Received") under the same UTR
    if (utr) {
      const prev = seenUtr.get(utr)
      if (prev != null && records[prev].amount === amount && records[prev].direction === direction) {
        skipped.push({ line: raw.slice(0, 160), reason: `Same UTR ${utr} and amount as an earlier row, so it is the same money listed twice` })
        return
      }
      seenUtr.set(utr, records.length)
    }

    const masked = payee.match(/^[*xX•]{3,}(\d{2,6})$/)
    const display = masked ? `Contact ending ${masked[1]}` : payee
    const kind = /refund/i.test(verbWord) ? 'Refund' : /cashback/i.test(verbWord) ? 'Cashback' : /recharge/i.test(payee) ? 'Mobile recharge' : direction === 'credit' ? 'UPI credit' : 'UPI payment'
    const description = [verbWord || (direction === 'debit' ? 'Paid' : 'Received'), payee].filter(Boolean).join(verbWord.endsWith('to') || verbWord.endsWith('from') ? ' ' : ' - ')
    records.push({
      date: b.date,
      postedDate: null,
      rawDescription: description || kind,
      reference: utr ?? txnId,
      amount,
      direction,
      balanceAfter: null,
      accountMask: acct && /\d/.test(acct[2]) ? acct[2].toUpperCase() : null,
      merchantHint: display || null,
      // classify on the payee alone, so the verb or boilerplate never matches a rule by accident
      classifyText: display ? `UPI/${display}` : kind,
      personHint: masked ? true : payee ? looksLikePerson(payee) : false,
      directionFrom: 'marker',
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const p = line.match(PERIOD)
    if (p) {
      finish()
      const s = headDate(p[1])
      const e = headDate(p[2])
      if (s && e) period = { start: s, end: e }
      continue
    }
    if (FOOTER.test(line)) {
      finish()
      continue
    }
    const dm = line.match(HEAD_DATE)
    const date = dm ? headDate(dm[1]) : null
    if (date) {
      finish()
      block = { date, parts: [line.slice(dm![0].length).trim()] }
    } else if (block) {
      block.parts.push(line)
    }
  }
  finish()
  const dates = records.map((r) => r.date).sort()
  return { records, skipped, range: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null, period }
}
