import { useEffect, useState } from 'react'

export type Route = 'start' | 'import' | 'overview' | 'review' | 'leaks' | 'simulator' | 'nudges' | 'mission' | 'profile' | 'rules' | 'privacy'

export const ROUTES: Route[] = ['start', 'import', 'overview', 'review', 'leaks', 'simulator', 'nudges', 'mission', 'profile', 'rules', 'privacy']

function read(): { route: Route; param: string | null } {
  const [r, param] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { route: (ROUTES as string[]).includes(r) ? (r as Route) : 'start', param: param ?? null }
}

/** Hash routing: survives refresh, works on any static host, no server needed. */
export function useRoute() {
  const [state, setState] = useState(read)
  useEffect(() => {
    const on = () => {
      setState(read())
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return state
}

export function go(route: Route, param?: string) {
  window.location.hash = `/${route}${param ? `/${param}` : ''}`
}
