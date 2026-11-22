import type { ExplainContent } from '../ui'
import type { GoalProjection, Model, Scenario, ValueSource } from '../../lib/engine/model'
import { formatDateShort } from '../../lib/dates'
import { formatINR, formatMonths, formatPct } from '../../lib/format'
import type { Profile } from '../../lib/types'

const src = (s: ValueSource) => (s === 'you' ? 'you entered' : s === 'statements' ? 'statements' : 'no data')

function periodText(m: Model) {
  return m.base.period
    ? `${formatDateShort(m.base.period.start)} → ${formatDateShort(m.base.period.end)} (${formatMonths(m.base.months)} months)`
    : 'No statements: using your profile only'
}

export function explainCash(m: Model, p: Profile): ExplainContent {
  return {
    definition: 'Money you could use this week without selling anything, breaking a lock-in or borrowing.',
    formula: p.includeFD ? 'Cash = accessible savings + FD × (1 − haircut)' : 'Cash = accessible savings',
    inputs: [
      ['Accessible savings', p.accessibleCash != null ? formatINR(p.accessibleCash) : 'not entered'],
      ...(p.includeFD ? ([['FD counted', `${formatINR(p.fdAmount)} × ${100 - p.fdHaircutPct}%`]] as [string, string][]) : []),
      ['Total', m.cash != null ? formatINR(m.cash) : '—'],
    ],
    assumptions: ['You entered this figure; Runway does not read your bank balance.'],
    limitations: ['Investments, retirement accounts and credit limits are deliberately excluded.'],
  }
}

export function explainEMB(m: Model): ExplainContent {
  return {
    definition: 'What you must pay every month to keep your life running: housing, debt, food at home, bills, family, cover and getting to work.',
    formula: 'Essentials = Rent + EMIs + Utilities + Groceries + Family Support + Insurance + Minimum Transport',
    inputs: [
      ...m.base.essential.map((l) => [l.category, `${formatINR(l.amount)} · ${src(l.source)}`] as [string, string]),
      ['Period', periodText(m)],
    ],
    assumptions: ['Statement figures are monthly averages over the period shown.', 'A figure you typed in the profile replaces the statement figure for that line.'],
    limitations: ['Annual payments (e.g. yearly premiums) are spread only over the months in your data.'],
  }
}

export function explainFS(m: Model): ExplainContent {
  return {
    definition: 'Spending you could reduce: dining, delivery, shopping, entertainment, travel, subscriptions and anything not yet classified.',
    formula: 'Flexible spending = Dining + Delivery + Shopping + Entertainment + Travel + Subscriptions + Other',
    inputs: [
      ...m.base.flexible.filter((l) => l.amount > 0).map((l) => [l.category, formatINR(l.amount)] as [string, string]),
      ...(m.base.flexibleOverride != null ? ([['You entered', formatINR(m.base.flexibleOverride)]] as [string, string][]) : []),
    ],
    assumptions: ['Unclassified debits count as flexible "Other" until you review them, which is the conservative choice.'],
    limitations: ['Refunds net off their category; credit-card bill payments and transfers are excluded.'],
  }
}

export function explainSurvival(s: Scenario): ExplainContent {
  return {
    definition: 'How many months your accessible cash covers essentials if income stopped today.',
    formula: 'Survival runway = Accessible cash ÷ Essentials per month',
    inputs: [
      ['Accessible cash', s.cash != null ? formatINR(s.cash) : 'not entered'],
      ['Essentials', `${formatINR(s.emb)}/mo`],
      ['Result', s.survival != null ? `${formatMonths(s.survival)} months` : '—'],
    ],
    assumptions: ['Essentials stay at today’s level.', 'No income of any kind during that time.'],
    limitations: ['Ignores one-off costs like a medical bill or a deposit for a new flat.'],
  }
}

export function explainLifestyle(s: Scenario): ExplainContent {
  return {
    definition: 'How long the same cash lasts if you keep spending the way you do now.',
    formula: 'Lifestyle runway = Accessible cash ÷ (Essentials + Flexible spending)',
    inputs: [
      ['Accessible cash', s.cash != null ? formatINR(s.cash) : 'not entered'],
      ['Essentials + flexible spending', `${formatINR(s.emb)} + ${formatINR(s.fs)}`],
      ['Result', s.lifestyle != null ? `${formatMonths(s.lifestyle)} months` : '—'],
    ],
  }
}

