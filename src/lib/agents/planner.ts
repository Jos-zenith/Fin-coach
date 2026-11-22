import { daysInMonth, diffDays, formatDateLong, formatDateShort, toISO } from '../dates'
import { computeScenario, type GoalProjection, type Model, type Scenario } from '../engine/model'
import { suggestPlan } from '../engine/insights'
import { formatINR, formatMonths } from '../format'
import { DEFAULT_SIM, FLEXIBLE_CATEGORIES, type FlexibleCategory, type Profile, type SimState } from '../types'
import type { Tracer } from './types'

// ---------------------------------------------------------------------------
// 1. Understanding: natural language → structured simulator parameters.
//    Deterministic grammar; the optional LLM mode produces the same structure.
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: 'runway' }
  | { kind: 'leaks' }
  | { kind: 'monthly' }
  | { kind: 'drift' }
  | { kind: 'scenario'; sim: Partial<SimState>; levers: string[]; goalRef: string | null; deadline: string | null; protect: boolean; caps: { category: FlexibleCategory; amount: number }[] }
  | { kind: 'unknown' }

const CATEGORY_WORDS: [RegExp, FlexibleCategory][] = [
  [/\b(dining|eating out|dine out|restaurants?|cafes?)\b/, 'Dining'],
  [/\b(food delivery|delivery|swiggy|zomato|ordering in)\b/, 'Food delivery'],
  [/\b(shopping|amazon|myntra|flipkart)\b/, 'Shopping'],
  [/\b(travel|trips?)\b/, 'Travel'],
  [/\b(entertainment|movies?)\b/, 'Entertainment'],
  [/\b(subscriptions?)\b/, 'Subscriptions'],
]

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "₹3,500", "3500", "3.5k", "50k", "1.2 lakh" → rupees */
export function parseAmount(s: string): number | null {
  const m = s.match(/(?:₹|rs\.?|inr)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|thousand|lakh|lac|l)?\b/i)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  const unit = (m[2] ?? '').toLowerCase()
  if (!Number.isFinite(n)) return null
  return unit === 'k' || unit === 'thousand' ? n * 1000 : unit === 'lakh' || unit === 'lac' || unit === 'l' ? n * 100000 : n
}

const AMOUNT = '(?:₹|rs\\.?|inr)?\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?(?:k|thousand|lakh|lac)?'

function parseDeadline(t: string): string | null {
  const m = t.match(/\bby\s+(?:the\s+end\s+of\s+)?([a-z]{3,9})\.?\s+(\d{4})\b/) ?? t.match(/\bby\s+(\d{4})-(\d{2})\b/)
  if (!m) return null
  if (/^\d{4}$/.test(m[1])) {
    const y = +m[1]
    const mo = +m[2]
    return toISO(y, mo, daysInMonth(y, mo))
  }
  const mo = MONTHS[m[1].slice(0, 3)]
  const y = +m[2]
  return mo ? toISO(y, mo, daysInMonth(y, mo)) : null
}

