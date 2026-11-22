import { Download, Printer } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Bot } from 'lucide-react'
import { monthlyNarrative } from '../lib/agents/supervisor'
import { Tracer } from '../lib/agents/types'
import { ungroundedNumbers } from '../lib/agents/guardrails'
import { openAgent } from '../components/agent/openAgent'
import { useStore } from '../app/store'
import { AssumptionsPanel } from '../components/financial/Assumptions'
import { GoalRow } from '../components/financial/GoalStatus'
import { Button, cx, Empty, SectionTitle } from '../components/ui'
import { download } from '../lib/backup'
import { EDUCATION_DISCLAIMER, SIMULATION_DISCLAIMER } from '../lib/copy'
import { formatDateLong, todayISO } from '../lib/dates'
import { dtiBand } from '../lib/engine/model'
import { buildMissionReview, reviewToMarkdown, type MonthStats } from '../lib/engine/review'
import { formatINR, formatMonths, formatPct } from '../lib/format'

type Row = { label: string; get: (m: MonthStats) => number | null; fmt: (n: number) => string; good: 'up' | 'down' }

const ROWS: Row[] = [
  { label: 'Income (salary + other credits)', get: (m) => m.income, fmt: formatINR, good: 'up' },
  { label: 'Essentials', get: (m) => m.essential, fmt: formatINR, good: 'down' },
  { label: 'Flexible spending', get: (m) => m.flexible, fmt: formatINR, good: 'down' },
  { label: 'Surplus', get: (m) => m.surplus, fmt: formatINR, good: 'up' },
  { label: 'Net savings rate', get: (m) => m.savingsRate, fmt: (n) => formatPct(n, 1), good: 'up' },
  { label: 'Transfers & repayments removed', get: (m) => m.excluded, fmt: formatINR, good: 'down' },
]

function Movement({ label, start, end, fmt }: { label: string; start: number | null; end: number | null; fmt: (n: number) => string }) {
  const d = start != null && end != null ? end - start : null
  return (
    <div className="bg-panel p-5">
      <p className="label">{label}</p>
      <p className="display tnum mt-2 flex items-baseline gap-3 text-4xl">
        <span className="text-muted">{start != null ? fmt(start) : '—'}</span>
        <span className="text-xl text-dim" aria-hidden>→</span>
        <span>{end != null ? fmt(end) : '—'}</span>
      </p>
      {d != null && <p className={cx('tnum mt-1 font-mono text-xs', d >= 0 ? 'text-sage' : 'text-rose')}>{d >= 0 ? '+' : '−'}{fmt(Math.abs(d))} over the month</p>}
    </div>
  )
}

