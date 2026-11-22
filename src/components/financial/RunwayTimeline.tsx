import { useAnimatedNumber } from '../ui'

/**
 * A horizontal month ruler. Survival runway is the solid amber run; lifestyle runway is the
 * thinner bar beneath; the goal marker shows where the emergency target sits.
 */
export function RunwayTimeline({
  survival,
  lifestyle,
  target,
}: {
  survival: number | null
  lifestyle: number | null
  target: number | null
}) {
  const s = useAnimatedNumber(survival ?? 0)
  const l = useAnimatedNumber(lifestyle ?? 0)
  const max = Math.max(12, Math.ceil(Math.max(survival ?? 0, target ?? 0)) + 1)
  const pct = (v: number) => `${Math.min(100, (Math.max(0, v) / max) * 100)}%`
  const ticks = Array.from({ length: max + 1 }, (_, i) => i)

  return (
    <figure
      className="w-full"
      aria-label={`Runway timeline: survival ${survival?.toFixed(1) ?? 'unknown'} months, lifestyle ${lifestyle?.toFixed(1) ?? 'unknown'} months${target ? `, goal ${target} months` : ''}`}
    >
      <div className="relative h-16">
        {/* month segments */}
        <div className="absolute inset-x-0 top-3 flex h-6 gap-[3px]" aria-hidden>
          {ticks.slice(0, -1).map((i) => {
            const fill = Math.max(0, Math.min(1, s - i))
            return (
              <div key={i} className="relative flex-1 bg-white/[0.06]">
                <div className="absolute inset-y-0 left-0 bg-amber" style={{ width: `${fill * 100}%`, opacity: i < 3 ? 0.95 : 0.85 }} />
              </div>
            )
          })}
        </div>
        {/* lifestyle runway */}
        <div className="absolute inset-x-0 top-11 h-[3px] bg-white/[0.05]" aria-hidden>
          <div className="h-full bg-text/70" style={{ width: pct(l) }} />
        </div>
        {/* goal marker */}
        {target != null && target > 0 && (
          <div className="absolute top-0 h-[54px] w-px bg-sage" style={{ left: pct(target) }} aria-hidden>
            <span className="absolute -top-1 left-1.5 whitespace-nowrap font-mono text-[0.58rem] uppercase tracking-[0.12em] text-sage">Goal {target}m</span>
          </div>
        )}
      </div>
      <div className="relative mt-1 h-4" aria-hidden>
        {ticks.map((i) => (
          <span key={i} className="tnum absolute -translate-x-1/2 font-mono text-[0.6rem] text-dim" style={{ left: `${(i / max) * 100}%` }}>
            {i % (max > 14 ? 2 : 1) === 0 ? i : ''}
          </span>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">
        <span className="flex items-center gap-2"><span className="h-2 w-4 bg-amber" aria-hidden /> Survival (essentials)</span>
        <span className="flex items-center gap-2"><span className="h-[3px] w-4 bg-text/70" aria-hidden /> Lifestyle (with today’s flexible spending)</span>
        <span className="text-dim">Months →</span>
      </figcaption>
    </figure>
  )
}
