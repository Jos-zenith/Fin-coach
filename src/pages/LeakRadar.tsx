import { ExternalLink, Info } from 'lucide-react'
import { useState } from 'react'
import { go } from '../app/router'
import { useStore } from '../app/store'
import { Button, cx, Empty, Modal, SectionTitle, Tag } from '../components/ui'
import { MANDATE_GUIDANCE, MANDATE_WHERE, NPCI_URL } from '../lib/copy'
import { DAYS_PER_MONTH, formatDateShort } from '../lib/dates'
import { daysOfRunwayPerMonth, runwayGainDays } from '../lib/engine/model'
import type { Leak } from '../lib/engine/recurring'
import { formatINR, formatINRExact, formatMonths } from '../lib/format'
import type { LeakDecision } from '../lib/types'

function kindLabel(l: Leak): string {
  if (l.kind === 'possible_duplicate') return 'Possible double charge'
  if (l.kind === 'subscription') return l.mandateMarker && /autopay|auto pay/i.test(l.mandateMarker) ? 'Subscription · UPI AutoPay' : 'Subscription'
  if (l.kind === 'mandate') {
    const m = l.mandateMarker ?? ''
    if (/nach|ach|ecs/i.test(m)) return 'NACH / ACH debit'
    if (/si|standing/i.test(m)) return 'Standing instruction'
    if (/autopay|auto pay/i.test(m)) return 'UPI AutoPay'
    return 'Automatic debit'
  }
  return 'Unknown recurring merchant'
}

const DECISIONS: { key: LeakDecision; label: string }[] = [
  { key: 'keep', label: 'Keep' },
  { key: 'cancel', label: 'Cancel' },
  { key: 'review', label: 'Needs review' },
]

