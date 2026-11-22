import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { todayISO } from '../lib/dates'
import {
  addTxns,
  clearEverything,
  db,
  deleteBatch,
  deleteRule,
  flagDuplicates,
  mergeProfile,
  mergeSim,
  putRule,
  saveDecisions,
  saveDismissed,
  saveMeta,
  saveProfile,
  saveScenarios,
  saveSim,
  setKV,
  type Meta,
} from '../lib/db'
import { buildModel, type Model } from '../lib/engine/model'
import { parseIntentWithClaude, redact } from '../lib/agents/llm'
import { handle, type Reply } from '../lib/agents/supervisor'
import { buildTriage, type TriageAction, type TriageChoice, type TriageItem } from '../lib/agents/triage'
import { Tracer, type Approval, type TraceEvent } from '../lib/agents/types'
import { formatINR } from '../lib/format'
import { buildNudges, computePace, type Nudge, type PaceReport } from '../lib/engine/nudges'
import { buildTxns, type BuildOptions, type BuildResult } from '../lib/ingest/build'
import { uid } from '../lib/ingest/ids'
import type { RawRecord } from '../lib/ingest/statement'
import { reconcile, type Reconciliation } from '../lib/ingest/reconcile'
import { sampleProfile, sampleRecords, sampleTxns } from '../lib/sample'
import {
  DEFAULT_SIM,
  type EmergencyFund,
  type Goal,
  type LeakDecision,
  type Profile,
  type Rule,
  type SavedScenario,
  type SimState,
  type Txn,
} from '../lib/types'

export interface Toast {
  id: number
  title: string
  detail?: string
  tone?: 'ok' | 'warn' | 'info'
  action?: { label: string; run: () => void }
}

export interface SavedReconciliation {
  batchId: string
  label: string
  at: string
  rec: Reconciliation
}

interface Store {
  ready: boolean
  txns: Txn[]
  rules: Rule[]
  profile: Profile
  sim: SimState
  scenarios: SavedScenario[]
  decisions: Record<string, LeakDecision>
  meta: Meta
  model: Model
  computeMs: number
  toasts: Toast[]
  notify: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
  patchProfile: (p: Partial<Profile>) => void
  patchEmergency: (e: Partial<EmergencyFund>) => void
  upsertGoal: (g: Goal) => void
  removeGoal: (id: string) => void
  pace: PaceReport | null
  /** nudges not dismissed */
  nudges: Nudge[]
  dismissedNudges: Nudge[]
  dismissNudge: (id: string) => void
  restoreNudge: (id: string) => void
  patchSim: (s: Partial<SimState>) => void
  resetSim: () => void
  addRule: (r: Omit<Rule, 'id' | 'createdAt'>) => Promise<Rule>
  updateRule: (r: Rule) => Promise<void>
  removeRule: (id: string) => Promise<void>
  importRecords: (
    records: RawRecord[],
    opts: Omit<BuildOptions, 'batchId' | 'importedAt'>,
    check?: { label: string; reconciliation: Reconciliation | null },
  ) => Promise<BuildResult>
  /** balance reconciliation of each imported bank statement */
  reconciliations: SavedReconciliation[]
  /** load a plan into the simulator and open it */
  applyPlan: (s: Partial<SimState>) => void
  // ---- agents
  traces: TraceEvent[]
  logTrace: (e: TraceEvent) => void
  setApproval: (traceId: string, a: Approval) => void
  clearTraces: () => void
  triage: TriageItem[]
  answerTriage: (item: TriageItem, action: TriageAction, choice: TriageChoice) => Promise<void>
  /** Ask Runway: optional Claude intent parsing, consent-gated */
  llm: { enabled: boolean; apiKey: string }
  setLlm: (l: { enabled: boolean; apiKey: string }) => void
  ask: (question: string) => Promise<Reply>
  removeTxn: (id: string) => Promise<void>
  loadSample: () => Promise<void>
  clearAll: () => Promise<void>
  setDecision: (leakId: string, d: LeakDecision | null) => void
  saveScenario: (name: string) => void
  deleteScenario: (id: string) => void
  applyScenario: (s: SavedScenario) => void
}

