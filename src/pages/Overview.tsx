import { AlertTriangle, ArrowRight, BellRing, Bot, CheckCircle2, ChevronDown, Radar, Sparkles, Target } from 'lucide-react'
import { useEffect, useState } from 'react'
import { go } from '../app/router'
import { useStore } from '../app/store'
import {
  explainCash,
  explainDTI,
  explainEMB,
  explainFS,
  explainGoal,
  explainLifestyle,
  explainNoise,
  explainSurplus,
  explainSurvival,
} from '../components/financial/explain'
import { Glossary } from '../components/financial/Glossary'
import { GoalRow } from '../components/financial/GoalStatus'
import { NudgeCard } from '../components/financial/NudgeCard'
import { RunwayTimeline } from '../components/financial/RunwayTimeline'
import { Button, cx, Explain, Num, Tag, type ExplainContent } from '../components/ui'
import { SIMULATION_DISCLAIMER } from '../lib/copy'
import { formatDateLong, formatDateShort } from '../lib/dates'
import { breakEvenGap, lifestyleRange, suggestPlan } from '../lib/engine/insights'
import { daysOfRunwayPerMonth, DTI_CAUTION, DTI_HIGH, dtiBand } from '../lib/engine/model'
import type { Leak } from '../lib/engine/recurring'
import { formatINR, formatMonths, formatPct } from '../lib/format'

function Metric({ label, value, sub, explain, tone }: { label: string; value: number | null; sub?: string; explain: ExplainContent; tone?: 'rose' | 'sage' }) {
  return (
    <div className="border-t border-line pt-4">
      <p className="label">{label}</p>
      <p className={cx('display mt-2 text-4xl', tone === 'rose' && 'text-rose', tone === 'sage' && 'text-sage')}>
        <Num value={value} format={formatINR} />
      </p>
      {sub && <p className="mt-1 text-sm text-dim">{sub}</p>}
      <Explain content={explain} className="mt-3" />
    </div>
  )
}

function leakAlert(l: Leak): { tag: string; tone: 'rose' | 'warn' | 'amber'; text: string } | null {
  if (l.unused && l.usage) return { tag: 'Possibly unused', tone: 'warn', text: `No ${l.usage.label.toLowerCase()} in ${l.usage.daysSince} days` }
  if (l.category == null && l.isNew) return { tag: 'New, unrecognised', tone: 'warn', text: `First charged ${formatDateShort(l.firstDate)}` }
  if (l.priceChange) return { tag: 'Price up', tone: 'rose', text: `${formatINR(l.priceChange.from)} → ${formatINR(l.priceChange.to)}` }
  if (l.isNew) return { tag: 'New charge', tone: 'amber', text: `Since ${formatDateShort(l.firstDate)}` }
  if (l.category == null) return { tag: 'Unknown mandate', tone: 'warn', text: 'Merchant not recognised' }
  return null
}

const OPEN_KEY = 'runway.overview.breakdown'

