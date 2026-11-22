import { Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { go } from '../app/router'
import { useStore } from '../app/store'
import { Button, Empty, SectionTitle, Tag } from '../components/ui'
import { formatDateShort } from '../lib/dates'
import { FIELD_LABEL, findRule, ruleMatches } from '../lib/engine/resolve'
import { formatINR } from '../lib/format'
import { classifyBaseline } from '../lib/ingest/sanitize'
import { ALL_CATEGORIES, bucketOf, BUCKET_LABEL, type Category, type Rule, type Txn } from '../lib/types'

export default function Rules() {
  const { rules, model, removeRule, updateRule, notify } = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  const [test, setTest] = useState('UPI-SWIGGY-swiggy@icici-ICIC0DC0099-612345678901-FOOD ORDER')

  const affected = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of model.resolved) if (t.ruleId) m.set(t.ruleId, (m.get(t.ruleId) ?? 0) + 1)
    return m
  }, [model.resolved])

  const sorted = [...rules].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const contains = sorted.filter((r) => r.matchType === 'contains')
  const pins = sorted.filter((r) => r.matchType === 'txn')

  // tester: run the same pipeline a real import would
  const result = useMemo(() => {
    const text = test.trim()
    if (!text) return null
    const base = classifyBaseline({ rawDescription: text, direction: 'debit', amount: 100 })
    const fake = { id: '__test__', merchantGuess: base.merchant, vpa: base.vpa, rawDescription: text } as Txn
    const rule = findRule(fake, contains)
    const candidates = contains.filter((r) => ruleMatches(r, fake))
    return { base, rule, candidates }
  }, [test, contains])

  return (
    <div className="space-y-10">
      <SectionTitle kicker="Rules library · your classification system" title="Rules">
        <p className="max-w-md text-sm text-muted">Every rule is visible and reversible. Newest rule wins when two match; a rule pinned to one transaction beats both.</p>
      </SectionTitle>

      <section className="panel p-5">
        <label htmlFor="tester" className="label">Test a description</label>
        <input
          id="tester"
          value={test}
          onChange={(e) => setTest(e.target.value)}
          className="mt-2 h-11 w-full border-b border-line-strong bg-transparent font-mono text-sm focus:border-amber focus:outline-none"
          placeholder="Paste a statement narration or SMS"
        />
        {result && (
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="label">Extracted</p>
              <p className="mt-1 text-text">{result.base.merchant ?? '—'}</p>
              <p className="font-mono text-xs text-dim">{result.base.vpa ?? 'no UPI ID'}</p>
            </div>
            <div>
              <p className="label">Your rule</p>
              {result.rule ? (
                <p className="mt-1 text-text">
                  <Tag tone="amber">{result.rule.category}</Tag> because the {FIELD_LABEL[result.rule.matchField ?? 'any']} “<span className="font-mono text-amber">{result.rule.token}</span>”
                  {result.candidates.length > 1 && <span className="block text-xs text-dim">{result.candidates.length} rules matched; the newest one wins.</span>}
                </p>
              ) : (
                <p className="mt-1 text-muted">No rule matches.</p>
              )}
            </div>
            <div>
              <p className="label">Built-in pattern</p>
              <p className="mt-1 text-text">{result.base.category ?? 'Unclassified'}</p>
              <p className="text-xs text-dim">{result.base.reason}</p>
            </div>
          </div>
        )}
      </section>

      {rules.length === 0 ? (
        <Empty
          title="No rules yet"
          body="Classify a transaction in Review and Runway saves the correction as a rule here. It then applies to past and future transactions."
          action={<Button variant="primary" onClick={() => go('review')}>Go to review</Button>}
        />
      ) : (
        <>
          <RuleTable title="Merchant rules" rules={contains} affected={affected} editing={editing} setEditing={setEditing} onDelete={async (r) => { await removeRule(r.id); notify({ title: 'Rule deleted', detail: `"${r.token}" transactions are back to Runway’s own classification.` }) }} onSave={async (r) => { await updateRule(r); setEditing(null); notify({ title: 'Rule updated', detail: `Re-applied to every matching transaction.` }) }} />
          {pins.length > 0 && (
            <RuleTable title="Single-transaction corrections" rules={pins} affected={affected} editing={editing} setEditing={setEditing} onDelete={async (r) => removeRule(r.id)} onSave={async (r) => { await updateRule(r); setEditing(null) }} />
          )}
        </>
      )}
    </div>
  )
}

