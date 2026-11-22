import { diffDays } from '../dates'
import { bucketOf, type Category, type Flag, type Rule, type Txn } from '../types'

export interface Line {
  category: Category
  amount: number
}

export type ClassificationSource = 'user' | 'rule' | 'heuristic' | 'detected' | 'unclassified'

export const SOURCE_LABEL: Record<ClassificationSource, string> = {
  user: 'You (this transaction)',
  rule: 'Your rule',
  heuristic: 'Built-in pattern',
  detected: 'Recurring-credit detection',
  unclassified: 'Unclassified',
}

/** A transaction after rules are applied. Pure function of (txn, rules): nothing here is stored. */
export interface ResolvedTxn extends Txn {
  /** Final category (user pin > rule > baseline). null = nobody has classified it yet. */
  category: Category | null
  ruleId: string | null
  classSource: ClassificationSource
  /** Why it landed where it did, in plain words. */
  reason: string
  /** Baseline flags plus flags implied by the final category. */
  effectiveFlags: Flag[]
  /** How the amount splits across categories. A P2P split can count the user's share and drop the rest. */
  lines: Line[]
  needsReview: boolean
  isRecurring: boolean
}

export function matchText(t: Pick<Txn, 'merchantGuess' | 'vpa' | 'rawDescription'>): string {
  return `${t.merchantGuess ?? ''} ${t.vpa ?? ''} ${t.rawDescription}`.toLowerCase()
}

/** Explains whether a "contains" rule matches a piece of text, for the rules tester. */
export function ruleMatches(rule: Rule, t: Pick<Txn, 'merchantGuess' | 'vpa' | 'rawDescription'>): boolean {
  if (rule.matchType !== 'contains' || !rule.token) return false
  return fieldText(t, rule.matchField).includes(rule.token.toLowerCase())
}

/** The text a "contains" rule looks at, depending on its field. */
export function fieldText(t: Pick<Txn, 'merchantGuess' | 'vpa' | 'rawDescription'>, field: Rule['matchField']): string {
  if (field === 'merchant') return (t.merchantGuess ?? '').toLowerCase()
  if (field === 'vpa') return (t.vpa ?? '').toLowerCase()
  return matchText(t)
}

export const FIELD_LABEL: Record<NonNullable<Rule['matchField']>, string> = {
  any: 'text contains',
  merchant: 'merchant contains',
  vpa: 'UPI ID contains',
}

/**
 * Picks the rule for a transaction. A pin on this exact transaction always wins.
 * Otherwise the newest matching "contains" rule wins; ties go to the longest token.
 */
export function findRule(t: Txn, rules: Rule[]): Rule | null {
  let best: Rule | null = null
  for (const r of rules) {
    if (r.matchType === 'txn') {
      if (r.token === t.id) return r
      continue
    }
    if (!ruleMatches(r, t)) continue
    if (
      !best ||
      r.createdAt > best.createdAt ||
      (r.createdAt === best.createdAt && r.token.length > best.token.length)
    ) {
      best = r
    }
  }
  return best
}

/** The token a one-click correction should use for this transaction. */
export function suggestToken(t: Pick<Txn, 'merchantGuess' | 'vpa' | 'rawDescription'>): string {
  if (t.vpa && !t.merchantGuess) return t.vpa.toLowerCase()
  if (t.merchantGuess && t.merchantGuess.trim().length >= 3) return t.merchantGuess.trim().toLowerCase()
  if (t.vpa) return t.vpa.toLowerCase()
  return t.rawDescription.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ')
}

function flagsFor(category: Category | null, base: Flag[]): Flag[] {
  const out = new Set<Flag>(base)
  if (category === 'Self-transfer') out.add('self_transfer')
  if (category === 'CC repayment') out.add('cc_repayment')
  if (category === 'P2P split') out.add('p2p_split')
  return [...out]
}

export interface Reimbursement {
  category: Category
  name: string
  paid: number
  date: string
}

/**
 * Unclassified credits from someone you recently paid (same UPI ID or name, within 45 days)
 * are treated as reimbursements: netted against the original spending, not counted as income.
 */
