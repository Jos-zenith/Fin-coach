import { ArrowRight, FileSpreadsheet, MessageSquareText, UserRound } from 'lucide-react'
import { useState } from 'react'
import { go } from '../app/router'
import { useStore } from '../app/store'
import { Button } from '../components/ui'
import { BUSINESS_MODEL } from '../lib/copy'
import { USER_QUOTES } from '../lib/evidence'

const TRUST = ['No bank login', 'No SMS permission', 'No account', 'No loan offers', 'Processed in this browser']

const OTHER = [
  { icon: FileSpreadsheet, title: 'Import a statement', body: 'CSV, Excel or PDF from net banking or your card.', to: () => go('import', 'statement') },
  { icon: MessageSquareText, title: 'Paste bank SMS', body: 'Copy 1–20 transaction messages from your phone.', to: () => go('import', 'sms') },
  { icon: UserRound, title: 'Type a few numbers', body: 'Pay, cash, rent, EMIs. A runway in under a minute.', to: () => go('import', 'profile') },
]

export function Landing() {
  const { loadSample, model, notify } = useStore()
  const [busy, setBusy] = useState(false)
  const hasData = model.hasTransactions || model.cash != null

  const sample = async () => {
    setBusy(true)
    await loadSample()
    setBusy(false)
    notify({ title: 'Sample loaded', detail: 'Rohan, 26, first job in Bengaluru: three and a half months of real-looking bank and card data.' })
    go('overview')
  }

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col justify-center gap-14 py-6">
      <section className="max-w-3xl">
        <p className="label !text-amber">Runway · local-first cash-flow coach</p>
        <h1 className="display mt-5 text-[clamp(3rem,9vw,7.2rem)] uppercase leading-[0.88]">
          Know how long
          <br />
          your money <span className="text-amber">lasts.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Turn your financial data into a private survival plan. Understand your runway, spot hidden drains, and make better
          decisions—without connecting your bank.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button variant="primary" size="lg" onClick={sample} disabled={busy}>
            {busy ? 'Loading…' : 'See a sample runway'} <ArrowRight size={15} />
          </Button>
          {hasData ? (
            <Button variant="ghost" size="lg" onClick={() => go('overview')}>Continue to your runway</Button>
          ) : (
            <span className="text-sm text-dim">Rohan, 26, first job in Bengaluru. No signup, nothing to install.</span>
          )}
        </div>
      </section>

      <section aria-label="Or use your own data" className="space-y-3">
        <p className="label">Or use your own data</p>
        <div className="grid gap-px border border-line bg-line md:grid-cols-3">
          {OTHER.map((o) => {
            const Icon = o.icon
            return (
              <button key={o.title} type="button" onClick={o.to} className="group flex items-start gap-4 bg-panel p-5 text-left transition-colors hover:bg-panel-2">
                <Icon size={18} className="mt-1 shrink-0 text-muted group-hover:text-amber" aria-hidden />
                <span className="flex-1">
                  <span className="block text-lg text-text">{o.title}</span>
                  <span className="mt-1 block text-sm text-muted">{o.body}</span>
                </span>
                <ArrowRight size={15} className="mt-1.5 text-dim transition-transform group-hover:translate-x-1 group-hover:text-amber" aria-hidden />
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {TRUST.map((t) => (
          <span key={t} className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-muted">
            <span className="h-px w-4 bg-sage" aria-hidden /> {t}
          </span>
        ))}
        <a href="#/privacy" className="font-mono text-xs uppercase tracking-[0.12em] text-dim underline-offset-4 hover:text-text hover:underline">
          How privacy works
        </a>
      </section>

      {USER_QUOTES.length > 0 && (
        <section aria-label="What users said" className="grid gap-4 md:grid-cols-2">
          {USER_QUOTES.slice(0, 2).map((q) => (
            <figure key={q.quote} className="border-l-2 border-amber/60 pl-5">
              <blockquote className="text-lg text-text">“{q.quote}”</blockquote>
              <figcaption className="mt-2 font-mono text-xs uppercase tracking-[0.12em] text-dim">{q.who} · {q.when}</figcaption>
            </figure>
          ))}
        </section>
      )}

      <p className="max-w-2xl border-t border-line pt-4 text-sm text-muted">
        <span className="label mr-2">Who pays</span>
        {BUSINESS_MODEL}
      </p>
    </div>
  )
}
