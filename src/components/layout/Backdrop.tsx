import { memo, useMemo } from 'react'

/**
 * The ambient environment: a procedurally drawn city at night, blurred and darkened so it never
 * competes with the numbers. No photos, no third-party assets, nothing fetched from the network.
 */
function rand(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

function Skyline() {
  const { far, near, lights } = useMemo(() => {
    const r = rand(42)
    const far: string[] = []
    const near: { x: number; w: number; h: number }[] = []
    const lights: { x: number; y: number; o: number; warm: boolean }[] = []
    let x = 0
    while (x < 1600) {
      const w = 30 + r() * 70
      const h = 120 + r() * 260
      far.push(`M${x},900 V${900 - h} H${x + w} V900 Z`)
      x += w + r() * 6
    }
    x = -20
    while (x < 1620) {
      const w = 50 + r() * 110
      const h = 90 + r() * 330
      near.push({ x, w, h })
      for (let wy = 900 - h + 14; wy < 880; wy += 16) {
        for (let wx = x + 8; wx < x + w - 8; wx += 13) {
          if (r() < 0.16) lights.push({ x: wx, y: wy, o: 0.35 + r() * 0.6, warm: r() < 0.78 })
        }
      }
      x += w + 4 + r() * 18
    }
    return { far, near, lights }
  }, [])

  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0c10" />
          <stop offset="0.55" stopColor="#1a1714" />
          <stop offset="1" stopColor="#2a1d12" />
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="1" r="0.7">
          <stop offset="0" stopColor="#c57a2c" stopOpacity="0.42" />
          <stop offset="1" stopColor="#c57a2c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sky)" />
      <rect width="1600" height="900" fill="url(#glow)" />
      <path d={far.join(' ')} fill="#1b1a1c" opacity="0.9" />
      {near.map((b, i) => (
        <rect key={i} x={b.x} y={900 - b.h} width={b.w} height={b.h} fill="#101012" />
      ))}
      {lights.map((l, i) => (
        <rect key={i} x={l.x} y={l.y} width="5" height="7" fill={l.warm ? '#f0b868' : '#9fb4c8'} opacity={l.o} />
      ))}
      {/* road light trails */}
      <path d="M-50,880 C400,840 1100,860 1650,820" stroke="#f3a64a" strokeWidth="5" opacity="0.5" fill="none" />
      <path d="M-50,895 C500,870 1000,885 1650,850" stroke="#d4573e" strokeWidth="4" opacity="0.4" fill="none" />
    </svg>
  )
}

function Bokeh() {
  const dots = useMemo(() => {
    const r = rand(7)
    return Array.from({ length: 26 }, () => ({
      left: r() * 100,
      top: 35 + r() * 60,
      size: 30 + r() * 120,
      warm: r() < 0.7,
      o: 0.08 + r() * 0.22,
    }))
  }, [])
  return (
    <div className="absolute inset-0" aria-hidden>
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            width: d.size,
            height: d.size,
            opacity: d.o,
            background: `radial-gradient(circle, ${d.warm ? '#f2b35c' : '#8fb0d0'} 0%, transparent 68%)`,
          }}
        />
      ))}
    </div>
  )
}

export const Backdrop = memo(function Backdrop({ intensity = 1, open = false }: { intensity?: number; open?: boolean }) {
  return (
    <div className="no-print pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink" aria-hidden>
      <div className="absolute inset-0 animate-drift" style={{ filter: 'blur(7px) saturate(0.9)', opacity: 0.85 * intensity }}>
        <Skyline />
        <Bokeh />
      </div>
      {/* darkening overlay + vignette keep text contrast high */}
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{
          background: open
            ? 'linear-gradient(90deg,rgba(10,10,12,0.82) 0%,rgba(10,10,12,0.45) 55%,rgba(10,10,12,0.3) 100%)'
            : 'linear-gradient(180deg,rgba(10,10,12,0.78) 0%,rgba(10,10,12,0.62) 45%,rgba(10,10,12,0.86) 100%)',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.7)_100%)]" />
      {/* faint film grain */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
})
