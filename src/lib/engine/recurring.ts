import { addDays, diffDays } from '../dates'
import { MANDATE_HINT } from '../ingest/merchants'
import { bucketOf, type Category, type Txn } from '../types'
import type { ResolvedTxn } from './resolve'

/** Day-to-day spending categories where a repeat is usually coincidence unless the bank marks it as automatic. */
const EVERYDAY = new Set<Category>(['Dining', 'Food delivery', 'Shopping', 'Groceries', 'Entertainment', 'Travel', 'Transport'])

export const MIN_GAP = 25
export const MAX_GAP = 35

export type LeakKind = 'subscription' | 'mandate' | 'unknown' | 'possible_duplicate'

export interface Series {
  key: string
  label: string
  txns: ResolvedTxn[]
  amounts: number[]
  dates: string[]
  firstDate: string
  lastDate: string
  /** latest charge, used as the monthly equivalent (all series are monthly) */
  monthly: number
  priceChange: { from: number; to: number; pct: number } | null
  /** steady amount that then stepped down */
  priceDrop: { from: number; to: number; pct: number } | null
  /** the first ever charge from this merchant starts this run, and it has only 2 charges so far */
  isNew: boolean
  confidence: 'high' | 'medium'
  mandateMarker: string | null
  category: Category | null
  avgGapDays: number
  /** lastDate + average gap: when the next charge would land if the pattern holds */
  nextExpected: string
}

export interface UsageSignal {
  /** what usage looks like for this membership, e.g. "Swiggy orders" */
  label: string
  lastUsed: string | null
  daysSince: number | null
}

export interface Leak extends Series {
  id: string
  kind: LeakKind
  why: string
  /** null when usage cannot be seen in bank data (e.g. streaming) */
  usage: UsageSignal | null
  /** a membership with no matching usage for UNUSED_DAYS or more */
  unused: boolean
}

export const UNUSED_DAYS = 60

/** Memberships whose use shows up as spending at a linked merchant. Streaming and similar have no visible usage. */
const USAGE_LINKS: { membership: RegExp; usage: RegExp; label: string }[] = [
  { membership: /swiggy ?one/i, usage: /swiggy|instamart/i, label: 'Swiggy orders' },
  { membership: /zomato ?gold/i, usage: /zomato/i, label: 'Zomato orders' },
  { membership: /amazon ?prime|prime ?membership/i, usage: /amazon/i, label: 'Amazon purchases' },
  { membership: /uber ?one/i, usage: /\buber\b/i, label: 'Uber rides' },
  { membership: /flipkart ?(?:plus|vip)/i, usage: /flipkart/i, label: 'Flipkart purchases' },
]

export function groupKey(t: Pick<Txn, 'merchantGuess' | 'vpa' | 'rawDescription'>): string {
  const m = (t.merchantGuess ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (m.length >= 3) return m
  if (t.vpa) return t.vpa.toLowerCase()
  return t.rawDescription.toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').slice(0, 3).join(' ')
}

/**
 * The run of charges, ending at the most recent one, whose consecutive gaps are 25–35 days.
 * Merchants you use several times a month never qualify because their gaps are short.
 */
function tailRun<T extends { date: string }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
  const run = [sorted[sorted.length - 1]]
  for (let i = sorted.length - 2; i >= 0; i--) {
    const gap = diffDays(run[0].date, sorted[i].date)
    if (gap >= MIN_GAP && gap <= MAX_GAP) run.unshift(sorted[i])
    else break
  }
  return run
}

