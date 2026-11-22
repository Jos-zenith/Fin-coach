// Date helpers. All dates are ISO "YYYY-MM-DD" strings handled in UTC so there is no timezone drift.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function toISO(y: number, m: number, d: number): string | null {
  return isValidYMD(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null
}

function fullYear(y: number): number {
  if (y >= 100) return y
  return y < 70 ? 2000 + y : 1900 + y
}

export interface DateParseOptions {
  /** Treat 01/02/2026 as 2 Jan instead of 1 Feb. Indian statements are day-first, so false by default. */
  monthFirst?: boolean
}

/**
 * Parses the date formats Indian banks and SMS use:
 * 26/04/2026, 26-04-26, 26.04.2026, 26 Apr 2026, 26-Apr-26, 26Apr26, 2026-04-26, Apr 26, 2026.
 * Returns null when it cannot be read as a real calendar date.
 */
export function parseDate(input: string, opts: DateParseOptions = {}): string | null {
  const s = input.trim().replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (!s) return null
  let m: RegExpMatchArray | null

  // 2026-04-26 / 2026/04/26
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/)
  if (m) return toISO(+m[1], +m[2], +m[3])

  // 26/04/2026, 26-04-26, 26.04.26
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T:].*)?$/)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    const y = fullYear(+m[3])
    const [d, mo] = opts.monthFirst ? [b, a] : [a, b]
    return toISO(y, mo, d)
  }

  // 26-Apr-2026, 26 Apr 26, 26Apr26, 26-April-2026
  m = s.match(/^(\d{1,2})[-/. ]?([A-Za-z]{3,9})[-/. ]?(\d{2,4})(?:[ T:].*)?$/)
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (mo) return toISO(fullYear(+m[3]), mo, +m[1])
  }

  // Apr 26, 2026
  m = s.match(/^([A-Za-z]{3,9}) (\d{1,2}) (\d{2,4})$/)
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()]
    if (mo) return toISO(fullYear(+m[3]), mo, +m[2])
  }
  return null
}

export function dateFromJS(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null
  // Excel/JS dates from spreadsheets are local-midnight; read local parts.
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000)
}

export function addDays(iso: string, days: number): string {
  const dt = new Date(toUTC(iso) + days * 86_400_000)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function todayISO(): string {
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export const DAYS_PER_MONTH = 30.4375

/**
 * Length of the period in months, used to turn totals into monthly averages.
 * A statement that covers whole calendar months (e.g. 1 Aug to 31 Oct) reads as exactly 3.
 */
export function spanMonths(start: string, end: string): number {
  const raw = (diffDays(end, start) + 1) / DAYS_PER_MONTH
  const nearest = Math.round(raw)
  if (nearest >= 1 && Math.abs(raw - nearest) < 0.25) return nearest
  return Math.max(1, raw)
}

export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return `${d} ${mon} ${String(y).slice(2)}`
}

export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return `${d} ${mon} ${y}`
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}
