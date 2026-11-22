import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { go } from '../../app/router'
import { useStore } from '../../app/store'
import { todayISO } from '../../lib/dates'
import type { GoalProjection } from '../../lib/engine/model'
import { formatINR } from '../../lib/format'
import { uid } from '../../lib/ingest/ids'
import {
  ALL_CATEGORIES,
  LINE_TO_CATEGORY,
  type Category,
  type Goal,
  type ProfileLines,
  type RiskPreference,
} from '../../lib/types'
import { GoalRow } from '../financial/GoalStatus'
import { Button, MoneyInput, Segmented } from '../ui'

const ESSENTIAL_FIELDS: { key: Exclude<keyof ProfileLines, 'flexible'>; label: string }[] = [
  { key: 'rent', label: 'Rent (your share)' },
  { key: 'emi', label: 'EMIs, all loans' },
  { key: 'utilities', label: 'Utilities & phone' },
  { key: 'groceries', label: 'Groceries' },
  { key: 'familySupport', label: 'Family support' },
  { key: 'insurance', label: 'Insurance premiums' },
  { key: 'transport', label: 'Minimum transport' },
]

const dateInput = 'mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm [color-scheme:dark] focus:border-amber focus:outline-none'

export function IncomeAndCosts() {
  const { profile, patchProfile, model } = useStore()
  const stmt = (cat: string) => model.base.essential.find((l) => l.category === cat)?.fromStatements ?? 0
  const flexStmt = model.base.flexible.reduce((a, l) => a + l.fromStatements, 0)
  const latestBalance = [...model.active].filter((t) => t.balanceAfter != null && t.statementType !== 'card').sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.balanceAfter ?? null
  const hint = (v: number) => (model.hasTransactions && v > 0 ? `Statements say ${formatINR(v)}/mo. Leave blank to use that.` : 'Monthly amount')

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel space-y-5 p-5">
        <h3 className="display text-xl uppercase">Income & cash</h3>
        <MoneyInput
          label="Monthly net take-home"
          value={profile.takeHome}
          onChange={(v) => patchProfile({ takeHome: v })}
          placeholder={model.salary ? String(model.salary.takeHome) : '68000'}
          hint={model.salary ? `Detected ${formatINR(model.salary.takeHome)} from "${model.salary.label}" (${model.salary.confidence} confidence). Leave blank to use it.` : 'After tax and deductions: what lands in your account. Not CTC.'}
        />
        <MoneyInput
          label="Accessible cash"
          value={profile.accessibleCash}
          onChange={(v) => patchProfile({ accessibleCash: v })}
          placeholder={latestBalance != null ? String(latestBalance) : '105000'}
          hint={latestBalance != null ? `Your latest statement balance is ${formatINR(latestBalance)}. Count only money you can use today.` : 'Savings you can use today. Not investments, retirement accounts or credit limits.'}
        />
        {latestBalance != null && profile.accessibleCash == null && (
          <Button size="sm" onClick={() => patchProfile({ accessibleCash: latestBalance })}>Use statement balance</Button>
        )}
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#e3a548]" checked={profile.includeFD} onChange={(e) => patchProfile({ includeFD: e.target.checked })} />
          Include breakable fixed deposits
        </label>
        {profile.includeFD && (
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyInput label="FD amount" value={profile.fdAmount} allowNull={false} onChange={(v) => patchProfile({ fdAmount: v ?? 0 })} />
            <label className="block">
              <span className="label">Haircut for penalty / lock-in</span>
              <div className="mt-1.5 flex items-center border-b border-line-strong">
                <input type="number" min={0} max={50} value={profile.fdHaircutPct} onChange={(e) => patchProfile({ fdHaircutPct: Math.max(0, Math.min(50, Number(e.target.value))) })} className="tnum h-10 w-full bg-transparent font-mono" />
                <span className="font-mono text-dim">%</span>
              </div>
              <span className="mt-1 block text-xs text-warn">May have a penalty or lock-in. Counted at {100 - profile.fdHaircutPct}%.</span>
            </label>
          </div>
        )}
        <label className="block">
          <span className="label">Payday (day of month)</span>
          <input
            type="number"
            min={1}
            max={31}
            placeholder={model.salary ? String(model.salary.payday) : '1'}
            value={profile.payday ?? ''}
            onChange={(e) => patchProfile({ payday: e.target.value === '' ? null : Math.max(1, Math.min(31, Number(e.target.value))) })}
            className="tnum mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono placeholder:text-dim/70 focus:border-amber focus:outline-none"
          />
          <span className="mt-1 block text-xs text-dim">Nudges pace your spending from payday to payday{model.salary ? ` (detected: day ${model.salary.payday})` : ''}.</span>
        </label>
      </section>

      <section className="panel space-y-5 p-5">
        <h3 className="display text-xl uppercase">Essentials & spending</h3>
        <p className="-mt-3 text-sm text-muted">A figure you type here replaces what the statements imply for that line.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ESSENTIAL_FIELDS.map((f) => (
            <MoneyInput
              key={f.key}
              label={f.label}
              value={profile[f.key]}
              onChange={(v) => patchProfile({ [f.key]: v } as Partial<ProfileLines>)}
              placeholder={stmt(LINE_TO_CATEGORY[f.key]) > 0 ? String(Math.round(stmt(LINE_TO_CATEGORY[f.key]))) : '0'}
              hint={hint(stmt(LINE_TO_CATEGORY[f.key]))}
            />
          ))}
          <MoneyInput
            label="Flexible spending, total"
            value={profile.flexible}
            onChange={(v) => patchProfile({ flexible: v })}
            placeholder={flexStmt > 0 ? String(Math.round(flexStmt)) : '0'}
            hint={model.hasTransactions && flexStmt > 0 ? `Statements say ${formatINR(flexStmt)}/mo.` : 'Dining, delivery, shopping, travel, subscriptions.'}
          />
        </div>
      </section>
    </div>
  )
}

