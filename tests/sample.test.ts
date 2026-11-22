import { describe, expect, it } from 'vitest'
import { buildModel } from '../src/lib/engine/model'
import { sampleProfile, sampleRecords, sampleTxns, SAMPLE_CASH_TARGET } from '../src/lib/sample'
import { suggestPlan } from '../src/lib/engine/insights'
import { reconcile } from '../src/lib/ingest/reconcile'
import { DEFAULT_SIM, type Rule } from '../src/lib/types'

const TODAY = '2026-11-21'
const txns = sampleTxns('2026-11-01T00:00:00Z')
const model = (rules: Rule[] = []) => buildModel({ txns, rules, profile: sampleProfile(), sim: DEFAULT_SIM, today: TODAY })

describe('Rohan sample mission', () => {
  const m = model()
  it('is three months of messy data that needs review', () => {
    expect(m.base.months).toBe(3)
    expect(m.takeHome).toBe(68000)
    expect(m.reviewCount).toBeGreaterThan(10)
    expect(m.noise.byCategory['CC repayment']).toBeGreaterThan(0)
    expect(m.noise.byCategory['Self-transfer']).toBe(10000)
  })
  it('ends with the bank balance equal to the accessible cash', () => {
    const last = [...txns].filter((t) => t.balanceAfter != null).sort((a, b) => a.date.localeCompare(b.date)).at(-1)!
    expect(last.balanceAfter).toBe(SAMPLE_CASH_TARGET)
  })
  it('detects subscriptions, the price hike and the unknown mandate, but not the investment debit', () => {
    const byLabel = Object.fromEntries(m.leaks.map((l) => [l.label, l]))
    expect(byLabel['Netflix'].priceChange).toMatchObject({ from: 499, to: 649 })
    expect(byLabel['Spotify']).toBeDefined()
    expect(byLabel['Swiggy One']).toBeDefined()
    expect(m.leaks.some((l) => l.kind === 'mandate' && /learnify/i.test(l.label))).toBe(true)
    expect(m.leaks.some((l) => /sip|bse/i.test(l.label))).toBe(false)
  })
  it('first load tells the PRD story: about 3.4 months, a real surplus, a reachable fund', () => {
    expect(m.baseline.survival!).toBeGreaterThan(3.2)
    expect(m.baseline.survival!).toBeLessThan(3.6)
    expect(m.baseline.surplus!).toBeGreaterThan(10000)
    expect(m.baseline.surplus!).toBeLessThan(14000)
    expect(m.baseline.emergency.status).toBe('on_track')
  })
  it('the suggested plan moves the emergency fund from behind its target date to ahead of it', () => {
    const plan = suggestPlan(m)!
    expect(m.baseline.emergency.vsTarget).toBe('behind')
    expect(plan.scenario.emergency.vsTarget).toBe('ahead')
    expect(plan.surplusGain!).toBeGreaterThan(1500)
  })
  it('a friend paying back a dinner split is netted, not counted as income', () => {
    const back = m.resolved.filter((t) => t.direction === 'credit' && t.vpa === 'karthik.v@okicici')
    expect(back.length).toBeGreaterThan(0)
    expect(back.every((t) => t.lines.every((l) => l.category !== 'Other income'))).toBe(true)
  })
  it('the sample bank statement reconciles', () => {
    const rec = reconcile(sampleRecords().bank)!
    expect(rec.ok).toBe(true)
    expect(rec.checked).toBeGreaterThan(100)
  })
})
