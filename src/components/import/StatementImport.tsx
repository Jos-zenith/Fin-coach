import { AlertTriangle, CheckCircle2, FileUp, RotateCcw } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { go } from '../../app/router'
import { useStore } from '../../app/store'
import { formatDateShort } from '../../lib/dates'
import { resolveTxn } from '../../lib/engine/resolve'
import { formatINRExact, formatNumber } from '../../lib/format'
import { buildTxns, type BuildResult } from '../../lib/ingest/build'
import {
  detectLayout,
  parseStatementRows,
  rowsFromCSVText,
  TEMPLATE_LABELS,
  type AmountMode,
  type ColumnMap,
  type Rows,
  type SingleSign,
  type TemplateId,
} from '../../lib/ingest/statement'
import { Button, cx, Segmented, Tag } from '../ui'
import { PrivacyInline, ReconcileLine } from './PrivacyInline'
import { AgentNote } from '../agent/AgentNote'
import { analyzeCsv } from '../../lib/agents/ingestion'
import type { TraceEvent } from '../../lib/agents/types'

const FIELDS: { key: keyof ColumnMap; label: string; required?: boolean; mode?: AmountMode }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'narration', label: 'Description / narration', required: true },
  { key: 'debit', label: 'Withdrawal / debit', mode: 'split' },
  { key: 'credit', label: 'Deposit / credit', mode: 'split' },
  { key: 'amount', label: 'Amount', mode: 'single' },
  { key: 'drcr', label: 'Dr / Cr marker', mode: 'single' },
  { key: 'balance', label: 'Balance' },
  { key: 'reference', label: 'Reference / cheque no.' },
  { key: 'postedDate', label: 'Value date' },
]