const Ctx = createContext<Store | null>(null)

const DEFAULT_META: Meta = { sampleLoaded: false, lastImportAt: null }

export function StoreProvider({ children }: { children: ReactNode }) {
  const txnsQ = useLiveQuery(() => db.transactions.toArray(), [])
  const rulesQ = useLiveQuery(() => db.rules.toArray(), [])
  const kvQ = useLiveQuery(() => db.kv.toArray(), [])
  const loaded = txnsQ !== undefined && rulesQ !== undefined && kvQ !== undefined

  const kv = useMemo(() => Object.fromEntries((kvQ ?? []).map((r) => [r.key, r.value])), [kvQ])
  const storedProfile = useMemo(() => mergeProfile(kv.profile), [kv.profile])
  const scenarios = (kv.scenarios as SavedScenario[] | undefined) ?? []
  const decisions = (kv.leakDecisions as Record<string, LeakDecision> | undefined) ?? {}
  const meta = { ...DEFAULT_META, ...((kv.meta as Partial<Meta>) ?? {}) }
  const traces = useMemo(() => (kv.agentTrace as TraceEvent[] | undefined) ?? [], [kv.agentTrace])
  const triageDecided = useMemo(() => (kv.triageDecisions as Record<string, TriageChoice> | undefined) ?? {}, [kv.triageDecisions])
  const reconciliations = useMemo(() => (kv.reconciliations as SavedReconciliation[] | undefined) ?? [], [kv.reconciliations])
  const dismissed = useMemo(() => new Set((kv.dismissedNudges as string[] | undefined) ?? []), [kv.dismissedNudges])

  // Profile and simulator state are edited at slider speed: keep them in React, persist with a short debounce.
  const [profile, setProfileState] = useState<Profile>(storedProfile)
  const [sim, setSimState] = useState<SimState>(DEFAULT_SIM)
  // "ready" only after profile + sim are copied into React state; otherwise screens would see one
  // render with an empty profile and (for profile-only users) redirect away from their data.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!loaded || hydrated) return
    setProfileState(mergeProfile(kv.profile))
    setSimState(mergeSim(kv.sim))
    setHydrated(true)
  }, [loaded, hydrated, kv.profile, kv.sim])
  const ready = loaded && hydrated

  const profileTimer = useRef<number | undefined>(undefined)
  const simTimer = useRef<number | undefined>(undefined)
  const persistProfile = (p: Profile) => {
    window.clearTimeout(profileTimer.current)
    profileTimer.current = window.setTimeout(() => void saveProfile(p), 250)
  }
  const persistSim = (s: SimState) => {
    window.clearTimeout(simTimer.current)
    simTimer.current = window.setTimeout(() => void saveSim(s), 250)
  }

  const patchProfile = useCallback((p: Partial<Profile>) => {
    setProfileState((prev) => {
      const next = { ...prev, ...p }
      persistProfile(next)
      return next
    })
  }, [])
  const patchEmergency = useCallback((e: Partial<EmergencyFund>) => {
    setProfileState((prev) => {
      const next = { ...prev, emergency: { ...prev.emergency, ...e } }
      persistProfile(next)
      return next
    })
  }, [])
  const upsertGoal = useCallback((g: Goal) => {
    setProfileState((prev) => {
      const exists = prev.goals.some((x) => x.id === g.id)
      const next = { ...prev, goals: exists ? prev.goals.map((x) => (x.id === g.id ? g : x)) : [...prev.goals, g] }
      persistProfile(next)
      return next
    })
  }, [])
  const removeGoal = useCallback((id: string) => {
    setProfileState((prev) => {
      const next = { ...prev, goals: prev.goals.filter((x) => x.id !== id) }
      persistProfile(next)
      return next
    })
  }, [])
  const patchSim = useCallback((s: Partial<SimState>) => {
    setSimState((prev) => {
      const next = { ...prev, ...s }
      persistSim(next)
      return next
    })
  }, [])
  const resetSim = useCallback(() => {
    setSimState(DEFAULT_SIM)
    persistSim(DEFAULT_SIM)
  }, [])

  // ---- toasts
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const notify = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev.slice(-2), { ...t, id }])
      window.setTimeout(() => dismiss(id), t.action ? 8000 : 5200)
    },
    [dismiss],
  )

  // ---- the model: a pure function of everything above
  const txns = txnsQ ?? []
  const rules = rulesQ ?? []
  const today = todayISO()
  const { model, computeMs } = useMemo(() => {
    const t0 = performance.now()
    const model = buildModel({ txns, rules, profile, sim, today })
    return { model, computeMs: performance.now() - t0 }
  }, [txns, rules, profile, sim, today])

  // ---- drift: payday pace and nudges, also pure functions of the model
  // drift is about real spending against usual spending, never against a simulation
  const pace = useMemo(() => computePace(model, DEFAULT_SIM), [model])
  const allNudges = useMemo(() => buildNudges(model, profile, pace, decisions), [model, profile, pace, decisions])
  const nudges = useMemo(() => allNudges.filter((n) => !dismissed.has(n.id)), [allNudges, dismissed])
  const dismissedNudges = useMemo(() => allNudges.filter((n) => dismissed.has(n.id)), [allNudges, dismissed])
  const dismissNudge = useCallback((id: string) => void saveDismissed([...dismissed, id]), [dismissed])
  const restoreNudge = useCallback((id: string) => void saveDismissed([...dismissed].filter((x) => x !== id)), [dismissed])

  // ---- actions
  const addRule = useCallback(async (r: Omit<Rule, 'id' | 'createdAt'>) => {
    const rule: Rule = { ...r, token: r.matchType === 'contains' ? r.token.trim().toLowerCase() : r.token, id: uid('rule'), createdAt: new Date().toISOString() }
    await putRule(rule)
    return rule
  }, [])
  const updateRule = useCallback(async (r: Rule) => {
    await putRule({ ...r, token: r.matchType === 'contains' ? r.token.trim().toLowerCase() : r.token })
  }, [])
  const removeRule = useCallback(async (id: string) => deleteRule(id), [])

  const importRecords = useCallback(
    async (records: RawRecord[], opts: Omit<BuildOptions, 'batchId' | 'importedAt'>, check?: { label: string; reconciliation: Reconciliation | null }) => {
      const existing = await db.transactions.toArray()
      const importedAt = new Date().toISOString()
      const batchId = uid('batch')
      const res = buildTxns(records, { ...opts, batchId, importedAt }, existing)
      await addTxns(res.txns)
      if (check?.reconciliation) await setKV('reconciliations', [...reconciliations, { batchId, label: check.label, at: importedAt, rec: check.reconciliation }].slice(-10))
      await flagDuplicates(res.supersededIds)
      await saveMeta({ ...meta, lastImportAt: importedAt })
      return res
    },
    [meta, reconciliations],
  )

  const removeTxn = useCallback(async (id: string) => {
    await db.transactions.delete(id)
  }, [])

  const loadSample = useCallback(async () => {
    await deleteBatch('sample')
    // a fresh demo: if only sample data was loaded, demo rules, scenarios and decisions go too
    const others = await db.transactions.count()
    if (others === 0) {
      await db.rules.clear()
      await saveScenarios([])
      await saveDismissed([])
    }
    await addTxns(sampleTxns())
    const rec = reconcile(sampleRecords().bank)
    await setKV('reconciliations', rec ? [{ batchId: 'sample-bank', label: 'Sample bank statement', at: new Date().toISOString(), rec }] : [])
    const p = sampleProfile()
    setProfileState(p)
    await saveProfile(p)
    setSimState(DEFAULT_SIM)
    await saveSim(DEFAULT_SIM)
    await saveDecisions({})
    await saveMeta({ ...meta, sampleLoaded: true })
  }, [meta])

  const clearAll = useCallback(async () => {
    await clearEverything()
    setProfileState(mergeProfile(undefined))
    setSimState(DEFAULT_SIM)
  }, [])

  const setDecision = useCallback(
    (leakId: string, d: LeakDecision | null) => {
      const next = { ...decisions }
      if (d) next[leakId] = d
      else delete next[leakId]
      void saveDecisions(next)
      // "cancel" is a planning decision: it feeds the simulator, nothing is cancelled for real
      setSimState((prev) => {
        const set = new Set(prev.disabledLeaks)
        if (d === 'cancel') set.add(leakId)
        else set.delete(leakId)
        const s = { ...prev, disabledLeaks: [...set] }
        persistSim(s)
        return s
      })
    },
    [decisions],
  )

  const saveScenario = useCallback(
    (name: string) => {
      const s: SavedScenario = { id: uid('scn'), name: name.trim() || `Scenario ${scenarios.length + 1}`, sim, createdAt: new Date().toISOString() }
      void saveScenarios([...scenarios, s])
    },
    [scenarios, sim],
  )
  const deleteScenario = useCallback((id: string) => void saveScenarios(scenarios.filter((s) => s.id !== id)), [scenarios])
  const applyScenario = useCallback((s: SavedScenario) => {
    const next = mergeSim(s.sim)
    setSimState(next)
    persistSim(next)
  }, [])

  // ---- agents
  const traceRef = useRef<TraceEvent[]>([])
  traceRef.current = traces
  const logTrace = useCallback((e: TraceEvent) => {
    const next = [e, ...traceRef.current.filter((t) => t.id !== e.id)].slice(0, 60)
    traceRef.current = next
    void setKV('agentTrace', next)
  }, [])
  const setApproval = useCallback((id: string, a: Approval) => {
    const next = traceRef.current.map((t) => (t.id === id ? { ...t, approval: a } : t))
    traceRef.current = next
    void setKV('agentTrace', next)
  }, [])
  const clearTraces = useCallback(() => {
    traceRef.current = []
    void setKV('agentTrace', [])
  }, [])

  const triage = useMemo(() => buildTriage(model, triageDecided), [model, triageDecided])

  const answerTriage = useCallback(
    async (item: TriageItem, action: TriageAction, choice: TriageChoice) => {
      const tr = new Tracer('Insight & Triage', 'User answered a question', item.question)
      tr.plan('Turn the answer into a reusable rule', 'Recompute the model', 'Report what changed')
      const before = model.baseline
      const saved: Rule[] = []
      for (const r of action.rules) {
        const rule = await tr.call('save_learned_rule', { match: r.matchType === 'txn' ? 'this transaction' : `${r.matchField ?? 'any'} contains "${r.token}"`, category: r.category }, () => r, () => `${r.category}`)
        saved.push({ ...rule, id: uid('rule'), createdAt: new Date().toISOString(), token: rule.matchType === 'contains' ? rule.token.trim().toLowerCase() : rule.token })
      }
      for (const r of saved) await putRule(r)
      if (action.leakDecision) setDecision(action.leakDecision.id, action.leakDecision.decision)
      const after = tr.call('recompute_model', { rules: rules.length + saved.length }, () => buildModel({ txns, rules: [...rules, ...saved], profile, sim: DEFAULT_SIM, today }).baseline, (b) => `flexible ${formatINR(b.fs)}, surplus ${b.surplus != null ? formatINR(b.surplus) : '—'}`)
      await setKV('triageDecisions', { ...triageDecided, [item.id]: choice })
      const dFs = after.fs - before.fs
      const dSur = after.surplus != null && before.surplus != null ? after.surplus - before.surplus : null
      tr.result(`Answer: ${action.label}`)
      if (Math.abs(dFs) >= 1) tr.result(`Flexible spending ${dFs < 0 ? 'down' : 'up'} ${formatINR(Math.abs(dFs))}/month; monthly surplus ${dSur != null ? `${dSur >= 0 ? '+' : '−'}${formatINR(Math.abs(dSur))}` : 'unchanged'}`)
      if (saved.some((r) => r.matchType === 'contains')) tr.result('Saved as a rule: future imports will use it too')
      tr.approval('approved').local()
      logTrace(tr.done())
      notify({ title: 'Got it', detail: tr.event.result.slice(1).join(' · ') || action.label, action: saved.length ? { label: 'Undo', run: () => saved.forEach((r) => void deleteRule(r.id)) } : undefined })
    },
    [model, rules, txns, profile, today, triageDecided, logTrace, notify],
  )

  const [llm, setLlmState] = useState<{ enabled: boolean; apiKey: string }>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('runway.llm') ?? '') as { enabled: boolean; apiKey: string }
    } catch {
      return { enabled: false, apiKey: '' }
    }
  })
  const setLlm = useCallback((l: { enabled: boolean; apiKey: string }) => {
    setLlmState(l)
    // session only: the key is forgotten when the tab closes
    sessionStorage.setItem('runway.llm', JSON.stringify(l))
  }, [])

  const ask = useCallback(
    async (question: string) => {
      const ctx = { model, profile, rules, decisions, nudges }
      let reply: Reply
      if (llm.enabled && llm.apiKey) {
        const payload = redact(question, model, profile, today)
        let intent = null
        let failure: string | null = null
        try {
          intent = await parseIntentWithClaude(llm.apiKey, payload, model, profile)
          if (!intent) failure = 'Claude declined or returned no structured result; used the local parser'
        } catch (e) {
          failure = `Ask Runway call failed (${e instanceof Error ? e.message.slice(0, 80) : 'error'}); used the local parser`
        }
        reply = intent ? handle(question, ctx, { intent, mode: 'llm' }) : handle(question, ctx)
        reply.trace.calls.unshift({ tool: 'llm_parse_intent', args: { model: 'claude-opus-5-5', sent: Object.keys(payload).filter((k) => (payload as unknown as Record<string, unknown>)[k] != null) }, summary: intent ? 'structured parameters returned' : failure ?? 'no result', ok: !!intent, ms: 0 })
        reply.trace.guardrails.unshift({ rule: 'Only the question and category/goal/merchant names were sent (no amounts, narrations, UPI IDs, balances or account numbers)', passed: true })
        if (failure) reply.trace.verification.unshift(failure)
      } else {
        reply = handle(question, ctx)
      }
      logTrace(reply.trace)
      return reply
    },
    [model, profile, rules, decisions, nudges, llm, today, logTrace],
  )

  const value: Store = {
    ready,
    txns,
    rules,
    profile,
    sim,
    scenarios,
    decisions,
    meta,
    model,
    computeMs,
    toasts,
    notify,
    dismiss,
    patchProfile,
    patchEmergency,
    upsertGoal,
    removeGoal,
    pace,
    nudges,
    dismissedNudges,
    dismissNudge,
    restoreNudge,
    patchSim,
    resetSim,
    addRule,
    updateRule,
    removeRule,
    importRecords,
    removeTxn,
    loadSample,
    clearAll,
    setDecision,
    saveScenario,
    deleteScenario,
    applyScenario,
    reconciliations,
    traces,
    logTrace,
    setApproval,
    clearTraces,
    triage,
    answerTriage,
    llm,
    setLlm,
    ask,
    applyPlan: (s: Partial<SimState>) => {
      const next = mergeSim({ ...DEFAULT_SIM, ...s })
      setSimState(next)
      persistSim(next)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}