export function parseRequest(text: string, model: Model, profile: Profile): Intent {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const sim: Partial<SimState> = {}
  const levers: string[] = []
  const caps: { category: FlexibleCategory; amount: number }[] = []

  // rent / EMI changes, in % or rupees
  const rent = t.match(new RegExp(`rent[^.?!]*?(?:up|rises?|rising|increase[sd]?|goes up|hike[sd]?|more)[^.?!\\d₹]*?(${AMOUNT}%?|\\d+(?:\\.\\d+)?\\s?%)`)) ?? t.match(new RegExp(`(${AMOUNT}%?)\\s+(?:rent )?(?:rent )?(?:hike|increase|rise) (?:in|on) (?:my )?rent`))
  if (rent) {
    if (/%/.test(rent[1])) {
      sim.rentStressPct = parseFloat(rent[1])
      levers.push(`Rent +${sim.rentStressPct}%`)
    } else {
      const a = parseAmount(rent[1])
      if (a) {
        sim.extraEssential = (sim.extraEssential ?? 0) + a
        sim.extraEssentialLabel = `Rent +${formatINR(a)}/month`
        levers.push(sim.extraEssentialLabel)
      }
    }
  }
  const emi = t.match(new RegExp(`(?:emi|loan)[^.?!]*?(?:up|rises?|increase[sd]?|goes up|new|another|more)[^.?!\\d₹]*?(${AMOUNT}%?|\\d+(?:\\.\\d+)?\\s?%)`)) ?? t.match(new RegExp(`new (?:emi|loan) of (${AMOUNT})`))
  if (emi) {
    if (/%/.test(emi[1])) {
      sim.emiStressPct = parseFloat(emi[1])
      levers.push(`EMIs +${sim.emiStressPct}%`)
    } else {
      const a = parseAmount(emi[1])
      if (a) {
        sim.extraEssential = (sim.extraEssential ?? 0) + a
        sim.extraEssentialLabel = [sim.extraEssentialLabel, `EMI +${formatINR(a)}/month`].filter(Boolean).join(', ')
        levers.push(`EMI +${formatINR(a)}/month`)
      }
    }
  }
  const family = t.match(new RegExp(`(?:parents?|family|mom|dad|mother|father)[^.?!]*?(?:need|needs|support|send|more)[^.?!\\d₹]*?(${AMOUNT})`))
  if (family) {
    const a = parseAmount(family[1])
    if (a) {
      sim.extraEssential = (sim.extraEssential ?? 0) + a
      sim.extraEssentialLabel = [sim.extraEssentialLabel, `Family support +${formatINR(a)}/month`].filter(Boolean).join(', ')
      levers.push(`Family support +${formatINR(a)}/month`)
    }
  }

  // income gap
  const gap = t.match(/(?:lose|lost|losing|no|without|stop(?:s|ped)?)\s+(?:my\s+)?(?:job|salary|income|pay)[^.?!]*?(\d|one|two|three)\s+months?/) ?? t.match(/(\d|one|two|three)\s+months?\s+(?:without|with no)\s+(?:salary|income|pay|job)/)
  if (gap) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3 }
    const n = Math.min(3, words[gap[1]] ?? parseInt(gap[1], 10))
    if (n > 0) {
      sim.incomeGapMonths = n
      levers.push(`${n} month${n > 1 ? 's' : ''} without salary`)
    }
  }

  // one-off shock
  const shock = t.match(new RegExp(`(${AMOUNT})\\s*(?:\\w+\\s){0,2}(?:medical|hospital|emergency|unexpected|surgery|repair)\\s*(?:bill|expense|cost)?`)) ?? t.match(new RegExp(`(?:medical|hospital|emergency|unexpected)\\s+(?:bill|expense|cost)\\s+of\\s+(${AMOUNT})`))
  if (shock) {
    const a = parseAmount(shock[1])
    if (a) {
      sim.shockExpense = a
      levers.push(`One-off expense of ${formatINR(a)}`)
    }
  }

  // cuts and caps
  const cutAll = t.match(/(?:cut|reduce|trim|lower)\s+(?:all\s+|my\s+)?(?:discretionary|flexible|non-essential|overall|all)\s*(?:spending|spend|expenses)?\s+by\s+(\d+(?:\.\d+)?)\s?%/)
  if (cutAll) {
    sim.cutPct = Math.min(50, parseFloat(cutAll[1]))
    levers.push(`Cut all flexible spending ${sim.cutPct}%`)
  }
  for (const [re, cat] of CATEGORY_WORDS) {
    if (cat === 'Subscriptions') continue
    const cut = t.match(new RegExp(`(?:cut|reduce|trim|lower)\\s+(?:my\\s+)?${re.source}(?:\\s+out)?\\s*(?:spending|spend)?\\s+by\\s+(\\d+(?:\\.\\d+)?)\\s?%`))
    if (cut) {
      sim.catCut = { category: cat, pct: Math.min(100, parseFloat(cut[cut.length - 1])) }
      levers.push(`Cut ${cat === 'Dining' ? 'dining out' : cat.toLowerCase()} ${sim.catCut.pct}%`)
    }
    const cap = t.match(new RegExp(`cap\\s+(?:my\\s+)?${re.source}(?:\\s+out)?\\s*(?:spending|spend)?\\s+(?:at|to)\\s+(${AMOUNT})`))
    if (cap) {
      const a = parseAmount(cap[cap.length - 1])
      if (a != null) caps.push({ category: cat, amount: a })
    }
  }

  // cancellations
  if (/\bcancel\b/.test(t)) {
    const named = model.leaks.filter((l) => l.kind !== 'possible_duplicate' && t.includes(l.label.toLowerCase().split(/[\s*]/)[0]))
    const flagged = /\b(flagged|unused|unknown|those|these|suggested)\b/.test(t) ? model.leaks.filter((l) => l.kind !== 'possible_duplicate' && (l.unused || (l.category == null && (l.isNew || l.kind === 'mandate')))) : []
    const all = /\ball (?:my )?subscriptions\b/.test(t) ? model.leaks.filter((l) => l.kind !== 'possible_duplicate') : []
    const pick = [...new Map([...named, ...flagged, ...all].map((l) => [l.id, l])).values()]
    if (pick.length) {
      sim.disabledLeaks = pick.map((l) => l.id)
      levers.push(`Cancel ${pick.map((l) => l.label).join(', ')}`)
    }
  }

  // goal reference
  let goalRef: string | null = null
  if (/emergency/.test(t)) goalRef = 'emergency'
  for (const g of profile.goals) {
    const words = g.name.toLowerCase().split(/\W+/).filter((w) => w.length >= 3 && !['trip', 'goal', 'fund', 'with', 'family', 'the', 'new', 'for'].includes(w))
    if (words.some((w) => t.includes(w))) goalRef = g.id
  }
  const deadline = parseDeadline(t)
  const protect = /\b(protect|still|keep|without missing|make it|on track|reach|hit|afford|what (?:can|should) i cut)\b/.test(t)

  if (levers.length || caps.length || (goalRef && protect)) return { kind: 'scenario', sim, levers, goalRef, deadline, protect, caps }
  if (/\b(runway|how long|survive|last)\b/.test(t)) return { kind: 'runway' }
  if (/\b(leaks?|drains?|subscriptions?|recurring|mandates?)\b/.test(t)) return { kind: 'leaks' }
  if (/\b(overspend\w*|over spend\w*|pace|drift|ahead|budget)\b/.test(t)) return { kind: 'drift' }
  if (/\b(review|this month|last month|summary|brief)\b/.test(t)) return { kind: 'monthly' }
  if (goalRef) return { kind: 'scenario', sim, levers, goalRef, deadline, protect: true, caps }
  return { kind: 'unknown' }
}