export function detectSeries(resolved: ResolvedTxn[]): Series[] {
  const groups = new Map<string, ResolvedTxn[]>()
  for (const t of resolved) {
    if (t.direction !== 'debit' || t.flags.includes('duplicate')) continue
    if (t.category && bucketOf(t.category) === 'excluded') continue
    const k = groupKey(t)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }

  const out: Series[] = []
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    const run = tailRun(list)
    if (run.length < 2) continue
    const amounts = run.map((t) => t.amount)
    const min = Math.min(...amounts)
    const max = Math.max(...amounts)
    const last = run[run.length - 1]
    const mandate = run.map((t) => t.rawDescription.match(MANDATE_HINT)?.[0]).find(Boolean) ?? null
    const known = last.category === 'Subscriptions'

    // amounts must be similar; a price rise is allowed, wild swings are not a subscription
    if (max / min > 2) continue
    const fixed = max / min <= 1.05
    const essential = last.category != null && bucketOf(last.category) === 'essential'
    // bills (electricity etc.) vary; anything else needs a steady amount, a mandate marker or a known biller
    if (!essential && !fixed && !mandate && !known) continue
    // two similar restaurant or shopping bills a month apart are coincidence, not a subscription
    const everyday = last.category != null && EVERYDAY.has(last.category)
    if (everyday && !mandate && !(fixed && run.length >= 3)) continue

    // A price change is a step: steady at one amount, then steady at another, within the last two cycles.
    // Normal bill-to-bill variation is not a step.
    const steady = (xs: number[]) => xs.length > 0 && Math.max(...xs) / Math.min(...xs) <= 1.02
    let step: { from: number; to: number; pct: number } | null = null
    for (let j = amounts.length - 1; j >= 1 && j >= amounts.length - 2; j--) {
      const before = amounts.slice(0, j)
      const after = amounts.slice(j)
      const from = amounts[j - 1]
      const to = amounts[j]
      if (Math.abs(to - from) / from > 0.02 && steady(before) && steady(after) && (mandate || known || before.length >= 2)) {
        step = { from, to, pct: (to - from) / from }
        break
      }
    }
    const priceChange = step && step.to > step.from ? step : null
    const priceDrop = step && step.to < step.from ? step : null
    const firstEver = [...list].sort((a, b) => a.date.localeCompare(b.date))[0]
    const isNew = run.length <= 2 && firstEver.id === run[0].id
    const gaps = run.slice(1).map((t, i) => diffDays(t.date, run[i].date))

    out.push({
      key,
      label: last.merchantGuess ?? last.vpa ?? key,
      txns: run,
      amounts,
      dates: run.map((t) => t.date),
      firstDate: run[0].date,
      lastDate: last.date,
      monthly: last.amount,
      priceChange,
      priceDrop,
      isNew,
      confidence: run.length >= 3 ? 'high' : 'medium',
      mandateMarker: mandate,
      category: last.category,
      avgGapDays: gaps.reduce((a, b) => a + b, 0) / gaps.length,
      nextExpected: addDays(last.date, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)),
    })
  }
  return out.sort((a, b) => b.monthly - a.monthly)
}

/** Recurring debits that are discretionary: subscriptions, mandates and unrecognised repeats. Never rent or EMIs. */
export function leaksFromSeries(series: Series[]): Leak[] {
  const leaks: Leak[] = []
  for (const s of series) {
    const bucket = s.category ? bucketOf(s.category) : null
    // investment-style debits are the user's call, never a 'leak'
    if (s.category == null && s.txns.some((t) => t.reviewReason === 'investment_like')) continue
    // repeated transfers to a person stay in the review queue; they are not subscriptions
    if (s.category == null && s.txns.some((t) => t.reviewReason === 'potential_p2p')) continue
    if (bucket === 'essential' || bucket === 'excluded' || bucket === 'income') continue
    let kind: LeakKind
    let why: string
    if (s.category === 'Subscriptions') {
      kind = 'subscription'
      why = `Recognised subscription merchant, charged ${s.txns.length}× about every ${Math.round(s.avgGapDays)} days.`
    } else if (s.mandateMarker) {
      kind = 'mandate'
      why = `Description mentions "${s.mandateMarker.trim()}", which usually means an automatic debit (UPI AutoPay, NACH or standing instruction).`
    } else if (s.category == null || s.category === 'Other') {
      kind = 'unknown'
      why = `Unrecognised merchant charged a similar amount ${s.txns.length}× about every ${Math.round(s.avgGapDays)} days.`
    } else {
      // dining, shopping etc. only count when there is an explicit mandate marker
      continue
    }
    leaks.push({ ...s, id: `leak:${s.key}`, kind, why, usage: null, unused: false })
  }
  return leaks
}

