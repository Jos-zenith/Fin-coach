import { ArrowRight, X } from 'lucide-react'
import { go } from '../../app/router'
import type { Nudge } from '../../lib/engine/nudges'
import { cx } from '../ui'

const KIND_LABEL: Record<Nudge['kind'], string> = {
  pace: 'Category pace',
  goal_delay: 'Goal delay',
  fixed_cost: 'Essential cost up',
  price: 'Price increase',
  unused: 'Possibly unused',
  new_charge: 'New recurring charge',
  runway: 'Runway warning',
  positive: 'Good news',
}

export function NudgeCard({ n, onDismiss, onRestore, compact = false }: { n: Nudge; onDismiss?: () => void; onRestore?: () => void; compact?: boolean }) {
  return (
    <li
      className={cx(
        'panel flex gap-4 border-l-2 p-4',
        n.tone === 'alert' && '!border-l-rose',
        n.tone === 'warn' && '!border-l-warn',
        n.tone === 'good' && '!border-l-sage',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cx('label', n.tone === 'alert' ? '!text-rose' : n.tone === 'good' ? '!text-sage' : '!text-warn')}>{KIND_LABEL[n.kind]}</p>
        <p className="mt-1.5 text-text">{n.title}</p>
        {!compact && <p className="mt-1.5 text-sm text-muted">{n.consequence}</p>}
        <button type="button" onClick={() => go(n.action.route, n.action.param)} className="mt-2.5 inline-flex items-center gap-1.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-amber hover:underline">
          {n.action.label} <ArrowRight size={11} aria-hidden />
        </button>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={`Dismiss: ${n.title}`} className="h-fit p-1 text-dim hover:text-text">
          <X size={15} />
        </button>
      )}
      {onRestore && (
        <button type="button" onClick={onRestore} className="h-fit font-mono text-[0.6rem] uppercase tracking-[0.1em] text-dim hover:text-amber">
          Restore
        </button>
      )}
    </li>
  )
}
