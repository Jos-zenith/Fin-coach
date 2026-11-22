import { formatDateLong, formatDateShort } from '../dates'
import { breakEvenGap, lifestyleRange } from '../engine/insights'
import { daysOfRunwayPerMonth, runwayGainDays, type Model } from '../engine/model'
import { computePace, type Nudge, type PaceReport } from '../engine/nudges'
import { buildMissionReview } from '../engine/review'
import { formatINR, formatMonths } from '../format'
import { DEFAULT_SIM, type LeakDecision, type Profile, type Rule, type SimState } from '../types'
import { checkOutput, checkRequest, EDU_LINE, ungroundedNumbers } from './guardrails'
import { describe, parseRequest, planScenario, type Intent, type ScenarioSummary } from './planner'
import { Tracer, type TraceEvent } from './types'

export interface OptionCard {
  key: string
  label: string
  line: string
  sim: Partial<SimState>
  meets: boolean | null
}

export interface Reply {
  text: string[]
  options: OptionCard[]
  links: { label: string; route: 'leaks' | 'simulator' | 'review' | 'nudges' | 'mission' | 'overview' }[]
  trace: TraceEvent
}

export interface Ctx {
  model: Model
  profile: Profile
  rules: Rule[]
  decisions: Record<string, LeakDecision>
  nudges: Nudge[]
}

const EXAMPLES = [
  'What is my runway?',
  'What are my biggest leaks?',
  'What if I cut dining out by 30%?',
  'Can I still reach my Goa goal if rent rises ₹3,500?',
  'My parents need ₹4,000 a month. Can I still build my emergency fund by December 2027?',
  'What if I lose my salary for two months?',
]
export const COPILOT_EXAMPLES = EXAMPLES

/**
 * The Supervisor: guardrails in, route to one specialist, deterministic tools, verify, guardrails out.
 * `parsed` lets the optional LLM mode supply the intent; everything after that is identical.
 */
