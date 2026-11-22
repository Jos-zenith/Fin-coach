// Agent layer types. Agents plan, call deterministic tools, verify, and explain.
// They never do arithmetic themselves: every number comes from a tool output.

export type AgentName = 'Supervisor' | 'Ingestion & Reconciliation' | 'Insight & Triage' | 'Goal Planner' | 'Monthly Review & Drift'

export interface ToolCall {
  tool: string
  args: Record<string, unknown>
  /** short human summary of the output */
  summary: string
  /** structured output, kept small for the trace */
  output?: unknown
  ok: boolean
  ms: number
}

export interface Guardrail {
  rule: string
  passed: boolean
  note?: string
}

export type Approval = 'none' | 'required' | 'approved' | 'declined'

export interface TraceEvent {
  id: string
  at: string
  agent: AgentName
  /** what started it: an import, a question, a correction, a checkpoint */
  trigger: string
  input: string
  /** "local" = no network; "llm" = the user enabled Ask Runway for intent parsing */
  mode: 'local' | 'llm'
  plan: string[]
  calls: ToolCall[]
  /** checks the agent ran on its own tool outputs */
  verification: string[]
  result: string[]
  guardrails: Guardrail[]
  approval: Approval
  status: 'ok' | 'corrected' | 'needs_user' | 'blocked' | 'error'
}

/** Builds a trace while an agent runs, timing each tool call. */
export class Tracer {
  readonly event: TraceEvent
  constructor(agent: AgentName, trigger: string, input: string, mode: 'local' | 'llm' = 'local') {
    this.event = {
      id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      agent,
      trigger,
      input,
      mode,
      plan: [],
      calls: [],
      verification: [],
      result: [],
      guardrails: [],
      approval: 'none',
      status: 'ok',
    }
  }
  plan(...steps: string[]) {
    this.event.plan.push(...steps)
    return this
  }
  /** Runs a deterministic tool and records it. */
  call<T>(tool: string, args: Record<string, unknown>, run: () => T, summarize: (out: T) => string, keep?: (out: T) => unknown): T {
    const t0 = performance.now()
    try {
      const out = run()
      this.event.calls.push({ tool, args, summary: summarize(out), output: keep ? keep(out) : undefined, ok: true, ms: Math.round((performance.now() - t0) * 10) / 10 })
      return out
    } catch (e) {
      this.event.calls.push({ tool, args, summary: e instanceof Error ? e.message : 'failed', ok: false, ms: Math.round((performance.now() - t0) * 10) / 10 })
      throw e
    }
  }
  verify(note: string) {
    this.event.verification.push(note)
    return this
  }
  result(...lines: string[]) {
    this.event.result.push(...lines)
    return this
  }
  guard(rule: string, passed: boolean, note?: string) {
    this.event.guardrails.push({ rule, passed, note })
    return this
  }
  status(s: TraceEvent['status']) {
    this.event.status = s
    return this
  }
  approval(a: Approval) {
    this.event.approval = a
    return this
  }
  /** Standard privacy guardrails for local runs. */
  local() {
    this.guard('No external network request', this.event.mode === 'local', this.event.mode === 'llm' ? 'Ask Runway sent the question only (redacted context)' : undefined)
    this.guard('No raw statement, balance or account number sent anywhere', true)
    return this
  }
  done() {
    return this.event
  }
}
