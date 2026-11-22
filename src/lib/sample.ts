import { buildTxns } from './ingest/build'
import type { RawRecord } from './ingest/statement'
import { DEFAULT_PROFILE, type Profile, type Txn } from './types'

/**
 * "Rohan — The First Job Financial Reset".
 * Three full months (Aug–Oct 2026) plus November up to the 16th of narrations written the way Indian bank and card statements print them,
 * pushed through the same sanitizer as real imports. It is deliberately messy: dinner splits paid back by a friend,
 * a card bill that would double-count, a self-transfer, P2P transfers, unknown merchants, an
 * investment-style debit, a price hike and an unrecognised mandate.
 */

const MONTHS = [
  { y: 2026, m: 8, tag: 'AUG' },
  { y: 2026, m: 9, tag: 'SEP' },
  { y: 2026, m: 10, tag: 'OCT' },
]

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const d = (y: number, m: number, day: number) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export const SAMPLE_CASH_TARGET = 1_24_600

export function sampleRecords(): { bank: RawRecord[]; card: RawRecord[] } {
  const rnd = mulberry32(20260801)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a))
  let ref = 612000000000
  const nextRef = () => String((ref += 7919 + Math.floor(rnd() * 900)))

  const bank: RawRecord[] = []
  const card: RawRecord[] = []
  const add = (date: string, desc: string, amount: number, direction: 'debit' | 'credit') =>
    bank.push({ date, postedDate: date, rawDescription: desc, reference: null, amount, direction, balanceAfter: null })
  const upi = (name: string, vpa: string, ifsc: string, note: string) =>
    `UPI-${name}-${vpa}-${ifsc}-${nextRef()}-${note}`
  const cardAdd = (date: string, desc: string, amount: number, direction: 'debit' | 'credit' = 'debit') =>
    card.push({ date, postedDate: date, rawDescription: desc, reference: null, amount, direction, balanceAfter: null })

  let cardBillDue = 0
  MONTHS.forEach(({ y, m, tag }, i) => {
    // --- income ---
    add(d(y, m, 1), `NEFT CR-CITI0000002-ACME TECHNOLOGIES PVT LTD-SALARY ${tag} 2026`, 68000, 'credit')

    // --- rent: Rohan sends his half to the flatmate who pays the landlord ---
    add(d(y, m, 3), upi('ARJUN MEHTA', 'arjun.mehta@okaxis', 'UTIB0000553', `RENT SHARE ${tag}`), 13000, 'debit')

    // --- EMIs ---
    add(d(y, m, 5), `ACH D- BAJAJ FINANCE LTD-P40${7712 + i}SMARTPHONE EMI`, 3850, 'debit')
    add(d(y, m, 7), `NACH DR-HDFC BANK TWO WHEELER LOAN-${88120 + i}`, 4200, 'debit')

    // --- family ---
    add(d(y, m, 2), upi('SUNITA SHARMA', 'sunita.sharma61@oksbi', 'SBIN0004421', 'FOR PARENTS'), 5000, 'debit')

    // --- insurance ---
    add(d(y, m, 10), `NACH DR-MAX LIFE INSURANCE PREMIUM-${51230 + i}`, 1050, 'debit')

    // --- utilities ---
    add(d(y, m, 12), upi('AIRTEL', 'airtelpostpaid@icici', 'ICIC0DC0099', 'AUTOPAY POSTPAID'), 599, 'debit')
    add(d(y, m, 16), upi('BESCOM', 'bescom.billdesk@hdfcbank', 'HDFC0000001', 'ELECTRICITY BILL'), [1180, 1460, 1320][i], 'debit')
    // the broadband plan goes up in October: a fixed-cost increase
    add(d(y, m, 18), `BBPS-ACT FIBERNET BROADBAND-${nextRef()}`, i === 2 ? 1149 : 1049, 'debit')

    // --- subscriptions & mandates (bank) ---
    add(d(y, m, 9), upi('NETFLIX', 'netflixupi@hdfcbank', 'HDFC0000001', 'UPI AUTOPAY'), i === 2 ? 649 : 499, 'debit')
    add(d(y, m, 14), upi('SPOTIFY', 'spotify.in@icici', 'ICIC0DC0099', 'UPI AUTOPAY'), 119, 'debit')
    add(d(y, m, 20), upi('SWIGGY ONE', 'swiggyone@icici', 'ICIC0DC0099', 'UPI AUTOPAY MEMBERSHIP'), 149, 'debit')
    // an unrecognised mandate that only started in September: a new recurring charge
    if (i >= 1) add(d(y, m, 22), `ACH D- RZP*LEARNIFY EDTECH-${nextRef()}`, 499, 'debit')
    // a membership whose merchant Rohan stopped using after August: an unused subscription
    add(d(y, m, 11), upi('ZOMATO GOLD', 'zomatogold@hdfcbank', 'HDFC0000001', 'UPI AUTOPAY MEMBERSHIP'), 149, 'debit')
    add(d(y, m, 6), upi('CULTFIT', 'cultfit@ybl', 'YESB0YBLUPI', 'UPI AUTOPAY'), 1299, 'debit')

    // --- investment-style debit: should be reviewed, never treated as a leak ---
    add(d(y, m, 8), `ACH D- BSE LTD SIP-${nextRef()}`, 3000, 'debit')

    // --- groceries ---
    for (let k = 0; k < 7; k++) {
      const [name, vpa] = pick([
        ['BLINKIT', 'blinkit.payu@hdfcbank'],
        ['ZEPTO', 'zepto.rzp@axisbank'],
        ['SWIGGY INSTAMART', 'instamart@icici'],
        ['BIGBASKET', 'bigbasket@ybl'],
      ])
      add(d(y, m, between(1, 28)), upi(name, vpa, 'ICIC0DC0099', 'ORDER'), between(280, 760), 'debit')
    }
    // corner kirana shop with a QR handle: unknown merchant
    add(d(y, m, between(10, 25)), upi('SRI LAKSHMI ENTERPRISES', 'q839201776@ybl', 'YESB0YBLUPI', 'PAY'), between(420, 690), 'debit')

    // --- transport ---
    for (let k = 0; k < 6; k++) {
      const [name, vpa] = pick([
        ['UBER INDIA', 'uber.india@axisbank'],
        ['OLA', 'olacabs@icici'],
        ['RAPIDO', 'rapido@ybl'],
        ['NAMMA METRO', 'bmrcl@sbi'],
      ])
      add(d(y, m, between(1, 28)), upi(name, vpa, 'UTIB0000001', 'RIDE'), between(70, 340), 'debit')
    }
    add(d(y, m, between(12, 20)), `POS 4592XXXXXXXX1121 HPCL FUEL STATION`, between(900, 1150), 'debit')

    // --- food delivery (bank UPI) ---
    for (let k = 0; k < 9; k++) {
      const [name, vpa] = pick(
        i === 0
          ? [
              ['SWIGGY', 'swiggy@icici'],
              ['ZOMATO', 'zomato.payu@hdfcbank'],
            ]
          : [['SWIGGY', 'swiggy@icici']],
      )
      add(d(y, m, between(1, 28)), upi(name, vpa, 'ICIC0DC0099', 'FOOD ORDER'), between(220, 640), 'debit')
    }

    // --- dining ---
    for (let k = 0; k < 3; k++) {
      add(
        d(y, m, between(1, 28)),
        `POS 4592XXXXXXXX1121 ${pick(['THIRD WAVE CAFE', 'MEGHANA FOODS RESTAURANT', 'STARBUCKS COFFEE', 'TRUFFLES CAFE'])}`,
        between(450, 1400),
        'debit',
      )
    }

    // --- P2P: dinner split with a friend, part paid back ---
    add(d(y, m, [19, 6, 27][i]), upi('KARTHIK V', 'karthik.v@okicici', 'ICIC0000102', 'DINNER'), [1200, 900, 1600][i], 'debit')
    if (i !== 1) add(d(y, m, [21, 8, 28][i]), upi('KARTHIK V', 'karthik.v@okicici', 'ICIC0000102', 'BACK'), 600, 'credit')

    // --- entertainment ---
    add(d(y, m, between(8, 26)), upi('BOOKMYSHOW', 'bookmyshow@icici', 'ICIC0DC0099', 'TICKETS'), between(380, 820), 'debit')

    // --- card statement (HDFC credit card) ---
    let cardTotal = 0
    for (let k = 0; k < 3; k++) {
      const a = between(380, 1300)
      cardTotal += a
      cardAdd(d(y, m, between(2, 27)), `${pick(['AMAZON PAY INDIA', 'MYNTRA DESIGNS', 'FLIPKART INTERNET', 'DECATHLON SPORTS'])} BANGALORE`, a)
    }
    for (let k = 0; k < 3; k++) {
      const a = between(260, 520)
      cardTotal += a
      cardAdd(d(y, m, between(2, 27)), i === 0 ? pick(['SWIGGY BANGALORE', 'ZOMATO LTD GURGAON']) : 'SWIGGY BANGALORE', a)
    }
    const unknownCard = between(780, 1300)
    cardTotal += unknownCard
    cardAdd(d(y, m, between(5, 25)), `GENIE RETAIL PVT ${pick(['KORAMANGALA', 'HSR LAYOUT'])}`, unknownCard)
    if (i === 1) {
      // a weekend train trip home
      cardAdd(d(y, m, 12), 'IRCTC E-TICKETING', 1850)
      cardTotal += 1850
    }
    if (i === 2) cardAdd(d(y, m, 17), 'AMAZON PAY INDIA REFUND', 1299, 'credit')
    if (cardBillDue > 0) {
      // the bank pays last month's card bill: this must not count as spending again
      add(d(y, m, 15), `CRED CLUB-HDFC CC XX4412 BILL PAYMENT-${nextRef()}`, cardBillDue, 'debit')
      cardAdd(d(y, m, 15), 'PAYMENT RECEIVED - THANK YOU', cardBillDue, 'credit')
    }
    cardBillDue = cardTotal
  })

  // --- November so far (statement downloaded on 16 Nov): a live pay cycle, with dining running hot ---
  const N = (day: number) => d(2026, 11, day)
  add(N(1), 'NEFT CR-CITI0000002-ACME TECHNOLOGIES PVT LTD-SALARY NOV 2026', 68000, 'credit')
  add(N(2), upi('SUNITA SHARMA', 'sunita.sharma61@oksbi', 'SBIN0004421', 'FOR PARENTS'), 5000, 'debit')
  add(N(3), upi('ARJUN MEHTA', 'arjun.mehta@okaxis', 'UTIB0000553', 'RENT SHARE NOV'), 13000, 'debit')
  add(N(5), 'ACH D- BAJAJ FINANCE LTD-P407715SMARTPHONE EMI', 3850, 'debit')
  add(N(6), upi('CULTFIT', 'cultfit@ybl', 'YESB0YBLUPI', 'UPI AUTOPAY'), 1299, 'debit')
  add(N(7), 'NACH DR-HDFC BANK TWO WHEELER LOAN-88123', 4200, 'debit')
  add(N(8), `ACH D- BSE LTD SIP-${nextRef()}`, 3000, 'debit')
  add(N(9), upi('NETFLIX', 'netflixupi@hdfcbank', 'HDFC0000001', 'UPI AUTOPAY'), 649, 'debit')
  add(N(10), 'NACH DR-MAX LIFE INSURANCE PREMIUM-51233', 1050, 'debit')
  add(N(11), upi('ZOMATO GOLD', 'zomatogold@hdfcbank', 'HDFC0000001', 'UPI AUTOPAY MEMBERSHIP'), 149, 'debit')
  add(N(12), upi('AIRTEL', 'airtelpostpaid@icici', 'ICIC0DC0099', 'AUTOPAY POSTPAID'), 599, 'debit')
  add(N(14), upi('SPOTIFY', 'spotify.in@icici', 'ICIC0DC0099', 'UPI AUTOPAY'), 119, 'debit')
  add(N(16), upi('BESCOM', 'bescom.billdesk@hdfcbank', 'HDFC0000001', 'ELECTRICITY BILL'), 1280, 'debit')
  for (const [day, amt] of [[2, 540], [6, 610], [10, 470], [14, 690]]) add(N(day), upi('BLINKIT', 'blinkit.payu@hdfcbank', 'ICIC0DC0099', 'ORDER'), amt, 'debit')
  for (const [day, amt] of [[3, 180], [7, 240], [12, 150]]) add(N(day), upi('UBER INDIA', 'uber.india@axisbank', 'UTIB0000001', 'RIDE'), amt, 'debit')
  add(N(9), 'POS 4592XXXXXXXX1121 HPCL FUEL STATION', 980, 'debit')
  for (const [day, amt] of [[2, 420], [5, 365], [9, 510], [13, 440]]) add(N(day), upi('SWIGGY', 'swiggy@icici', 'ICIC0DC0099', 'FOOD ORDER'), amt, 'debit')
  for (const [day, name, amt] of [[1, 'TRUFFLES CAFE', 1180], [4, 'MEGHANA FOODS RESTAURANT', 1420], [8, 'THIRD WAVE CAFE', 640], [11, 'TOIT BREWPUB RESTAURANT', 2350], [15, 'STARBUCKS COFFEE', 560]] as [number, string, number][])
    add(N(day), `POS 4592XXXXXXXX1121 ${name}`, amt, 'debit')
  add(N(13), upi('KARTHIK V', 'karthik.v@okicici', 'ICIC0000102', 'DINNER'), 1400, 'debit')
  add(N(15), `CRED CLUB-HDFC CC XX4412 BILL PAYMENT-${nextRef()}`, cardBillDue, 'debit')
  cardAdd(N(15), 'PAYMENT RECEIVED - THANK YOU', cardBillDue, 'credit')

  // a few one-offs
  add('2026-09-24', 'IMPS-626712345678-ROHAN SHARMA-KKBK-XXXXXXXX9031-SELF', 10000, 'debit')
  add('2026-10-02', `INT.PD:01-07-2026 TO 30-09-2026`, 612, 'credit')
  add('2026-10-23', upi('APOLLO PHARMACY', 'apollopharmacy@icici', 'ICIC0DC0099', 'MEDICINES'), 655, 'debit')

  bank.sort((a, b) => a.date.localeCompare(b.date))
  card.sort((a, b) => a.date.localeCompare(b.date))

  // running balance that ends at the sample's accessible cash
  const net = bank.reduce((s, r) => s + (r.direction === 'credit' ? r.amount : -r.amount), 0)
  let bal = SAMPLE_CASH_TARGET - net
  for (const r of bank) {
    bal += r.direction === 'credit' ? r.amount : -r.amount
    r.balanceAfter = Math.round(bal * 100) / 100
  }
  return { bank, card }
}

export function sampleTxns(importedAt = new Date().toISOString()): Txn[] {
  const { bank, card } = sampleRecords()
  const a = buildTxns(bank, { source: 'sample', statementType: 'bank', bank: 'HDFC Bank', accountMask: 'XX2210', batchId: 'sample-bank', importedAt })
  const b = buildTxns(card, { source: 'sample', statementType: 'card', bank: 'HDFC Bank Credit Card', accountMask: 'XX4412', batchId: 'sample-card', importedAt }, a.txns)
  return [...a.txns, ...b.txns]
}

export function sampleProfile(): Profile {
  return {
    ...DEFAULT_PROFILE,
    accessibleCash: SAMPLE_CASH_TARGET,
    emergency: { ...DEFAULT_PROFILE.emergency, targetDate: '2027-09-30' },
    goals: [
      {
        id: 'goal-goa',
        name: 'Family trip to Goa',
        type: 'custom',
        target: 60000,
        saved: 8000,
        targetDate: '2028-02-29',
        monthlyContribution: 4000,
      },
    ],
  }
}
