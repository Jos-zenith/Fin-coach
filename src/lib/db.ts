import Dexie, { type EntityTable } from 'dexie'
import {
  DEFAULT_PROFILE,
  DEFAULT_SIM,
  type LeakDecision,
  type Profile,
  type Rule,
  type SavedScenario,
  type SimState,
  type Txn,
} from './types'

export interface KV {
  key: string
  value: unknown
}

export interface Meta {
  sampleLoaded: boolean
  lastImportAt: string | null
}

/** Everything lives in this browser's IndexedDB. Nothing is sent anywhere. */
class RunwayDB extends Dexie {
  transactions!: EntityTable<Txn, 'id'>
  rules!: EntityTable<Rule, 'id'>
  kv!: EntityTable<KV, 'key'>

  constructor() {
    super('runway-local-first')
    this.version(1).stores({
      transactions: 'id, date, source, batchId',
      rules: 'id, token',
      kv: 'key',
    })
  }
}

export const db = new RunwayDB()

interface LegacyGoal {
  type?: string
  name?: string
  months?: number
  target?: number | null
  saved?: number | null
  monthlyContribution?: number | null
}

/** Fills defaults and upgrades profiles saved by the single-goal version. */
export function mergeProfile(v: unknown): Profile {
  const p = (v ?? {}) as Partial<Profile> & { goal?: LegacyGoal }
  const { goal: legacy, ...rest } = p
  const out: Profile = {
    ...DEFAULT_PROFILE,
    ...rest,
    emergency: { ...DEFAULT_PROFILE.emergency, ...(p.emergency ?? {}) },
    goals: Array.isArray(p.goals) ? p.goals : [],
  }
  if (legacy && !p.emergency) {
    if (legacy.type === 'emergency') out.emergency.months = legacy.months ?? 6
    else if (legacy.type === 'custom' || legacy.type === 'debt')
      out.goals = [{ id: 'goal-legacy', name: legacy.name ?? 'Goal', type: legacy.type, target: legacy.target ?? null, saved: legacy.saved ?? null, targetDate: null, monthlyContribution: legacy.monthlyContribution ?? null }]
  }
  return out
}
export function mergeSim(v: unknown): SimState {
  const s = (v ?? {}) as Partial<SimState>
  return { ...DEFAULT_SIM, ...s, catCut: { ...DEFAULT_SIM.catCut, ...(s.catCut ?? {}) } }
}

export const saveDismissed = (ids: string[]) => setKV('dismissedNudges', ids)

export const setKV = (key: string, value: unknown) => db.kv.put({ key, value })

export const saveProfile = (p: Profile) => setKV('profile', p)
export const saveSim = (s: SimState) => setKV('sim', s)
export const saveScenarios = (s: SavedScenario[]) => setKV('scenarios', s)
export const saveDecisions = (d: Record<string, LeakDecision>) => setKV('leakDecisions', d)
export const saveMeta = (m: Meta) => setKV('meta', m)

export async function addTxns(txns: Txn[]): Promise<void> {
  if (txns.length) await db.transactions.bulkPut(txns)
}

export async function flagDuplicates(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.transaction('rw', db.transactions, async () => {
    for (const id of ids) {
      const t = await db.transactions.get(id)
      if (t && !t.flags.includes('duplicate')) {
        await db.transactions.put({
          ...t,
          flags: [...t.flags.filter((f) => f !== 'needs_review'), 'duplicate'],
          reviewReason: null,
        })
      }
    }
  })
}

export const putRule = (rule: Rule) => db.rules.put(rule)
export const deleteRule = (id: string) => db.rules.delete(id)

export async function deleteBatch(source: Txn['source']): Promise<void> {
  await db.transactions.where('source').equals(source).delete()
}

/** Wipes statements, rules, profile, scenarios and decisions. The privacy "forget me" button. */
export async function clearEverything(): Promise<void> {
  await db.transaction('rw', db.transactions, db.rules, db.kv, async () => {
    await db.transactions.clear()
    await db.rules.clear()
    await db.kv.clear()
  })
}

export interface Snapshot {
  app: 'runway'
  version: 1
  exportedAt: string
  transactions: Txn[]
  rules: Rule[]
  kv: KV[]
}

export async function snapshot(): Promise<Snapshot> {
  const [transactions, rules, kv] = await Promise.all([db.transactions.toArray(), db.rules.toArray(), db.kv.toArray()])
  return { app: 'runway', version: 1, exportedAt: new Date().toISOString(), transactions, rules, kv }
}

export async function restore(s: Snapshot): Promise<void> {
  if (s.app !== 'runway' || s.version !== 1 || !Array.isArray(s.transactions)) throw new Error('This file is not a Runway export.')
  await db.transaction('rw', db.transactions, db.rules, db.kv, async () => {
    await db.transactions.clear()
    await db.rules.clear()
    await db.kv.clear()
    await db.transactions.bulkPut(s.transactions)
    await db.rules.bulkPut(s.rules)
    await db.kv.bulkPut(s.kv)
  })
}