export function EmergencyFundEditor() {
  const { profile, patchEmergency, model } = useStore()
  const ef = profile.emergency
  const proj = model.baseline.emergency
  return (
    <section className="panel space-y-5 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="display text-xl uppercase">Emergency fund</h3>
        <p className="font-mono text-xs text-dim">Funded first, before other goals</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className="label">Months of essentials</span>
          <input type="number" min={1} max={24} value={ef.months} onChange={(e) => patchEmergency({ months: Math.max(1, Math.min(24, Number(e.target.value))) })} className="tnum mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono focus:border-amber focus:outline-none" />
          <span className="mt-1 block text-xs text-dim">{ef.months} × {formatINR(model.base.emb)} = {formatINR(ef.months * model.base.emb)}</span>
        </label>
        <MoneyInput label="Target (override)" value={ef.targetOverride} onChange={(v) => patchEmergency({ targetOverride: v })} placeholder={String(Math.round(ef.months * model.base.emb))} hint="Blank = months × essential burn." />
        <MoneyInput label="Current fund balance" value={ef.balance} onChange={(v) => patchEmergency({ balance: v })} placeholder={model.cash != null ? String(Math.round(model.cash)) : ''} hint="Blank = your accessible cash." />
        <label className="block">
          <span className="label">Target date</span>
          <input type="date" value={ef.targetDate ?? ''} min={todayISO()} onChange={(e) => patchEmergency({ targetDate: e.target.value || null })} className={dateInput} />
        </label>
        <MoneyInput label="Monthly contribution" value={ef.monthlyContribution} onChange={(v) => patchEmergency({ monthlyContribution: v })} placeholder={proj.contribution != null ? String(Math.round(proj.contribution)) : ''} hint="Blank = share of the surplus." />
      </div>
      <div className="border-t border-line pt-4">
        <GoalRow g={proj} />
      </div>
    </section>
  )
}

export function GoalsEditor() {
  const { profile, upsertGoal, removeGoal, model } = useStore()
  const proj = new Map(model.baseline.goals.map((g) => [g.id, g]))
  const add = () =>
    upsertGoal({ id: uid('goal'), name: 'New goal', type: 'custom', target: null, saved: 0, targetDate: null, monthlyContribution: null })
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="display text-2xl uppercase">Dated goals</h3>
        <Button variant="ghost" size="sm" onClick={add}><Plus size={13} /> Add goal</Button>
      </div>
      <p className="text-sm text-muted">The surplus goes to the emergency fund first, then to goals in this order. Goals with a contribution you set get it first; the rest share what is left.</p>
      {profile.goals.length === 0 && <p className="panel p-5 text-sm text-dim">No other goals yet. Add one with a target date to see whether you are on track.</p>}
      {profile.goals.map((g) => (
        <GoalCard key={g.id} g={g} onChange={upsertGoal} onRemove={() => removeGoal(g.id)} projection={proj.get(g.id)} />
      ))}
    </section>
  )
}

function GoalCard({ g, onChange, onRemove, projection }: { g: Goal; onChange: (g: Goal) => void; onRemove: () => void; projection?: GoalProjection }) {
  const set = (p: Partial<Goal>) => onChange({ ...g, ...p })
  return (
    <div className="panel space-y-4 p-5">
      <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_auto_1fr_1fr_1fr_1fr_auto]">
        <label className="block">
          <span className="label">Goal name</span>
          <input value={g.name} onChange={(e) => set({ name: e.target.value })} className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent text-text focus:border-amber focus:outline-none" />
        </label>
        <Segmented label="Goal type" value={g.type} onChange={(type) => set({ type })} options={[{ value: 'custom', label: 'Savings' }, { value: 'debt', label: 'Card debt' }]} />
        <MoneyInput label={g.type === 'debt' ? 'Debt to clear' : 'Target'} value={g.target} onChange={(v) => set({ target: v })} />
        <MoneyInput label={g.type === 'debt' ? 'Set aside' : 'Saved'} value={g.saved} onChange={(v) => set({ saved: v })} />
        <label className="block">
          <span className="label">Target date</span>
          <input type="date" value={g.targetDate ?? ''} min={todayISO()} onChange={(e) => set({ targetDate: e.target.value || null })} className={dateInput} />
        </label>
        <MoneyInput label="Per month" value={g.monthlyContribution} onChange={(v) => set({ monthlyContribution: v })} hint="Blank = shared" />
        <button type="button" onClick={onRemove} aria-label={`Remove ${g.name}`} className="mb-2 p-2 text-dim hover:text-rose"><Trash2 size={15} /></button>
      </div>
      {projection ? <div className="border-t border-line pt-4"><GoalRow g={projection} /></div> : null}
      {g.type === 'debt' && <p className="text-xs text-dim">A simple payoff timeline. Interest on the balance is not modelled, so the real date will be later.</p>}
    </div>
  )
}

