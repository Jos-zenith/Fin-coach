import { ChevronDown, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { useStore } from '../app/store'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'
export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-mono uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'h-8 px-3 text-[0.66rem]',
        size === 'md' && 'h-10 px-4 text-[0.7rem]',
        size === 'lg' && 'h-12 px-6 text-[0.74rem]',
        variant === 'primary' && 'bg-amber text-ink hover:bg-[#efb75f]',
        variant === 'ghost' && 'border border-line-strong text-text hover:border-amber hover:text-amber',
        variant === 'subtle' && 'text-muted hover:text-text',
        variant === 'danger' && 'border border-rose/50 text-rose hover:bg-rose-soft',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Animated number: eases to the new value; instant when reduced motion is on
// ---------------------------------------------------------------------------

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function useAnimatedNumber(target: number, ms = 450): number {
  const [v, setV] = useState(target)
  const from = useRef(target)
  const raf = useRef(0)
  useEffect(() => {
    if (!Number.isFinite(target)) {
      setV(target)
      return
    }
    if (prefersReducedMotion() || !Number.isFinite(from.current)) {
      from.current = target
      setV(target)
      return
    }
    const start = performance.now()
    const a = from.current
    cancelAnimationFrame(raf.current)
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      const cur = a + (target - a) * e
      setV(cur)
      from.current = cur
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, ms])
  return v
}

export function Num({ value, format, className }: { value: number | null; format: (n: number) => string; className?: string }) {
  const v = useAnimatedNumber(value ?? NaN)
  return <span className={cx('tnum', className)}>{value == null ? '—' : format(v)}</span>
}

// ---------------------------------------------------------------------------
// "How is this calculated?" disclosure
// ---------------------------------------------------------------------------

export interface ExplainContent {
  definition: string
  formula: string
  inputs: [string, string][]
  assumptions?: string[]
  limitations?: string[]
}

export function Explain({ content, label = 'How is this calculated?', className }: { content: ExplainContent; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="label inline-flex items-center gap-1.5 !text-dim transition-colors hover:!text-amber"
      >
        {label}
        <ChevronDown size={12} className={cx('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={id} role="region" className="mt-3 animate-fade-up space-y-3 border-l border-amber/40 pl-4 text-sm text-muted">
          <p className="text-text/90">{content.definition}</p>
          <p className="font-mono text-xs text-amber/90">{content.formula}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            {content.inputs.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-dim">{k}</dt>
                <dd className="tnum text-text/90">{v}</dd>
              </div>
            ))}
          </dl>
          {content.assumptions?.length ? (
            <div>
              <p className="label mb-1">Assumptions</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">{content.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          ) : null}
          {content.limitations?.length ? (
            <div>
              <p className="label mb-1">Limitations</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">{content.limitations.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function MoneyInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  allowNull = true,
  id,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  hint?: string
  allowNull?: boolean
  id?: string
}) {
  const auto = useId()
  const fid = id ?? auto
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text.replace(/,/g, ''))
    if (parsed !== value) setText(value == null ? '' : String(Math.round(value * 100) / 100))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <label htmlFor={fid} className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5 flex items-center border-b border-line-strong focus-within:border-amber">
        <span className="pr-2 font-mono text-dim">₹</span>
        <input
          id={fid}
          inputMode="decimal"
          className="tnum h-10 w-full bg-transparent font-mono text-text placeholder:text-dim/70 focus:outline-none"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.,]/g, '')
            setText(raw)
            const n = raw.trim() === '' ? null : Number(raw.replace(/,/g, ''))
            if (n == null) onChange(allowNull ? null : 0)
            else if (Number.isFinite(n)) onChange(n)
          }}
        />
      </div>
      {hint && <span className="mt-1 block text-xs text-dim">{hint}</span>}
    </label>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format: (v: number) => string
  hint?: string
}) {
  const id = useId()
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="display tnum text-2xl text-text">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="range mt-1"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="mt-1 text-xs text-dim">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-9 px-3 font-mono text-[0.68rem] uppercase tracking-[0.12em] transition-colors',
            value === o.value ? 'bg-amber-soft text-amber' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tag({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'amber' | 'sage' | 'rose' | 'warn'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.68rem] uppercase tracking-[0.08em] whitespace-nowrap',
        tone === 'neutral' && 'border-line-strong text-muted',
        tone === 'amber' && 'border-amber/40 text-amber',
        tone === 'sage' && 'border-sage/40 text-sage',
        tone === 'rose' && 'border-rose/40 text-rose',
        tone === 'warn' && 'border-warn/40 text-warn',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function SectionTitle({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="label !text-amber">{kicker}</p>
        <h1 className="display mt-2 text-4xl uppercase sm:text-5xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-8">
      <p className="display text-2xl uppercase">{title}</p>
      <p className="max-w-xl text-sm text-muted">{body}</p>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal (native dialog: focus trap, Esc, backdrop for free)
// ---------------------------------------------------------------------------

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(560px,92vw)] border border-line-strong bg-graphite p-0 text-text backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 className="display text-xl uppercase">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
          <X size={18} />
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
    </dialog>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useStore()
  return (
    <div aria-live="polite" className="no-print fixed bottom-20 left-1/2 z-50 flex w-[min(420px,92vw)] -translate-x-1/2 flex-col gap-2 lg:bottom-24 lg:left-auto lg:right-6 lg:translate-x-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'panel flex animate-fade-up items-start gap-3 !bg-graphite/95 px-4 py-3',
            t.tone === 'warn' ? 'border-l-2 !border-l-warn' : 'border-l-2 !border-l-sage',
          )}
        >
          <div className="flex-1">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-text">{t.title}</p>
            {t.detail && <p className="mt-1 text-sm text-muted">{t.detail}</p>}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
                className="mt-2 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-amber hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-dim hover:text-text">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
