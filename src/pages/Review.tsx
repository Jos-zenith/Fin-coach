import { Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../app/store'
import { TriageCard } from '../components/agent/TriageCard'
import { Button, cx, MoneyInput, SectionTitle, Tag } from '../components/ui'
import { formatDateShort } from '../lib/dates'
import { FIELD_LABEL, fieldText, matchText, SOURCE_LABEL, suggestToken, type ResolvedTxn } from '../lib/engine/resolve'
import { formatINR, formatINRExact } from '../lib/format'
import {
  bucketOf,
  BUCKET_LABEL,
  ESSENTIAL_CATEGORIES,
  EXCLUDED_CATEGORIES,
  FLEXIBLE_CATEGORIES,
  INCOME_CATEGORIES,
  type Category,
  type Rule,
} from '../lib/types'

type Filter = 'review' | 'p2p' | 'noise' | 'recurring' | 'all' | 'duplicates'

const REVIEW_ORDER: Record<string, number> = { uncategorized: 0, potential_p2p: 1, investment_like: 2, missing_date: 3 }

const REASON_LABEL: Record<string, string> = {
  uncategorized: 'Uncategorized',
  potential_p2p: 'Potential P2P',
  investment_like: 'Investment-like',
  missing_date: 'No date in SMS',
}

export function categoryTone(c: Category | null): 'neutral' | 'amber' | 'sage' | 'rose' | 'warn' {
  if (!c) return 'warn'
  const b = bucketOf(c)
  return b === 'essential' ? 'amber' : b === 'income' ? 'sage' : b === 'excluded' ? 'neutral' : 'neutral'
}

export default function Review() {
  const { model } = useStore()
  const [filter, setFilter] = useState<Filter>(model.reviewCount ? 'review' : 'all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const [open, setOpen] = useState<string | null>(null)

  const counts = useMemo(() => {
    const r = model.resolved
    return {
      review: r.filter((t) => t.needsReview).length,
      p2p: r.filter((t) => t.reviewReason === 'potential_p2p' || t.category === 'P2P split').length,
      noise: r.filter((t) => t.category && bucketOf(t.category) === 'excluded').length,
      recurring: r.filter((t) => t.isRecurring).length,
      all: r.filter((t) => !t.flags.includes('duplicate')).length,
      duplicates: r.filter((t) => t.flags.includes('duplicate')).length,
    }
  }, [model.resolved])

  const list = useMemo(() => {
    let r = model.resolved
    if (filter === 'review') r = r.filter((t) => t.needsReview)
    if (filter === 'p2p') r = r.filter((t) => t.reviewReason === 'potential_p2p' || t.category === 'P2P split')
    if (filter === 'noise') r = r.filter((t) => t.category && bucketOf(t.category) === 'excluded')
    if (filter === 'recurring') r = r.filter((t) => t.isRecurring)
    if (filter === 'all') r = r.filter((t) => !t.flags.includes('duplicate'))
    if (filter === 'duplicates') r = r.filter((t) => t.flags.includes('duplicate'))
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      r = r.filter((t) => matchText(t).includes(needle) || (t.category ?? '').toLowerCase().includes(needle))
    }
    return [...r].sort((a, b) => {
      if (filter === 'review') {
        const d = (REVIEW_ORDER[a.reviewReason ?? ''] ?? 9) - (REVIEW_ORDER[b.reviewReason ?? ''] ?? 9)
        if (d) return d
        return b.amount - a.amount
      }
      return b.date.localeCompare(a.date)
    })
  }, [model.resolved, filter, q])

  const filters: { key: Filter; label: string }[] = [
    { key: 'review', label: 'Needs review' },
    { key: 'p2p', label: 'P2P' },
    { key: 'noise', label: 'Excluded' },
    { key: 'recurring', label: 'Recurring' },
    { key: 'all', label: 'All' },
    { key: 'duplicates', label: 'Duplicates' },
  ]

  return (
    <div className="space-y-8">
      <SectionTitle kicker="Review & train · every correction becomes a rule" title="Teach Runway your money">
        <p className="max-w-md text-sm text-muted">Fix a merchant once. Runway saves a rule, re-applies it to history and to every future import, and recalculates instantly.</p>
      </SectionTitle>

      <TriageCard />

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Filter transactions" className="flex flex-wrap border border-line">
          {filters.map((f) => (
            <button
              key={f.key}
              role="tab"
              type="button"
              aria-selected={filter === f.key}
              onClick={() => {
                setFilter(f.key)
                setLimit(60)
              }}
              className={cx('flex h-9 items-center gap-2 px-3 font-mono text-[0.66rem] uppercase tracking-[0.12em] transition-colors', filter === f.key ? 'bg-amber-soft text-amber' : 'text-muted hover:text-text')}
            >
              {f.label} <span className="tnum text-dim">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex h-9 min-w-[220px] items-center gap-2 border-b border-line-strong focus-within:border-amber">
          <Search size={14} className="text-dim" aria-hidden />
          <span className="sr-only">Search transactions</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant, UPI ID, text" className="h-full w-full bg-transparent text-sm placeholder:text-dim/70 focus:outline-none" />
        </label>
      </div>

      {list.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="display text-2xl uppercase">{filter === 'review' ? 'Nothing left to review' : 'No transactions here'}</p>
          <p className="mt-2 text-sm text-muted">{filter === 'review' ? 'Every transaction has a category. Your numbers reflect your corrections.' : 'Try another filter or search.'}</p>
        </div>
      ) : (
        <ul className="panel divide-y divide-line" aria-label="Transactions">
          {list.slice(0, limit).map((t) => (
            <TxnRow key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
          ))}
        </ul>
      )}
      {list.length > limit && (
        <div className="flex justify-center">
          <Button onClick={() => setLimit((l) => l + 100)}>Show {Math.min(100, list.length - limit)} more of {list.length - limit}</Button>
        </div>
      )}
    </div>
  )
}

function TxnRow({ t, open, onToggle }: { t: ResolvedTxn; open: boolean; onToggle: () => void }) {
  const dup = t.flags.includes('duplicate')
  return (
    <li className={cx('transition-colors', open && 'bg-white/[0.025]')}>
      <div className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] sm:items-center">
        <p className="order-3 font-mono text-xs text-muted sm:order-none">{formatDateShort(t.date)}</p>
        <div className="min-w-0">
          <p className="truncate text-text">{t.merchantGuess ?? t.vpa ?? 'Unknown'}</p>
          <p className="truncate font-mono text-[0.68rem] text-dim" title={t.rawDescription}>{t.rawDescription}</p>
        </div>
        <p className={cx('tnum text-right font-mono', t.direction === 'credit' ? 'text-sage' : 'text-text', dup && 'line-through opacity-50')}>
          {t.direction === 'credit' ? '+' : '−'}{formatINRExact(t.amount)}
        </p>
        <div className="order-4 flex flex-wrap items-center justify-end gap-1.5 sm:order-none">
          {t.needsReview && t.reviewReason && <Tag tone="warn">{REASON_LABEL[t.reviewReason]}</Tag>}
          {dup ? <Tag>Duplicate</Tag> : <Tag tone={categoryTone(t.category)}>{t.category ?? 'Unclassified'}</Tag>}
          {t.isRecurring && <Tag>Recurring</Tag>}
          {!dup && (
            <Button size="sm" variant={t.needsReview ? 'primary' : 'ghost'} onClick={onToggle} aria-expanded={open}>
              {open ? 'Close' : t.needsReview ? 'Classify' : 'Change'}
            </Button>
          )}
        </div>
      </div>
      {open && <TxnEditor t={t} onDone={onToggle} />}
    </li>
  )
}

const GROUPS: { title: string; cats: readonly Category[] }[] = [
  { title: 'Essential', cats: ESSENTIAL_CATEGORIES },
  { title: 'Flexible', cats: FLEXIBLE_CATEGORIES },
  { title: 'Not spending (excluded)', cats: EXCLUDED_CATEGORIES },
  { title: 'Income', cats: INCOME_CATEGORIES },
]

function TxnEditor({ t, onDone }: { t: ResolvedTxn; onDone: () => void }) {
  const { addRule, model, notify, rules, removeRule } = useStore()
  const [token, setToken] = useState(suggestToken(t))
  const [scope, setScope] = useState<'all' | 'one'>('all')
  const [cat, setCat] = useState<Category | null>(t.category)
  const [share, setShare] = useState<number | null>(null)
  const [shareCat, setShareCat] = useState<Category>('Rent')
  const [field, setField] = useState<NonNullable<Rule['matchField']>>(t.vpa && !t.merchantGuess ? 'vpa' : 'any')
  const [splitOn, setSplitOn] = useState(false)
  const [parts, setParts] = useState<{ category: Category; amount: number | null }[]>([{ category: 'Groceries', amount: null }])

  const matches = useMemo(() => {
    const needle = token.trim().toLowerCase()
    if (!needle) return 0
    return model.resolved.filter((x) => !x.flags.includes('duplicate') && fieldText(x, field).includes(needle)).length
  }, [token, field, model.resolved])
  const partsTotal = parts.reduce((a, p) => a + (p.amount ?? 0), 0)
  const splitInvalid = splitOn && (partsTotal <= 0 || partsTotal > t.amount)

  const existingRule = t.ruleId ? rules.find((r) => r.id === t.ruleId) : null

  const save = async () => {
    if (!cat) return
    const splitExtra = cat === 'P2P split' && t.direction === 'debit' && share && share > 0 ? { myShare: share, shareCategory: shareCat } : {}
    const undo = (id: string) => ({ label: 'Undo', run: () => void removeRule(id) })
    if (scope === 'one') {
      const splits = splitOn ? parts.filter((p) => p.amount && p.amount > 0).map((p) => ({ category: p.category, amount: p.amount! })) : undefined
      const r = await addRule({ matchType: 'txn', token: t.id, category: cat, label: t.merchantGuess ?? t.rawDescription.slice(0, 40), ...splitExtra, ...(splits ? { splits } : {}) })
      notify({
        title: splits ? 'Split saved' : 'Saved for this transaction',
        detail: splits
          ? `${splits.map((p) => `${formatINR(p.amount)} ${p.category}`).join(' + ')}, the rest ${cat}.`
          : `${t.merchantGuess ?? 'Transaction'} → ${cat}. Other transactions are unchanged.`,
        action: undo(r.id),
      })
    } else {
      const tok = token.trim().toLowerCase()
      if (!tok) return
      const r = await addRule({ matchType: 'contains', matchField: field, token: tok, category: cat, label: t.merchantGuess ?? tok, ...splitExtra })
      const what = FIELD_LABEL[field].charAt(0).toUpperCase() + FIELD_LABEL[field].slice(1)
      notify({
        title: 'Rule saved',
        detail: `${what} "${tok}" → ${cat}. Applied to ${matches} existing transaction${matches === 1 ? '' : 's'}; future imports will use it too.`,
        action: undo(r.id),
      })
    }
    onDone()
  }

  return (
    <div className="animate-fade-up space-y-5 border-t border-line px-4 pb-5 pt-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-2 text-sm">
          <p className="label">Why it is classified this way</p>
          <p className="text-muted">{t.reason}</p>
          <p className="font-mono text-[0.68rem] text-dim">
            Source: {SOURCE_LABEL[t.classSource]}
            {t.autoConfidence && t.classSource === 'heuristic' ? ` · ${t.autoConfidence} confidence` : ''}
            {t.vpa ? ` · UPI ${t.vpa}` : ''}
            {t.reference ? ` · ref ${t.reference}` : ''}
            {` · ${t.source.toUpperCase()}${t.statementType === 'card' ? ' (card)' : ''}`}
          </p>
          <p className="break-all font-mono text-[0.68rem] text-dim/80">{t.rawDescription}</p>
          {existingRule && (
            <button type="button" className="label !text-amber underline-offset-4 hover:underline" onClick={() => void removeRule(existingRule.id).then(onDone)}>
              Remove the rule that set this
            </button>
          )}
        </div>
        <div className="space-y-4">
          <fieldset>
            <legend className="label mb-2">Apply to</legend>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-3">
                <input type="radio" name={`scope-${t.id}`} checked={scope === 'all'} onChange={() => setScope('all')} className="accent-[#e3a548]" />
                Every transaction whose
                <select
                  aria-label="Match in"
                  value={field}
                  onChange={(e) => {
                    setField(e.target.value as NonNullable<Rule['matchField']>)
                    setScope('all')
                  }}
                  className="h-8 border-b border-line-strong bg-transparent font-mono text-xs"
                >
                  <option value="any" className="bg-graphite">text</option>
                  <option value="merchant" className="bg-graphite">merchant</option>
                  <option value="vpa" className="bg-graphite">UPI ID</option>
                </select>
                contains
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onFocus={() => setScope('all')}
                  aria-label="Match text"
                  className="h-8 min-w-0 flex-1 border-b border-line-strong bg-transparent font-mono text-xs focus:border-amber focus:outline-none"
                />
                <span className="tnum font-mono text-xs text-dim">{matches}</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="radio" name={`scope-${t.id}`} checked={scope === 'one'} onChange={() => setScope('one')} className="accent-[#e3a548]" />
                Only this transaction
              </label>
              {scope === 'one' && t.direction === 'debit' && (
                <label className="ml-7 flex items-center gap-3 text-muted">
                  <input type="checkbox" checked={splitOn} onChange={(e) => setSplitOn(e.target.checked)} className="accent-[#e3a548]" />
                  Split it across categories
                </label>
              )}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="space-y-3">
        {GROUPS.map((g) => (
          <div key={g.title} className="flex flex-wrap items-center gap-1.5">
            <span className="label mr-2 w-full sm:w-44">{g.title}</span>
            {g.cats.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={cat === c}
                onClick={() => setCat(c)}
                className={cx(
                  'h-8 border px-2.5 text-xs transition-colors',
                  cat === c ? 'border-amber bg-amber-soft text-amber' : 'border-line text-muted hover:border-line-strong hover:text-text',
                )}
              >
                {c === 'CC repayment' ? 'Card bill payment' : c}
              </button>
            ))}
          </div>
        ))}
      </div>

      {scope === 'one' && splitOn && (
        <div className="space-y-3 border-l border-amber/40 pl-4">
          <p className="text-sm text-muted">Parts listed here are counted first; whatever is left of {formatINR(t.amount)} goes to the category you pick above.</p>
          {parts.map((p, i) => (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="block">
                <span className="label">Part {i + 1} category</span>
                <select value={p.category} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, category: e.target.value as Category } : x)))} className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm">
                  {[...ESSENTIAL_CATEGORIES, ...FLEXIBLE_CATEGORIES, ...EXCLUDED_CATEGORIES].map((c) => (
                    <option key={c} value={c} className="bg-graphite">{c}</option>
                  ))}
                </select>
              </label>
              <MoneyInput label={`Part ${i + 1} amount`} value={p.amount} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              <button type="button" aria-label={`Remove part ${i + 1}`} disabled={parts.length === 1} onClick={() => setParts(parts.filter((_, j) => j !== i))} className="mb-2 p-2 text-dim hover:text-rose disabled:opacity-30">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="subtle" onClick={() => setParts([...parts, { category: 'Shopping', amount: null }])}>
              <Plus size={12} /> Add part
            </Button>
            <span className={cx('tnum font-mono text-xs', splitInvalid ? 'text-rose' : 'text-dim')}>
              {formatINR(partsTotal)} split · {formatINR(Math.max(0, t.amount - partsTotal))} left{partsTotal > t.amount ? ' (more than the transaction)' : ''}
            </span>
          </div>
        </div>
      )}

      {cat === 'P2P split' && t.direction === 'debit' && (
        <div className="grid gap-4 border-l border-amber/40 pl-4 sm:grid-cols-2">
          <MoneyInput
            label="Your own share (optional)"
            value={share}
            onChange={setShare}
            hint={`Leave blank to exclude the whole ${formatINR(t.amount)}. Enter your share to keep it counted and exclude only the part others owe you.`}
          />
          <label className="block">
            <span className="label">Count your share as</span>
            <select value={shareCat} onChange={(e) => setShareCat(e.target.value as Category)} className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm">
              {[...ESSENTIAL_CATEGORIES, ...FLEXIBLE_CATEGORIES].map((c) => (
                <option key={c} value={c} className="bg-graphite">{c} · {BUCKET_LABEL[bucketOf(c)]}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="subtle" onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={!cat || (scope === 'all' && !token.trim()) || splitInvalid} onClick={save}>
          {scope === 'all' ? `Save rule · applies to ${matches} transaction${matches === 1 ? '' : 's'}` : splitOn ? 'Save split' : 'Save for this one'}
        </Button>
      </div>
    </div>
  )
}
