import { ArrowRight, Bot, Lock, Send, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { go } from '../../app/router'
import { useStore } from '../../app/store'
import { redact } from '../../lib/agents/llm'
import { COPILOT_EXAMPLES, type Reply } from '../../lib/agents/supervisor'
import { todayISO } from '../../lib/dates'
import { Button, cx, Tag } from '../ui'
import { TraceCard } from './TraceList'

interface Msg {
  role: 'user' | 'agent'
  text: string[]
  reply?: Reply
}

/** The copilot and the trace, in one drawer. */
export function AgentPanel({ open, tab, onTab, onClose }: { open: boolean; tab: 'ask' | 'trace'; onTab: (t: 'ask' | 'trace') => void; onClose: () => void }) {
  const { ask, traces, clearTraces, applyPlan, setApproval, llm, setLlm, model, profile } = useStore()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [focusTrace, setFocusTrace] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  // block body: scrollIntoView() returns a Promise in current Chrome, which must not reach React as a cleanup
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setQ('')
    setMsgs((m) => [...m, { role: 'user', text: [t] }])
    setBusy(true)
    const reply = await ask(t)
    setBusy(false)
    setMsgs((m) => [...m, { role: 'agent', text: reply.text, reply }])
  }

  if (!open) return null
  const preview = redact('Can I still reach my goal if rent rises ₹3,500?', model, profile, todayISO())

  return (
    <div className="no-print fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Runway agent">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-[520px] flex-col border-l border-line-strong bg-graphite">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Bot size={18} className="text-amber" aria-hidden />
          <div role="tablist" aria-label="Agent" className="flex gap-1">
            {(['ask', 'trace'] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => onTab(t)} className={cx('h-8 px-3 font-mono text-xs uppercase tracking-[0.1em]', tab === t ? 'bg-amber-soft text-amber' : 'text-muted hover:text-text')}>
                {t === 'ask' ? 'Ask Runway' : `Trace ${traces.length}`}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close agent panel" className="ml-auto p-1 text-muted hover:text-text"><X size={18} /></button>
        </header>

        {tab === 'ask' ? (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="flex items-start gap-2 text-sm text-muted">
                <Lock size={14} className={cx('mt-0.5 shrink-0', llm.enabled ? 'text-warn' : 'text-sage')} aria-hidden />
                <p>
                  {llm.enabled
                    ? 'Ask Runway is on: your question and category, goal and merchant names go to Claude to understand it. Amounts, narrations, UPI IDs, balances and account numbers never leave this browser. Every number still comes from the local engine.'
                    : 'Local mode: answers come from the deterministic engine in this browser. No network request.'}
                </p>
              </div>
              {msgs.length === 0 && (
                <div className="space-y-2">
                  <p className="label">Try</p>
                  {COPILOT_EXAMPLES.map((e) => (
                    <button key={e} type="button" onClick={() => send(e)} className="block w-full border border-line px-3 py-2 text-left text-sm text-muted transition-colors hover:border-amber hover:text-text">{e}</button>
                  ))}
                </div>
              )}
              {msgs.map((m, i) =>
                m.role === 'user' ? (
                  <p key={i} className="ml-10 border border-line-strong bg-white/[0.03] px-3 py-2 text-sm text-text">{m.text[0]}</p>
                ) : (
                  <div key={i} className="space-y-2">
                    {m.text.map((t, k) => <p key={k} className="text-sm leading-relaxed text-text">{t}</p>)}
                    {m.reply && m.reply.options.length > 0 && (
                      <ul className="space-y-2 pt-1">
                        {m.reply.options.map((o) => (
                          <li key={o.key} className="border border-line bg-panel p-3">
                            <p className="flex flex-wrap items-center gap-2 text-sm text-text">
                              <span className="font-mono text-amber">{o.key}</span> {o.label}
                              {o.meets === true && <Tag tone="sage">Meets date</Tag>}
                              {o.meets === false && <Tag tone="rose">Misses date</Tag>}
                            </p>
                            <p className="mt-1 text-sm text-muted">{o.line}</p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-2"
                              onClick={() => {
                                setApproval(m.reply!.trace.id, 'approved')
                                applyPlan(o.sim)
                                onClose()
                                go('simulator')
                              }}
                            >
                              Approve & open in simulator <ArrowRight size={12} />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.reply && (
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-dim">
                        <span>{m.reply.trace.agent} · {m.reply.trace.calls.map((c) => c.tool).filter((v, j, a) => a.indexOf(v) === j).join(', ') || 'no tools'}</span>
                        <button type="button" className="text-amber hover:underline" onClick={() => { setFocusTrace(m.reply!.trace.id); onTab('trace') }}>View trace</button>
                        {m.reply.links.map((l) => (
                          <button key={l.label} type="button" className="text-amber hover:underline" onClick={() => { onClose(); go(l.route) }}>{l.label}</button>
                        ))}
                      </p>
                    )}
                  </div>
                ),
              )}
              {busy && <p className="label animate-pulse">Planning · calling tools…</p>}
              <div ref={endRef} />
            </div>

            <form className="border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); void send(q) }}>
              <label htmlFor="copilot-q" className="sr-only">Ask Runway</label>
              <div className="flex items-center gap-2 border border-line-strong focus-within:border-amber">
                <input id="copilot-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What if my rent goes up ₹3,500?" className="h-11 flex-1 bg-transparent px-3 text-sm placeholder:text-dim/70 focus:outline-none" />
                <button type="submit" aria-label="Send" disabled={!q.trim() || busy} className="px-3 text-amber disabled:opacity-40"><Send size={16} /></button>
              </div>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.1em] text-dim hover:text-text">Ask Runway mode (optional, uses Claude)</summary>
                <div className="mt-3 space-y-3 text-muted">
                  <p>Off by default. When on, Claude only turns your sentence into simulator settings; it never calculates. This is exactly what would be sent for a sample question:</p>
                  <pre className="max-h-40 overflow-auto border border-line bg-ink/60 p-2 font-mono text-[0.7rem] text-dim">{JSON.stringify(preview, null, 1)}</pre>
                  {llm.enabled ? (
                    <Button size="sm" variant="ghost" onClick={() => setLlm({ enabled: false, apiKey: '' })}>Turn off and forget the key</Button>
                  ) : (
                    <>
                      <label className="block">
                        <span className="label">Your Anthropic API key</span>
                        <input type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} className="mt-1 h-9 w-full border-b border-line-strong bg-transparent font-mono text-xs focus:border-amber focus:outline-none" />
                        <span className="mt-1 block text-xs text-dim">Kept for this browser tab only and sent only to Anthropic. A key in a web page can be read by anyone with access to this device; use a restricted key.</span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-[#e3a548]" />
                        <span>I agree to send my questions and category, goal and merchant names (as shown above) to Anthropic.</span>
                      </label>
                      <Button size="sm" variant="primary" disabled={!consent || keyDraft.trim().length < 20} onClick={() => { setLlm({ enabled: true, apiKey: keyDraft.trim() }); setKeyDraft('') }}>Turn on Ask Runway</Button>
                    </>
                  )}
                </div>
              </details>
            </form>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted">Every agent run: its plan, tool calls, checks, guardrails and whether you approved anything.</p>
              {traces.length > 0 && <button type="button" aria-label="Clear trace" onClick={clearTraces} className="p-1 text-dim hover:text-rose"><Trash2 size={14} /></button>}
            </div>
            {traces.length ? (
              <ul className="space-y-2">{traces.map((e) => <TraceCard key={e.id} e={e} open={e.id === focusTrace} />)}</ul>
            ) : (
              <p className="text-sm text-dim">No agent runs yet. Import data, answer a question, or ask Runway something.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