export function Overview() {
  const { model, profile, nudges, applyPlan, reconciliations, sim, triage } = useStore()
  const s = model.baseline
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')
  useEffect(() => {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  }, [open])

  const gap = breakEvenGap(s)
  const plan = suggestPlan(model)
  const range = lifestyleRange(model, s)
  // Same order as the "Try this" plan and the copilot: unused, then unknown, then new, then price rises.
  const priority = (l: Leak) => (l.unused ? 4 : l.category == null ? 3 : l.isNew ? 2 : 1)
  const alerts = (model.leaks.map((l) => ({ l, a: leakAlert(l) })).filter((x) => x.a) as { l: Leak; a: NonNullable<ReturnType<typeof leakAlert>> }[]).sort(
    (x, y) => priority(y.l) - priority(x.l) || y.l.monthly - x.l.monthly,
  )
  const topLeak = alerts[0]
  const drift = nudges.filter((n) => n.kind === 'pace' || n.kind === 'goal_delay' || n.kind === 'runway')
  const ccPaid = model.noise.byCategory['CC repayment']
  const hasCardData = model.active.some((t) => t.statementType === 'card')
  const band = s.dti != null ? dtiBand(s.dti) : null
  const top = [...model.base.flexible].filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount)
  const flexMax = Math.max(1, ...top.map((l) => l.amount))
  const fixed = model.base.essential.filter((l) => l.amount > 0)
  const ef = s.emergency
  const simActive =
    sim.cutPct > 0 || sim.catCut.pct > 0 || sim.rentStressPct > 0 || sim.emiStressPct > 0 || sim.incomeGapMonths > 0 || sim.shockExpense > 0 || sim.disabledLeaks.length > 0
  const recs = reconciliations.slice(-2)

  const tryPlan = () => {
    if (!plan) return
    applyPlan(plan.sim)
    go('simulator')
  }

  return (
    <div className="space-y-10">
      {model.cash == null && (
        <p className="flex flex-wrap items-center gap-3 border border-warn/30 px-4 py-3 text-sm text-muted">
          <AlertTriangle size={16} className="text-warn" aria-hidden /> Enter your accessible cash to calculate runway.
          <Button size="sm" variant="ghost" onClick={() => go('profile')}>Add cash</Button>
        </p>
      )}

      {/* HERO: confidence vs reality */}
      <section aria-labelledby="survival-h" className="grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <p className="label !text-amber">Survival runway</p>
          <p className="mt-2 text-lg text-muted">
            {model.cash != null ? (
              <>You have <span className="tnum text-text">{formatINR(model.cash)}</span> in accessible cash. That covers</>
            ) : (
              'Your accessible cash covers'
            )}
          </p>
          <h1 id="survival-h" className="sr-only">Survival runway</h1>
          <p className="display mt-2 flex items-baseline gap-4 text-[clamp(5.5rem,17vw,11.5rem)] leading-[0.8]" aria-describedby="survival-sub">
            <Num value={s.survival} format={formatMonths} />
            <span className="text-[0.26em] tracking-[0.08em] text-muted">MONTHS</span>
          </p>
          <p id="survival-sub" className="mt-4 max-w-xl text-lg text-muted">
            of essentials{s.emb > 0 ? <> (<span className="tnum">{formatINR(s.emb)}</span>/month)</> : null} if your income stopped.
          </p>
          <Explain content={explainSurvival(s)} className="mt-3" />
        </div>
        <div className="border-l border-line pl-6 lg:pb-8">
          <p className="label">Lifestyle runway</p>
          <p className="display mt-2 flex items-baseline gap-3 text-6xl leading-none text-text/80">
            <Num value={s.lifestyle} format={formatMonths} />
            <span className="text-xl tracking-[0.08em] text-dim">MONTHS</span>
          </p>
          <p className="mt-3 text-base text-muted">
            The same cash if you also keep today’s flexible spending
            {s.fs > 0 ? <> (<span className="tnum">{formatINR(s.fs)}</span>/month)</> : null}.
          </p>
          {range && range.high - range.low >= 0.05 && (
            <p className="mt-1 text-sm text-dim">Could rise to {formatMonths(range.high)} once you review {formatINR(range.unreviewed)}/month of unclassified spending.</p>
          )}
          <Explain content={explainLifestyle(s)} className="mt-3" />
        </div>
      </section>

      {/* ONE PRIMARY ACTION */}
      {(plan || gap) && (
        <section aria-label="What to do next" className="flex flex-col gap-4 border border-amber/40 bg-[rgb(36_30_22/0.86)] p-5 sm:flex-row sm:items-center">
          <Sparkles size={20} className="shrink-0 text-amber" aria-hidden />
          <div className="flex-1">
            {gap != null ? (
              <p className="text-lg text-text">
                You spend <span className="tnum text-rose">{formatINR(gap)}</span> a month more than you take home. Cut <span className="tnum">{formatINR(gap)}/month</span> to start saving.
              </p>
            ) : null}
            {plan && (
              <p className={cx('text-text', gap != null ? 'mt-1 text-base text-muted' : 'text-lg')}>
                <span className="label mr-2 !text-amber">Try this</span>
                {plan.steps.join(', ')}:{' '}
                {plan.surplusGain != null && <span className="tnum text-sage">+{formatINR(plan.surplusGain)}/month</span>}
                {plan.efSoonerDays != null && plan.efSoonerDays > 0 ? <>, emergency fund <span className="text-sage">{Math.round(plan.efSoonerDays / 7)} weeks sooner</span></> : plan.unlocks ? <>, and your emergency fund becomes <span className="text-sage">reachable</span></> : null}
                {plan.lifestyleGainDays != null && plan.lifestyleGainDays >= 1 && <>, +{Math.round(plan.lifestyleGainDays)} days of lifestyle runway</>}.
              </p>
            )}
          </div>
          {plan && <Button variant="primary" onClick={tryPlan}>Try it in the simulator <ArrowRight size={13} /></Button>}
        </section>
      )}

      {/* THREE STORY CARDS */}
      <section aria-label="What needs attention" className="grid gap-6 lg:grid-cols-3">
        <div className="panel flex flex-col p-6">
          <div className="flex items-center justify-between"><p className="label">Leak to check first</p><Radar size={16} className="text-amber" aria-hidden /></div>
          {topLeak ? (
            <>
              <p className="display mt-3 text-3xl uppercase">{topLeak.l.label}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><Tag tone={topLeak.a.tone}>{topLeak.a.tag}</Tag>{topLeak.a.text}</p>
              <p className="mt-3 text-base text-text">
                <span className="tnum">{formatINR(topLeak.l.monthly)}/month</span> costs about {daysOfRunwayPerMonth(topLeak.l.monthly, s.burn)?.toFixed(1)} days of runway every month.
              </p>
              {alerts.length > 1 && <p className="mt-1 text-sm text-dim">+{alerts.length - 1} more recurring charge{alerts.length > 2 ? 's' : ''} to check.</p>}
            </>
          ) : (
            <p className="mt-3 text-base text-muted">{model.hasTransactions ? 'No unused, new, unknown or price-raised recurring charges.' : 'Import a statement to scan for recurring drains.'}</p>
          )}
          <div className="mt-auto pt-5"><Button size="sm" variant="subtle" className="!px-0" onClick={() => go('leaks')}>Open Leak Radar <ArrowRight size={12} /></Button></div>
        </div>

        <div className="panel flex flex-col p-6">
          <div className="flex items-center justify-between"><p className="label">Goals</p><Target size={16} className="text-amber" aria-hidden /></div>
          {gap != null ? (
            <>
              <p className="display mt-3 text-3xl uppercase text-rose">On hold</p>
              <p className="mt-1 text-base text-muted">No goal can move while spending is {formatINR(gap)}/month above take-home.</p>
              <ul className="mt-4 space-y-1 text-sm text-dim">{[ef, ...s.goals].map((g) => <li key={g.id}>{g.name}{g.targetDate ? ` · target ${formatDateShort(g.targetDate)}` : ''}</li>)}</ul>
            </>
          ) : (
            <div className="mt-3 space-y-5">
              <GoalRow g={ef} compact />
              {s.goals.map((g) => <GoalRow key={g.id} g={g} compact />)}
            </div>
          )}
          <div className="mt-auto pt-5"><Button size="sm" variant="subtle" className="!px-0" onClick={() => go('profile')}>Goals & profile <ArrowRight size={12} /></Button></div>
        </div>

        <div className="panel flex flex-col p-6">
          <div className="flex items-center justify-between"><p className="label">This pay cycle</p><BellRing size={16} className="text-amber" aria-hidden /></div>
          {drift[0] ? (
            <>
              <p className="mt-3 text-lg text-text">{drift[0].title}</p>
              <p className="mt-2 text-sm text-muted">{drift[0].consequence}</p>
              {drift.length > 1 && <p className="mt-2 text-sm text-dim">+{drift.length - 1} more in the Nudge Center.</p>}
            </>
          ) : (
            <p className="mt-3 text-base text-muted">Nothing is running ahead of pace this cycle.</p>
          )}
          <div className="mt-auto pt-5"><Button size="sm" variant="subtle" className="!px-0" onClick={() => go('nudges')}>All nudges <ArrowRight size={12} /></Button></div>
        </div>
      </section>

      {/* DATA CHECK: one quiet line. Questions and the review queue live on the Review screen. */}
      {model.hasTransactions && (
        <section aria-label="How much to trust these numbers" className="space-y-2">
          <div className="flex flex-col gap-3 border-y border-line py-3 text-sm sm:flex-row sm:items-center">
            <ul className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1.5 text-muted">
              {recs.map((r) => (
                <li key={r.batchId} className="flex items-center gap-2">
                  {r.rec.ok ? <CheckCircle2 size={14} className="text-sage" aria-hidden /> : <AlertTriangle size={14} className="text-warn" aria-hidden />}
                  {r.rec.ok ? `${r.label}: balances reconcile` : `${r.label}: balance breaks near ${formatDateShort(r.rec.breaks[0].date)}, rows may be missing`}
                </li>
              ))}
              {triage.length > 0 && (
                <li className="flex items-center gap-2">
                  <Bot size={14} className="text-amber" aria-hidden />
                  {triage.length} question{triage.length > 1 ? 's' : ''} about your data, the first worth {formatINR(triage[0].impact)}/month
                </li>
              )}
              {model.reviewCount > 0 && <li>{model.reviewCount} transactions unreviewed (counted as flexible spending for now)</li>}
            </ul>
            {(triage.length > 0 || model.reviewCount > 0) && (
              <Button size="sm" variant="ghost" onClick={() => go('review')}>Review <ArrowRight size={12} /></Button>
            )}
          </div>
          {ccPaid > 0 && !hasCardData && (
            <p className="flex items-start gap-3 border border-warn/30 px-4 py-3 text-sm text-muted">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>You paid {formatINR(ccPaid)} in card bills, which Runway excludes to avoid double-counting. No card statement is loaded, so card purchases are missing. <a href="#/import/statement" className="text-amber underline-offset-4 hover:underline">Import it</a>.</span>
            </p>
          )}
          {simActive && <p className="text-sm text-dim">The simulator has changes in it. They are not applied here; this page always shows your real numbers. <a href="#/simulator" className="text-amber underline-offset-4 hover:underline">Open simulator</a></p>}
        </section>
      )}

      {/* EVERYTHING ELSE, COLLAPSED */}
      <section aria-label="Full breakdown">
        <button type="button" aria-expanded={open} aria-controls="breakdown" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between border-y border-line py-4 text-left">
          <span className="display text-2xl uppercase">Full breakdown</span>
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-muted">
            Income, costs, goals, alerts, EMI load, noise <ChevronDown size={16} className={cx('transition-transform', open && 'rotate-180')} aria-hidden />
          </span>
        </button>
        {open && (
          <div id="breakdown" className="animate-fade-up space-y-10 pt-8">
            <div className="panel px-5 pb-5 pt-6">
              <RunwayTimeline survival={s.survival} lifestyle={s.lifestyle} target={profile.emergency.targetOverride ? null : profile.emergency.months} />
            </div>
            <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Net take-home" value={s.takeHome} sub={model.takeHomeSource === 'statements' ? `Detected from ${model.salary?.label}` : model.takeHomeSource === 'you' ? 'You entered it' : 'Not known yet'} explain={explainSurplus(model, s)} />
              <Metric label="Accessible cash" value={model.cash} sub={profile.includeFD ? 'Savings + FDs after haircut' : 'Savings you could use this week'} explain={explainCash(model, profile)} />
              <Metric label="Essentials · per month" value={s.emb} sub="What you must pay every month" explain={explainEMB(model)} />
              <Metric label="Monthly surplus" value={s.surplus} sub={`After ${formatINR(s.fs)} of flexible spending`} explain={explainFS(model)} tone={s.surplus != null && s.surplus < 0 ? 'rose' : undefined} />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="panel p-6">
                <p className="label">Essentials · per month</p>
                <ul className="mt-4 divide-y divide-line">
                  {fixed.map((l) => (
                    <li key={l.category} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                      <span className="text-muted">{l.category}{l.source === 'you' && <span className="ml-2 font-mono text-xs uppercase text-amber">yours</span>}</span>
                      <span className="tnum font-mono">{formatINR(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex justify-between border-t border-line-strong pt-3 font-mono text-sm"><span className="text-dim">Total</span><span className="tnum">{formatINR(s.emb)}</span></p>
              </div>
              <div className="panel p-6">
                <p className="label">Flexible spending · per month</p>
                <ul className="mt-4 space-y-2.5">
                  {top.map((l) => (
                    <li key={l.category} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-sm">
                      <span className="truncate text-muted">{l.category === 'Other' ? 'Unclassified' : l.category}</span>
                      <span className="h-1.5 bg-white/[0.05]" aria-hidden><span className="block h-full bg-amber/75" style={{ width: `${(l.amount / flexMax) * 100}%` }} /></span>
                      <span className="tnum text-right font-mono">{formatINR(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex justify-between border-t border-line-strong pt-3 font-mono text-sm"><span className="text-dim">Total</span><span className="tnum">{formatINR(s.fs)}</span></p>
              </div>
              <div className="panel p-6">
                <p className="label">Emergency fund</p>
                <div className="mt-4"><GoalRow g={ef} /></div>
                {ef.date && <p className="mt-3 text-sm text-muted">Projected {formatDateLong(ef.date)}.</p>}
                <Explain content={explainGoal(ef)} className="mt-4" />
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="panel p-6">
                <p className="label">All leak alerts</p>
                <ul className="mt-4 divide-y divide-line">
                  {alerts.map(({ l, a }) => (
                    <li key={l.id} className="space-y-1 py-3">
                      <div className="flex items-baseline justify-between gap-3"><p className="truncate text-text">{l.label}</p><p className="tnum shrink-0 font-mono text-sm">{formatINR(l.monthly)}/mo</p></div>
                      <p className="flex flex-wrap items-center gap-2 text-sm text-dim"><Tag tone={a.tone}>{a.tag}</Tag>{a.text}</p>
                    </li>
                  ))}
                  {!alerts.length && <li className="py-3 text-sm text-muted">None.</li>}
                </ul>
              </div>
              <div className="flex flex-col gap-3">
                <p className="label px-1">Drift alerts</p>
                {drift.length ? <ul className="space-y-3">{drift.map((n) => <NudgeCard key={n.id} n={n} compact />)}</ul> : <p className="panel p-5 text-sm text-muted">Nothing is running ahead of pace.</p>}
              </div>
              <div className="flex flex-col gap-6">
                <div className="panel p-6">
                  <p className="label">EMI / debt load</p>
                  <p className={cx('display mt-3 text-4xl', band === 'high' && 'text-rose', band === 'caution' && 'text-warn')}>{s.dti != null ? formatPct(s.dti, 1) : '—'}</p>
                  <p className="mt-1 text-sm text-muted">{formatINR(s.emi)}/mo of EMIs{s.takeHome != null ? ` on ${formatINR(s.takeHome)} take-home` : ''}</p>
                  {s.dti != null && (
                    <div className="relative mt-4 h-1.5 bg-white/[0.06]" aria-hidden>
                      <div className={cx('h-full', band === 'high' ? 'bg-rose' : band === 'caution' ? 'bg-warn' : 'bg-sage')} style={{ width: `${Math.min(100, (s.dti / 0.6) * 100)}%` }} />
                      <span className="absolute -top-1 h-3.5 w-px bg-warn" style={{ left: `${(DTI_CAUTION / 0.6) * 100}%` }} />
                      <span className="absolute -top-1 h-3.5 w-px bg-rose" style={{ left: `${(DTI_HIGH / 0.6) * 100}%` }} />
                    </div>
                  )}
                  <p className="mt-2 text-sm text-dim">35% caution and 40% higher-stress marks are rules of thumb, not limits.</p>
                  <Explain content={explainDTI(model, s)} className="mt-3" />
                </div>
                <div className="panel p-6">
                  <p className="label">Noise removed</p>
                  <p className="display mt-3 text-4xl"><Num value={model.noise.removed} format={formatINR} /></p>
                  <p className="mt-1 text-sm text-muted">Card bills, self-transfers and splits excluded from spending.</p>
                  <Explain content={explainNoise(model)} className="mt-3" />
                </div>
              </div>
            </div>
            <Glossary />
          </div>
        )}
      </section>

      <p className="text-sm text-dim">{SIMULATION_DISCLAIMER}</p>
    </div>
  )
}
