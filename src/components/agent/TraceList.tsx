import { CheckCircle2, ChevronDown, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { TraceEvent } from '../../lib/agents/types'
import { cx, Tag } from '../ui'

const STATUS: Record<TraceEvent['status'], { label: string; tone: 'sage' | 'warn' | 'rose' | 'amber' | 'neutral' }> = {
  ok: { label: 'Done', tone: 'sage' },
  corrected: { label: 'Self-corrected', tone: 'amber' },
  needs_user: { label: 'Needs you', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'rose' },
  error: { label: 'Error', tone: 'rose' },
}

const APPROVAL: Record<TraceEvent['approval'], string> = {
  none: 'No approval needed (read-only)',
  required: 'Your approval is required before anything is applied',
  approved: 'Approved by you',
  declined: 'Declined by you',
}

function fmt(v: unknown): string {
  const s = JSON.stringify(v)
  return s.length > 160 ? s.slice(0, 160) + '…' : s
}

export function TraceCard({ e, open: initial = false }: { e: TraceEvent; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  const st = STATUS[e.status]
  return (
    <li id={`trace-${e.id}`} className="border border-line bg-panel">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="label !text-amber">{e.agent}</span>
            <Tag tone={st.tone}>{st.label}</Tag>
            {e.mode === 'llm' && <Tag tone="warn">Ask Runway</Tag>}
          </p>
          <p className="mt-1 truncate text-sm text-text">{e.trigger}: {e.input}</p>
          <p className="font-mono text-xs text-dim">{new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {e.calls.length} tool call{e.calls.length === 1 ? '' : 's'}</p>
        </div>
        <ChevronDown size={15} className={cx('mt-1 shrink-0 text-dim transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4 text-sm">
          {e.plan.length > 0 && (
            <section>
              <p className="label">Plan</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-muted">{e.plan.map((p) => <li key={p}>{p}</li>)}</ol>
            </section>
          )}
          {e.calls.length > 0 && (
            <section>
              <p className="label">Tools called</p>
              <ul className="mt-1.5 space-y-2">
                {e.calls.map((c, i) => (
                  <li key={i} className="border-l border-line-strong pl-3">
                    <p className="flex items-center gap-2 font-mono text-xs text-text">
                      <Wrench size={11} className={c.ok ? 'text-sage' : 'text-rose'} aria-hidden /> {c.tool}()
                      <span className="text-dim">{c.ms} ms</span>
                    </p>
                    {Object.keys(c.args).length > 0 && <p className="break-all font-mono text-[0.72rem] text-dim">in: {fmt(c.args)}</p>}
                    <p className="text-muted">→ {c.summary}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {e.verification.length > 0 && (
            <section>
              <p className="label">Checked</p>
              <ul className="mt-1.5 space-y-0.5">{e.verification.map((v) => <li key={v} className="flex gap-2 text-muted"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-sage" aria-hidden />{v}</li>)}</ul>
            </section>
          )}
          {e.result.length > 0 && (
            <section>
              <p className="label">Result</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-text">{e.result.map((r) => <li key={r}>{r}</li>)}</ul>
            </section>
          )}
          <section>
            <p className="label">Guardrails</p>
            <ul className="mt-1.5 space-y-0.5">
              {e.guardrails.map((g) => (
                <li key={g.rule} className={cx('flex gap-2', g.passed ? 'text-muted' : 'text-rose')}>
                  {g.passed ? <ShieldCheck size={13} className="mt-0.5 shrink-0 text-sage" aria-hidden /> : <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />}
                  <span>{g.rule}{g.note ? ` (${g.note})` : ''}</span>
                </li>
              ))}
            </ul>
          </section>
          <p className={cx('text-sm', e.approval === 'required' ? 'text-warn' : 'text-dim')}>{APPROVAL[e.approval]}</p>
        </div>
      )}
    </li>
  )
}
