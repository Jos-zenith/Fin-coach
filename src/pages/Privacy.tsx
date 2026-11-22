import { Check, Download, Lock, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { go } from '../app/router'
import { useStore } from '../app/store'
import { AssumptionsPanel } from '../components/financial/Assumptions'
import { Glossary } from '../components/financial/Glossary'
import { Button, Modal, SectionTitle } from '../components/ui'
import { decodeExport, download, encodeExport, isEncrypted } from '../lib/backup'
import { BUSINESS_MODEL, EDUCATION_DISCLAIMER, PRIVACY_BADGE, PROCESSING_NOTICE, SIMULATION_DISCLAIMER, SURPLUS_GUIDANCE } from '../lib/copy'
import { restore, snapshot } from '../lib/db'
import { todayISO } from '../lib/dates'

const TRUST = [
  ['No bank login', 'Runway never asks for net-banking credentials.'],
  ['No account', 'There is no sign-up and no server-side profile.'],
  ['No SMS permission', 'You paste messages; nothing reads your phone.'],
  ['No loan offers', 'No credit products, no lenders, no referrals.'],
  ['No investment upsells', 'No securities, funds or product names anywhere.'],
  ['No data selling', 'There is nothing to sell: data never leaves this browser.'],
  ['Local processing', 'CSV, Excel, PDF and SMS are parsed in this tab.'],
  ['No analytics', 'This build loads no trackers and makes no network calls with your data.'],
]

export default function Privacy() {
  const { txns, rules, scenarios, loadSample, clearAll, notify, meta, computeMs } = useStore()
  const [confirmClear, setConfirmClear] = useState(false)
  const [pass, setPass] = useState('')
  const [importText, setImportText] = useState<string | null>(null)
  const [importPass, setImportPass] = useState('')
  const [importErr, setImportErr] = useState<string | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setUsage(`${(e.usage / 1024).toFixed(0)} KB`)
    })
  }, [txns.length])

  const doExport = async () => {
    const text = await encodeExport(await snapshot(), pass)
    download(`runway-export-${todayISO()}${pass ? '-encrypted' : ''}.json`, text)
    notify({ title: 'Export downloaded', detail: pass ? 'Encrypted with your passphrase. Without it the file cannot be opened.' : 'Plain JSON. Anyone with the file can read it.' })
    setPass('')
  }

  const doImport = async () => {
    if (!importText) return
    try {
      const snap = await decodeExport(importText, importPass)
      await restore(snap)
      notify({ title: 'Data restored', detail: `${snap.transactions.length} transactions and ${snap.rules.length} rules.` })
      window.location.hash = '/overview'
      window.location.reload()
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : 'Could not import this file.')
    }
  }

  return (
    <div className="space-y-12">
      <SectionTitle kicker="Privacy & guardrails" title="Your data stays here" />

      <section className="border border-sage/30 bg-sage-soft p-6">
        <p className="flex items-start gap-3 text-lg text-text"><Lock size={20} className="mt-1 shrink-0 text-sage" aria-hidden /> {PRIVACY_BADGE}</p>
      </section>

      <section aria-label="Trust guarantees" className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {TRUST.map(([t, d]) => (
          <div key={t} className="bg-panel p-5">
            <p className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text"><Check size={13} className="text-sage" aria-hidden /> {t}</p>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel space-y-4 p-6">
          <h2 className="display text-2xl uppercase">What is stored, and where</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 font-mono text-sm">
            <dt className="text-muted">Transactions</dt><dd className="tnum">{txns.length}</dd>
            <dt className="text-muted">Rules</dt><dd className="tnum">{rules.length}</dd>
            <dt className="text-muted">Saved scenarios</dt><dd className="tnum">{scenarios.length}</dd>
            <dt className="text-muted">Browser storage used</dt><dd className="tnum">{usage ?? '—'}</dd>
            <dt className="text-muted">Last recalculation</dt><dd className="tnum">{computeMs.toFixed(1)} ms</dd>
          </dl>
          <p className="text-sm text-muted">Everything lives in this browser’s IndexedDB on this device. It is not encrypted at rest by Runway, and it is not synced. Clearing site data in your browser deletes it.</p>
          <p className="text-sm text-muted">Uploaded files are read in memory to extract transactions; the file itself is never stored. Only the extracted transactions are saved, here, in your browser.</p>
        </div>
        <div className="panel space-y-4 p-6">
          <h2 className="display text-2xl uppercase">Server processing notice</h2>
          <p className="text-sm text-muted">This notice applies only when a file is sent to a server. This build has no server path at all: PDFs are read in the browser with a bundled reader, and there is no AI service. So it is <span className="text-text">not in effect</span>:</p>
          <blockquote className="border-l border-line-strong pl-4 text-sm text-dim">{PROCESSING_NOTICE}</blockquote>
          <p className="text-sm text-muted">You can check: open your browser’s developer tools, Network tab, then import a statement. No request carries your data.</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel space-y-4 p-6">
          <h2 className="display text-2xl uppercase">Export</h2>
          <p className="text-sm text-muted">Download everything (transactions, rules, profile, goals, scenarios and leak decisions) to move to another browser or keep a backup.</p>
          <label className="block">
            <span className="label">Passphrase (optional, encrypts the file)</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono focus:border-amber focus:outline-none" />
            <span className="mt-1 block text-xs text-dim">AES-256-GCM with a PBKDF2 key. Only the export file is encrypted.</span>
          </label>
          <Button variant="ghost" onClick={doExport} disabled={!txns.length && !rules.length}><Download size={14} /> {pass ? 'Download encrypted export' : 'Download export'}</Button>
        </div>
        <div className="panel space-y-4 p-6">
          <h2 className="display text-2xl uppercase">Import an export</h2>
          <p className="text-sm text-muted">Replaces everything in this browser with the file’s contents.</p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setImportErr(null)
              setImportText(await f.text())
            }}
          />
          <Button variant="ghost" onClick={() => fileRef.current?.click()}><Upload size={14} /> Choose export file</Button>
          {importText && (
            <div className="space-y-3">
              {isEncrypted(importText) && (
                <label className="block">
                  <span className="label">Passphrase</span>
                  <input type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} className="mt-1.5 h-10 w-full border-b border-line-strong bg-transparent font-mono focus:border-amber focus:outline-none" />
                </label>
              )}
              {importErr && <p role="alert" className="text-sm text-rose">{importErr}</p>}
              <Button variant="primary" onClick={doImport}>Replace my data with this file</Button>
            </div>
          )}
        </div>
      </section>

      <section className="panel flex flex-wrap items-center gap-3 p-6">
        <div className="mr-auto">
          <h2 className="display text-2xl uppercase">Reset</h2>
          <p className="text-sm text-muted">{meta.sampleLoaded ? 'The sample mission is loaded.' : 'Start over at any time.'}</p>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            await loadSample()
            notify({ title: 'Sample mission reset', detail: 'Rohan’s data is back to its original, un-reviewed state.' })
            go('overview')
          }}
        >
          <RotateCcw size={14} /> Reset sample mission
        </Button>
        <Button variant="danger" onClick={() => setConfirmClear(true)}><Trash2 size={14} /> Clear all local data</Button>
      </section>

      <Glossary />
      {txns.length > 0 && <AssumptionsPanel />}

      <section className="space-y-3 text-sm text-muted">
        <h2 className="display text-2xl uppercase text-text">Guardrails</h2>
        <p>{EDUCATION_DISCLAIMER}</p>
        <p>{SIMULATION_DISCLAIMER}</p>
        <p>{SURPLUS_GUIDANCE}</p>
        <p>The EMI-load marks at 35% and 40% are general rules of thumb, not regulatory limits.</p>
      </section>

      <section className="space-y-2 text-sm text-muted">
        <h2 className="display text-2xl uppercase text-text">How Runway is paid for</h2>
        <p>{BUSINESS_MODEL}</p>
      </section>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear all local data?">
        <p className="text-sm text-muted">This deletes every transaction, rule, goal, scenario and decision stored in this browser. It cannot be undone. Export first if you want a copy.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="subtle" onClick={() => setConfirmClear(false)}>Keep my data</Button>
          <Button
            variant="danger"
            onClick={async () => {
              await clearAll()
              setConfirmClear(false)
              notify({ title: 'All local data cleared' })
              go('start')
            }}
          >
            Delete everything
          </Button>
        </div>
      </Modal>
    </div>
  )
}