export function Preferences() {
  const { profile, patchProfile } = useStore()
  return (
    <section className="panel grid gap-6 p-5 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="display text-xl uppercase">Comfort with risk</h3>
        <Segmented<RiskPreference> label="Risk preference" value={profile.risk} onChange={(risk) => patchProfile({ risk })} options={[{ value: 'conservative', label: 'Conservative' }, { value: 'balanced', label: 'Balanced' }]} />
        <p className="text-sm text-muted">
          {profile.risk === 'conservative'
            ? 'Shapes wording only: tips lean towards a larger cash buffer before other goals. Many people in single-income households aim for six months of essentials.'
            : 'Shapes wording only: tips treat three to six months of essentials as a common range for a buffer.'}{' '}
          It never changes the numbers and Runway never suggests a product.
        </p>
      </div>
      <div className="space-y-3">
        <h3 className="display text-xl uppercase">Runway alert</h3>
        <label className="block">
          <span className="label">Warn me when survival runway is below</span>
          <div className="mt-1.5 flex items-center border-b border-line-strong">
            <input type="number" min={1} max={12} value={profile.runwayAlertMonths} onChange={(e) => patchProfile({ runwayAlertMonths: Math.max(1, Math.min(12, Number(e.target.value))) })} className="tnum h-10 w-full bg-transparent font-mono focus:outline-none" />
            <span className="font-mono text-dim">months</span>
          </div>
        </label>
      </div>
    </section>
  )
}

export function QuickAdd() {
  const { importRecords, notify, addRule } = useStore()
  const [date, setDate] = useState(todayISO())
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit')
  const [category, setCategory] = useState<Category | ''>('')

  const add = async () => {
    if (!desc.trim() || !amount || amount <= 0) return
    const res = await importRecords([{ date, postedDate: null, rawDescription: desc.trim(), reference: null, amount, direction, balanceAfter: null }], { source: 'manual', statementType: null })
    if (category && res.txns[0]) await addRule({ matchType: 'txn', token: res.txns[0].id, category, label: desc.trim() })
    notify({ title: 'Transaction added', detail: `${desc.trim()} · ${formatINR(amount)}` })
    setDesc('')
    setAmount(null)
    setCategory('')
  }

  return (
    <section className="panel p-5">
      <h3 className="display text-xl uppercase">Quick add a transaction</h3>
      <p className="mt-1 text-sm text-muted">For cash spends or anything missing from your statements.</p>
      <div className="mt-4 grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[auto_1.5fr_1fr_auto_1fr_auto]">
        <label className="block">
          <span className="label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dateInput} />
        </label>
        <label className="block">
          <span className="label">Description</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Maid salary, cash" className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent text-text placeholder:text-dim/70 focus:border-amber focus:outline-none" />
        </label>
        <MoneyInput label="Amount" value={amount} onChange={setAmount} />
        <Segmented label="Direction" value={direction} onChange={setDirection} options={[{ value: 'debit', label: 'Out' }, { value: 'credit', label: 'In' }]} />
        <label className="block">
          <span className="label">Category</span>
          <select aria-label="Quick add category" value={category} onChange={(e) => setCategory(e.target.value as Category)} className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm">
            <option className="bg-graphite" value="">Let Runway decide</option>
            {ALL_CATEGORIES.map((c) => (
              <option className="bg-graphite" key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <Button variant="ghost" disabled={!desc.trim() || !amount} onClick={add}>Add</Button>
      </div>
    </section>
  )
}

/** The whole persistent profile, used by the Profile page and the import "profile" tab. */
export function ProfileForm() {
  const { model } = useStore()
  return (
    <div className="space-y-6">
      <IncomeAndCosts />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Saved automatically in this browser.</p>
        <Button variant="primary" disabled={model.cash == null} onClick={() => go('overview')}>
          {model.cash == null ? 'Enter accessible cash to continue' : 'See my runway'}
        </Button>
      </div>
      <EmergencyFundEditor />
      <GoalsEditor />
      <Preferences />
      <QuickAdd />
    </div>
  )
}
