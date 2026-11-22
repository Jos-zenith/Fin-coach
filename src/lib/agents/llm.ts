// Optional "Ask Runway" mode. Off by default; the user must consent and supply their own API key.
// Claude only turns the user's sentence into structured simulator parameters. It never sees amounts,
// narrations, UPI IDs, balances or account numbers, and it does no arithmetic: every number in an
// answer still comes from the deterministic engine.

import { formatINR } from '../format'
import { DEFAULT_SIM, FLEXIBLE_CATEGORIES, type FlexibleCategory, type SimState } from '../types'
import type { Model } from '../engine/model'
import type { Profile } from '../types'
import type { Intent } from './planner'

export const LLM_MODEL = 'claude-opus-5-5'

/** Exactly what leaves the browser. Shown to the user before they switch the mode on. */
export interface RedactedContext {
  task: 'parse_cash_flow_question'
  question: string
  categories: string[]
  goal_names: string[]
  recurring_merchant_names: string[]
  today: string
  raw_narration: null
  account_number: null
  balance: null
  full_statement: null
}

export function redact(question: string, model: Model, profile: Profile, today: string): RedactedContext {
  return {
    task: 'parse_cash_flow_question',
    question: question.slice(0, 500),
    categories: [...FLEXIBLE_CATEGORIES],
    goal_names: ['Emergency fund', ...profile.goals.map((g) => g.name)],
    recurring_merchant_names: model.leaks.filter((l) => l.kind !== 'possible_duplicate').map((l) => l.label),
    today,
    raw_narration: null,
    account_number: null,
    balance: null,
    full_statement: null,
  }
}

const SYSTEM = `You convert one question about personal cash flow into structured parameters for a deterministic simulator.
Rules:
- Only copy numbers the user explicitly stated. Never calculate, estimate, convert or invent a number. Use null when not stated.
- "kind" is "scenario" for any what-if or goal question, otherwise "runway", "leaks", "drift", "monthly" or "unknown".
- Category names must come from the provided list. Merchant names in "cancel" must come from the provided recurring merchant list; use "flagged" to mean the ones the app has flagged.
- "goal" must be one of the provided goal names, or null.
- "deadline" is YYYY-MM if the user gave a month and year, else null.
- If the question asks which security, fund, deposit, insurance product or loan to choose, use kind "unknown".`

/** Calls Claude for intent parsing only. Returns null on refusal or failure; the caller falls back to the local parser. */
export async function parseIntentWithClaude(apiKey: string, ctx: RedactedContext, model: Model, profile: Profile): Promise<Intent | null> {
  const [{ default: Anthropic }, { z }, { zodOutputFormat }] = await Promise.all([import('@anthropic-ai/sdk'), import('zod'), import('@anthropic-ai/sdk/helpers/zod')])
  const Schema = z.object({
    kind: z.enum(['scenario', 'runway', 'leaks', 'drift', 'monthly', 'unknown']),
    rent_increase_rupees: z.number().nullable(),
    rent_increase_percent: z.number().nullable(),
    emi_increase_rupees: z.number().nullable(),
    emi_increase_percent: z.number().nullable(),
    family_support_extra_rupees: z.number().nullable(),
    cut_category: z.string().nullable(),
    cut_category_percent: z.number().nullable(),
    cap_category: z.string().nullable(),
    cap_rupees: z.number().nullable(),
    cut_all_flexible_percent: z.number().nullable(),
    cancel: z.array(z.string()),
    months_without_salary: z.number().nullable(),
    one_off_expense_rupees: z.number().nullable(),
    goal: z.string().nullable(),
    deadline: z.string().nullable(),
    protect_goal: z.boolean(),
  })
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const response = await client.messages.parse({
    model: LLM_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(ctx) }],
    output_config: { effort: 'low', format: zodOutputFormat(Schema) },
  })
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null
  const p = response.parsed_output
  if (p.kind !== 'scenario') return { kind: p.kind } as Intent

  // map to the planner's intent; labels are formatted locally, nothing computed by the model
  const sim: Partial<SimState> = { ...DEFAULT_SIM }
  const levers: string[] = []
  const caps: { category: FlexibleCategory; amount: number }[] = []
  const extra: string[] = []
  const addExtra = (n: number, label: string) => {
    sim.extraEssential = (sim.extraEssential ?? 0) + n
    extra.push(label)
    levers.push(label)
  }
  if (p.rent_increase_rupees) addExtra(p.rent_increase_rupees, `Rent +${formatINR(p.rent_increase_rupees)}/month`)
  if (p.rent_increase_percent) {
    sim.rentStressPct = p.rent_increase_percent
    levers.push(`Rent +${p.rent_increase_percent}%`)
  }
  if (p.emi_increase_rupees) addExtra(p.emi_increase_rupees, `EMI +${formatINR(p.emi_increase_rupees)}/month`)
  if (p.emi_increase_percent) {
    sim.emiStressPct = p.emi_increase_percent
    levers.push(`EMIs +${p.emi_increase_percent}%`)
  }
  if (p.family_support_extra_rupees) addExtra(p.family_support_extra_rupees, `Family support +${formatINR(p.family_support_extra_rupees)}/month`)
  if (extra.length) sim.extraEssentialLabel = extra.join(', ')
  const cat = (s: string | null) => (FLEXIBLE_CATEGORIES as readonly string[]).includes(s ?? '') ? (s as FlexibleCategory) : null
  if (cat(p.cut_category) && p.cut_category_percent) {
    sim.catCut = { category: cat(p.cut_category)!, pct: Math.min(100, p.cut_category_percent) }
    levers.push(`Cut ${sim.catCut.category} ${sim.catCut.pct}%`)
  }
  if (cat(p.cap_category) && p.cap_rupees != null) caps.push({ category: cat(p.cap_category)!, amount: p.cap_rupees })
  if (p.cut_all_flexible_percent) {
    sim.cutPct = Math.min(50, p.cut_all_flexible_percent)
    levers.push(`Cut all flexible spending ${sim.cutPct}%`)
  }
  const leaks = model.leaks.filter((l) => l.kind !== 'possible_duplicate')
  const picked = p.cancel.includes('flagged') ? leaks.filter((l) => l.unused || (l.category == null && (l.isNew || l.kind === 'mandate'))) : leaks.filter((l) => p.cancel.some((c) => c.toLowerCase() === l.label.toLowerCase()))
  if (picked.length) {
    sim.disabledLeaks = picked.map((l) => l.id)
    levers.push(`Cancel ${picked.map((l) => l.label).join(', ')}`)
  }
  if (p.months_without_salary) {
    sim.incomeGapMonths = Math.min(3, Math.max(0, Math.round(p.months_without_salary)))
    levers.push(`${sim.incomeGapMonths} months without salary`)
  }
  if (p.one_off_expense_rupees) {
    sim.shockExpense = p.one_off_expense_rupees
    levers.push(`One-off expense of ${formatINR(p.one_off_expense_rupees)}`)
  }
  const goalRef = p.goal == null ? null : /emergency/i.test(p.goal) ? 'emergency' : (profile.goals.find((g) => g.name.toLowerCase() === p.goal!.toLowerCase())?.id ?? null)
  let deadline: string | null = null
  const dm = p.deadline?.match(/^(\d{4})-(\d{2})$/)
  if (dm) {
    const y = +dm[1]
    const m = +dm[2]
    deadline = `${dm[1]}-${dm[2]}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  }
  return { kind: 'scenario', sim, levers, goalRef, deadline, protect: p.protect_goal, caps }
}