function RuleTable({
  title,
  rules,
  affected,
  editing,
  setEditing,
  onDelete,
  onSave,
}: {
  title: string
  rules: Rule[]
  affected: Map<string, number>
  editing: string | null
  setEditing: (id: string | null) => void
  onDelete: (r: Rule) => void
  onSave: (r: Rule) => void
}) {
  return (
    <section className="space-y-3">
      <h2 className="display text-2xl uppercase">{title} <span className="tnum text-dim">{rules.length}</span></h2>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="label border-b border-line">
              <th className="p-4 font-normal">Rule</th>
              <th className="p-4 font-normal">Matches</th>
              <th className="p-4 font-normal">Sets</th>
              <th className="p-4 text-right font-normal">Applies to</th>
              <th className="p-4 font-normal">Created</th>
              <th className="p-4 font-normal"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) =>
              editing === r.id ? (
                <EditRow key={r.id} rule={r} onCancel={() => setEditing(null)} onSave={onSave} />
              ) : (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="p-4 text-text">{r.label ?? r.token}</td>
                  <td className="p-4 font-mono text-xs text-muted">{r.matchType === 'contains' ? <>{FIELD_LABEL[r.matchField ?? 'any']} “<span className="text-amber">{r.token}</span>”</> : 'this transaction only'}</td>
                  <td className="p-4">
                    <Tag tone={bucketOf(r.category) === 'excluded' ? 'neutral' : 'amber'}>{r.category}</Tag>
                    <span className="ml-2 text-xs text-dim">{BUCKET_LABEL[bucketOf(r.category)]}</span>
                    {r.myShare ? <span className="mt-1 block text-xs text-dim">keeps your {formatINR(r.myShare)} as {r.shareCategory}</span> : null}
                    {r.splits?.length ? <span className="mt-1 block text-xs text-dim">split: {r.splits.map((p) => `${formatINR(p.amount)} ${p.category}`).join(' + ')}, rest {r.category}</span> : null}
                  </td>
                  <td className="tnum p-4 text-right font-mono">{affected.get(r.id) ?? 0}</td>
                  <td className="p-4 font-mono text-xs text-dim">{formatDateShort(r.createdAt.slice(0, 10))}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-1">
                      <button type="button" aria-label={`Edit rule ${r.label ?? r.token}`} onClick={() => setEditing(r.id)} className="p-2 text-dim hover:text-amber"><Pencil size={14} /></button>
                      <button type="button" aria-label={`Delete rule ${r.label ?? r.token}`} onClick={() => onDelete(r)} className="p-2 text-dim hover:text-rose"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EditRow({ rule, onCancel, onSave }: { rule: Rule; onCancel: () => void; onSave: (r: Rule) => void }) {
  const [token, setToken] = useState(rule.token)
  const [category, setCategory] = useState<Category>(rule.category)
  const [label, setLabel] = useState(rule.label ?? '')
  return (
    <tr className="border-t border-line bg-white/[0.03]">
      <td className="p-3"><input aria-label="Rule name" value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 w-full border-b border-line-strong bg-transparent focus:border-amber focus:outline-none" /></td>
      <td className="p-3">
        {rule.matchType === 'contains' ? (
          <input aria-label="Match text" value={token} onChange={(e) => setToken(e.target.value)} className="h-9 w-full border-b border-line-strong bg-transparent font-mono text-xs focus:border-amber focus:outline-none" />
        ) : (
          <span className="font-mono text-xs text-dim">this transaction only</span>
        )}
      </td>
      <td className="p-3">
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category)} className="h-9 w-full border-b border-line-strong bg-transparent font-mono text-xs">
          {ALL_CATEGORIES.map((c) => <option key={c} value={c} className="bg-graphite">{c}</option>)}
        </select>
      </td>
      <td colSpan={3} className="p-3">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="subtle" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={rule.matchType === 'contains' && !token.trim()} onClick={() => onSave({ ...rule, token: rule.matchType === 'contains' ? token : rule.token, category, label: label || undefined, ...(category !== 'P2P split' ? { myShare: undefined, shareCategory: undefined } : {}) })}>Save</Button>
        </div>
      </td>
    </tr>
  )
}