// ---------------------------------------------------------------------------
// 2. Planning: deterministic simulator calls, solver, ranking.
// ---------------------------------------------------------------------------

export interface ScenarioSummary {
  label: string
  sim: Partial<SimState>
  survival: number | null
  lifestyle: number | null
  surplus: number | null
  monthlyCut: number
  goal: { name: string; date: string | null; status: GoalProjection['status']; months: number | null }
  meetsDeadline: boolean | null
  daysVsBaseline: number | null
}

/** Applies "cap X at ₹Y" as a category cut: the tool, not the agent, converts the cap to a percentage. */
export function capsToCut(model: Model, caps: { category: FlexibleCategory; amount: number }[]): SimState['catCut'] | null {
  const c = caps[0]
  if (!c) return null
  const line = model.base.flexible.find((l) => l.category === c.category)?.amount ?? 0
  if (line <= 0) return null
  return { category: c.category, pct: Math.max(0, Math.min(100, (1 - c.amount / line) * 100)) }
}

function pickGoal(s: Scenario, ref: string | null): GoalProjection {
  if (ref && ref !== 'emergency') return s.goals.find((g) => g.id === ref) ?? s.emergency
  return s.emergency
}

export function summarize(model: Model, label: string, sim: Partial<SimState>, ref: string | null, deadline: string | null): ScenarioSummary {
  const s = computeScenario(model.ctx, sim)
  const base = pickGoal(model.baseline, ref)
  const g = pickGoal(s, ref)
  return {
    label,
    sim,
    survival: s.survival,
    lifestyle: s.lifestyle,
    surplus: s.surplus,
    monthlyCut: Math.max(0, model.baseline.fs - s.fs),
    goal: { name: g.name, date: g.status === 'on_track' || g.status === 'reached' ? g.date : null, status: g.status, months: g.months },
    meetsDeadline: deadline ? g.date != null && (g.status === 'on_track' || g.status === 'reached') && g.date <= deadline : null,
    daysVsBaseline: base.date && g.date && (g.status === 'on_track' || g.status === 'reached') ? diffDays(g.date, base.date) : null,
  }
}

/** Smallest overall flexible cut (0–50%) that meets the deadline on top of the scenario; null if none does. */
export function solveRequiredCut(model: Model, sim: Partial<SimState>, ref: string | null, deadline: string): number | null {
  const meets = (pct: number) => summarize(model, '', { ...sim, cutPct: pct }, ref, deadline).meetsDeadline
  if (!meets(50)) return null
  let lo = 0
  let hi = 50
  if (meets(0)) return 0
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (meets(mid)) hi = mid
    else lo = mid
  }
  return hi
}

export interface PlanResult {
  scenario: ScenarioSummary
  options: ScenarioSummary[]
  deadline: string | null
  goalName: string
  baseline: ScenarioSummary
}