export function findReimbursements(first: ResolvedTxn[]): Map<string, Reimbursement> {
  const out = new Map<string, Reimbursement>()
  const key = (t: Txn) => t.vpa ?? (t.merchantGuess ?? '').toLowerCase()
  const debits = first.filter((t) => t.direction === 'debit' && !t.flags.includes('duplicate') && key(t))
  for (const c of first) {
    if (c.direction !== 'credit' || c.category != null || c.ruleId || c.flags.includes('duplicate')) continue
    if (c.reviewReason !== 'potential_p2p' || !key(c)) continue
    const candidates = debits.filter((d) => key(d) === key(c) && Math.abs(diffDays(c.date, d.date)) <= 45 && d.amount >= c.amount * 0.3)
    if (!candidates.length) continue
    const d = candidates.sort((a, b) => Math.abs(diffDays(c.date, a.date)) - Math.abs(diffDays(c.date, b.date)))[0]
    out.set(c.id, { category: d.category ?? 'Other', name: c.merchantGuess ?? c.vpa ?? 'someone', paid: d.amount, date: d.date })
  }
  return out
}

export function resolveTxn(
  t: Txn,
  rules: Rule[],
  salaryIds: ReadonlySet<string>,
  reimbursements?: ReadonlyMap<string, Reimbursement>,
): ResolvedTxn {
  const isDup = t.flags.includes('duplicate')
  const rule = isDup ? null : findRule(t, rules)
  let category: Category | null = isDup ? null : (rule?.category ?? t.autoCategory)
  let source: ClassificationSource = rule
    ? rule.matchType === 'txn'
      ? 'user'
      : 'rule'
    : category
      ? 'heuristic'
      : 'unclassified'
  let reason = t.autoReason
  if (rule) {
    reason =
      rule.matchType === 'txn'
        ? `You set this transaction to ${rule.category}.`
        : `Your rule: ${FIELD_LABEL[rule.matchField ?? 'any']} "${rule.token}" → ${rule.category}.`
  }
  if (!rule && !isDup && t.direction === 'credit' && category == null && salaryIds.has(t.id)) {
    category = 'Salary'
    source = 'detected'
    reason = 'Largest credit that repeats every 25–35 days from the same source, so treated as salary.'
  }
  const back = !rule && !isDup && t.direction === 'credit' && category == null ? reimbursements?.get(t.id) : undefined
  if (back) {
    // money back from someone you paid: it reduces what you spent, it is not income
    category = back.category
    source = 'detected'
    reason = `Looks like ${back.name} paying you back for your payment of ₹${Math.round(back.paid)} on ${back.date}${back.category !== 'Other' ? ` (${back.category})` : ''}. Netted against that spending instead of counted as income.`
  }
  if (isDup) reason = 'Same amount, date and counterparty as a record from another source. Kept for reference, not counted twice.'

  let lines: Line[] = []
  if (!isDup) {
    if (category == null) {
      // conservative defaults: unknown spend counts as flexible, unknown credits as other income
      lines = [{ category: t.direction === 'debit' ? 'Other' : 'Other income', amount: t.amount }]
    } else if (rule?.splits?.length) {
      // manual split: listed parts first, any remainder under the rule's category
      let left = t.amount
      for (const s of rule.splits) {
        const a = Math.min(Math.max(0, s.amount), left)
        if (a > 0) lines.push({ category: s.category, amount: a })
        left -= a
      }
      if (left > 0.004) lines.push({ category, amount: left })
      reason = `You split this transaction: ${lines.map((l) => `₹${Math.round(l.amount)} ${l.category}`).join(' + ')}.`
    } else if (t.direction === 'debit' && bucketOf(category) === 'income') {
      lines = [{ category: 'Other', amount: t.amount }]
    } else if (rule && rule.category === 'P2P split' && t.direction === 'debit' && rule.myShare && rule.myShare > 0) {
      const share = Math.min(rule.myShare, t.amount)
      lines = [
        { category: rule.shareCategory ?? 'Other', amount: share },
        ...(t.amount - share > 0.004 ? [{ category: 'P2P split' as Category, amount: t.amount - share }] : []),
      ]
      reason += ` Your share ₹${share} stays counted as ${rule.shareCategory ?? 'Other'}; the rest is excluded.`
    } else {
      lines = [{ category, amount: t.amount }]
    }
  }

  const baseFlags = rule ? t.flags.filter((f) => f !== 'needs_review') : t.flags
  const needsReview =
    !isDup && !rule && t.flags.includes('needs_review') && (category == null || t.reviewReason === 'missing_date')
  return {
    ...t,
    category,
    ruleId: rule?.id ?? null,
    classSource: source,
    reason,
    effectiveFlags: flagsFor(category, baseFlags),
    lines,
    needsReview,
    isRecurring: false,
  }
}
