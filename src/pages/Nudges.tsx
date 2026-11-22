import { useState } from 'react'
import { useStore } from '../app/store'
import { NudgeCard } from '../components/financial/NudgeCard'
import { cx, Empty, Explain, SectionTitle } from '../components/ui'
import { formatDateShort } from '../lib/dates'
import { daysToPayday, PACE_AMBER, PACE_RED } from '../lib/engine/nudges'
import { formatINR } from '../lib/format'

export default function Nudges() {
  const { pace, nudges, dismissedNudges, dismissNudge, restoreNudge, model } = useStore()
  const [showDismissed, setShowDismissed] = useState(false)

  return (
    <div className="space-y-10">
      <SectionTitle kicker="Nudge center · paced from payday" title="Is the plan drifting?">
        <p className="max-w-md text-sm text-muted">Spending is compared with how far you are into the pay cycle, not the calendar month. Each nudge says what it costs and one thing to do.</p>
      </SectionTitle>

      {pace ? (
        <section aria-labelledby="pace-h" className="panel p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="pace-h" className="label">This pay cycle</h2>
              <p className="display mt-1.5 text-3xl uppercase">
                {formatDateShort(pace.cycleStart)} → {formatDateShort(pace.cycleEnd)}
              </p>
              <p className="mt-1 text-sm text-muted">
                Day {pace.daysIn} of {pace.cycleDays} · {daysToPayday(pace)} days to payday · as of {formatDateShort(pace.asOf)}, your latest transaction
                {model.payday ? ` · payday ${model.payday}` : ' · payday assumed on the 1st'}
              </p>
            </div>
            <div className="w-full max-w-xs">
              <div className="flex justify-between font-mono text-[0.62rem] uppercase tracking-[0.1em] text-dim">
                <span>Cycle elapsed</span>
                <span className="tnum">{Math.round(pace.elapsed * 100)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 bg-white/[0.06]"><div className="h-full bg-text/70" style={{ width: `${pace.elapsed * 100}%` }} /></div>
            </div>
          </div>
          {pace.tooEarly && <p className="mt-3 text-sm text-dim">It is too early in the cycle to judge pace. Nudges start on day 3.</p>}
          {pace.cardGap && (
            <p className="mt-3 text-sm text-warn">Your card statement does not reach into this pay cycle yet, so card spending is missing here. Import it or paste card SMS for an accurate pace.</p>
          )}
          <p className="mt-2 text-xs text-dim">Day-to-day spending only. Subscriptions and other recurring charges are tracked in Leak Radar.</p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="label">
                  <th className="pb-2 font-normal">Category</th>
                  <th className="pb-2 text-right font-normal">Spent</th>
                  <th className="pb-2 text-right font-normal">Usual / cycle</th>
                  <th className="pb-2 pl-6 font-normal">Used vs cycle elapsed</th>
                  <th className="pb-2 text-right font-normal">Pace</th>
                </tr>
              </thead>
              <tbody>
                {pace.rows.map((r) => (
                  <tr key={r.category} className="border-t border-line">
                    <td className="py-3 text-text">{r.category === 'Other' ? 'Other / unclassified' : r.category}</td>
                    <td className={cx('tnum py-3 text-right font-mono', r.spent === 0 && 'text-dim')}>{r.spent === 0 ? 'none seen' : formatINR(r.spent)}</td>
                    <td className="tnum py-3 text-right font-mono text-muted">{formatINR(r.budget)}</td>
                    <td className="py-3 pl-6">
                      <div className="relative h-2 w-full min-w-[160px] bg-white/[0.06]" aria-label={`${Math.round(r.used * 100)}% used, ${Math.round(pace.elapsed * 100)}% of cycle elapsed`}>
                        <div className={cx('h-full', r.status === 'red' ? 'bg-rose' : r.status === 'amber' ? 'bg-warn' : 'bg-sage')} style={{ width: `${Math.min(100, r.used * 100)}%` }} />
                        <span className="absolute -top-1 h-4 w-px bg-text" style={{ left: `${pace.elapsed * 100}%` }} aria-hidden />
                      </div>
                    </td>
                    <td className={cx('tnum py-3 text-right font-mono', r.status === 'red' ? 'text-rose' : r.status === 'amber' ? 'text-warn' : 'text-sage')}>
                      {Number.isFinite(r.ratio) ? `${r.ratio.toFixed(2)}×` : 'new'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Explain
            className="mt-4"
            content={{
              definition: 'Pace compares how much of a category’s usual spend is used with how much of the pay cycle has passed.',
              formula: 'Pace = (spent ÷ usual monthly spend) ÷ (days since payday ÷ days in cycle)',
              inputs: [
                ['Cycle', `${pace.cycleStart} → ${pace.cycleEnd} (${pace.cycleDays} days)`],
                ['Days elapsed', `${pace.daysIn}`],
                ['Thresholds', `green < ${PACE_AMBER}× · amber ${PACE_AMBER}–${PACE_RED}× · red > ${PACE_RED}×`],
              ],
              assumptions: ['Usual spend is the monthly average from your complete months, after any cut you planned in the simulator.', 'Goal delay = projected overspend ÷ monthly emergency-fund contribution.'],
              limitations: ['Spending is rarely even through a cycle; a big early purchase can look like fast pace.'],
            }}
          />
        </section>
      ) : (
        <Empty title="No pay cycle yet" body="Pace nudges need transactions. Import a statement or paste SMS for the current month." />
      )}

      <section aria-labelledby="nudges-h" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="nudges-h" className="display text-3xl uppercase">Nudges <span className="tnum text-dim">{nudges.length}</span></h2>
          {dismissedNudges.length > 0 && (
            <button type="button" onClick={() => setShowDismissed((s) => !s)} className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-dim hover:text-text">
              {showDismissed ? 'Hide' : 'Show'} {dismissedNudges.length} dismissed
            </button>
          )}
        </div>
        {nudges.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {nudges.map((n) => (
              <NudgeCard key={n.id} n={n} onDismiss={() => dismissNudge(n.id)} />
            ))}
          </ul>
        ) : (
          <p className="panel p-5 text-sm text-muted">Nothing is drifting right now.</p>
        )}
        {showDismissed && dismissedNudges.length > 0 && (
          <ul className="grid gap-3 opacity-70 lg:grid-cols-2">
            {dismissedNudges.map((n) => (
              <NudgeCard key={n.id} n={n} onRestore={() => restoreNudge(n.id)} />
            ))}
          </ul>
        )}
        <p className="text-xs text-dim">Dismissing hides a nudge, not the facts behind it: the numbers stay in the dashboard, Leak Radar and the monthly review. A dismissed nudge comes back if its numbers change.</p>
      </section>
    </div>
  )
}
