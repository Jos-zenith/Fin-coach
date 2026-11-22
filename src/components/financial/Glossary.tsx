import { TERMS } from '../../lib/copy'
import { cx } from '../ui'

/** The six words Runway uses, each meaning one thing everywhere. */
export function Glossary({ className }: { className?: string }) {
  return (
    <section aria-labelledby="glossary-h" className={cx('print-avoid-break space-y-3', className)}>
      <h2 id="glossary-h" className="label">Words Runway uses</h2>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {TERMS.map((t) => (
          <div key={t.term} className="border-t border-line pt-3">
            <dt className="text-sm text-text">{t.term}</dt>
            <dd className="mt-1 text-sm text-muted">{t.means}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
