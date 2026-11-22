import { Lock } from 'lucide-react'
import type { Reconciliation } from '../../lib/ingest/reconcile'

/** Shown wherever data enters: the promise, and how to check it. */
export function PrivacyInline({ what }: { what: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-sage/90">
      <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        {what} {what.endsWith('s') ? 'are' : 'is'} read in this browser only. Nothing is uploaded, and Runway needs no bank login or phone permission.{' '}
        <span className="text-dim">To check: open your browser’s developer tools, Network tab. It stays empty while you import.</span>
      </span>
    </p>
  )
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

export function ReconcileLine({ rec }: { rec: Reconciliation | null }) {
  if (!rec) return <p className="text-sm text-dim">No balance column (UPI app statements such as PhonePe have none), so rows cannot be checked against each other. Each payment’s UTR is kept, so importing your bank statement later will not double-count it.</p>
  const id = rec.identity
  const equation = (
    <span className="font-mono text-xs">
      Opening {inr(id.opening)} + credits {inr(id.credits)} − debits {inr(id.debits)} = closing {inr(id.closing)} {id.ok ? '✓' : '✗'}
      {id.stated ? (id.stated.matches ? ' · matches the balances printed on the statement' : ' · does not match the printed balance') : ''}
    </span>
  )
  if (!rec.breaks.length && id.stated && !id.stated.matches)
    return (
      <div className="space-y-1 text-sm text-warn">
        <p>Rows chain correctly, but the totals do not reach the balance printed on the statement ({id.stated.closing != null ? `closing ${inr(id.stated.closing)}` : `opening ${inr(id.stated.opening!)}`}). Rows at the start or end may be missing.</p>
        <p>{equation}</p>
      </div>
    )
  return rec.ok ? (
    <div className="space-y-1 text-sm text-sage">
      <p>✓ Running balances reconcile across all {rec.checked} rows: no rows appear to be missing.</p>
      <p>{equation}</p>
    </div>
  ) : (
    <p className="text-sm text-warn">
      The running balance breaks in {rec.breaks.length} place{rec.breaks.length === 1 ? '' : 's'} (first near {rec.breaks[0].date}, off by ₹{Math.abs(Math.round(rec.breaks[0].gap)).toLocaleString('en-IN')}). Rows may be missing or mis-read; check the mapping or the file.
    </p>
  )
}