export default function MissionReview() {
  const { model, rules, decisions, logTrace, txns } = useStore()
  const review = useMemo(() => buildMissionReview(model, rules, decisions), [model, rules, decisions])
  const narrative = review ? monthlyNarrative(review) : null

  // the Monthly Review & Drift agent runs once per data change, not on every visit
  useEffect(() => {
    if (!review || !narrative) return
    const sig = `${txns.length}:${rules.length}:${Object.keys(decisions).length}:${review.current.key}`
    if (sessionStorage.getItem('runway.reviewAgent') === sig) return
    sessionStorage.setItem('runway.reviewAgent', sig)
    const tr = new Tracer('Monthly Review & Drift', 'Monthly checkpoint', review.current.label)
    tr.plan('Compute month metrics and runway movement', 'Detect new, changed and unused recurring charges', 'Write a grounded brief', 'Select one next mission')
    tr.call('generate_monthly_review', { month: review.current.key }, () => review, (r) => `${r.changes.length} changes; ${r.corrections.rules} rules learned`)
    tr.call('detect_leak_changes', {}, () => model.leaks.filter((l) => l.priceChange || l.isNew || l.unused).length, (n) => `${n} recurring charges changed, new or unused`)
    tr.call('select_next_mission', {}, () => review.nextAction, (a) => a.slice(0, 90))
    const outputs = [{ current: review.current, previous: review.previous, runwayStart: review.runwayStart, runwayEnd: review.runwayEnd, savingsPct: review.current.savingsRate != null ? Math.round(review.current.savingsRate * 100) : null, essentialChange: review.previous ? Math.abs(review.current.essential - review.previous.essential) : null, flexibleChange: review.previous ? Math.abs(review.current.flexible - review.previous.flexible) : null }]
    const missing = ungroundedNumbers(narrative, outputs)
    tr.verify(missing.length ? `Grounding check: ${missing.join(', ')} not found in metrics` : 'Grounding check: every figure in the brief comes from the review metrics')
    tr.result(narrative, `Next mission: ${review.nextAction}`).guard('Education only: no product advice', true).local()
    logTrace(tr.done())
  }, [review, narrative]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!review) {
    return (
      <div className="space-y-8">
        <SectionTitle kicker="Monthly review" title="Your briefing" />
        <Empty title="Needs statement data" body="The monthly review compares calendar months from your statements or SMS. Import at least one month to see it." />
      </div>
    )
  }
  const { current: cur, previous: prev } = review
  const drains = model.leaks.filter((l) => l.kind !== 'possible_duplicate').slice(0, 3)
  const band = review.emiLoad != null ? dtiBand(review.emiLoad) : null
  const months = (n: number) => `${formatMonths(n)} mo`

  return (
    <div className="print-sheet space-y-10">
      <SectionTitle kicker={`Monthly review${review.partial ? ' · partial month' : ''}`} title={cur.label}>
        <Button variant="ghost" className="no-print" onClick={() => download(`runway-review-${cur.key}.md`, reviewToMarkdown(review))}><Download size={14} /> Export</Button>
        <Button variant="ghost" className="no-print" onClick={() => window.print()}><Printer size={14} /> Print</Button>
      </SectionTitle>
      {review.partial && <p className="text-sm text-warn">Your data does not cover all of {cur.label}, so totals are for the days available ({cur.txnCount} transactions).</p>}

      {narrative && (
        <section className="print-avoid-break flex items-start gap-3 border border-line p-5">
          <Bot size={18} className="mt-1 shrink-0 text-amber" aria-hidden />
          <div className="flex-1">
            <p className="label">Monthly brief · written by the review agent from the numbers below</p>
            <p className="mt-2 text-lg leading-snug text-text">{narrative}</p>
          </div>
          <button type="button" className="no-print shrink-0 font-mono text-xs uppercase tracking-[0.1em] text-amber hover:underline" onClick={() => openAgent('trace')}>Trace</button>
        </section>
      )}

      <section className="print-avoid-break border border-amber/40 bg-[rgb(36_30_22/0.86)] p-6">
        <p className="label !text-amber">Next mission</p>
        <p className="mt-3 max-w-3xl text-xl leading-snug text-text">{review.nextAction}</p>
      </section>

      {/* 1 · month at a glance */}
      <section aria-labelledby="glance-h" className="print-avoid-break space-y-3">
        <h2 id="glance-h" className="display text-3xl uppercase">Month at a glance</h2>
        <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Net savings rate', cur.savingsRate != null ? formatPct(cur.savingsRate, 1) : '—', cur.savingsRate != null && cur.savingsRate < 0],
            ['Income', formatINR(cur.income), false],
            ['Essentials', formatINR(cur.essential), false],
            ['Flexible spending', formatINR(cur.flexible), false],
            ['Surplus', formatINR(cur.surplus), cur.surplus < 0],
          ].map(([k, v, bad]) => (
            <div key={k as string} className="bg-panel p-5">
              <p className="label">{k}</p>
              <p className={cx('display tnum mt-2 text-4xl', bad && 'text-rose')}>{v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2 · runway movement */}
      <section aria-labelledby="move-h" className="print-avoid-break space-y-3">
        <h2 id="move-h" className="display text-3xl uppercase">Runway movement</h2>
        {review.balancesKnown ? (
          <div className="grid gap-px border border-line bg-line lg:grid-cols-3">
            <Movement label="Survival runway, start → end" start={review.runwayStart} end={review.runwayEnd} fmt={months} />
            <Movement label="Lifestyle runway, start → end" start={review.lifestyleStart} end={review.lifestyleEnd} fmt={months} />
            <Movement label="Emergency fund, % of target" start={review.efStart} end={review.efEnd} fmt={(n) => formatPct(n)} />
          </div>
        ) : (
          <p className="panel p-5 text-sm text-muted">Your statements do not carry running balances, so start and end of month cannot be measured. Import a bank statement with a balance column to see runway movement.</p>
        )}
        <p className="text-xs text-dim">From the bank balance at the start and end of {cur.label}, divided by your usual essentials ({formatINR(model.baseline.emb)}) and total spending ({formatINR(model.baseline.burn)}).</p>
      </section>

      {/* 3 · what changed */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="print-avoid-break panel p-6">
          <h2 className="label">What changed</h2>
          {review.changes.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {review.changes.map((c) => (
                <li key={c.text} className="flex gap-3 text-text">
                  <span className={cx('mt-2 h-px w-3 shrink-0', c.tone === 'good' ? 'bg-sage' : c.tone === 'warn' ? 'bg-warn' : 'bg-line-strong')} aria-hidden />
                  {c.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No meaningful change from last month.</p>
          )}
        </div>
        {/* 4 · corrections learned */}
        <div className="print-avoid-break panel p-6">
          <h2 className="label">Corrections learned</h2>
          <dl className="mt-4 grid grid-cols-3 gap-4">
            <div><dt className="label !text-dim">Rules</dt><dd className="display tnum mt-1 text-4xl">{review.corrections.rules}</dd></div>
            <div><dt className="label !text-dim">Reclassified</dt><dd className="display tnum mt-1 text-4xl">{review.corrections.reclassified}</dd></div>
            <div><dt className="label !text-dim">Noise removed</dt><dd className="display tnum mt-1 text-4xl">{formatINR(review.corrections.noiseRemoved)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-dim">Rules are yours and apply to every future import. Noise removed is for {cur.label}.</p>
          <h3 className="label mt-6">Top recurring drains</h3>
          <ol className="mt-2 divide-y divide-line">
            {drains.map((l, i) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span><span className="tnum mr-3 font-mono text-dim">{i + 1}</span>{l.label}{l.unused && <span className="ml-2 text-xs text-warn">unused?</span>}{l.priceChange && <span className="ml-2 text-xs text-rose">price up</span>}</span>
                <span className="tnum font-mono">{formatINR(l.monthly)}/mo</span>
              </li>
            ))}
            {!drains.length && <li className="py-2 text-sm text-muted">None detected.</li>}
          </ol>
        </div>
      </section>

      {/* 5 · goal status */}
      <section aria-labelledby="goals-h" className="print-avoid-break space-y-3">
        <h2 id="goals-h" className="display text-3xl uppercase">Goal status</h2>
        <div className="panel grid gap-6 p-6 lg:grid-cols-2">
          {review.goals.map((g) => <GoalRow key={g.id} g={g} />)}
        </div>
      </section>

      <section className="print-avoid-break space-y-3">
        <h2 className="display text-3xl uppercase">This month vs last month</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="label p-4 font-normal"><span className="sr-only">Metric</span></th>
                <th className="label p-4 text-right font-normal">{prev?.label ?? '—'}</th>
                <th className="label p-4 text-right font-normal !text-amber">{cur.label}</th>
                <th className="label p-4 text-right font-normal">Change</th>
              </tr>
            </thead>
            <tbody className="tnum font-mono">
              {ROWS.map((r) => {
                const a = prev ? r.get(prev) : null
                const b = r.get(cur)
                const d = a != null && b != null ? b - a : null
                const better = d != null && (r.good === 'up' ? d > 0 : d < 0)
                return (
                  <tr key={r.label} className="border-t border-line">
                    <td className="p-4 font-sans text-muted">{r.label}</td>
                    <td className="p-4 text-right text-muted">{a != null ? r.fmt(a) : '—'}</td>
                    <td className="p-4 text-right text-text">{b != null ? r.fmt(b) : '—'}</td>
                    <td className={cx('p-4 text-right', d == null || Math.abs(d) < 0.0005 ? 'text-dim' : better ? 'text-sage' : 'text-rose')}>
                      {d == null ? '—' : r.label === 'Net savings rate' ? `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts` : `${d >= 0 ? '+' : '−'}${r.fmt(Math.abs(d))}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {band && band !== 'ok' && <p className="text-sm text-warn">EMI burden {formatPct(review.emiLoad!, 1)} is above the 35% caution mark (a rule of thumb).</p>}
      </section>

      <AssumptionsPanel />

      <footer className="space-y-1 border-t border-line pt-4 text-xs text-dim">
        <p>Prepared {formatDateLong(todayISO())} from data stored in this browser.</p>
        <p>{SIMULATION_DISCLAIMER}</p>
        <p>{EDUCATION_DISCLAIMER}</p>
      </footer>
    </div>
  )
}
