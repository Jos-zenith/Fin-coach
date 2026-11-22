import { CheckCircle2, MessageSquareText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { go } from '../../app/router'
import { useStore } from '../../app/store'
import { formatDateShort } from '../../lib/dates'
import { findRule, resolveTxn } from '../../lib/engine/resolve'
import { formatINRExact } from '../../lib/format'
import { buildTxns } from '../../lib/ingest/build'
import { parseSmsBlock } from '../../lib/ingest/sms'
import { analyzeSms } from '../../lib/agents/ingestion'
import { Button, cx, Tag } from '../ui'
import { PrivacyInline } from './PrivacyInline'

const EXAMPLE = `A/c XX1234 debited by ₹356.00 on 26Oct26 trf to Swiggy Refno 612345678901

Rs 598.10 debited from A/c XX1234 on 02-Nov-26; Dominos Pizza

Sent Rs.1,200.00 From HDFC Bank A/C *1234 To ramesh.iyer58@okhdfcbank On 03/11/26 Ref 612345678902

Rs 68,000.00 credited to A/c XX1234 on 01-11-26 by NEFT-ACME TECHNOLOGIES-SALARY. Avl Bal Rs 1,32,100.00

123456 is your OTP for a transaction of Rs 2,000. Do not share it with anyone.`

export function SmsImport() {
  const { importRecords, rules, txns, notify, logTrace } = useStore()
  const [text, setText] = useState('')
  const [done, setDone] = useState<{ added: number; dup: number; existing: number; ruled: number } | null>(null)

  const parsed = useMemo(() => (text.trim() ? parseSmsBlock(text) : null), [text])
  const preview = useMemo(() => {
    if (!parsed?.records.length) return []
    const built = buildTxns(parsed.records, { source: 'sms', statementType: 'bank', batchId: 'preview', importedAt: '' }, txns)
    return built.txns.map((t) => resolveTxn(t, rules, new Set()))
  }, [parsed, rules, txns])

  const add = async () => {
    if (!parsed?.records.length) return
    const agent = analyzeSms(text, txns, rules)
    logTrace(agent.trace.done())
    const res = await importRecords(parsed.records, { source: 'sms', statementType: 'bank' })
    const ruled = res.txns.filter((t) => !t.flags.includes('duplicate') && findRule(t, rules)).length
    setDone({ added: res.txns.length, dup: res.duplicatesFlagged, existing: res.alreadyImported, ruled })
    notify({
      title: `${res.txns.length} SMS transactions added`,
      detail: ruled ? `${ruled} matched your saved rules and were classified automatically.` : undefined,
    })
    setText('')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="panel flex flex-col p-5">
        <label htmlFor="sms" className="display text-xl uppercase">Paste bank / UPI SMS</label>
        <p className="mt-1 text-sm text-muted">Paste 1–20 messages, separated by a blank line. They stay in this browser. Runway never asks for SMS permission.</p>
        <textarea
          id="sms"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setDone(null)
          }}
          rows={12}
          placeholder="A/c XX1234 debited by ₹356.00 on 26Apr26 trf to Swiggy…"
          className="mt-4 w-full flex-1 resize-y border border-line-strong bg-ink/60 p-3 font-mono text-xs leading-relaxed text-text placeholder:text-dim focus:border-amber focus:outline-none"
        />
        <div className="mt-3"><PrivacyInline what="Messages" /></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="subtle" onClick={() => setText(EXAMPLE)}><MessageSquareText size={13} /> Paste example messages</Button>
          {text && <Button size="sm" variant="subtle" onClick={() => setText('')}>Clear</Button>}
        </div>
      </div>

      <div className="panel flex flex-col p-5">
        <h3 className="display text-xl uppercase">What Runway read</h3>
        {done && (
          <div className="mt-4 flex items-start gap-3 border border-sage/30 bg-sage-soft p-4 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 text-sage" aria-hidden />
            <div className="space-y-1">
              <p>{done.added} added{done.dup ? ` · ${done.dup} matched an existing statement row and were marked duplicate` : ''}{done.existing ? ` · ${done.existing} were already imported` : ''}.</p>
              {done.ruled > 0 && <p className="text-sage">{done.ruled} matched your rules and were classified automatically.</p>}
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="primary" onClick={() => go('overview')}>See runway</Button>
                <Button size="sm" onClick={() => go('review')}>Review</Button>
              </div>
            </div>
          </div>
        )}
        {!parsed && !done && <p className="mt-4 text-sm text-dim">Parsed transactions appear here as you paste.</p>}
        {parsed && (
          <>
            <p className="mt-2 font-mono text-xs text-muted">
              <span className="text-sage">{parsed.records.length} understood</span> · <span className={parsed.unparsed.length ? 'text-warn' : ''}>{parsed.unparsed.length} not understood</span>
              {preview.length > 0 && <> · auto-classified {preview.filter((t) => t.category).length} of {preview.length}</>}
            </p>
            <ul className="mt-4 divide-y divide-line">
              {preview.map((t) => (
                <li key={t.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-text">{t.merchantGuess ?? t.vpa ?? 'Unknown counterparty'}</p>
                    <p className="font-mono text-[0.68rem] text-dim">
                      {formatDateShort(t.date)}
                      {t.reviewReason === 'missing_date' && <span className="text-warn"> (no date in SMS: used today)</span>}
                      {t.accountMask && ` · ${t.accountMask}`}
                      {t.reference && ` · ref ${t.reference}`}
                      {t.balanceAfter != null && ` · bal ${formatINRExact(t.balanceAfter)}`}
                    </p>
                  </div>
                  <p className={cx('tnum text-right font-mono', t.direction === 'credit' ? 'text-sage' : 'text-text')}>
                    {t.direction === 'credit' ? '+' : '−'}{formatINRExact(t.amount)}
                  </p>
                  <div className="col-span-2 flex flex-wrap gap-1.5">
                    {t.flags.includes('duplicate') ? (
                      <Tag tone="warn">Duplicate of a statement row</Tag>
                    ) : t.category ? (
                      <Tag tone={t.classSource === 'rule' ? 'amber' : 'neutral'}>{t.category}{t.classSource === 'rule' ? ' · your rule' : ''}</Tag>
                    ) : (
                      <Tag tone="warn">{t.reviewReason === 'potential_p2p' ? 'Potential P2P · review' : 'Needs review'}</Tag>
                    )}
                    {t.bank && <Tag>{t.bank}</Tag>}
                  </div>
                </li>
              ))}
            </ul>
            {parsed.unparsed.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="label !text-warn">Not imported</p>
                <ul className="mt-2 space-y-2">
                  {parsed.unparsed.map((u, i) => (
                    <li key={i} className="text-xs">
                      <p className="text-warn">{u.reason}</p>
                      <p className="truncate font-mono text-dim" title={u.text}>{u.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-auto flex justify-end border-t border-line pt-4">
              <Button variant="primary" disabled={!parsed.records.length} onClick={add}>Add {parsed.records.length} transactions</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