function fileSize(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

export function StatementImport() {
  const { importRecords, rules, notify, txns, logTrace } = useStore()
  const [agentEvent, setAgentEvent] = useState<TraceEvent | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [rows, setRows] = useState<Rows | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)

  const [headerRow, setHeaderRow] = useState(0)
  const [map, setMap] = useState<ColumnMap | null>(null)
  const [template, setTemplate] = useState<TemplateId>('generic')
  const [amountMode, setAmountMode] = useState<AmountMode>('split')
  const [singleSign, setSingleSign] = useState<SingleSign>('negative_debit')
  const [monthFirst, setMonthFirst] = useState(false)
  const [statementType, setStatementType] = useState<'bank' | 'card'>('bank')
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [result, setResult] = useState<(BuildResult & { review: number }) | null>(null)
  const [confident, setConfident] = useState(true)

  const reset = () => {
    setFile(null)
    setRows(null)
    setMap(null)
    setResult(null)
    setError(null)
    setRange(null)
    setAgentEvent(null)
  }

  const load = async (f: File) => {
    reset()
    setLoading(true)
    setFile({ name: f.name, size: f.size })
    try {
      let r: Rows
      if (/\.xlsx$/i.test(f.name)) {
        const { rowsFromXLSX } = await import('../../lib/ingest/xlsx')
        r = await rowsFromXLSX(f)
      } else if (/\.xls$/i.test(f.name)) {
        throw new Error('Old .xls files are not supported. Open it in Excel or Sheets and save as .xlsx or .csv.')
      } else if (/\.pdf$/i.test(f.name)) {
        throw new Error('PDF statements are not read in this version. Download the CSV/Excel statement from net banking, or paste SMS instead.')
      } else {
        r = rowsFromCSVText(await f.text())
      }
      if (!r.length) throw new Error('The file is empty.')
      const det = detectLayout(r)!
      setRows(r)
      setHeaderRow(det.headerRow)
      setMap(det.map)
      setTemplate(det.template)
      setAmountMode(det.amountMode)
      setConfident(det.confident)
      const type = /card|cc/i.test(f.name) ? 'card' : statementType
      if (det.amountMode === 'single') setSingleSign(type === 'card' ? 'positive_debit' : 'negative_debit')
      if (type === 'card') setStatementType('card')
      // the Ingestion agent: extract, reconcile, retry with alternate assumptions, flag
      const agent = analyzeCsv(r, det, f.name, type, txns, rules)
      setMap(agent.options.map)
      setMonthFirst(agent.options.monthFirst)
      setSingleSign(agent.options.singleSign)
      const ev = agent.trace.done()
      logTrace(ev)
      setAgentEvent(ev)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this file.')
    } finally {
      setLoading(false)
    }
  }

  const headers = rows?.[headerRow] ?? []
  const parsed = useMemo(() => {
    if (!rows || !map) return null
    return parseStatementRows(rows, { headerRow, map, amountMode, singleSign, monthFirst })
  }, [rows, map, headerRow, amountMode, singleSign, monthFirst])

  const inRange = useMemo(() => {
    if (!parsed) return []
    const r = range ?? parsed.range
    if (!r) return parsed.records
    return parsed.records.filter((x) => x.date >= r.start && x.date <= r.end)
  }, [parsed, range])

  // preview through the real sanitizer + the user's rules
  const preview = useMemo(() => {
    if (!inRange.length) return []
    const built = buildTxns(inRange.slice(0, 10), { source: 'csv', statementType, batchId: 'preview', importedAt: '' })
    return built.txns.map((t) => resolveTxn(t, rules, new Set()))
  }, [inRange, statementType, rules])

  // auto-classification status across everything that will be imported
  const autoStats = useMemo(() => {
    if (!inRange.length) return null
    const built = buildTxns(inRange, { source: 'csv', statementType, batchId: 'stats', importedAt: '' })
    const resolved = built.txns.map((t) => resolveTxn(t, rules, new Set()))
    return { total: resolved.length, classified: resolved.filter((t) => t.category).length }
  }, [inRange, statementType, rules])

  const missing = !map || map.date == null || map.narration == null || (amountMode === 'split' ? map.debit == null && map.credit == null : map.amount == null)

  const doImport = async () => {
    if (!inRange.length) return
    const res = await importRecords(
      inRange,
      { source: 'csv', statementType, bank: template !== 'generic' ? template.toUpperCase() : null },
      { label: file?.name ?? 'Statement', reconciliation: statementType === 'bank' ? parsed?.reconciliation ?? null : null },
    )
    const review = res.txns.filter((t) => t.flags.includes('needs_review')).length
    setResult({ ...res, review })
    notify({ title: `${res.txns.length} transactions imported`, detail: review ? `${review} need a quick review.` : 'Everything was classified.' })
  }

  if (result) {
    return (
      <div className="panel space-y-5 p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="text-sage" size={22} aria-hidden />
          <h3 className="display text-2xl uppercase">Import complete</h3>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Added', result.txns.length - result.duplicatesFlagged + result.supersededIds.length],
            ['Already imported', result.alreadyImported],
            ['Duplicates flagged', result.duplicatesFlagged],
            ['Need review', result.review],
          ].map(([k, v]) => (
            <div key={k} className="border-l border-line pl-3">
              <dt className="label">{k}</dt>
              <dd className="display tnum mt-1 text-3xl">{v}</dd>
            </div>
          ))}
        </dl>
        {parsed && parsed.skipped.length > 0 && (
          <p className="text-sm text-warn">{parsed.skipped.length} rows in the file were not transactions and were skipped (listed before import).</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => go('overview')}>See my runway</Button>
          {result.review > 0 && <Button onClick={() => go('review')}>Review {result.review}</Button>}
          <Button variant="subtle" onClick={reset}><RotateCcw size={13} /> Import another file</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!rows && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void load(f)
          }}
          className={cx('panel flex flex-col items-center justify-center gap-4 border-dashed px-6 py-14 text-center transition-colors', drag && '!border-amber bg-amber-soft')}
        >
          <FileUp size={28} className="text-amber" aria-hidden />
          <div>
            <p className="display text-2xl uppercase">Drop a statement here</p>
            <p className="mt-1 text-sm text-muted">CSV or Excel (.xlsx) from net banking or your card portal. Read in this browser only.</p>
          </div>
          <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx,.xls,.pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          <Button variant="primary" onClick={() => inputRef.current?.click()}>{loading ? 'Reading…' : 'Choose file'}</Button>
          <div className="max-w-xl text-left"><PrivacyInline what="Statements" /></div>
          {file && loading && <p className="font-mono text-xs text-muted">{file.name} · {fileSize(file.size)}</p>}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 border border-rose/40 bg-rose-soft p-4 text-sm text-text">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose" aria-hidden />
          <div>
            <p>{error}</p>
            <button type="button" className="label mt-2 !text-text underline" onClick={reset}>Try another file</button>
          </div>
        </div>
      )}

      {rows && map && parsed && (
        <>
          <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
            <div>
              <p className="label">File</p>
              <p className="font-mono text-sm">{file?.name} <span className="text-dim">· {file && fileSize(file.size)}</span></p>
            </div>
            <div>
              <p className="label">Rows read</p>
              <p className="tnum font-mono text-sm">{formatNumber(rows.length)}</p>
            </div>
            <div>
              <p className="label">Parsed</p>
              <p className="tnum font-mono text-sm text-sage">{formatNumber(parsed.records.length)}</p>
            </div>
            <div>
              <p className="label">Skipped</p>
              <button type="button" onClick={() => setShowSkipped((s) => !s)} className={cx('tnum font-mono text-sm underline-offset-4 hover:underline', parsed.skipped.length ? 'text-warn' : 'text-muted')}>
                {parsed.skipped.length} {parsed.skipped.length ? (showSkipped ? '(hide)' : '(show)') : ''}
              </button>
            </div>
            {parsed.range && (
              <div>
                <p className="label">Covers</p>
                <p className="font-mono text-sm">{formatDateShort(parsed.range.start)} → {formatDateShort(parsed.range.end)}</p>
              </div>
            )}
            <Button size="sm" variant="subtle" className="ml-auto" onClick={reset}><RotateCcw size={12} /> Different file</Button>
          </div>

          {!missing && <ReconcileLine rec={parsed.reconciliation} />}

          {showSkipped && parsed.skipped.length > 0 && (
            <div className="panel max-h-64 overflow-auto p-4">
              <table className="w-full text-left font-mono text-xs">
                <thead className="text-dim"><tr><th className="pb-2 pr-4">Row</th><th className="pb-2 pr-4">Why skipped</th><th className="pb-2">Content</th></tr></thead>
                <tbody>
                  {parsed.skipped.map((s) => (
                    <tr key={s.row} className="border-t border-line align-top">
                      <td className="py-1.5 pr-4 text-muted">{s.row}</td>
                      <td className="py-1.5 pr-4 text-warn">{s.reason}</td>
                      <td className="py-1.5 text-muted break-all">{s.raw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <AgentNote e={agentEvent} />

          {!confident && (
            <p className="flex items-center gap-2 text-sm text-warn"><AlertTriangle size={15} aria-hidden /> Runway could not recognise this layout with certainty. Check the column mapping below.</p>
          )}

          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <div className="panel space-y-5 p-5">
              <h3 className="display text-xl uppercase">Column mapping</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Statement type</span>
                  <select className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm" value={statementType} onChange={(e) => setStatementType(e.target.value as 'bank' | 'card')}>
                    <option className="bg-graphite" value="bank">Bank account</option>
                    <option className="bg-graphite" value="card">Credit card</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label">Layout</span>
                  <select className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm" value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
                    {(Object.keys(TEMPLATE_LABELS) as TemplateId[]).map((t) => (
                      <option className="bg-graphite" key={t} value={t}>{TEMPLATE_LABELS[t]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Header row (file line)</span>
                  <input
                    type="number"
                    min={1}
                    max={rows.length}
                    value={headerRow + 1}
                    onChange={(e) => {
                      const n = Math.max(0, Math.min(rows.length - 1, Number(e.target.value) - 1))
                      setHeaderRow(n)
                    }}
                    className="tnum mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm"
                  />
                </label>
                <label className="block">
                  <span className="label">Date order</span>
                  <select className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono text-sm" value={monthFirst ? 'mf' : 'df'} onChange={(e) => setMonthFirst(e.target.value === 'mf')}>
                    <option className="bg-graphite" value="df">Day first (26/04/2026)</option>
                    <option className="bg-graphite" value="mf">Month first (04/26/2026)</option>
                  </select>
                </label>
              </div>
              <div className="space-y-2">
                <span className="label">Amounts are in</span>
                <Segmented
                  label="Amount columns"
                  value={amountMode}
                  onChange={setAmountMode}
                  options={[
                    { value: 'split', label: 'Debit + credit columns' },
                    { value: 'single', label: 'One amount column' },
                  ]}
                />
                {amountMode === 'single' && (
                  <Segmented
                    label="Sign convention"
                    value={singleSign}
                    onChange={setSingleSign}
                    options={[
                      { value: 'negative_debit', label: 'Negative = money out' },
                      { value: 'positive_debit', label: 'Positive = spend (cards)' },
                    ]}
                  />
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.filter((f) => !f.mode || f.mode === amountMode).map((f) => (
                  <label key={f.key} className="block">
                    <span className="label">{f.label}{f.required && <span className="text-amber"> *</span>}</span>
                    <select
                      className={cx('mt-1.5 h-10 w-full border-b bg-transparent font-mono text-sm', f.required && map[f.key] == null ? 'border-warn' : 'border-line-strong')}
                      value={map[f.key] ?? ''}
                      onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}
                    >
                      <option className="bg-graphite" value="">— not in file —</option>
                      {headers.map((h, i) => (
                        <option className="bg-graphite" key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="panel flex flex-col p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h3 className="display text-xl uppercase">Preview · first 10</h3>
                {parsed.range && (
                  <div className="flex items-end gap-2 font-mono text-xs">
                    <label>
                      <span className="label block">From</span>
                      <input type="date" className="h-9 border-b border-line-strong bg-transparent [color-scheme:dark]" value={(range ?? parsed.range).start} min={parsed.range.start} max={parsed.range.end} onChange={(e) => setRange({ ...(range ?? parsed.range!), start: e.target.value })} />
                    </label>
                    <label>
                      <span className="label block">To</span>
                      <input type="date" className="h-9 border-b border-line-strong bg-transparent [color-scheme:dark]" value={(range ?? parsed.range).end} min={parsed.range.start} max={parsed.range.end} onChange={(e) => setRange({ ...(range ?? parsed.range!), end: e.target.value })} />
                    </label>
                  </div>
                )}
              </div>
              <div className="mt-4 flex-1 overflow-x-auto">
                {missing ? (
                  <p className="text-sm text-warn">Map at least Date, Description and an amount column to see the preview.</p>
                ) : preview.length === 0 ? (
                  <p className="text-sm text-warn">No rows could be read with this mapping. Try a different header row or columns.</p>
                ) : (
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="label">
                        <th className="pb-2 pr-3 font-normal">Date</th>
                        <th className="pb-2 pr-3 font-normal">Merchant · raw</th>
                        <th className="pb-2 pr-3 text-right font-normal">Amount</th>
                        <th className="pb-2 font-normal">Runway reads it as</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((t) => (
                        <tr key={t.id} className="border-t border-line align-top">
                          <td className="py-2 pr-3 font-mono text-xs text-muted whitespace-nowrap">{formatDateShort(t.date)}</td>
                          <td className="py-2 pr-3">
                            <p className="text-text">{t.merchantGuess ?? '—'}</p>
                            <p className="max-w-[260px] truncate font-mono text-[0.68rem] text-dim" title={t.rawDescription}>{t.rawDescription}</p>
                          </td>
                          <td className={cx('tnum py-2 pr-3 text-right font-mono whitespace-nowrap', t.direction === 'credit' ? 'text-sage' : 'text-text')}>
                            {t.direction === 'credit' ? '+' : '−'}{formatINRExact(t.amount)}
                          </td>
                          <td className="py-2">
                            {t.category ? <Tag tone={t.classSource === 'rule' ? 'amber' : 'neutral'}>{t.category}{t.classSource === 'rule' ? ' · rule' : ''}</Tag> : <Tag tone="warn">Needs review</Tag>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-sm text-muted">
                  {autoStats && !missing && (
                    <span className="mb-1 block text-text">
                      Auto-classified {autoStats.classified} of {autoStats.total} transactions. {autoStats.total - autoStats.classified} need review.
                    </span>
                  )}
                  <span className="tnum text-text">{inRange.length}</span> transactions will be imported
                  {parsed.skipped.length > 0 && <> · <span className="text-warn">{parsed.skipped.length} rows skipped</span></>}
                </p>
                <Button variant="primary" disabled={missing || !inRange.length} onClick={doImport}>Import {inRange.length} transactions</Button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