/** Same merchant, same amount, within 3 days: often a double charge worth checking. */
export function possibleDuplicateCharges(resolved: ResolvedTxn[]): Leak[] {
  const out: Leak[] = []
  const debits = resolved
    .filter((t) => t.direction === 'debit' && !t.flags.includes('duplicate') && t.category !== null)
    .filter((t) => t.category === 'Subscriptions' || (t.category && bucketOf(t.category) === 'flexible' && t.amount >= 99))
  const byKey = new Map<string, ResolvedTxn[]>()
  for (const t of debits) {
    const k = `${groupKey(t)}|${t.amount.toFixed(2)}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(t)
  }
  for (const [k, list] of byKey) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    for (let i = 1; i < sorted.length; i++) {
      const gap = diffDays(sorted[i].date, sorted[i - 1].date)
      if (gap <= 3 && sorted[i - 1].category === 'Subscriptions') {
        const pair = [sorted[i - 1], sorted[i]]
        out.push({
          id: `dup:${k}:${sorted[i].date}`,
          key: k,
          label: sorted[i].merchantGuess ?? k,
          txns: pair,
          amounts: pair.map((t) => t.amount),
          dates: pair.map((t) => t.date),
          firstDate: pair[0].date,
          lastDate: pair[1].date,
          monthly: 0,
          priceChange: null,
          confidence: 'medium',
          mandateMarker: null,
          category: sorted[i].category,
          avgGapDays: gap,
          nextExpected: pair[1].date,
          kind: 'possible_duplicate',
          priceDrop: null,
          isNew: false,
          usage: null,
          unused: false,
          why: `Charged ${pair[0].amount} twice within ${gap} day${gap === 1 ? '' : 's'}. Check whether one is a double charge.`,
        })
      }
    }
  }
  return out
}

export interface SalaryDetection {
  ids: Set<string>
  takeHome: number
  payday: number
  label: string
  confidence: 'high' | 'medium' | 'low'
}

/** Largest credit that repeats every 25–35 days from the same source. Falls back to a "salary" keyword credit. */
export function detectSalary(resolved: ResolvedTxn[]): SalaryDetection | null {
  const credits = resolved.filter(
    (t) =>
      t.direction === 'credit' &&
      !t.flags.includes('duplicate') &&
      t.reviewReason !== 'potential_p2p' &&
      (t.category == null || t.category === 'Salary') &&
      t.amount >= 5000,
  )
  if (!credits.length) return null

  const groups = new Map<string, ResolvedTxn[]>()
  for (const t of credits) {
    const k = t.category === 'Salary' && !t.merchantGuess ? 'salary' : groupKey(t)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }

  let best: { run: ResolvedTxn[]; score: number } | null = null
  for (const list of groups.values()) {
    const run = tailRun(list)
    const amounts = run.map((t) => t.amount)
    const ok = run.length >= 2 && Math.max(...amounts) / Math.min(...amounts) <= 1.5
    const keyword = run.some((t) => t.category === 'Salary')
    if (!ok && !keyword) continue
    const latest = run[run.length - 1].amount
    const score = latest * (ok ? 2 : 1) * (keyword ? 1.5 : 1)
    if (!best || score > best.score) best = { run: ok ? run : [run[run.length - 1]], score }
  }
  if (!best) return null
  const last = best.run[best.run.length - 1]
  const all = groups.get(groupKey(last)) ?? best.run
  const ids = new Set(
    all.filter((t) => Math.abs(t.amount - last.amount) / last.amount <= 0.35).map((t) => t.id),
  )
  for (const t of best.run) ids.add(t.id)
  return {
    ids,
    takeHome: last.amount,
    payday: Number(last.date.slice(8, 10)),
    label: last.merchantGuess ?? 'Salary credit',
    confidence: best.run.length >= 3 ? 'high' : best.run.length === 2 ? 'medium' : 'low',
  }
}

/** Adds usage signals: for memberships tied to a spending merchant, when was that merchant last used? */
export function annotateLeaks(leaks: Leak[], active: ResolvedTxn[], asOf: string | null): Leak[] {
  if (!asOf) return leaks
  return leaks.map((l) => {
    if (l.kind === 'possible_duplicate') return l
    const text = `${l.label} ${l.txns.map((t) => t.rawDescription).join(' ')}`
    const link = USAGE_LINKS.find((u) => u.membership.test(text))
    if (!link) return l
    const own = new Set(l.txns.map((t) => t.id))
    const uses = active.filter(
      (t) =>
        t.direction === 'debit' &&
        !own.has(t.id) &&
        !link.membership.test(`${t.merchantGuess ?? ''} ${t.rawDescription}`) &&
        link.usage.test(`${t.merchantGuess ?? ''} ${t.vpa ?? ''} ${t.rawDescription}`),
    )
    const lastUsed = uses.length ? uses.reduce((a, t) => (t.date > a ? t.date : a), uses[0].date) : null
    // "since" counts from the first membership charge when it was never used
    const daysSince = lastUsed ? diffDays(asOf, lastUsed) : diffDays(asOf, l.firstDate)
    return { ...l, usage: { label: link.label, lastUsed, daysSince }, unused: daysSince >= UNUSED_DAYS }
  })
}
