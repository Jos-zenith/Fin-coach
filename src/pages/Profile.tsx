import { ArrowRight } from 'lucide-react'
import { go } from '../app/router'
import { useStore } from '../app/store'
import { EmergencyFundEditor, GoalsEditor, IncomeAndCosts, Preferences, QuickAdd } from '../components/import/ProfileForm'
import { Button, SectionTitle } from '../components/ui'
import { formatINR, formatMonths } from '../lib/format'

export default function ProfilePage() {
  const { model } = useStore()
  const s = model.baseline
  const fixed = model.base.essential.reduce((a, l) => a + l.amount, 0)
  return (
    <div className="space-y-8">
      <SectionTitle kicker="Profile & goals · saved in this browser" title="Your financial profile">
        <Button variant="ghost" size="sm" onClick={() => go('overview')}>See runway <ArrowRight size={12} /></Button>
      </SectionTitle>

      <section aria-label="Profile summary" className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Take-home', s.takeHome != null ? formatINR(s.takeHome) : '—'],
          ['Accessible cash', model.cash != null ? formatINR(model.cash) : '—'],
          ['Essentials', `${formatINR(fixed)}/mo`],
          ['Monthly surplus', s.surplus != null ? formatINR(s.surplus) : '—'],
          ['Survival runway', s.survival != null ? `${formatMonths(s.survival)} mo` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel p-4">
            <p className="label">{k}</p>
            <p className="display tnum mt-1.5 text-2xl">{v}</p>
          </div>
        ))}
      </section>
      <p className="-mt-4 text-xs text-dim">Every change here recalculates runway, goals and nudges immediately and is kept after a refresh.</p>

      <IncomeAndCosts />
      <EmergencyFundEditor />
      <GoalsEditor />
      <Preferences />
      <QuickAdd />
    </div>
  )
}
