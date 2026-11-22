import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, DAYS_PER_MONTH, formatDateShort, todayISO } from '../../lib/dates'
import type { Scenario } from '../../lib/engine/model'
import { formatINR } from '../../lib/format'

/** Validated against the chart surface (#141518, dark): L 0.48–0.67, contrast ≥ 3:1. */
const SIM = '#c08532'
const REF = '#8f8a82'

/**
 * Accessible cash month by month: start from today's cash (less any emergency expense),
 * lose the whole monthly burn during an income gap, then add the monthly surplus.
 */
export function projectBalance(s: Scenario, gapMonths: number, horizon: number): number[] {
  const out: number[] = []
  const start = s.cash ?? 0
  for (let t = 0; t <= horizon; t++) {
    const inGap = Math.min(t, gapMonths)
    const after = Math.max(0, t - gapMonths)
    out.push(start - inGap * s.burn + after * (s.surplus ?? 0))
  }
  return out
}

function compact(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`
  if (a >= 1e3) return `${sign}₹${Math.round(a / 1e3)}k`
  return `${sign}₹${Math.round(a)}`
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return { ref, w }
}

export function BalanceChart({ before, after, gapMonths, target, horizon = 18 }: { before: Scenario; after: Scenario; gapMonths: number; target: number | null; horizon?: number }) {
  const { ref, w } = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const today = todayISO()
  const b = useMemo(() => projectBalance(before, 0, horizon), [before, horizon])
  const a = useMemo(() => projectBalance(after, gapMonths, horizon), [after, gapMonths, horizon])
  const label = (t: number) => (t === 0 ? 'Now' : formatDateShort(addDays(today, Math.round(t * DAYS_PER_MONTH))).slice(2))

  const H = 240
  const pad = { l: 52, r: 96, t: 16, b: 28 }
  const iw = w - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const all = [...a, ...b, ...(target != null ? [target] : []), 0]
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  const span = hi - lo || 1
  lo -= span * 0.05
  hi += span * 0.08
  const x = (t: number) => pad.l + (t / horizon) * iw
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * ih
  const path = (vs: number[]) => vs.map((v, t) => `${t ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4)
  const crossA = target != null ? a.findIndex((v) => v >= target) : -1
  const crossB = target != null ? b.findIndex((v) => v >= target) : -1

  return (
    <figure className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <figcaption className="label">Accessible cash over the next {horizon} months</figcaption>
        <button type="button" onClick={() => setTable((v) => !v)} className="font-mono text-xs uppercase tracking-[0.1em] text-dim hover:text-text" aria-pressed={table}>
          {table ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {/* legend: identity never rests on colour alone */}
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" aria-hidden={table}>
        <li className="flex items-center gap-2"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={SIM} strokeWidth="2" /></svg>Simulated</li>
        <li className="flex items-center gap-2"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={REF} strokeWidth="2" strokeDasharray="4 3" /></svg>Current trajectory</li>
        {target != null && <li className="flex items-center gap-2"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={REF} strokeWidth="1" strokeDasharray="1 3" /></svg>Emergency-fund target</li>}
      </ul>
      {table ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="label"><th className="py-1.5 font-normal">Month</th><th className="py-1.5 text-right font-normal">Current</th><th className="py-1.5 text-right font-normal">Simulated</th></tr></thead>
            <tbody className="tnum font-mono">
              {a.map((v, t) => (
                <tr key={t} className="border-t border-line"><td className="py-1.5 font-sans text-muted">{label(t)}</td><td className="py-1.5 text-right text-muted">{formatINR(b[t])}</td><td className="py-1.5 text-right">{formatINR(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
          <svg width={w} height={H} role="img" aria-label={`Projected accessible cash. Current trajectory reaches ${formatINR(b[horizon])} in ${horizon} months; simulated reaches ${formatINR(a[horizon])}.`}>
            {/* recessive grid */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} stroke="rgb(255 240 220 / 0.06)" />
                <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fill="#75716a" fontSize="11" fontFamily="JetBrains Mono Variable, monospace">{compact(v)}</text>
              </g>
            ))}
            {Math.min(...a, ...b) < 0 && (
              <g>
                <line x1={pad.l} x2={pad.l + iw} y1={y(0)} y2={y(0)} stroke="#d27766" strokeOpacity="0.6" />
                <text x={pad.l + iw + 6} y={y(0)} dy="0.32em" fill="#d27766" fontSize="11">Cash runs out</text>
              </g>
            )}
            {[0, 6, 12, 18].filter((t) => t <= horizon).map((t) => (
              <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fill="#75716a" fontSize="11" fontFamily="JetBrains Mono Variable, monospace">{label(t)}</text>
            ))}
            {target != null && (
              <g>
                <line x1={pad.l} x2={pad.l + iw} y1={y(target)} y2={y(target)} stroke={REF} strokeWidth="1" strokeDasharray="1 3" />
                {/* keep clear of the end-value labels */}
                <text
                  x={pad.l + iw + 6}
                  y={y(target) + ([a[horizon], b[horizon]].some((v) => Math.abs(y(v) - y(target)) < 14) ? (y(a[horizon]) > y(target) ? -14 : 14) : 0)}
                  dy="0.32em"
                  fill="#a29d94"
                  fontSize="11"
                >
                  Fund target
                </text>
              </g>
            )}
            <path d={path(b)} fill="none" stroke={REF} strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" />
            <path d={path(a)} fill="none" stroke={SIM} strokeWidth="2" strokeLinejoin="round" />
            {/* where each line reaches the fund target */}
            {crossB > 0 && <circle cx={x(crossB)} cy={y(b[crossB])} r="4" fill="#141518" stroke={REF} strokeWidth="2" />}
            {crossA > 0 && <circle cx={x(crossA)} cy={y(a[crossA])} r="5" fill={SIM} stroke="#141518" strokeWidth="2" />}
            {/* direct end labels, in text ink */}
            <text x={x(horizon) + 6} y={y(a[horizon])} dy="0.32em" fill="#f2ede4" fontSize="12">{compact(a[horizon])}</text>
            {Math.abs(y(a[horizon]) - y(b[horizon])) > 14 && <text x={x(horizon) + 6} y={y(b[horizon])} dy="0.32em" fill="#a29d94" fontSize="12">{compact(b[horizon])}</text>}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="rgb(255 240 220 / 0.25)" />
                <circle cx={x(hover)} cy={y(b[hover])} r="4" fill="#141518" stroke={REF} strokeWidth="2" />
                <circle cx={x(hover)} cy={y(a[hover])} r="4" fill={SIM} stroke="#141518" strokeWidth="2" />
              </g>
            )}
            {/* hit target bigger than the marks */}
            <rect
              x={pad.l}
              y={pad.t}
              width={iw}
              height={ih}
              fill="transparent"
              onMouseMove={(e) => {
                const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
                setHover(Math.max(0, Math.min(horizon, Math.round(((e.clientX - r.left) / r.width) * horizon))))
              }}
              onMouseLeave={() => setHover(null)}
            />
          </svg>
          {hover != null && (
            <div
              className="pointer-events-none absolute top-2 z-10 border border-line-strong bg-graphite px-3 py-2 text-sm shadow-lg"
              style={{ left: Math.min(x(hover) + 12, w - 190) }}
            >
              <p className="font-mono text-xs text-dim">{label(hover)}</p>
              <p className="tnum text-text">Simulated {formatINR(a[hover])}</p>
              <p className="tnum text-muted">Current {formatINR(b[hover])}</p>
            </div>
          )}
        </div>
      )}
      <p className="text-sm text-dim">Assumes the monthly surplus is kept as cash. During months without salary, essentials and flexible spending both come out of cash.</p>
    </figure>
  )
}