export function planScenario(model: Model, intent: Extract<Intent, { kind: 'scenario' }>, profile: Profile, tr: Tracer): PlanResult {
  const ref = intent.goalRef
  const target = ref && ref !== 'emergency' ? profile.goals.find((g) => g.id === ref) : null
  const deadline = intent.deadline ?? (target ? target.targetDate : ref === 'emergency' ? profile.emergency.targetDate : null)
  const sim: Partial<SimState> = { ...DEFAULT_SIM, ...intent.sim }
  const cap = capsToCut(model, intent.caps)
  if (cap) sim.catCut = cap

  const baseline = tr.call('run_what_if_simulation', { scenario: 'baseline', goal: ref ?? 'emergency', deadline }, () => summarize(model, 'Current plan', DEFAULT_SIM, ref, deadline), (o) => `${o.goal.name}: ${o.goal.date ?? o.goal.status}; surplus ${o.surplus != null ? formatINR(o.surplus) : '—'}`, (o) => o)
  const scenario = tr.call('run_what_if_simulation', { levers: intent.levers, ...(cap ? { cap: intent.caps[0] } : {}) }, () => summarize(model, intent.levers.join(' + ') || 'Your scenario', sim, ref, deadline), (o) => `${o.goal.name}: ${o.goal.date ?? o.goal.status}; surplus ${o.surplus != null ? formatINR(o.surplus) : '—'}`, (o) => o)

  const options: ScenarioSummary[] = []
  const worse = scenario.meetsDeadline === false || (scenario.daysVsBaseline != null && scenario.daysVsBaseline > 0) || scenario.goal.status === 'not_achievable'
  if (intent.protect || worse || deadline) {
    // Option A: the drains + top-category plan, on top of the scenario
    const plan = suggestPlan(model)
    if (plan) {
      const a = tr.call(
        'run_what_if_simulation',
        { option: 'A', levers: plan.steps },
        () => summarize(model, `${plan.steps.join(', ')}`, { ...sim, disabledLeaks: [...new Set([...(sim.disabledLeaks ?? []), ...(plan.sim.disabledLeaks ?? [])])], catCut: sim.catCut?.pct ? sim.catCut : plan.sim.catCut }, ref, deadline),
        (o) => `${o.goal.date ?? o.goal.status}, cuts ${formatINR(o.monthlyCut)}/month`,
        (o) => o,
      )
      options.push(a)
    }
    // Option B: the smallest across-the-board cut that meets the deadline
    if (deadline) {
      const pct = tr.call('solve_required_adjustments', { target_date: deadline, lever: 'cut all flexible spending' }, () => solveRequiredCut(model, sim, ref, deadline), (p) => (p == null ? 'not reachable even with a 50% cut' : `${p}% cut is the smallest that meets ${deadline}`))
      if (pct != null && pct > 0) options.push(summarize(model, `Cut all flexible spending ${pct}%`, { ...sim, cutPct: pct }, ref, deadline))
    } else {
      options.push(tr.call('run_what_if_simulation', { option: 'B', cutPct: 20 }, () => summarize(model, 'Cut all flexible spending 20%', { ...sim, cutPct: 20 }, ref, deadline), (o) => `${o.goal.date ?? o.goal.status}`, (o) => o))
    }
    // Option C: change nothing else
    options.push({ ...scenario, label: intent.levers.length ? `Keep current spending and absorb ${intent.levers.join(' and ')}` : 'Keep current spending' })
  }

  const ranked = tr.call(
    'rank_scenarios',
    { by: deadline ? 'meets deadline, then smallest monthly cut' : 'earliest goal date, then smallest monthly cut' },
    () =>
      [...options].sort((x, y) => {
        if (deadline && x.meetsDeadline !== y.meetsDeadline) return x.meetsDeadline ? -1 : 1
        if (deadline && x.meetsDeadline && y.meetsDeadline) return x.monthlyCut - y.monthlyCut
        const dx = x.goal.date ?? '9999'
        const dy = y.goal.date ?? '9999'
        return dx === dy ? x.monthlyCut - y.monthlyCut : dx.localeCompare(dy)
      }),
    (r) => r.map((o, i) => `${String.fromCharCode(65 + i)}: ${o.label}`).join(' · '),
  )
  return { scenario, options: ranked.slice(0, 3), deadline, goalName: scenario.goal.name, baseline }
}

/** Plain-English rendering. Every number comes from a ScenarioSummary. */
export function describe(s: ScenarioSummary, deadline: string | null): string {
  const date = s.goal.date ? formatDateLong(s.goal.date) : s.goal.status === 'not_achievable' ? 'not reachable at this pace' : 'not calculable yet'
  const parts = [`${s.goal.name} ${s.goal.date ? `by ${date}` : date}`]
  if (s.surplus != null) parts.push(`surplus ${formatINR(s.surplus)}/month`)
  if (s.monthlyCut >= 1) parts.push(`spending ${formatINR(s.monthlyCut)}/month lower`)
  if (s.lifestyle != null) parts.push(`lifestyle runway ${formatMonths(s.lifestyle)} months`)
  if (deadline && s.meetsDeadline != null) parts.push(s.meetsDeadline ? `meets ${formatDateShort(deadline)}` : `misses ${formatDateShort(deadline)}`)
  return parts.join(' · ')
}

export const FLEX = FLEXIBLE_CATEGORIES
