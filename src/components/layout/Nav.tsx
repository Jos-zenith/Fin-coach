import {
  BellRing,
  BookOpenCheck,
  Bot,
  Gauge,
  ListChecks,
  MoreHorizontal,
  Plus,
  Radar,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Workflow,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { go, type Route } from '../../app/router'
import { openAgent } from '../agent/openAgent'
import { useStore } from '../../app/store'
import { cx } from '../ui'

const ITEMS: { route: Route; label: string; short: string; icon: typeof Gauge; primary?: boolean; desktop?: boolean }[] = [
  { route: 'overview', label: 'Runway', short: 'Runway', icon: Gauge, primary: true, desktop: true },
  { route: 'review', label: 'Review', short: 'Review', icon: ListChecks, primary: true, desktop: true },
  { route: 'leaks', label: 'Leak Radar', short: 'Leaks', icon: Radar, primary: true, desktop: true },
  { route: 'simulator', label: 'Simulator', short: 'Simulate', icon: SlidersHorizontal, primary: true, desktop: true },
  { route: 'nudges', label: 'Nudges', short: 'Nudges', icon: BellRing, desktop: true },
  { route: 'mission', label: 'Monthly Review', short: 'Monthly', icon: BookOpenCheck, desktop: true },
  { route: 'profile', label: 'Profile & Goals', short: 'Profile', icon: UserRound },
  { route: 'rules', label: 'Rules', short: 'Rules', icon: Workflow },
  { route: 'privacy', label: 'Privacy', short: 'Privacy', icon: ShieldCheck },
]

export function Wordmark({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex shrink-0 items-center gap-2.5" aria-label="Runway home">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <path d="M4 25h24M4 25l8-9 5 5 11-12" stroke="#e3a548" strokeWidth="2.6" fill="none" strokeLinecap="square" />
      </svg>
      <span className="display text-xl tracking-[0.18em] text-text">RUNWAY</span>
    </button>
  )
}

function Badge({ route }: { route: Route }) {
  const { model, nudges } = useStore()
  const n = route === 'review' ? model.reviewCount : route === 'nudges' ? nudges.filter((x) => x.tone !== 'good').length : 0
  if (!n) return null
  return <span className="tnum bg-amber-soft px-1 text-[0.6rem] text-amber">{n}</span>
}

function DesktopMore({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(false)
  }, [route])
  const rest = ITEMS.filter((i) => !i.desktop)
  const active = rest.some((i) => i.route === route)
  return (
    <div className="relative flex items-stretch" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="desktop-more"
        onClick={() => setOpen((o) => !o)}
        className={cx('relative flex items-center gap-1 px-2 font-mono text-[0.66rem] uppercase tracking-[0.12em] xl:px-3', active || open ? 'text-text' : 'text-muted hover:text-text')}
      >
        More <MoreHorizontal size={14} aria-hidden />
        <span aria-hidden className={cx('absolute inset-x-2 bottom-0 h-[2px]', active ? 'bg-amber' : '')} />
      </button>
      {open && (
        <ul id="desktop-more" className="absolute right-0 top-full z-50 mt-px w-52 border border-line-strong bg-graphite py-1 shadow-xl">
          {rest.map((it) => {
            const Icon = it.icon
            return (
              <li key={it.route}>
                <a href={`#/${it.route}`} aria-current={route === it.route ? 'page' : undefined} className={cx('flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.04]', route === it.route ? 'text-amber' : 'text-muted hover:text-text')}>
                  <Icon size={15} aria-hidden /> {it.label}
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function TopNav({ route }: { route: Route }) {
  const { model } = useStore()
  const hasData = model.hasTransactions || model.cash != null
  return (
    <header className="no-print sticky top-0 z-40 border-b border-line bg-ink/70 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-5 px-4 sm:px-6">
        <Wordmark onClick={() => go(hasData ? 'overview' : 'start')} />
        {hasData && (
          <nav aria-label="Main" className="hidden flex-1 items-stretch justify-center self-stretch lg:flex">
            {ITEMS.filter((it) => it.desktop).map((it) => {
              const active = route === it.route
              return (
                <a
                  key={it.route}
                  href={`#/${it.route}`}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'relative flex items-center gap-1.5 whitespace-nowrap px-2 font-mono text-[0.66rem] uppercase tracking-[0.12em] transition-colors xl:px-3',
                    active ? 'text-text' : 'text-muted hover:text-text',
                  )}
                >
                  {it.label}
                  <Badge route={it.route} />
                  <span aria-hidden className={cx('absolute inset-x-2 bottom-0 h-[2px] transition-opacity', active ? 'bg-amber opacity-100' : 'opacity-0')} />
                </a>
              )
            })}
            <DesktopMore route={route} />
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => openAgent('ask')}
            className="flex h-8 items-center gap-1.5 border border-amber/50 px-3 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-amber transition-colors hover:bg-amber-soft"
          >
            <Bot size={14} aria-hidden /> <span className="hidden sm:inline">Ask Runway</span><span className="sm:hidden">Ask</span>
          </button>
          <span className="hidden items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sage 2xl:flex" title="Your data stays in this browser">
            <span className="h-1.5 w-1.5 rounded-full bg-sage" aria-hidden /> Local-first
          </span>
          <a
            href="#/import"
            className={cx(
              'flex h-8 items-center gap-1.5 border px-3 font-mono text-[0.64rem] uppercase tracking-[0.14em] transition-colors',
              route === 'import' ? 'border-amber text-amber' : 'border-line-strong text-text hover:border-amber hover:text-amber',
            )}
          >
            <Plus size={13} aria-hidden /> Import
          </a>
        </div>
      </div>
    </header>
  )
}

export function MobileNav({ route }: { route: Route }) {
  const { model } = useStore()
  const [more, setMore] = useState(false)
  useEffect(() => {
    setMore(false)
  }, [route])
  if (!(model.hasTransactions || model.cash != null)) return null
  const primary = ITEMS.filter((i) => i.primary)
  const rest = ITEMS.filter((i) => !i.primary)
  const inRest = rest.some((i) => i.route === route)
  return (
    <>
      {more && (
        <div className="no-print fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMore(false)} aria-hidden />
      )}
      {more && (
        <div id="more-menu" className="no-print fixed inset-x-0 bottom-14 z-50 border-t border-line bg-graphite lg:hidden">
          <ul className="grid grid-cols-3">
            {rest.map((it) => {
              const Icon = it.icon
              return (
                <li key={it.route}>
                  <a href={`#/${it.route}`} aria-current={route === it.route ? 'page' : undefined} className={cx('flex h-16 flex-col items-center justify-center gap-1.5', route === it.route ? 'text-amber' : 'text-muted')}>
                    <Icon size={18} aria-hidden />
                    <span className="flex items-center gap-1 font-mono text-[0.58rem] uppercase tracking-[0.08em]">{it.short} <Badge route={it.route} /></span>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink/95 backdrop-blur-md lg:hidden">
        <ul className="grid grid-cols-5">
          {primary.map((it) => {
            const active = route === it.route
            const Icon = it.icon
            return (
              <li key={it.route}>
                <a href={`#/${it.route}`} aria-current={active ? 'page' : undefined} className={cx('relative flex h-14 flex-col items-center justify-center gap-1', active ? 'text-amber' : 'text-muted')}>
                  <Icon size={18} aria-hidden />
                  <span className="font-mono text-[0.52rem] uppercase tracking-[0.08em]">{it.short}</span>
                  {it.route === 'review' && model.reviewCount > 0 && <span className="absolute right-[26%] top-2 h-1.5 w-1.5 rounded-full bg-amber" aria-label={`${model.reviewCount} to review`} />}
                </a>
              </li>
            )
          })}
          <li>
            <button type="button" aria-expanded={more} aria-controls="more-menu" onClick={() => setMore((m) => !m)} className={cx('flex h-14 w-full flex-col items-center justify-center gap-1', more || inRest ? 'text-amber' : 'text-muted')}>
              <MoreHorizontal size={18} aria-hidden />
              <span className="font-mono text-[0.52rem] uppercase tracking-[0.08em]">More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  )
}
