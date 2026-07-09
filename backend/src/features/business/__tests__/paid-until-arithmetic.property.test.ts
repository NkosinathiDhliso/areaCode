import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { addPaidInterval, PAID_INTERVALS, type PaidInterval } from '../types.js'

/**
 * Feature: billing-revenue-integrity, Property 1: Paid_Until arithmetic is total and monotone.
 *
 * For all valid `(fromIso, interval)`, `addPaidInterval`:
 *   1. Total       — returns a valid ISO 8601 instant and never throws.
 *   2. Monotone    — the result instant is strictly greater than `fromIso`.
 *   3. Clamped     — calendar-month/year arithmetic clamps to the last day of the
 *                    target month (31 Jan + monthly = 28/29 Feb), so the result
 *                    day is `min(originalDay, lastDayOfTargetMonth)` and never
 *                    exceeds the target month's length.
 *   4. Never       — a renewal from `max(now, existingPaidUntil)` never shortens
 *      shortens      the existing window: the produced window end is always
 *                    greater than the existing `paidUntil` (and than `now`).
 *
 * Validates: Requirements 2.3
 */

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Valid millisecond-precision UTC ISO instant. Bounded 2000-01-01..2100-01-01 so
 * calendar shifts stay well inside the JS Date range and the day-of-month spread
 * covers every month length (28/29/30/31), exercising the clamp branch.
 */
const isoInstantArb: fc.Arbitrary<string> = fc
  .integer({ min: 946_684_800_000, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString())

const intervalArb: fc.Arbitrary<PaidInterval> = fc.constantFrom(...PAID_INTERVALS)

const RUN = { numRuns: 200 } as const

// Day 0 of the next month is the last day of `monthZeroBased` (UTC).
function lastDayOfUtcMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate()
}

describe('Feature: billing-revenue-integrity, Property 1: Paid_Until arithmetic is total and monotone', () => {
  it('is total: returns a valid ISO instant for any valid instant and interval', () => {
    fc.assert(
      fc.property(isoInstantArb, intervalArb, (fromIso, interval) => {
        const result = addPaidInterval(fromIso, interval)
        expect(typeof result).toBe('string')
        expect(Number.isNaN(new Date(result).getTime())).toBe(false)
        // Round-trips through Date without loss (canonical ISO string).
        expect(new Date(result).toISOString()).toBe(result)
      }),
      RUN,
    )
  })

  it('is monotone: the result instant is strictly greater than the input', () => {
    fc.assert(
      fc.property(isoInstantArb, intervalArb, (fromIso, interval) => {
        const result = addPaidInterval(fromIso, interval)
        expect(new Date(result).getTime()).toBeGreaterThan(new Date(fromIso).getTime())
      }),
      RUN,
    )
  })

  it('clamps calendar-month/year arithmetic to the last day of the target month', () => {
    const calendarIntervalArb: fc.Arbitrary<PaidInterval> = fc.constantFrom('monthly', 'yearly')
    fc.assert(
      fc.property(isoInstantArb, calendarIntervalArb, (fromIso, interval) => {
        const from = new Date(fromIso)
        const result = new Date(addPaidInterval(fromIso, interval))

        const originalDay = from.getUTCDate()
        const resultDay = result.getUTCDate()
        const lastDay = lastDayOfUtcMonth(result.getUTCFullYear(), result.getUTCMonth())

        // Never overflows the target month, and lands exactly on the clamped day.
        expect(resultDay).toBeLessThanOrEqual(lastDay)
        expect(resultDay).toBe(Math.min(originalDay, lastDay))

        // Target month is deterministic: +1 month (monthly) or +12 months (yearly).
        const monthsAdded = interval === 'monthly' ? 1 : 12
        const expectedMonthIndex = (from.getUTCMonth() + monthsAdded) % 12
        expect(result.getUTCMonth()).toBe(expectedMonthIndex)

        // Time-of-day is preserved through the shift.
        expect(result.getUTCHours()).toBe(from.getUTCHours())
        expect(result.getUTCMinutes()).toBe(from.getUTCMinutes())
        expect(result.getUTCSeconds()).toBe(from.getUTCSeconds())
        expect(result.getUTCMilliseconds()).toBe(from.getUTCMilliseconds())
      }),
      RUN,
    )
  })

  it('renewal from max(now, existingPaidUntil) never shortens the existing window', () => {
    fc.assert(
      fc.property(isoInstantArb, isoInstantArb, intervalArb, (nowIso, existingPaidUntilIso, interval) => {
        // Callers extend from the later of now and the current window end.
        const nowMs = new Date(nowIso).getTime()
        const existingMs = new Date(existingPaidUntilIso).getTime()
        const fromIso = nowMs >= existingMs ? nowIso : existingPaidUntilIso

        const producedMs = new Date(addPaidInterval(fromIso, interval)).getTime()

        // The renewed window ends strictly after both the old window end and now,
        // so a renewal can only ever grow the paid window.
        expect(producedMs).toBeGreaterThan(existingMs)
        expect(producedMs).toBeGreaterThan(nowMs)
      }),
      RUN,
    )
  })

  it('clamps concrete month-end examples (31 Jan + monthly -> 28/29 Feb)', () => {
    // Non-leap year: 31 Jan 2025 -> 28 Feb 2025.
    expect(addPaidInterval('2025-01-31T09:15:00.000Z', 'monthly')).toBe('2025-02-28T09:15:00.000Z')
    // Leap year: 31 Jan 2024 -> 29 Feb 2024.
    expect(addPaidInterval('2024-01-31T09:15:00.000Z', 'monthly')).toBe('2024-02-29T09:15:00.000Z')
    // Leap-day + yearly clamps to 28 Feb the following (non-leap) year.
    expect(addPaidInterval('2024-02-29T00:00:00.000Z', 'yearly')).toBe('2025-02-28T00:00:00.000Z')
    // daily / weekly are plain offsets.
    expect(addPaidInterval('2025-03-30T12:00:00.000Z', 'daily')).toBe('2025-03-31T12:00:00.000Z')
    expect(addPaidInterval('2025-03-30T12:00:00.000Z', 'weekly')).toBe('2025-04-06T12:00:00.000Z')
  })
})
