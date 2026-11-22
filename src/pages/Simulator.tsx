import { RotateCcw, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../app/store'
import { explainGoal, explainLifestyle, explainSurplus, explainSurvival } from '../components/financial/explain'
import { BalanceChart } from '../components/financial/BalanceChart'
import { goalHeadline } from '../components/financial/GoalStatus'
import { breakEvenGap } from '../lib/engine/insights'
import { Button, cx, Explain, MoneyInput, Num, SectionTitle, Segmented, Slider, type ExplainContent } from '../components/ui'
import { SIMULATION_DISCLAIMER, SURPLUS_GUIDANCE } from '../lib/copy'
import { DAYS_PER_MONTH, diffDays, formatDateShort } from '../lib/dates'
import { computeScenario, type GoalProjection, type Scenario } from '../lib/engine/model'
import { formatINR, formatMonths } from '../lib/format'
import { DEFAULT_SIM, FLEXIBLE_CATEGORIES, type FlexibleCategory, type SimState } from '../lib/types'

function shortGoal(g: GoalProjection): string {
  if (g.status === 'on_track' && g.date) return formatDateShort(g.date)
  return goalHeadline(g)
}

function monthsDelta(d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : ''
  const abs = Math.abs(d)
  const weeks = Math.round((abs * DAYS_PER_MONTH) / 7)
  return `${sign}${abs.toFixed(1)} months${weeks ? ` (${weeks} week${weeks === 1 ? '' : 's'})` : ''}`
}

/** Days sooner (+) or later (−); null when either side has no date. */
function dateShift(a: GoalProjection, b: GoalProjection): number | null {
  if (!a.date || !b.date || a.status === 'incomplete' || b.status === 'incomplete') return null
  return diffDays(a.date, b.date)
}

function Compare({ label, before, after, format, delta, explain }: { label: string; before: number | null; after: number | null; format: (n: number) => string; delta: (d: number) => string; explain: ExplainContent }) {
  const d = before != null && after != null ? after - before : null
  const positive = d != null && d > 0.0049
  const negative = d != null && d < -0.0049
  return (
    <div className="border-t border-line py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <div>
          <p className="label">{label}</p>
          <p className="display tnum mt-2 text-2xl text-muted sm:text-3xl">{before == null ? '—' : format(before)}</p>
        </div>
        <span className="pb-2 font-mono text-dim" aria-hidden>→</span>
        <div className="text-right">
          <p className={cx('display mt-2 text-4xl sm:text-5xl', positive && 'text-sage', negative && 'text-rose')}>
            <Num value={after} format={format} />
          </p>
          <p className={cx('tnum font-mono text-xs', positive ? 'text-sage' : negative ? 'text-rose' : 'text-dim')}>{d == null || Math.abs(d) < 0.005 ? 'no change' : delta(d)}</p>
        </div>
      </div>
      <Explain content={explain} className="mt-2" label="How?" />
    </div>
  )
}

function GoalCompare({ before, after }: { before: GoalProjection; after: GoalProjection }) {
  const shift = dateShift(before, after)
  return (
    <div className="border-t border-line py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <div>
          <p className="label">{before.name} date</p>
          <p className="display mt-2 text-2xl text-muted sm:text-3xl">{shortGoal(before)}</p>
        </div>
        <span className="pb-2 font-mono text-dim" aria-hidden>→</span>
        <div className="text-right">
          <p className={cx('display mt-2 text-4xl sm:text-5xl', shift != null && shift > 0 && 'text-sage', ((shift != null && shift < 0) || after.status === 'not_achievable') && 'text-rose')}>{shortGoal(after)}</p>
          <p className="font-mono text-xs text-dim">
            {shift != null && shift !== 0 ? (
              <span className={shift > 0 ? 'text-sage' : 'text-rose'}>{Math.abs(shift)} days {shift > 0 ? 'sooner' : 'later'}</span>
            ) : shift === 0 ? 'no change' : after.status === 'on_track' && before.status !== 'on_track' ? <span className="text-sage">now reachable</span> : after.status === 'not_achievable' && before.status === 'on_track' ? <span className="text-rose">no longer reachable</span> : after.status === 'incomplete' ? `missing ${after.missing.join(', ')}` : ''}
            {after.targetDate && after.vsTarget && <span className={cx('ml-2', after.vsTarget === 'behind' ? 'text-rose' : 'text-sage')}>· {after.vsTarget.replace('_', ' ')} vs {formatDateShort(after.targetDate)}</span>}
          </p>
        </div>
      </div>
      <Explain content={explainGoal(after)} className="mt-2" label="How?" />
    </div>
  )
}

const PRESETS: { label: string; sim: Partial<SimState> }[] = [
  { label: 'Cut dining out 30%', sim: { catCut: { category: 'Dining', pct: 30 } } },
  { label: 'Rent goes up 10%', sim: { rentStressPct: 10 } },
  { label: 'No salary for 2 months', sim: { incomeGapMonths: 2 } },
  { label: '₹50,000 medical bill', sim: { shockExpense: 50000 } },
]

export default function Simulator() {
  const { model, sim, patchSim, resetSim, scenarios, saveScenario, deleteScenario, applyScenario } = useStore()
  const [name, setName] = useState('')
  const base = model.baseline
  const cur = model.current
  const leaks = model.leaks.filter((l) => l.kind !== 'possible_duplicate')
  const catLine = model.base.flexible.find((l) => l.category === sim.catCut.category)?.amount ?? 0

  const attribution = useMemo(() => {
    const run = (s: Partial<SimState>) => computeScenario(model.ctx, s)
    const rows: { label: string; s: Scenario }[] = []
    if (sim.catCut.pct) rows.push({ label: `Cut ${sim.catCut.category} by ${sim.catCut.pct}%`, s: run({ catCut: sim.catCut }) })
    if (sim.disabledLeaks.length) {
      const names = leaks.filter((l) => sim.disabledLeaks.includes(l.id)).map((l) => l.label)
      rows.push({ label: `Cancel ${names.join(', ')}`, s: run({ disabledLeaks: sim.disabledLeaks }) })
    }
    if (sim.cutPct) rows.push({ label: `Cut all flexible spending ${sim.cutPct}%`, s: run({ cutPct: sim.cutPct }) })
    if (sim.rentStressPct) rows.push({ label: `Rent up ${sim.rentStressPct}%`, s: run({ rentStressPct: sim.rentStressPct }) })
    if (sim.emiStressPct) rows.push({ label: `EMIs up ${sim.emiStressPct}%`, s: run({ emiStressPct: sim.emiStressPct }) })
    if (sim.incomeGapMonths) rows.push({ label: `${sim.incomeGapMonths} month${sim.incomeGapMonths > 1 ? 's' : ''} without salary`, s: run({ incomeGapMonths: sim.incomeGapMonths }) })
    if (sim.shockExpense) rows.push({ label: `Emergency expense of ${formatINR(sim.shockExpense)}`, s: run({ shockExpense: sim.shockExpense }) })
    if (sim.extraEssential) rows.push({ label: sim.extraEssentialLabel || `New essential of ${formatINR(sim.extraEssential)}/month`, s: run({ extraEssential: sim.extraEssential }) })
    return rows
  }, [model.ctx, sim, leaks])

  const columns: { name: string; s: Scenario }[] = [
    { name: 'Current trajectory', s: base },
    { name: 'This simulation', s: cur },
    ...scenarios.map((sc) => ({ name: sc.name, s: computeScenario(model.ctx, sc.sim) })),
  ]

  return (
    <div className="space-y-10">
      <SectionTitle kicker="Simulator · what if" title="Change the trajectory">
        <Button variant="ghost" size="sm" onClick={resetSim}><RotateCcw size={13} /> Reset to baseline</Button>
      </SectionTitle>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1">Try</span>
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => patchSim({ ...DEFAULT_SIM, disabledLeaks: sim.disabledLeaks, ...p.sim })} className="h-8 border border-line px-3 text-xs text-muted transition-colors hover:border-amber hover:text-amber">
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section aria-label="Simulation controls" className="panel min-w-0 space-y-7 p-6">
          <div className="space-y-2">
            <label className="block">
              <span className="label">Cut one category</span>
              <select
                aria-label="Category to cut"
                value={sim.catCut.category}
                onChange={(e) => patchSim({ catCut: { ...sim.catCut, category: e.target.value as FlexibleCategory } })}
                className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm"
              >
                {FLEXIBLE_CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-graphite">{c === 'Dining' ? 'Dining out' : c}</option>
                ))}
              </select>
            </label>
            <Slider
              label={`Cut ${sim.catCut.category === 'Dining' ? 'dining out' : sim.catCut.category.toLowerCase()} by`}
              value={sim.catCut.pct}
              min={0}
              max={100}
              step={5}
              onChange={(v) => patchSim({ catCut: { ...sim.catCut, pct: v } })}
              format={(v) => `${v}%`}
              hint={`${formatINR(catLine)}/mo today${sim.catCut.pct ? ` → saves ${formatINR(cur.catCutAmount)}/mo` : ''}`}
            />
          </div>

          <Slider label="Cut all flexible spending" value={sim.cutPct} min={0} max={50} onChange={(v) => patchSim({ cutPct: v })} format={(v) => `${v}%`} hint={sim.cutPct ? `Saves ${formatINR(cur.cutAmount)}/mo on top of the other cuts` : `${formatINR(model.base.fs)}/mo flexible today`} />

          <fieldset>
            <legend className="label">Cancel recurring drains</legend>
            {leaks.length ? (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {leaks.map((l) => {
                  const on = sim.disabledLeaks.includes(l.id)
                  return (
                    <li key={l.id}>
                      <label className="flex cursor-pointer items-center gap-3 py-2.5 text-sm">
                        <input type="checkbox" checked={on} onChange={() => patchSim({ disabledLeaks: on ? sim.disabledLeaks.filter((x) => x !== l.id) : [...sim.disabledLeaks, l.id] })} className="h-4 w-4 accent-[#e3a548]" />
                        <span className={cx('flex-1', on ? 'text-text line-through decoration-amber/70' : 'text-muted')}>{l.label}{l.unused && <span className="ml-2 font-mono text-[0.6rem] uppercase text-warn">unused?</span>}</span>
                        <span className="tnum font-mono text-xs">{formatINR(l.monthly)}/mo</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-dim">No recurring drains detected in your data.</p>
            )}
          </fieldset>

          <div className="grid gap-7 sm:grid-cols-2">
            <Slider label="Rent increase" value={sim.rentStressPct} min={0} max={30} onChange={(v) => patchSim({ rentStressPct: v })} format={(v) => `+${v}%`} hint={`Rent ${formatINR(model.base.essential[0].amount)}/mo`} />
            <Slider label="EMI increase" value={sim.emiStressPct} min={0} max={30} onChange={(v) => patchSim({ emiStressPct: v })} format={(v) => `+${v}%`} hint={`EMIs ${formatINR(model.base.essential[1].amount)}/mo`} />
          </div>

          <div className="grid gap-7 sm:grid-cols-2">
            <div>
              <p className="label mb-2">Months without salary</p>
              <Segmented label="Months without salary" value={String(sim.incomeGapMonths) as '0' | '1' | '2' | '3'} onChange={(v) => patchSim({ incomeGapMonths: Number(v) })} options={(['0', '1', '2', '3'] as const).map((v) => ({ value: v, label: v === '0' ? 'None' : `${v} mo` }))} />
              {sim.incomeGapMonths > 0 && cur.cashAfterGap != null && (
                <p className={cx('mt-2 text-xs', cur.runsOutAfter != null ? 'text-rose' : 'text-muted')}>
                  {cur.runsOutAfter != null
                    ? `Cash runs out after about ${formatMonths(cur.runsOutAfter)} months.`
                    : `Cash after ${sim.incomeGapMonths} month${sim.incomeGapMonths > 1 ? 's' : ''}: ${formatINR(cur.cashAfterGap)}.`}
                </p>
              )}
            </div>
            <MoneyInput label="Emergency expense" value={sim.shockExpense || null} onChange={(v) => patchSim({ shockExpense: v ?? 0 })} placeholder="0" hint="A one-off bill paid from cash today." />
          </div>

          <MoneyInput
            label="New essential cost per month"
            value={sim.extraEssential || null}
            onChange={(v) => patchSim({ extraEssential: v ?? 0, extraEssentialLabel: v ? sim.extraEssentialLabel : '' })}
            placeholder="0"
            hint={sim.extraEssential ? sim.extraEssentialLabel || 'Added to essentials every month.' : 'E.g. rent up ₹3,500 or parents need ₹4,000 a month. Added to essentials.'}
          />
        </section>

        <section aria-label="Results" aria-live="polite" className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-px border border-line bg-line">
            <div className="bg-panel p-4">
              <p className="label">Current trajectory</p>
              <p className="mt-1 text-sm text-muted">Your data, no changes</p>
            </div>
            <div className="bg-[rgb(36_30_22/0.86)] p-4 text-right">
              <p className="label !text-amber">Simulated</p>
              <p className="mt-1 text-sm text-muted">With the controls on the left</p>
            </div>
          </div>
          <div className="panel p-5">
            <BalanceChart before={base} after={cur} gapMonths={sim.incomeGapMonths} target={cur.emergency.target} />
          </div>
          {breakEvenGap(cur) != null ? (
            <p className="border border-rose/40 bg-rose-soft px-4 py-3 text-base text-text">
              Spending is still <span className="tnum">{formatINR(breakEvenGap(cur)!)}</span>/month above take-home. Cut that much more to start saving; until then no goal can move.
            </p>
          ) : breakEvenGap(base) != null && cur.surplus != null ? (
            <p className="border border-sage/40 bg-sage-soft px-4 py-3 text-base text-text">This plan closes the {formatINR(breakEvenGap(base)!)}/month gap and leaves {formatINR(cur.surplus)}/month to save.</p>
          ) : null}
          <div className="panel px-5">
            <Compare label={sim.incomeGapMonths ? 'Survival runway after the gap' : 'Survival runway'} before={base.survival} after={cur.survival} format={(n) => `${formatMonths(n)} mo`} delta={monthsDelta} explain={explainSurvival(cur)} />
            <Compare label="Lifestyle runway" before={base.lifestyle} after={cur.lifestyle} format={(n) => `${formatMonths(n)} mo`} delta={monthsDelta} explain={explainLifestyle(cur)} />
            <Compare label="Monthly surplus" before={base.surplus} after={cur.surplus} format={formatINR} delta={(d) => `${d > 0 ? '+' : '−'}${formatINR(Math.abs(d))}/mo`} explain={explainSurplus(model, cur)} />
            <GoalCompare before={base.emergency} after={cur.emergency} />
            {cur.goals.map((g, i) => <GoalCompare key={g.id} before={base.goals[i]} after={g} />)}
          </div>

          <div className="panel p-5">
            <p className="label">Which action does what · each on its own</p>
            {attribution.length === 0 ? (
              <p className="mt-3 text-sm text-dim">Move a control or pick a preset to see its effect.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {attribution.map((a) => {
                  const dl = a.s.lifestyle != null && base.lifestyle != null ? (a.s.lifestyle - base.lifestyle) * DAYS_PER_MONTH : null
                  const ds = a.s.surplus != null && base.surplus != null ? a.s.surplus - base.surplus : null
                  const dg = dateShift(base.emergency, a.s.emergency)
                  return (
                    <li key={a.label} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
                      <span className="text-sm text-text">{a.label}</span>
                      <span className="tnum font-mono text-xs text-muted">
                        {ds != null && Math.abs(ds) >= 1 && <span className={ds >= 0 ? 'text-sage' : 'text-rose'}>{ds >= 0 ? '+' : '−'}{formatINR(Math.abs(ds))}/mo</span>}
                        {dl != null && Math.abs(dl) >= 0.5 && <> · {dl >= 0 ? '+' : '−'}{Math.round(Math.abs(dl))} days lifestyle</>}
                        {a.s.survival != null && base.survival != null && Math.abs(a.s.survival - base.survival) > 0.005 && <> · survival {a.s.survival > base.survival ? '+' : '−'}{Math.abs(a.s.survival - base.survival).toFixed(2)} mo</>}
                        {dg != null && dg !== 0 && <> · emergency fund {Math.abs(dg)}d {dg > 0 ? 'sooner' : 'later'}</>}
                        {a.s.emergency.status === 'not_achievable' && base.emergency.status !== 'not_achievable' && <span className="text-rose"> · fund not achievable</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-1 text-xs text-dim">
            <p>{SIMULATION_DISCLAIMER}</p>
            <p>{SURPLUS_GUIDANCE}</p>
            <p>Spending cuts change lifestyle runway and goal dates. Rent or EMI increases, an income gap or an emergency expense change survival runway.</p>
          </div>
        </section>
      </div>

      <section aria-labelledby="scn-h" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="scn-h" className="display text-3xl uppercase">Compare scenarios</h2>
          <form
            className="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault()
              saveScenario(name)
              setName('')
            }}
          >
            <label className="sr-only" htmlFor="scn-name">Scenario name</label>
            <input id="scn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this simulation" className="h-10 min-w-0 flex-1 border-b border-line-strong bg-transparent text-sm placeholder:text-dim/70 focus:border-amber focus:outline-none sm:w-56 sm:flex-none" />
            <Button type="submit" variant="ghost"><Save size={13} /> Save</Button>
          </form>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="label p-4 font-normal">Metric</th>
                {columns.map((c, i) => (
                  <th key={i} className={cx('p-4 font-normal', i === 1 && 'bg-amber-soft')}>
                    <span className={cx('label', i === 1 && '!text-amber')}>{c.name}</span>
                    {i >= 2 && (
                      <span className="mt-1 flex gap-2">
                        <button type="button" className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-dim hover:text-amber" onClick={() => applyScenario(scenarios[i - 2])}>Load</button>
                        <button type="button" aria-label={`Delete ${c.name}`} className="text-dim hover:text-rose" onClick={() => deleteScenario(scenarios[i - 2].id)}><Trash2 size={11} /></button>
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum font-mono">
              {(
                [
                  ['Survival runway', (s: Scenario) => (s.survival != null ? `${formatMonths(s.survival)} mo` : '—')],
                  ['Lifestyle runway', (s: Scenario) => (s.lifestyle != null ? `${formatMonths(s.lifestyle)} mo` : '—')],
                  ['Monthly surplus', (s: Scenario) => (s.surplus != null ? formatINR(s.surplus) : '—')],
                  ['Flexible spending', (s: Scenario) => formatINR(s.fs)],
                  ['Essentials', (s: Scenario) => formatINR(s.emb)],
                  ['Emergency fund', (s: Scenario) => shortGoal(s.emergency)],
                  ...base.goals.map((g, gi) => [g.name, (s: Scenario) => (s.goals[gi] ? shortGoal(s.goals[gi]) : '—')] as [string, (s: Scenario) => string]),
                ] as [string, (s: Scenario) => string][]
              ).map(([label, f]) => (
                <tr key={label} className="border-t border-line">
                  <td className="p-4 font-sans text-muted">{label}</td>
                  {columns.map((c, i) => (
                    <td key={i} className={cx('p-4', i === 1 && 'bg-amber-soft text-text')}>{f(c.s)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {scenarios.length === 0 && <p className="text-sm text-dim">Saved simulations appear here side by side. They stay in this browser.</p>}
      </section>
    </div>
  )
}
