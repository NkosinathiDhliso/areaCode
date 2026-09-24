/**
 * Feature: Proof of demand, Property 10: the SAST midnight TTL.
 *
 * `secondsUntilNextSastMidnight(now)` is the TTL for anything that means
 * "today": the day check-in counter behind pulse and the city toasts. The
 * property is what makes it safe to hand to a TTL field: the value is always a
 * positive number of seconds no longer than a day, and adding it to the instant
 * lands exactly on a 00:00 SAST boundary, never a fraction of a second either
 * side of one.
 *
 * Instants are generated on whole seconds because that is the granularity a TTL
 * has. Sub-second instants are covered by the unit case in `sast.test.ts`, which
 * pins the round-up.
 *
 * Validates: Requirements 15.2
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { SAST_OFFSET_MS, sastDateString, secondsUntilNextSastMidnight, startOfSastDayIso } from '../sast.js'

const DAY_SECONDS = 86_400

/** Whole-second instants spanning four years, so leap days and month ends appear. */
const instantArb = fc
  .integer({ min: 0, max: 4 * 366 * DAY_SECONDS })
  .map((offsetSeconds) => (Date.parse('2025-01-01T00:00:00.000Z') + offsetSeconds * 1000) as number)

describe('Feature: Proof of demand, Property 10: secondsUntilNextSastMidnight', () => {
  it('is always in (0, 86400]', () => {
    fc.assert(
      fc.property(instantArb, (nowMs) => {
        const seconds = secondsUntilNextSastMidnight(nowMs)
        expect(seconds).toBeGreaterThan(0)
        expect(seconds).toBeLessThanOrEqual(DAY_SECONDS)
        expect(Number.isInteger(seconds)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('lands exactly on a 00:00 SAST boundary', () => {
    fc.assert(
      fc.property(instantArb, (nowMs) => {
        const expiryMs = nowMs + secondsUntilNextSastMidnight(nowMs) * 1000
        // On the boundary: shifted into the SAST wall clock, the instant is
        // midnight, and it is the start of its own SAST day.
        expect(new Date(expiryMs + SAST_OFFSET_MS).toISOString().slice(10)).toBe('T00:00:00.000Z')
        expect(startOfSastDayIso(expiryMs)).toBe(new Date(expiryMs).toISOString())
      }),
      { numRuns: 200 },
    )
  })

  it('lands on the boundary that closes the instant\u2019s own SAST day', () => {
    fc.assert(
      fc.property(instantArb, (nowMs) => {
        const expiryMs = nowMs + secondsUntilNextSastMidnight(nowMs) * 1000
        // The expiry opens the NEXT SAST day, so the counter it guards cannot
        // survive into a morning that would read yesterday's number.
        const dayStartMs = Date.parse(startOfSastDayIso(nowMs))
        expect(expiryMs - dayStartMs).toBe(DAY_SECONDS * 1000)
        expect(sastDateString(expiryMs)).not.toBe(sastDateString(nowMs))
      }),
      { numRuns: 200 },
    )
  })
})
