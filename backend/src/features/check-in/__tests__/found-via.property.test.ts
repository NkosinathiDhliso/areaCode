/**
 * Feature: Proof of demand, Property 1: Away_Gate semantics of `resolveFoundVia`.
 *
 * `foundVia` decides whether a check-in is sold to an owner as demand Area Code
 * created. Three universal rules hold over the whole input space:
 *
 * 1. Exactly one outcome, always from `FOUND_VIA`, for any row and any instant,
 *    and the function is pure: same input, same answer, row untouched.
 * 2. `walk_in` whenever the claim cannot be verified: no row, an unreadable
 *    row, an open after the check-in, an open older than the
 *    Attribution_Window, or an open that fails both arms of the Away_Gate.
 * 3. The row's own `source` survives whenever the gate passes. The function
 *    never invents a source and never returns one that is not on the row.
 *
 * The boundary instants (exactly 20 minutes, exactly 6 hours, one millisecond
 * past each) are pinned as examples in `found-via.test.ts`.
 *
 * **Validates: Requirements 2.4**
 */

import {
  ATTRIBUTION_WINDOW_HOURS,
  AWAY_GATE_MIN_MINUTES,
  FOUND_VIA,
  OPEN_SOURCES,
} from '@area-code/shared/constants/attribution'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { resolveFoundVia, type VenueOpenRow } from '../found-via.js'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/** The two thresholds under test, in milliseconds. */
const WINDOW_MS = ATTRIBUTION_WINDOW_HOURS * 60 * MINUTE_MS
const GATE_MS = AWAY_GATE_MIN_MINUTES * MINUTE_MS

const sourceArb = fc.constantFrom(...OPEN_SOURCES)

/** `null` is "position unknown", which must rely on the time arm alone. */
const awayArb = fc.constantFrom(true, false, null)

/** Check-in instants across a year, so no single date can carry a result. */
const checkInAtArb = fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) })

/** An open after the check-in: clock skew, never creditable. */
const negativeAgeArb = fc.integer({ min: -DAY_MS, max: -1 })

/** Inside the window but short of the time arm: the "opened at the bar" case. */
const beforeGateAgeArb = fc.integer({ min: 0, max: GATE_MS - 1 })

/** Past the time arm and still inside the window: creditable on time alone. */
const withinGateAgeArb = fc.integer({ min: GATE_MS, max: WINDOW_MS })

/** Past the window: the TTL's defensive twin. */
const expiredAgeArb = fc.integer({ min: WINDOW_MS + 1, max: WINDOW_MS + DAY_MS })

const anyAgeArb = fc.oneof(negativeAgeArb, beforeGateAgeArb, withinGateAgeArb, expiredAgeArb)

/** Build the row a check-in `ageMs` after the open would read. */
function rowFor(
  source: (typeof OPEN_SOURCES)[number],
  checkInAt: number,
  ageMs: number,
  away: boolean | null,
): VenueOpenRow {
  return { source, openedAt: new Date(checkInAt - ageMs).toISOString(), away }
}

describe('Feature: Proof of demand, Property 1: resolveFoundVia yields exactly one outcome and is pure', () => {
  it('returns a Found_Via value for any row, and the same value twice, leaving the row untouched', () => {
    fc.assert(
      fc.property(sourceArb, checkInAtArb, anyAgeArb, awayArb, (source, checkInAt, ageMs, away) => {
        const row = rowFor(source, checkInAt, ageMs, away)
        const snapshot = JSON.stringify(row)
        const instant = new Date(checkInAt).toISOString()

        const first = resolveFoundVia(row, instant)
        const second = resolveFoundVia(row, instant)

        expect([...FOUND_VIA]).toContain(first)
        expect(second).toBe(first)
        expect(JSON.stringify(row)).toBe(snapshot)
      }),
      { numRuns: 300 },
    )
  })

  it('reads a missing row as walk_in for any instant', () => {
    fc.assert(
      fc.property(checkInAtArb, (checkInAt) => {
        expect(resolveFoundVia(null, new Date(checkInAt).toISOString())).toBe('walk_in')
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 1: walk_in whenever the gate fails or the window lapsed', () => {
  it('never credits an open that is older than the Attribution_Window, whatever away says', () => {
    fc.assert(
      fc.property(sourceArb, checkInAtArb, expiredAgeArb, awayArb, (source, checkInAt, ageMs, away) => {
        const row = rowFor(source, checkInAt, ageMs, away)

        expect(resolveFoundVia(row, new Date(checkInAt).toISOString())).toBe('walk_in')
      }),
      { numRuns: 300 },
    )
  })

  it('never credits an open recorded after the check-in, whatever away says', () => {
    fc.assert(
      fc.property(sourceArb, checkInAtArb, negativeAgeArb, awayArb, (source, checkInAt, ageMs, away) => {
        const row = rowFor(source, checkInAt, ageMs, away)

        expect(resolveFoundVia(row, new Date(checkInAt).toISOString())).toBe('walk_in')
      }),
      { numRuns: 300 },
    )
  })

  it('never credits an open inside the time arm when the consumer was not known to be away', () => {
    fc.assert(
      fc.property(
        sourceArb,
        checkInAtArb,
        beforeGateAgeArb,
        fc.constantFrom(false, null),
        (source, checkInAt, ageMs, away) => {
          const row = rowFor(source, checkInAt, ageMs, away)

          expect(resolveFoundVia(row, new Date(checkInAt).toISOString())).toBe('walk_in')
        },
      ),
      { numRuns: 300 },
    )
  })

  it('reads an unreadable openAt or instant as walk_in', () => {
    const unreadableArb = fc.constantFrom('', 'not-an-instant', 'tonight', '2026-13-45T99:99:99Z')

    fc.assert(
      fc.property(sourceArb, checkInAtArb, awayArb, unreadableArb, (source, checkInAt, away, junk) => {
        const instant = new Date(checkInAt).toISOString()

        expect(resolveFoundVia({ source, openedAt: junk, away }, instant)).toBe('walk_in')
        expect(resolveFoundVia({ source, openedAt: instant, away }, junk)).toBe('walk_in')
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 1: the row source survives whenever the gate passes', () => {
  it('returns the row source when the open is old enough, whatever away says', () => {
    fc.assert(
      fc.property(sourceArb, checkInAtArb, withinGateAgeArb, awayArb, (source, checkInAt, ageMs, away) => {
        const row = rowFor(source, checkInAt, ageMs, away)

        expect(resolveFoundVia(row, new Date(checkInAt).toISOString())).toBe(source)
      }),
      { numRuns: 300 },
    )
  })

  it('returns the row source inside the window when the consumer was away, however recent the open', () => {
    fc.assert(
      fc.property(sourceArb, checkInAtArb, fc.oneof(beforeGateAgeArb, withinGateAgeArb), (source, checkInAt, ageMs) => {
        const row = rowFor(source, checkInAt, ageMs, true)

        expect(resolveFoundVia(row, new Date(checkInAt).toISOString())).toBe(source)
      }),
      { numRuns: 300 },
    )
  })

  it('never returns a source other than the one on the row', () => {
    fc.assert(
      fc.property(sourceArb, checkInAtArb, anyAgeArb, awayArb, (source, checkInAt, ageMs, away) => {
        const row = rowFor(source, checkInAt, ageMs, away)

        const result = resolveFoundVia(row, new Date(checkInAt).toISOString())

        if (result !== 'walk_in') {
          expect(result).toBe(source)
        }
      }),
      { numRuns: 300 },
    )
  })
})
