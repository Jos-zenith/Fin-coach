import { Bot } from 'lucide-react'
import { useStore } from '../../app/store'
import { formatINR } from '../../lib/format'
import { Button } from '../ui'

const KIND_LABEL = {
  reimbursement: 'likely reimbursement',
  unknown_recurring: 'unknown recurring charge',
  savings_debit: 'possible savings transfer',
  large_unclassified: 'large unclassified spend',
} as const

/** One focused question at a time, highest monthly impact first. */
export function TriageCard({ compact = false }: { compact?: boolean }) {
  const { triage, answerTriage } = useStore()
  if (!triage.length) return null
  const item = triage[0]
  const counts = Object.entries(
    triage.reduce<Record<string, number>>((a, t) => ({ ...a, [t.kind]: (a[t.kind] ?? 0) + 1 }), {}),
  )
  return (
    <section aria-label="Runway agent question" className="border border-amber/30 bg-panel p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Bot size={16} className="text-amber" aria-hidden />
        <p className="label !text-amber">Runway agent found</p>
        <p className="text-sm text-muted">
          {counts.map(([k, n]) => `${n} ${KIND_LABEL[k as keyof typeof KIND_LABEL]}${n > 1 ? 's' : ''}`).join(' · ')}
        </p>
        <span className="ml-auto font-mono text-xs text-dim">1 of {triage.length} · worth about {formatINR(item.impact)}/month</span>
      </div>
      <p className="mt-3 text-lg leading-snug text-text">{item.question}</p>
      {!compact && <p className="mt-1 text-sm text-muted">{item.detail}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => void answerTriage(item, item.confirm, 'confirmed')}>{item.confirm.label}</Button>
        {item.alternatives.map((a) => (
          <Button key={a.label} variant="ghost" size="sm" onClick={() => void answerTriage(item, a, 'confirmed')}>{a.label}</Button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => void answerTriage(item, item.dismiss, 'dismissed')}>{item.dismiss.label}</Button>
        <Button variant="subtle" size="sm" onClick={() => void answerTriage(item, { label: 'Marked for review', rules: [] }, 'review')}>Mark for review</Button>
      </div>
    </section>
  )
}
