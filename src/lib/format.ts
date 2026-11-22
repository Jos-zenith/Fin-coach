const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})
const inrDecimal = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** ₹1,05,000 (lakh grouping). */
export function formatINR(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return inr.format(Math.round(n))
}

/** ₹356.00, for transaction rows where paise matter. */
export function formatINRExact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return inrDecimal.format(n)
}

export function formatNumber(n: number): string {
  return plain.format(n)
}

/** 3.4 */
export function formatMonths(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(1)
}

/** "+12 days" / "−3 days" */
export function formatDaysDelta(days: number): string {
  const r = Math.round(days)
  if (r === 0) return '0 days'
  return `${r > 0 ? '+' : '−'}${Math.abs(r)} day${Math.abs(r) === 1 ? '' : 's'}`
}

export function formatPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`
}
