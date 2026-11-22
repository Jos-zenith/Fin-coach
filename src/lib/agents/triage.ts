import { formatDateShort } from '../dates'
import { averagingBasis, type Model } from '../engine/model'
import { groupKey } from '../engine/recurring'
import { formatINR } from '../format'
import type { Category, Rule } from '../types'

export type TriageChoice = 'confirmed' | 'dismissed' | 'review'

export interface TriageAction {
  label: string
  /** rules saved when chosen (the correction becomes memory) */
  rules: Omit<Rule, 'id' | 'createdAt'>[]
  /** set a Leak Radar decision instead of / as well as rules */
  leakDecision?: { id: string; decision: 'review' | 'keep' }
}

export interface TriageItem {
  id: string
  kind: 'reimbursement' | 'unknown_recurring' | 'savings_debit' | 'large_unclassified'
  question: string
  detail: string
  /** ₹ per month this answer can move in the runway maths */
  impact: number
  confirm: TriageAction
  alternatives: TriageAction[]
  dismiss: TriageAction
}

/**
 * Builds the question queue: only consequential ambiguity, ranked by monthly impact.
 * Every item maps a yes/no answer to a concrete, reversible rule.
 */
export function buildTriage(model: Model, decided: Record<string, TriageChoice>): TriageItem[] {
  const items: TriageItem[] = []
  const basis = averagingBasis(model.active)
  const months = basis.months
  // impact uses the same whole-month basis as every other monthly figure
  const inBasis = new Set(basis.txns.map((t) => t.id))

  // 1. likely reimbursements (provisionally netted; the user confirms or undoes)
  for (const c of model.resolved.filter((t) => t.direction === 'credit' && t.classSource === 'detected' && t.category !== 'Salary')) {
    const key = c.vpa ?? (c.merchantGuess ?? '').toLowerCase()
    const paid = model.active
      .filter((d) => d.direction === 'debit' && (d.vpa ?? (d.merchantGuess ?? '').toLowerCase()) === key && d.date <= c.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    if (!paid) continue
    const cat: Category = paid.category && paid.category !== 'Other' ? paid.category : 'Dining'
    const who = c.merchantGuess ?? c.vpa ?? 'this person'
    items.push({
      id: `reimb:${c.id}`,
      kind: 'reimbursement',
      question: `You paid ${formatINR(paid.amount)} to ${who} on ${formatDateShort(paid.date)} and received ${formatINR(c.amount)} back from ${c.vpa ?? who} on ${formatDateShort(c.date)}. Is this a shared bill being paid back?`,
      detail: `If yes, money from ${who} will always reduce that spending instead of counting as income, and payments to ${who} count as ${cat === 'Dining' ? 'dining (shared meals)' : cat}.`,
      impact: c.amount / months,
      confirm: { label: 'Yes, shared bill', rules: [{ matchType: 'contains', matchField: c.vpa ? 'vpa' : 'merchant', token: (c.vpa ?? who).toLowerCase(), category: cat, label: `${who}: shared bills` }] },
      alternatives: [],
      dismiss: { label: 'No, it is income', rules: [{ matchType: 'txn', token: c.id, category: 'Other income', label: `${who}: not a reimbursement` }] },
    })
  }

  // 2. recurring charges from merchants Runway cannot identify
  for (const l of model.leaks.filter((x) => x.kind !== 'possible_duplicate' && x.category == null && !x.txns.some((t) => t.reviewReason === 'investment_like'))) {
    items.push({
      id: `unknown:${l.id}`,
      kind: 'unknown_recurring',
      question: `${formatINR(l.monthly)} has left your account every month since ${formatDateShort(l.firstDate)}${l.mandateMarker ? ` through an automatic debit (${l.mandateMarker.trim().toUpperCase()})` : ''} to “${l.label}”. Do you recognise it?`,
      detail: `Next one expected around ${formatDateShort(l.nextExpected)}. If you do not recognise it, you can check active mandates in your UPI or banking app.`,
      impact: l.monthly,
      confirm: { label: 'Yes, a subscription I use', rules: [{ matchType: 'contains', matchField: 'merchant', token: l.label.toLowerCase(), category: 'Subscriptions', label: l.label }] },
      alternatives: [],
      dismiss: { label: 'No, I need to check it', rules: [], leakDecision: { id: l.id, decision: 'review' } },
    })
  }

  // 3. investment-style debits: savings, not spending, if the user says so
  const savingsGroups = new Map<string, typeof model.active>()
  for (const t of model.active.filter((x) => x.direction === 'debit' && x.reviewReason === 'investment_like' && x.category == null)) {
    const k = groupKey(t)
    savingsGroups.set(k, [...(savingsGroups.get(k) ?? []), t])
  }
  for (const [k, list] of savingsGroups) {
    const t = list[list.length - 1]
    const monthly = list.filter((x) => inBasis.has(x.id)).reduce((a, x) => a + x.amount, 0) / months
    items.push({
      id: `savings:${k}`,
      kind: 'savings_debit',
      question: `${formatINR(t.amount)} goes to “${t.merchantGuess ?? k}” each month. Is this money you are setting aside (savings), rather than spending?`,
      detail: `Right now it counts as flexible spending, which lowers your surplus by about ${formatINR(monthly)} a month. Runway does not judge or recommend what you invest in.`,
      impact: monthly,
      confirm: { label: 'Yes, it is savings', rules: [{ matchType: 'contains', matchField: 'merchant', token: (t.merchantGuess ?? k).toLowerCase(), category: 'Self-transfer', label: `${t.merchantGuess ?? k}: savings` }] },
      alternatives: [],
      dismiss: { label: 'No, it is spending', rules: [{ matchType: 'contains', matchField: 'merchant', token: (t.merchantGuess ?? k).toLowerCase(), category: 'Other', label: t.merchantGuess ?? k }] },
    })
  }

  // 4. the largest unclassified spends by merchant
  const groups = new Map<string, typeof model.active>()
  for (const t of model.active.filter((x) => x.direction === 'debit' && x.category == null && x.reviewReason !== 'investment_like' && x.reviewReason !== 'potential_p2p')) {
    const k = groupKey(t)
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  // merchants already asked about as unknown recurring charges
  const covered = new Set(model.leaks.filter((l) => l.category == null).map((l) => groupKey(l.txns[0])))
  const ranked = [...groups.entries()]
    .map(([k, list]) => ({ k, list, monthly: list.filter((x) => inBasis.has(x.id)).reduce((a, x) => a + x.amount, 0) / months }))
    .filter((g) => g.monthly >= 300 && !covered.has(g.k))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 3)
  for (const g of ranked) {
    const name = g.list[0].merchantGuess ?? g.k
    const choice = (label: string, category: Category): TriageAction => ({ label, rules: [{ matchType: 'contains', matchField: 'merchant', token: name.toLowerCase(), category, label: name }] })
    items.push({
      id: `unclassified:${g.k}`,
      kind: 'large_unclassified',
      question: `About ${formatINR(g.monthly)} a month goes to “${name}” (${g.list.length} payment${g.list.length > 1 ? 's' : ''}). What is it?`,
      detail: 'Unclassified spending counts as flexible. Telling Runway once applies to every past and future payment there.',
      impact: g.monthly,
      confirm: choice('Groceries', 'Groceries'),
      alternatives: [choice('Shopping', 'Shopping'), choice('Dining', 'Dining')],
      dismiss: choice('Something else', 'Other'),
    })
  }

  return items.filter((i) => !decided[i.id]).sort((a, b) => b.impact - a.impact)
}