export function handle(question: string, ctx: Ctx, parsed?: { intent: Intent; mode: 'llm' }): Reply {
  const gate = checkRequest(question)
  if (!gate.allowed) {
    const tr = new Tracer('Supervisor', 'Copilot question', question).plan('Check the request against education-only guardrails')
    tr.guard('Education only: no securities, funds, deposits, insurance products or loans', false, 'Request blocked').status('blocked').local()
    tr.result('Declined and redirected to cash-flow questions')
    return { text: [gate.reason, EDU_LINE], options: [], links: [{ label: 'Open the simulator', route: 'simulator' }], trace: tr.done() }
  }

  const intent = parsed?.intent ?? parseRequest(question, ctx.model, ctx.profile)
  const mode = parsed?.mode ?? 'local'
  let reply: Omit<Reply, 'trace'>
  let tr: Tracer
  const outputs: unknown[] = []

  switch (intent.kind) {
    case 'runway': {
      tr = new Tracer('Insight & Triage', 'Copilot question', question, mode).plan('Read the baseline runway from the model', 'Explain survival vs lifestyle runway')
      const s = ctx.model.baseline
      const range = tr.call('get_runway', {}, () => ({ survival: s.survival, lifestyle: s.lifestyle, cash: s.cash, emb: s.emb, burn: s.burn, surplus: s.surplus, range: lifestyleRange(ctx.model, s), gap: breakEvenGap(s) }), (o) => `survival ${o.survival?.toFixed(1)} mo, lifestyle ${o.lifestyle?.toFixed(1)} mo`, (o) => o)
      outputs.push(range)
      reply = {
        text: [
          s.survival != null
            ? `Your ${formatINR(s.cash ?? 0)} of accessible cash covers ${formatMonths(s.survival)} months of essentials (${formatINR(s.emb)}/month) if your income stopped. That is your survival runway.`
            : 'I need your accessible cash to calculate runway. Add it in Profile & Goals.',
          s.lifestyle != null ? `If you also keep today’s flexible spending (${formatINR(s.burn)}/month in total), it lasts ${formatMonths(s.lifestyle)} months: your lifestyle runway${range.range ? `, or up to ${formatMonths(range.range.high)} if the unreviewed ${formatINR(range.range.unreviewed)}/month turns out not to be spending` : ''}.` : '',
          range.gap != null ? `You are spending ${formatINR(range.gap)}/month more than you take home.` : s.surplus != null ? `You keep ${formatINR(s.surplus)} a month after spending.` : '',
        ].filter(Boolean),
        options: [],
        links: [{ label: 'See the runway', route: 'overview' }],
      }
      break
    }
    case 'leaks': {
      tr = new Tracer('Insight & Triage', 'Copilot question', question, mode).plan('List recurring charges', 'Rank by what deserves a decision: unused, unknown, new, price rises', 'Express each in runway days')
      const ranked = tr.call(
        'detect_leak_changes',
        {},
        () =>
          ctx.model.leaks
            .filter((l) => l.kind !== 'possible_duplicate' && ctx.decisions[l.id] !== 'keep')
            .map((l) => ({
              label: l.label,
              monthly: l.monthly,
              why: l.unused ? `no matching ${l.usage?.label.toLowerCase()} in ${l.usage?.daysSince} days` : l.category == null ? 'merchant not recognised' : l.isNew ? `new since ${formatDateShort(l.firstDate)}` : l.priceChange ? `price up from ${formatINR(l.priceChange.from)}` : 'recurring subscription',
              priority: l.unused ? 4 : l.category == null ? 3 : l.priceChange ? 2 : l.isNew ? 2 : 1,
              gainDays: runwayGainDays(l.monthly, ctx.model.baseline.cash, ctx.model.baseline.burn),
              perMonthDays: daysOfRunwayPerMonth(l.monthly, ctx.model.baseline.burn),
            }))
            .sort((a, b) => b.priority - a.priority || b.monthly - a.monthly),
        (r) => `${r.length} recurring charges, ${r.filter((x) => x.priority >= 3).length} worth a decision first`,
        (r) => r,
      )
      outputs.push(ranked)
      const top = ranked.slice(0, 4)
      const total = top.reduce((a, l) => a + l.monthly, 0)
      outputs.push({ total })
      reply = {
        text: top.length
          ? [
              `These are the recurring charges worth reviewing first:`,
              ...top.map((l, i) => `${i + 1}. ${l.label}: ${formatINR(l.monthly)}/month (${l.why}).`),
              `Together that is ${formatINR(total)}/month. Runway cannot cancel anything; mark a decision in Leak Radar and manage mandates in your UPI or banking app.`,
            ]
          : ['No recurring charges need a decision right now.'],
        options: [],
        links: [{ label: 'Open Leak Radar', route: 'leaks' }],
      }
      break
    }
    case 'drift': {
      tr = new Tracer('Monthly Review & Drift', 'Copilot question', question, mode).plan('Compute this pay cycle’s pace by category', 'Translate overrun into goal-delay days')
      const pace: PaceReport | null = tr.call('compute_paycycle_drift', {}, () => computePace(ctx.model, DEFAULT_SIM), (p) => (p ? `day ${p.daysIn} of ${p.cycleDays}; ${p.rows.filter((r) => r.status === 'red').length} categories ahead of pace` : 'no current cycle'), (p) => p && { cycleStart: p.cycleStart, daysIn: p.daysIn, cycleDays: p.cycleDays, rows: p.rows })
      outputs.push(pace)
      const hot = pace?.rows.filter((r) => r.status !== 'green' && r.spent > 0) ?? []
      reply = {
        text: !pace
          ? ['I need transactions from the current pay cycle to judge pace.']
          : hot.length
            ? [
                `Day ${pace.daysIn} of ${pace.cycleDays} in this pay cycle:`,
                ...hot.slice(0, 3).map((r) => `${r.category}: ${formatINR(r.spent)} spent vs ${formatINR(r.budget)} usual for the whole cycle${r.goalShiftDays != null && r.goalShiftDays >= 1 ? `; at this pace your emergency fund slips about ${Math.round(r.goalShiftDays)} days` : ''}.`),
              ]
            : [`Day ${pace.daysIn} of ${pace.cycleDays}: every category is at or under its usual pace.`],
        options: hot[0] ? [{ key: 'cap', label: `Cut ${hot[0].category} 30% for the rest of the cycle`, line: 'Opens the simulator with this cut', sim: { ...DEFAULT_SIM, catCut: { category: hot[0].category, pct: 30 } }, meets: null }] : [],
        links: [{ label: 'Open the Nudge Center', route: 'nudges' }],
      }
      break
    }
    case 'monthly': {
      tr = new Tracer('Monthly Review & Drift', 'Copilot question', question, mode).plan('Build the monthly review from deterministic metrics', 'Write a grounded narrative', 'Select one next mission')
      const r = tr.call('generate_monthly_review', {}, () => buildMissionReview(ctx.model, ctx.rules, ctx.decisions), (x) => (x ? `${x.current.label}: ${x.changes.length} changes` : 'no data'), (x) => x && { current: x.current, previous: x.previous, runwayStart: x.runwayStart, runwayEnd: x.runwayEnd, nextAction: x.nextAction })
      outputs.push(
        r && {
          current: r.current,
          previous: r.previous,
          runwayStart: r.runwayStart,
          runwayEnd: r.runwayEnd,
          savingsPct: r.current.savingsRate != null ? Math.round(r.current.savingsRate * 100) : null,
          essentialChange: r.previous ? Math.abs(r.current.essential - r.previous.essential) : null,
          flexibleChange: r.previous ? Math.abs(r.current.flexible - r.previous.flexible) : null,
          nextAction: r.nextAction,
        },
      )
      reply = r
        ? {
            text: [
              monthlyNarrative(r),
              `Next mission: ${r.nextAction}`,
            ],
            options: [],
            links: [{ label: 'Open the monthly review', route: 'mission' }],
          }
        : { text: ['I need at least one month of statement data for a review.'], options: [], links: [] }
      break
    }
    case 'scenario': {
      tr = new Tracer('Goal Planner', 'Copilot question', question, mode)
      tr.plan(
        `Understand: ${intent.levers.length ? intent.levers.join(', ') : 'protect a goal'}${intent.goalRef ? ` · goal: ${intent.goalRef === 'emergency' ? 'emergency fund' : ctx.profile.goals.find((g) => g.id === intent.goalRef)?.name}` : ''}${intent.deadline ? ` · deadline ${intent.deadline}` : ''}`,
        'Run the deterministic simulator for the baseline and the scenario',
        'If the goal slips or misses its date, generate alternatives and solve for the smallest adjustment',
        'Rank options; the user chooses; nothing is applied automatically',
      )
      const res = planScenario(ctx.model, intent, ctx.profile, tr)
      outputs.push(res.baseline, res.scenario, res.options)
      const s = res.scenario
      const b = res.baseline
      const lines: string[] = []
      if (intent.levers.length) {
        lines.push(
          `${intent.levers.join(' and ')}: ${b.surplus != null && s.surplus != null ? `monthly surplus goes from ${formatINR(b.surplus)} to ${formatINR(s.surplus)}` : 'surplus cannot be calculated without take-home pay'}.`,
        )
        lines.push(
          `${s.goal.name}: ${b.goal.date ? formatDateLong(b.goal.date) : b.goal.status.replace('_', ' ')} → ${s.goal.date ? formatDateLong(s.goal.date) : s.goal.status === 'not_achievable' ? 'not reachable at this pace' : s.goal.status.replace('_', ' ')}${s.daysVsBaseline ? ` (${Math.abs(s.daysVsBaseline)} days ${s.daysVsBaseline > 0 ? 'later' : 'sooner'})` : ''}.`,
        )
        if (s.survival != null && b.survival != null && Math.abs(s.survival - b.survival) >= 0.05) lines.push(`Survival runway: ${formatMonths(b.survival)} → ${formatMonths(s.survival)} months.`)
      } else {
        lines.push(`${s.goal.name} is currently projected for ${s.goal.date ? formatDateLong(s.goal.date) : s.goal.status.replace('_', ' ')}${res.deadline ? `; your target is ${formatDateLong(res.deadline)}` : ''}.`)
      }
      // Say what every option assumes, so a date that differs from the dashboard is never a surprise.
      if (res.options.length && intent.levers.length)
        lines.push(`Every option below already includes ${intent.levers.join(' and ')}. The dashboard shows today, without ${intent.levers.length > 1 ? 'these changes' : 'it'}: ${b.goal.name} ${b.goal.date ? `by ${formatDateLong(b.goal.date)}` : b.goal.status.replace('_', ' ')}.`)
      if (res.options.length) lines.push(res.deadline ? `Options, ranked by whether they meet ${formatDateShort(res.deadline)} and then by how little they change:` : 'Options, ranked by goal date:')
      reply = {
        text: lines,
        options: res.options.map((o: ScenarioSummary, i) => ({ key: String.fromCharCode(65 + i), label: o.label, line: describe(o, res.deadline), sim: o.sim, meets: o.meetsDeadline })),
        links: [{ label: 'Open the simulator', route: 'simulator' }],
      }
      if (!res.options.length) reply.options = [{ key: 'A', label: s.label, line: describe(s, res.deadline), sim: s.sim, meets: s.meetsDeadline }]
      tr.approval('required')
      break
    }
    default: {
      tr = new Tracer('Supervisor', 'Copilot question', question, mode).plan('Route the request to a specialist')
      tr.result('No specialist matched; offered example questions')
      reply = { text: ['I can answer questions about your runway, recurring charges, this pay cycle, your monthly review, and what-if changes to income, costs and spending. Try one of these:', ...EXAMPLES.map((e) => `• ${e}`)], options: [], links: [] }
    }
  }

  // verify before answering: grounded numbers, no product advice
  const text = reply.text.join(' ')
  const missing = ungroundedNumbers(text, outputs)
  tr!.verify(missing.length ? `Grounding check: ${missing.length} figure(s) not found in tool outputs (${missing.slice(0, 3).join(', ')})` : 'Grounding check: every figure in the answer comes from a tool output')
  const out = checkOutput(text)
  tr!.guard('Education only: no securities, funds, deposits, insurance products or loans', out.ok, out.hit)
  tr!.guard('LLM does no arithmetic: all numbers from the deterministic engine', true)
  tr!.local()
  if (!tr!.event.result.length) tr!.result(...reply.text.slice(0, 3))
  if (reply.options.length) tr!.result(`${reply.options.length} option(s) offered; applying one needs your approval`)
  return { ...reply, trace: tr!.done() }
}

/** Grounded monthly narrative: built only from MissionReview fields. */
export function monthlyNarrative(r: NonNullable<ReturnType<typeof buildMissionReview>>): string {
  const c = r.current
  const p = r.previous
  const parts: string[] = []
  if (r.runwayStart != null && r.runwayEnd != null)
    parts.push(`Your survival runway went from ${formatMonths(r.runwayStart)} to ${formatMonths(r.runwayEnd)} months during ${c.label}`)
  else parts.push(`In ${c.label}`)
  if (p) {
    const de = c.essential - p.essential
    const df = c.flexible - p.flexible
    const bits = [
      Math.abs(de) >= 100 ? `essentials ${de > 0 ? 'rose' : 'fell'} by ${formatINR(Math.abs(de))}` : '',
      Math.abs(df) >= 100 ? `flexible spending ${df > 0 ? 'rose' : 'fell'} by ${formatINR(Math.abs(df))}` : '',
    ].filter(Boolean)
    if (bits.length) parts.push(`${bits.join(' and ')} compared with ${p.label}`)
  }
  return `${parts.join('; ')}.${c.savingsRate != null ? ` You kept ${Math.round(c.savingsRate * 100)}% of income.` : ''}`
}

export type { PaceReport }
