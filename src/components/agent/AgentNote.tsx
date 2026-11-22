import { Bot } from 'lucide-react'
import type { TraceEvent } from '../../lib/agents/types'
import { cx } from '../ui'
import { openAgent } from './openAgent'

/** One-line summary of what an agent just did, with a link to its full trace. */
export function AgentNote({ e }: { e: TraceEvent | null }) {
  if (!e) return null
  return (
    <div className={cx('flex items-start gap-3 border px-4 py-3 text-sm', e.status === 'needs_user' ? 'border-warn/40' : e.status === 'corrected' ? 'border-amber/40' : 'border-sage/30')}>
      <Bot size={16} className="mt-0.5 shrink-0 text-amber" aria-hidden />
      <div className="flex-1 space-y-0.5">
        <p className="text-text">
          <span className="label mr-2 !text-amber">{e.agent} agent</span>
          {e.status === 'corrected' ? 'fixed the import itself' : e.status === 'needs_user' ? 'needs you to check one thing' : 'checked the import'}
          {' · '}
          {e.calls.length} tool calls
        </p>
        {[...e.verification, ...e.result].slice(0, 4).map((l) => (
          <p key={l} className="text-muted">{l}</p>
        ))}
      </div>
      <button type="button" onClick={() => openAgent('trace')} className="shrink-0 font-mono text-xs uppercase tracking-[0.1em] text-amber hover:underline">View trace</button>
    </div>
  )
}
