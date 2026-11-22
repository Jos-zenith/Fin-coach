import { useStore } from '../../app/store'
import { assumptions } from '../../lib/engine/insights'
import { cx } from '../ui'

const KIND: Record<string, string> = { data: 'Data', method: 'Method', limit: 'Limit' }

/** What every number on this page rests on, in plain words. */
export function AssumptionsPanel({ className }: { className?: string }) {
  const { model, profile, reconciliations } = useStore()
  const items = assumptions(model, profile, reconciliations.map((r) => ({ label: r.label, rec: r.rec })))
  return (
    <section aria-labelledby="assume-h" className={cx('print-avoid-break space-y-3', className)}>
      <h2 id="assume-h" className="display text-3xl uppercase">Assumptions & limitations</h2>
      <ul className="panel divide-y divide-line">
        {items.map((a) => (
          <li key={a.text} className="grid gap-1 px-5 py-3 sm:grid-cols-[6rem_1fr] sm:gap-4">
            <span className={cx('label pt-0.5', a.kind === 'limit' ? '!text-warn' : a.kind === 'data' ? '!text-sage' : '')}>{KIND[a.kind]}</span>
            <span className="text-base text-muted">{a.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
