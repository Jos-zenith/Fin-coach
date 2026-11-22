import { lazy, Suspense, useEffect, useState } from 'react'
import { AgentPanel } from '../components/agent/AgentPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Backdrop } from '../components/layout/Backdrop'
import { MobileNav, TopNav } from '../components/layout/Nav'
import { Toasts } from '../components/ui'
import { EDUCATION_DISCLAIMER, PRIVACY_BADGE } from '../lib/copy'
import { Landing } from '../pages/Landing'
import { Overview } from '../pages/Overview'
import { go, useRoute, type Route } from './router'
import { StoreProvider, useStore } from './store'

const loaders = {
  import: () => import('../pages/Import'),
  review: () => import('../pages/Review'),
  leaks: () => import('../pages/LeakRadar'),
  simulator: () => import('../pages/Simulator'),
  mission: () => import('../pages/MissionReview'),
  rules: () => import('../pages/Rules'),
  nudges: () => import('../pages/Nudges'),
  profile: () => import('../pages/Profile'),
  privacy: () => import('../pages/Privacy'),
}
const ImportPage = lazy(loaders.import)
const Review = lazy(loaders.review)
const LeakRadar = lazy(loaders.leaks)
const Simulator = lazy(loaders.simulator)
const MissionReview = lazy(loaders.mission)
const Rules = lazy(loaders.rules)
const Nudges = lazy(loaders.nudges)
const ProfilePage = lazy(loaders.profile)
const Privacy = lazy(loaders.privacy)

/** Shaped like a page, so switching screens never flashes an empty black frame. */
function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <div className="h-4 w-48 animate-pulse bg-white/[0.06]" />
      <div className="h-14 w-2/3 animate-pulse bg-white/[0.06]" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel h-72 animate-pulse" />
        <div className="panel h-72 animate-pulse" />
      </div>
    </div>
  )
}

function Screen({ route, param }: { route: Route; param: string | null }) {
  switch (route) {
    case 'start':
      return <Landing />
    case 'import':
      return <ImportPage tab={param} />
    case 'overview':
      return <Overview />
    case 'review':
      return <Review />
    case 'leaks':
      return <LeakRadar />
    case 'simulator':
      return <Simulator />
    case 'mission':
      return <MissionReview />
    case 'rules':
      return <Rules />
    case 'nudges':
      return <Nudges />
    case 'profile':
      return <ProfilePage />
    case 'privacy':
      return <Privacy />
  }
}

const DATA_ROUTES: Route[] = ['overview', 'review', 'leaks', 'simulator', 'nudges', 'mission', 'rules']

function Shell() {
  const { ready, model } = useStore()
  const { route, param } = useRoute()
  const hasData = model.hasTransactions || model.cash != null
  const [agent, setAgent] = useState<{ open: boolean; tab: 'ask' | 'trace' }>({ open: false, tab: 'ask' })
  useEffect(() => {
    const on = (e: Event) => setAgent({ open: true, tab: (e as CustomEvent<'ask' | 'trace'>).detail ?? 'ask' })
    window.addEventListener('runway:agent', on)
    return () => window.removeEventListener('runway:agent', on)
  }, [])

  // fetch every screen in the background once the first one is up
  useEffect(() => {
    const run = () => Object.values(loaders).forEach((l) => void l())
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(run)
    else setTimeout(run, 800)
  }, [])

  // Data screens make no sense before there is data: send people to the start.
  useEffect(() => {
    if (ready && !hasData && DATA_ROUTES.includes(route)) go('start')
    if (ready && hasData && route === 'start' && !window.location.hash) go('overview')
  }, [ready, hasData, route])

  return (
    <div className="flex min-h-dvh flex-col">
      <Backdrop intensity={route === 'start' ? 1.15 : 0.8} open={route === 'start'} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-amber focus:px-3 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <TopNav route={route} />
      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-28 pt-8 sm:px-6 lg:pb-16">
        {!ready ? (
          <Skeleton />
        ) : (
          <Suspense fallback={<Skeleton />}>
            <div key={route} className="animate-fade-up">
              <Screen route={route} param={param} />
            </div>
          </Suspense>
        )}
      </main>
      <footer className="no-print border-t border-line bg-ink/60 px-4 py-5 pb-20 text-xs text-dim sm:px-6 lg:pb-5">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-1.5 md:flex-row md:justify-between md:gap-8">
          <p className="text-sage/90">{PRIVACY_BADGE}</p>
          <p className="md:max-w-[52%] md:text-right">{EDUCATION_DISCLAIMER}</p>
        </div>
      </footer>
      <MobileNav route={route} />
      <ErrorBoundary label="The agent panel" onReset={() => setAgent((a) => ({ ...a, open: false }))}>
        <AgentPanel open={agent.open} tab={agent.tab} onTab={(tab) => setAgent({ open: true, tab })} onClose={() => setAgent((a) => ({ ...a, open: false }))} />
      </ErrorBoundary>
      <Toasts />
    </div>
  )
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
