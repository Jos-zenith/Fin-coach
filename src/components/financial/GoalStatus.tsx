import { formatDateLong, formatDateShort } from '../../lib/dates'
import type { GoalProjection } from '../../lib/engine/model'
import { formatINR, formatMonths } from '../../lib/format'
import { cx, Tag } from '../ui'

export function goalHeadline(g: GoalProjection): string {
  if (g.status === 'reached') return 'Reached'
  if (g.status === 'not_achievable') return 'Not achievable at current pace'
  if (g.status === 'incomplete') return 'Incomplete'
  return g.date ? formatDateLong(g.date) : '—'
}

export function VsTarget({ g }: { g: GoalProjection }) {
  if (!g.targetDate) return null
  if (g.vsTarget === 'ahead') return <Tag tone="sage">Ahead of {formatDateShort(g.targetDate)}{g.daysVsTarget ? ` · ${g.daysVsTarget}d` : ''}</Tag>
  if (g.vsTarget === 'on_time') return <Tag tone="sage">On time for {formatDateShort(g.targetDate)}</Tag>
  if (g.vsTarget === 'behind') return <Tag tone="rose">Behind {formatDateShort(g.targetDate)}{g.daysVsTarget ? ` · ${Math.abs(g.daysVsTarget)}d late` : ''}</Tag>
  return <Tag>Target {formatDateShort(g.targetDate)}</Tag>
}

/** Compact goal row: progress, projected date, target date and what it would take. */
export function GoalRow({ g, compact = false }: { g: GoalProjection; compact?: boolean }) {
  const progress = g.target && g.saved != null ? Math.max(0, Math.min(1, g.saved / g.target)) : 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-text">{g.name}</p>
        {g.status === 'on_track' && g.date ? (
          <p className={cx('display uppercase', compact ? 'text-xl' : 'text-2xl')}>{goalHeadline(g)}</p>
        ) : (
          <p className={cx('text-base', g.status === 'not_achievable' && 'text-rose', g.status === 'reached' && 'text-sage', g.status === 'incomplete' && 'text-dim')}>{goalHeadline(g)}</p>
        )}
      </div>
      <div className="h-1 bg-white/[0.06]" role="progressbar" aria-label={`${g.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="h-full bg-sage" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
        <span className="tnum">{g.saved != null ? formatINR(Math.max(0, g.saved)) : '—'} / {g.target != null ? formatINR(g.target) : '—'}</span>
        {g.contribution != null && g.status !== 'reached' && <span className="tnum">{formatINR(g.contribution)}/mo{g.contributionSource === 'shared' ? ' (shared surplus)' : ''}</span>}
        {g.months != null && g.status === 'on_track' && <span className="tnum">~{formatMonths(g.months)} months</span>}
        <VsTarget g={g} />
      </div>
      {!compact && g.required != null && g.vsTarget === 'behind' && (
        <p className="text-xs text-warn">To hit {formatDateShort(g.targetDate!)} it needs about {formatINR(g.required)}/month.</p>
      )}
      {!compact && g.capped && <p className="text-xs text-warn">The contribution you set is more than the surplus can give.</p>}
      {!compact && g.status === 'incomplete' && g.missing.length > 0 && <p className="text-xs text-dim">Missing: {g.missing.join(', ')}.</p>}
    </div>
  )
}
