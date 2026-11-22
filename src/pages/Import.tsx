import { FileSpreadsheet, FileText, MessageSquareText, UserRound } from 'lucide-react'
import { go } from '../app/router'
import { useStore } from '../app/store'
import { PdfImport } from '../components/import/PdfImport'
import { ProfileForm } from '../components/import/ProfileForm'
import { SmsImport } from '../components/import/SmsImport'
import { StatementImport } from '../components/import/StatementImport'
import { cx, SectionTitle } from '../components/ui'

const TABS = [
  { key: 'statement', label: 'CSV / Excel', icon: FileSpreadsheet },
  { key: 'pdf', label: 'PDF statement', icon: FileText },
  { key: 'sms', label: 'Paste SMS', icon: MessageSquareText },
  { key: 'profile', label: 'Profile & goal', icon: UserRound },
] as const

export default function ImportPage({ tab }: { tab: string | null }) {
  const active = TABS.find((t) => t.key === tab)?.key ?? 'statement'
  const { txns } = useStore()
  const counts = {
    csv: txns.filter((t) => t.source === 'csv').length,
    pdf: txns.filter((t) => t.source === 'pdf').length,
    sms: txns.filter((t) => t.source === 'sms').length,
    manual: txns.filter((t) => t.source === 'manual').length,
    sample: txns.filter((t) => t.source === 'sample').length,
  }
  return (
    <div className="space-y-8">
      <SectionTitle kicker="Data ingest · processed in this browser" title="Bring your numbers">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-dim">
          Loaded: {counts.csv} CSV · {counts.pdf} PDF · {counts.sms} SMS · {counts.manual} manual{counts.sample ? ` · ${counts.sample} sample` : ''}
        </p>
      </SectionTitle>
      <div role="tablist" aria-label="Import method" className="flex flex-wrap gap-px border border-line bg-line">
        {TABS.map((t) => {
          const Icon = t.icon
          const on = t.key === active
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => go('import', t.key)}
              className={cx(
                'flex flex-1 items-center justify-center gap-2 px-4 py-3.5 font-mono text-[0.7rem] uppercase tracking-[0.14em] transition-colors',
                on ? 'bg-[rgb(36_30_22/0.9)] text-amber' : 'bg-panel text-muted hover:text-text',
              )}
            >
              <Icon size={15} aria-hidden /> {t.label}
            </button>
          )
        })}
      </div>
      <div role="tabpanel">
        {active === 'statement' && <StatementImport />}
        {active === 'pdf' && <PdfImport />}
        {active === 'sms' && <SmsImport />}
        {active === 'profile' && <ProfileForm />}
      </div>
    </div>
  )
}