export default function LeakRadar() {
  const { model, decisions, setDecision } = useStore()
  const [help, setHelp] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'cancel' | 'keep'>('all')
  const base = model.baseline
  const leaks = model.leaks
  const recurringTotal = leaks.filter((l) => l.kind !== 'possible_duplicate').reduce((a, l) => a + l.monthly, 0)
  const planned = leaks.filter((l) => decisions[l.id] === 'cancel')
  const plannedTotal = planned.reduce((a, l) => a + l.monthly, 0)
  const plannedGain = runwayGainDays(plannedTotal, base.cash, base.burn)
  const shown = leaks.filter((l) =>
    filter === 'all' ? true : filter === 'open' ? !decisions[l.id] || decisions[l.id] === 'review' : decisions[l.id] === filter,
  )

  if (!model.hasTransactions) {
    return (
      <div className="space-y-8">
        <SectionTitle kicker="Leak radar" title="Recurring drains" />
        <Empty title="Nothing to scan yet" body="Leak Radar looks for charges that repeat every 25–35 days. Import at least two months of statements or SMS." action={<Button variant="primary" onClick={() => go('import', 'statement')}>Import a statement</Button>} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <SectionTitle kicker="Leak radar · investigation" title="Recurring drains">
        <Button variant="ghost" size="sm" onClick={() => setHelp(true)}><Info size={13} /> How to stop a mandate</Button>
      </SectionTitle>

      <section className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-panel p-5">
          <p className="label">Fixed commitments / month</p>
          <p className="display tnum mt-2 text-4xl">{formatINR(model.commitments)}</p>
          <p className="mt-1 text-xs text-dim">EMIs + recurring drains below</p>
        </div>
        <div className="bg-panel p-5">
          <p className="label">Recurring drains / month</p>
          <p className="display tnum mt-2 text-4xl">{formatINR(recurringTotal)}</p>
          <p className="mt-1 text-xs text-dim">{formatINR(recurringTotal * 12)} a year</p>
        </div>
        <div className="bg-panel p-5">
          <p className="label">Marked to cancel</p>
          <p className="display tnum mt-2 text-4xl text-amber">{formatINR(plannedTotal)}</p>
          <p className="mt-1 text-xs text-dim">{planned.length} item{planned.length === 1 ? '' : 's'} · a plan, nothing is cancelled for you</p>
        </div>
        <div className="bg-panel p-5">
          <p className="label">Lifestyle runway if cancelled</p>
          <p className="display tnum mt-2 text-4xl text-sage">{plannedGain != null ? (plannedGain < 1 ? '<1 day' : `+${Math.round(plannedGain)} day${Math.round(plannedGain) === 1 ? '' : 's'}`) : '—'}</p>
          <button type="button" className="mt-1 text-xs text-dim underline-offset-4 hover:text-amber hover:underline" onClick={() => go('simulator')}>See it in the simulator →</button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'open', 'cancel', 'keep'] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cx('h-8 border px-3 font-mono text-[0.64rem] uppercase tracking-[0.12em]', filter === f ? 'border-amber text-amber' : 'border-line text-muted hover:text-text')}>
            {f === 'all' ? `All ${leaks.length}` : f === 'open' ? 'Undecided' : f === 'cancel' ? 'Cancel' : 'Keep'}
          </button>
        ))}
        <p className="ml-auto max-w-md text-xs text-dim">Found from repeating debits in your data. A repeat is not proof of an active mandate, and Runway cannot cancel anything.</p>
      </div>

      {shown.length === 0 ? (
        <Empty title="Nothing in this view" body={leaks.length ? 'Change the filter to see other drains.' : 'No charges repeat every 25–35 days at a similar amount. Rent, EMIs and bills are tracked as essentials, not drains.'} />
      ) : (
        <ul className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {shown.map((l) => {
            const perMonth = daysOfRunwayPerMonth(l.monthly, base.burn)
            const gain = runwayGainDays(l.monthly, base.cash, base.burn)
            const d = decisions[l.id]
            return (
              <li key={l.id} className={cx('panel flex min-w-0 flex-col p-5', d === 'cancel' && '!border-amber/40', d === 'keep' && 'opacity-80')}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="label">{kindLabel(l)}</p>
                    <h3 className="display mt-1 truncate text-3xl uppercase">{l.label}</h3>
                  </div>
                  <div className="text-right">
                    <p className="display tnum text-3xl">{formatINR(l.kind === 'possible_duplicate' ? l.amounts[1] : l.monthly)}</p>
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-dim">{l.kind === 'possible_duplicate' ? 'charged twice' : 'per month'}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Tag tone={l.confidence === 'high' ? 'sage' : 'warn'}>{l.kind === 'possible_duplicate' ? 'Check' : l.confidence === 'high' ? `Seen ${l.txns.length}× · steady` : `Seen ${l.txns.length}× · tentative`}</Tag>
                  {l.kind !== 'possible_duplicate' && <Tag>{l.mandateMarker ? 'Mandate marker in statement' : 'Pattern only, not a confirmed mandate'}</Tag>}
                  {l.unused && <Tag tone="warn">Possibly unused</Tag>}
                  {l.isNew && <Tag tone="amber">New recurring charge</Tag>}
                  {l.priceChange && <Tag tone="rose">Price up {formatINR(l.priceChange.from)} → {formatINR(l.priceChange.to)}</Tag>}
                  {l.priceDrop && <Tag tone="sage">Price down {formatINR(l.priceDrop.from)} → {formatINR(l.priceDrop.to)}</Tag>}
                  {l.mandateMarker && <Tag>Marker: {l.mandateMarker.trim().toUpperCase()}</Tag>}
                  {l.category && <Tag>{l.category}</Tag>}
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-4">
                  <div><dt className="text-dim">Cadence</dt><dd className="tnum">{l.kind === 'possible_duplicate' ? `${l.avgGapDays} day gap` : `~${Math.round(l.avgGapDays)} days`}</dd></div>
                  <div><dt className="text-dim">First seen</dt><dd>{formatDateShort(l.firstDate)} · {formatINR(l.monthly * 12)}/yr</dd></div>
                  <div><dt className="text-dim">Last debit</dt><dd>{formatDateShort(l.lastDate)}</dd></div>
                  <div><dt className="text-dim">Next expected</dt><dd>{l.kind === 'possible_duplicate' ? '—' : `~${formatDateShort(l.nextExpected)}`}</dd></div>
                </dl>

                {(l.priceChange || l.unused || l.isNew) && (
                  <ul className="mt-4 space-y-1 text-sm text-text">
                    {l.priceChange && <li>{l.label} increased from {formatINR(l.priceChange.from)} to {formatINR(l.priceChange.to)} per month.</li>}
                    {l.unused && l.usage && (
                      <li>This {formatINR(l.monthly)} membership has no matching {l.usage.label.toLowerCase()} in the last {l.usage.daysSince} days{l.usage.lastUsed ? ` (last on ${formatDateShort(l.usage.lastUsed)})` : ''}.</li>
                    )}
                    {l.isNew && <li>A new recurring charge of {formatINR(l.monthly)} was detected, first on {formatDateShort(l.firstDate)}.</li>}
                  </ul>
                )}
                {l.usage && !l.unused && (
                  <p className="mt-2 font-mono text-[0.68rem] text-dim">Usage seen: {l.usage.label.toLowerCase()} {l.usage.lastUsed ? `last on ${formatDateShort(l.usage.lastUsed)}` : 'none'}.</p>
                )}
                {!l.usage && l.kind !== 'possible_duplicate' && (
                  <p className="mt-2 font-mono text-[0.68rem] text-dim">Usage cannot be seen in bank data for this kind of service.</p>
                )}
                {l.kind !== 'possible_duplicate' && perMonth != null && (
                  <p className="mt-4 border-l border-amber/50 pl-3 text-sm text-muted">
                    Keeping this costs about <span className="text-text">{perMonth.toFixed(1)} days</span> of lifestyle runway every month.
                    {gain != null && (
                      <>
                        {' '}Cancelling this saves {formatINR(l.monthly)}/month, adding <span className="text-sage">{gain < 1 ? 'less than a day' : gain >= DAYS_PER_MONTH ? `${(gain / DAYS_PER_MONTH).toFixed(1)} months` : `${Math.round(gain)} day${Math.round(gain) === 1 ? '' : 's'}`}</span> to lifestyle runway.
                      </>
                    )}
                  </p>
                )}
                <p className="mt-2 text-xs text-dim">{l.why}</p>

                <details className="mt-3 text-xs">
                  <summary className="label cursor-pointer !text-dim hover:!text-text">Evidence · {l.txns.length} transactions</summary>
                  <ul className="mt-2 space-y-1.5">
                    {l.txns.map((t) => (
                      <li key={t.id} className="grid grid-cols-[5rem_1fr_auto] gap-3 font-mono">
                        <span className="text-muted">{formatDateShort(t.date)}</span>
                        <span className="truncate text-dim" title={t.rawDescription}>{t.rawDescription}</span>
                        <span className="tnum">{formatINRExact(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </details>

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-5" role="group" aria-label={`Decision for ${l.label}`}>
                  {DECISIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      aria-pressed={d === opt.key}
                      onClick={() => setDecision(l.id, d === opt.key ? null : opt.key)}
                      className={cx(
                        'h-9 flex-1 border font-mono text-[0.66rem] uppercase tracking-[0.12em] transition-colors',
                        d === opt.key
                          ? opt.key === 'cancel'
                            ? 'border-amber bg-amber text-ink'
                            : opt.key === 'keep'
                              ? 'border-sage bg-sage-soft text-sage'
                              : 'border-warn bg-[rgb(217_164_65/0.12)] text-warn'
                          : 'border-line text-muted hover:border-line-strong hover:text-text',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs text-dim">
        Runway impact uses your current lifestyle burn of {formatINR(base.burn)}/month ({formatINR(base.burn / DAYS_PER_MONTH)}/day)
        {base.lifestyle != null && <> and lifestyle runway of {formatMonths(base.lifestyle)} months</>}.
      </p>

      <Modal open={help} onClose={() => setHelp(false)} title="Stopping a recurring payment">
        <div className="space-y-4 text-sm text-muted">
          <p className="text-text">{MANDATE_GUIDANCE}</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>{MANDATE_WHERE}</li>
            <li>NACH / ACH debits (often EMIs and some subscriptions) are set up with your bank or the company. Ask them to cancel the mandate.</li>
            <li>Card subscriptions are managed with the merchant, or through your card issuer’s standing instruction settings.</li>
          </ul>
          <p>Marking “Cancel” here is a planning decision. It shows the effect in the simulator; it does not contact anyone.</p>
          <a href={NPCI_URL} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-amber underline-offset-4 hover:underline">
            Official UPI information (NPCI) <ExternalLink size={13} aria-hidden />
          </a>
        </div>
      </Modal>
    </div>
  )
}