export function explainSurplus(m: Model, s: Scenario): ExplainContent {
  return {
    definition: 'What is left each month after essentials and flexible spending.',
    formula: 'Surplus = Net take-home − Essentials − Flexible spending',
    inputs: [
      ['Net take-home', s.takeHome != null ? `${formatINR(s.takeHome)} · ${src(m.takeHomeSource)}` : 'not known'],
      ['Essentials', formatINR(s.emb)],
      ['Flexible spending', formatINR(s.fs)],
      ['Surplus', s.surplus != null ? formatINR(s.surplus) : '—'],
    ],
    assumptions: m.salary && m.takeHomeSource === 'statements' ? [`Take-home detected from "${m.salary.label}", the largest credit repeating every 25–35 days.`] : [],
    limitations: ['Bonuses, interest and refunds are not counted as take-home.'],
  }
}

export function explainGoal(g: GoalProjection): ExplainContent {
  return {
    definition: g.kind === 'emergency' ? 'Cash that covers several months of essentials. Funded before any other goal.' : `Reach ${g.name}.`,
    formula: 'Months to goal = (Target − Saved) ÷ Monthly contribution · over 120 months or no surplus → not achievable',
    inputs: [
      ['Target', g.target != null ? formatINR(g.target) : 'missing'],
      ['Saved', g.saved != null ? formatINR(Math.max(0, g.saved)) : 'missing'],
      ['Contribution', g.contribution != null ? `${formatINR(g.contribution)}/mo (${g.contributionSource === 'you' ? 'you set it' : 'share of surplus'})` : 'missing'],
      ['Months', g.months != null ? formatMonths(g.months) : '—'],
      ...(g.targetDate ? ([['Target date', g.targetDate], ['Needed per month', g.required != null ? formatINR(g.required) : '—']] as [string, string][]) : []),
    ],
    assumptions: ['Surplus goes to the emergency fund first, then goals in order; contributions you set are honoured first.', 'Contributions stay the same every month. Dates are rounded up, never optimistic.'],
    limitations: ['No interest or returns are assumed on savings, and no interest on debt.'],
  }
}

export function explainDTI(m: Model, s: Scenario): ExplainContent {
  return {
    definition: 'How much of your take-home goes to loan EMIs.',
    formula: 'EMI load = Total monthly EMIs ÷ Net take-home × 100',
    inputs: [
      ['EMIs', `${formatINR(s.emi)}/mo`],
      ['Take-home', s.takeHome != null ? formatINR(s.takeHome) : 'not known'],
      ['EMI load', s.dti != null ? formatPct(s.dti, 1) : '—'],
    ],
    assumptions: ['35% is used as a caution mark and 40% as higher stress.'],
    limitations: ['These are general rules of thumb, not regulatory limits or a lender’s criteria.', `EMIs counted: ${m.base.essential.find((l) => l.category === 'EMI')?.source === 'you' ? 'the figure you entered' : 'debits classified as EMI'}.`],
  }
}

export function explainNoise(m: Model): ExplainContent {
  const n = m.noise
  return {
    definition: 'Money that moved but is not spending, so Runway leaves it out of every calculation.',
    formula: 'Noise = card bill payments + self-transfers + P2P splits + ignored items',
    inputs: [
      ['Card bill payments', formatINR(n.byCategory['CC repayment'])],
      ['Self-transfers', formatINR(n.byCategory['Self-transfer'])],
      ['P2P splits', formatINR(n.byCategory['P2P split'])],
      ['Ignored', formatINR(n.byCategory['Ignored'])],
      ['Duplicates (SMS = statement)', `${n.duplicates}`],
      ['Card bills paired with card statement', n.cardBillPayments ? `${n.cardBillPairs} of ${n.cardBillPayments}` : 'none'],
      ['Bank-view spend / month', formatINR(n.apparentMonthly)],
      ['Counted spend / month', formatINR(n.trueMonthly)],
    ],
    assumptions: ['Card purchases are counted from the card statement, so paying the card bill from your bank is not counted again.'],
    limitations: ['Transfers to people are never excluded automatically. You decide in Review.'],
  }
}
