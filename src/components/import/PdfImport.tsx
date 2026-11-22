import { AlertTriangle, ArrowLeftRight, CheckCircle2, FileText, Lock, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { go } from '../../app/router'
import { useStore } from '../../app/store'
import { formatDateShort } from '../../lib/dates'
import { resolveTxn } from '../../lib/engine/resolve'
import { formatINRExact } from '../../lib/format'
import { buildTxns } from '../../lib/ingest/build'
import { PdfPasswordError, type PdfRow } from '../../lib/ingest/pdf'
import { analyzePdf } from '../../lib/agents/ingestion'
import { AgentNote } from '../agent/AgentNote'
import { reconcile } from '../../lib/ingest/reconcile'
import { Button, cx, Segmented, Tag } from '../ui'
import { PrivacyInline, ReconcileLine } from './PrivacyInline'

const FROM_LABEL: Record<PdfRow['directionFrom'], string> = {
  marker: 'Dr/Cr marker',
  balance: 'balance change',
  card: 'card statement',
  guess: 'guessed from words',
}

export function PdfImport() {
  const { importRecords, rules, notify, txns, logTrace } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState<'needed' | 'wrong' | null>(null)
  const [statementType, setStatementType] = useState<'bank' | 'card'>('bank')
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState<Set<number>>(new Set())
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [showText, setShowText] = useState(false)
  const [done, setDone] = useState<{ added: number; review: number; dup: number } | null>(null)

  const reset = () => {
    setFile(null)
    setLines(null)
    setError(null)
    setNeedsPassword(null)
    setPassword('')
    setFlipped(new Set())
    setExcluded(new Set())
    setDone(null)
  }

  const read = async (f: File, pass: string) => {
    setBusy(true)
    setError(null)
    try {
      const { pdfToLines } = await import('../../lib/ingest/pdf')
      const l = await pdfToLines(f, pass)
      setLines(l)
      setNeedsPassword(null)
      // "card" or a standalone "cc" in the name; not the "cc" inside "account"
      if (/card|(^|[^a-z])cc([^a-z]|$)/i.test(f.name)) setStatementType('card')
    } catch (e) {
      if (e instanceof PdfPasswordError) setNeedsPassword(e.reason)
      else setError(e instanceof Error ? e.message : 'Could not read this PDF.')
    } finally {
      setBusy(false)
    }
  }

  // the Ingestion agent: extract, reconcile, repair directions from the balance, flag
  const agent = useMemo(() => (lines ? analyzePdf(lines, file?.name ?? 'PDF statement', statementType, null, txns, rules) : null), [lines, statementType]) // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = agent ? { records: agent.rows, skipped: agent.skipped, range: agent.range } : null
  const agentEvent = useMemo(() => (agent ? agent.trace.done() : null), [agent])
  useEffect(() => {
    if (agentEvent) logTrace(agentEvent)
  }, [agentEvent]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(
    () =>
      (parsed?.records ?? []).map((r, i) => ({
        ...r,
        direction: flipped.has(i) ? (r.direction === 'debit' ? 'credit' : 'debit') : r.direction,
        i,
      })),
    [parsed, flipped],
  )
  const keep = rows.filter((r) => !excluded.has(r.i))
  const preview = useMemo(() => {
    if (!keep.length) return new Map<number, ReturnType<typeof resolveTxn>>()
    const built = buildTxns(keep, { source: 'pdf', statementType, batchId: 'preview', importedAt: '' })
    return new Map(built.txns.map((t, k) => [keep[k].i, resolveTxn(t, rules, new Set())]))
  }, [keep, statementType, rules])
  const classified = [...preview.values()].filter((t) => t.category).length
  // re-checked live, so flipping a direction that fixes the balance chain shows immediately
  const rec = useMemo(() => (statementType === 'bank' ? reconcile(keep, agent?.stated) : null), [keep, statementType, agent])
  const guessed = rows.filter((r) => r.directionFrom === 'guess' && !flipped.has(r.i) && !agent?.repaired.includes(r.i)).length

  const doImport = async () => {
    const res = await importRecords(
      keep.map(({ i: _i, directionFrom: _d, ...r }) => r),
      { source: 'pdf', statementType, bank: null },
      { label: file?.name ?? 'PDF statement', reconciliation: rec },
    )
    const review = res.txns.filter((t) => t.flags.includes('needs_review')).length
    setDone({ added: res.txns.length - res.duplicatesFlagged, review, dup: res.duplicatesFlagged + res.alreadyImported })
    notify({ title: `${res.txns.length} transactions imported from PDF`, detail: review ? `${review} need a quick review.` : undefined })
  }

  if (done) {
    return (
      <div className="panel space-y-4 p-6">
        <p className="flex items-center gap-3"><CheckCircle2 className="text-sage" size={22} aria-hidden /><span className="display text-2xl uppercase">PDF imported</span></p>
        <p className="text-sm text-muted">{done.added} added · {done.dup} already present or duplicates · {done.review} need review.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => go('overview')}>See my runway</Button>
          {done.review > 0 && <Button onClick={() => go('review')}>Review {done.review}</Button>}
          <Button variant="subtle" onClick={reset}><RotateCcw size={13} /> Another PDF</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="flex items-start gap-2 text-sm text-muted">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        Some PDF layouts may not parse perfectly. Use CSV or SMS paste as a fallback. The PDF is read in this browser; it is never uploaded.
      </p>

      {!file && (
        <div className="panel flex flex-col items-center gap-4 border-dashed px-6 py-12 text-center">
          <FileText size={28} className="text-amber" aria-hidden />
          <p className="display text-2xl uppercase">Upload a PDF statement</p>
          <p className="text-sm text-muted">Bank or credit-card statement with selectable text. Password-protected files are supported.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            aria-label="PDF statement"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) {
                setFile(f)
                void read(f, '')
              }
            }}
          />
          <Button variant="primary" onClick={() => inputRef.current?.click()}>Choose PDF</Button>
          <div className="max-w-xl text-left"><PrivacyInline what="PDFs and their passwords" /></div>
        </div>
      )}

      {file && (
        <div className="panel flex flex-wrap items-center gap-4 px-5 py-4">
          <p className="font-mono text-sm">{file.name}</p>
          {busy && <p className="label animate-pulse">Reading…</p>}
          <Button size="sm" variant="subtle" className="ml-auto" onClick={reset}><RotateCcw size={12} /> Different file</Button>
        </div>
      )}

      {needsPassword && file && (
        <form
          className="panel flex flex-wrap items-end gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            void read(file, password)
          }}
        >
          <label className="block flex-1">
            <span className="label flex items-center gap-1.5"><Lock size={12} aria-hidden /> PDF password</span>
            <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono focus:border-amber focus:outline-none" />
            <span className={cx('mt-1 block text-xs', needsPassword === 'wrong' ? 'text-rose' : 'text-dim')}>
              {needsPassword === 'wrong' ? 'That password did not open the PDF. Banks often use a mix of name and date of birth.' : 'This statement is password-protected. The password is used only to open it here.'}
            </span>
          </label>
          <Button type="submit" variant="primary" disabled={!password || busy}>Open</Button>
        </form>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 border border-rose/40 bg-rose-soft p-4 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose" aria-hidden />
          <div>
            <p className="text-text">{error}</p>
            <p className="mt-1 text-muted">Couldn’t read this PDF. Paste the transactions as SMS or upload the CSV / Excel statement instead.</p>
            <div className="mt-2 flex gap-3">
              <button type="button" className="label !text-amber underline" onClick={() => go('import', 'statement')}>Upload CSV</button>
              <button type="button" className="label !text-amber underline" onClick={() => go('import', 'sms')}>Paste SMS</button>
            </div>
          </div>
        </div>
      )}

      {parsed && (
        <section className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="display text-xl uppercase">What Runway read</h3>
              <p className="mt-1 font-mono text-xs text-muted">
                {lines?.length} text lines · <span className="text-sage">{parsed.records.length} transactions</span> · <span className={parsed.skipped.length ? 'text-warn' : ''}>{parsed.skipped.length} dated lines skipped</span>
                {parsed.range && ` · ${formatDateShort(parsed.range.start)} → ${formatDateShort(parsed.range.end)}`}
              </p>
            </div>
            <Segmented label="Statement type" value={statementType} onChange={setStatementType} options={[{ value: 'bank', label: 'Bank account' }, { value: 'card', label: 'Credit card' }]} />
          </div>

          <AgentNote e={agentEvent} />
          {parsed.records.length > 0 && statementType === 'bank' && <ReconcileLine rec={rec} />}
          {parsed.records.length > 0 && (
            <p className="text-sm text-text">
              Auto-classified {classified} of {keep.length} transactions. {keep.length - classified} need review.
              {guessed > 0 && <span className="text-warn"> {guessed} debit/credit directions were guessed; check the rows marked below.</span>}
            </p>
          )}

          {parsed.records.length === 0 ? (
            <p className="text-sm text-warn">No transaction rows were recognised in this layout. Check the extracted text below, then use CSV or SMS paste instead.</p>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 bg-graphite">
                  <tr className="label">
                    <th className="py-2 pr-2 font-normal"><span className="sr-only">Include</span></th>
                    <th className="py-2 pr-3 font-normal">Date</th>
                    <th className="py-2 pr-3 font-normal">Description</th>
                    <th className="py-2 pr-3 text-right font-normal">Amount</th>
                    <th className="py-2 pr-3 font-normal">Direction from</th>
                    <th className="py-2 font-normal">Runway reads it as</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const t = preview.get(r.i)
                    const off = excluded.has(r.i)
                    return (
                      <tr key={r.i} className={cx('border-t border-line align-top', off && 'opacity-40')}>
                        <td className="py-2 pr-2">
                          <input type="checkbox" aria-label={`Include row ${r.i + 1}`} checked={!off} onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(r.i)) n.delete(r.i); else n.add(r.i); return n })} className="accent-[#e3a548]" />
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-muted whitespace-nowrap">{formatDateShort(r.date)}</td>
                        <td className="max-w-[280px] py-2 pr-3"><p className="truncate font-mono text-[0.7rem] text-dim" title={r.rawDescription}>{r.rawDescription}</p></td>
                        <td className="py-2 pr-3 text-right">
                          <button type="button" onClick={() => setFlipped((s) => { const n = new Set(s); if (n.has(r.i)) n.delete(r.i); else n.add(r.i); return n })} title="Flip debit / credit" className={cx('tnum inline-flex items-center gap-1 font-mono whitespace-nowrap hover:underline', r.direction === 'credit' ? 'text-sage' : 'text-text')}>
                            {r.direction === 'credit' ? '+' : '−'}{formatINRExact(r.amount)} <ArrowLeftRight size={11} className="text-dim" aria-hidden />
                          </button>
                        </td>
                        <td className="py-2 pr-3">
                          <Tag tone={r.directionFrom === 'guess' && !flipped.has(r.i) && !agent?.repaired.includes(r.i) ? 'warn' : agent?.repaired.includes(r.i) && !flipped.has(r.i) ? 'amber' : 'neutral'}>{flipped.has(r.i) ? 'you' : agent?.repaired.includes(r.i) ? 'agent: balance' : FROM_LABEL[r.directionFrom]}</Tag>
                        </td>
                        <td className="py-2">{t?.category ? <Tag tone={t.classSource === 'rule' ? 'amber' : 'neutral'}>{t.category}{t.classSource === 'rule' ? ' · rule' : ''}</Tag> : <Tag tone="warn">Needs review</Tag>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {parsed.skipped.length > 0 && (
            <details className="text-xs">
              <summary className="label cursor-pointer !text-warn">{parsed.skipped.length} skipped lines</summary>
              <ul className="mt-2 space-y-1 font-mono">{parsed.skipped.map((s, i) => <li key={i} className="text-dim"><span className="text-warn">{s.reason}:</span> {s.line}</li>)}</ul>
            </details>
          )}
          <button type="button" className="label !text-dim hover:!text-text" onClick={() => setShowText((v) => !v)}>{showText ? 'Hide' : 'Show'} extracted text</button>
          {showText && <pre className="max-h-64 overflow-auto border border-line bg-ink/60 p-3 font-mono text-[0.68rem] leading-relaxed text-dim">{lines?.join('\n')}</pre>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-muted"><span className="tnum text-text">{keep.length}</span> transactions will be imported</p>
            <Button variant="primary" disabled={!keep.length} onClick={doImport}>Import {keep.length} transactions</Button>
          </div>
        </section>
      )}
    </div>
  )
}
