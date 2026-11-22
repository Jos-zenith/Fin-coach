/**
 * Balance reconciliation: in a complete statement every row's closing balance equals the previous
 * balance plus credits minus debits, and over the whole statement
 *   Opening + Credits − Debits = Closing.
 * Any break means a missing row, a mis-read amount or a wrong debit/credit direction, so it is the
 * strongest trust signal a bank statement can give.
 */

export interface ReconcileInput {
  date: string
  amount: number
  direction: 'debit' | 'credit'
  balanceAfter: number | null
}

export interface ReconcileBreak {
  /** date of the row where the balance stopped adding up */
  date: string
  expected: number
  found: number
  gap: number
}

export interface StatementIdentity {
  opening: number
  credits: number
  debits: number
  closing: number
  /** opening + credits − debits = closing (within ₹1) */
  ok: boolean
  /** balances printed on the statement itself (PDFs), when found */
  stated: { opening: number | null; closing: number | null; matches: boolean } | null
}

export interface Reconciliation {
  /** consecutive pairs checked */
  checked: number
  matched: number
  breaks: ReconcileBreak[]
  order: 'oldest_first' | 'newest_first'
  ok: boolean
  identity: StatementIdentity
}

const signed = (r: ReconcileInput) => (r.direction === 'credit' ? r.amount : -r.amount)
const round2 = (n: number) => Math.round(n * 100) / 100

function run(rows: ReconcileInput[]) {
  let matched = 0
  const breaks: ReconcileBreak[] = []
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].balanceAfter!
    const r = rows[i]
    const expected = prev + signed(r)
    if (Math.abs(expected - r.balanceAfter!) < 1) matched++
    else breaks.push({ date: r.date, expected: round2(expected), found: r.balanceAfter!, gap: round2(r.balanceAfter! - expected) })
  }
  return { matched, breaks }
}

/**
 * Rows in file order. Statements list oldest-first or newest-first, so both are tried.
 * `stated` are the opening/closing balances printed on the statement, if the parser found them.
 */
export function reconcile(rowsInFileOrder: ReconcileInput[], stated?: { opening: number | null; closing: number | null }): Reconciliation | null {
  const rows = rowsInFileOrder.filter((r) => r.balanceAfter != null)
  if (rows.length < 2) return null
  const fwd = run(rows)
  const rev = run([...rows].reverse())
  const best = rev.matched > fwd.matched ? { ...rev, order: 'newest_first' as const } : { ...fwd, order: 'oldest_first' as const }

  // statement-level identity, oldest row first
  const chrono = best.order === 'oldest_first' ? rows : [...rows].reverse()
  const all = best.order === 'oldest_first' ? rowsInFileOrder : [...rowsInFileOrder].reverse()
  const opening = round2(chrono[0].balanceAfter! - signed(chrono[0]))
  const closing = chrono[chrono.length - 1].balanceAfter!
  const credits = round2(all.filter((r) => r.direction === 'credit').reduce((a, r) => a + r.amount, 0))
  const debits = round2(all.filter((r) => r.direction === 'debit').reduce((a, r) => a + r.amount, 0))
  const statedOk =
    stated && (stated.opening != null || stated.closing != null)
      ? (stated.opening == null || Math.abs(stated.opening - opening) < 1) && (stated.closing == null || Math.abs(stated.closing - closing) < 1)
      : null
  const identity: StatementIdentity = {
    opening,
    credits,
    debits,
    closing,
    ok: Math.abs(opening + credits - debits - closing) < 1,
    stated: statedOk == null ? null : { opening: stated!.opening, closing: stated!.closing, matches: statedOk },
  }

  return {
    checked: rows.length - 1,
    matched: best.matched,
    breaks: best.breaks.slice(0, 20),
    order: best.order,
    ok: best.breaks.length === 0 && identity.ok && (identity.stated?.matches ?? true),
    identity,
  }
}
