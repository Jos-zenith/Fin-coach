import { Component, type ReactNode } from 'react'

/** Keeps a failure in one part of the UI (e.g. the agent panel) from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; onReset?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="fixed bottom-24 right-6 z-[70] max-w-sm border border-rose/40 bg-graphite p-4 text-sm text-text">
        <p>{this.props.label} hit a problem and was closed. Your data is safe.</p>
        <button
          type="button"
          className="mt-2 font-mono text-xs uppercase tracking-[0.1em] text-amber hover:underline"
          onClick={() => {
            this.setState({ error: null })
            this.props.onReset?.()
          }}
        >
          Dismiss
        </button>
      </div>
    )
  }
}
