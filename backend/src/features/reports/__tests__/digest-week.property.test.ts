import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { digestWeekFor } from '../digest'

/**
 * Property 1: Digest_Week arithmetic
 *
 * For any instant, `digestWeekFor` returns a Monday-00:00-SAST week start
 * strictly before the instant, a 7-day window, and is constant across all
 * instants inside the same SAST week (idempotency key stability).
 *
 * **Validates: Requirements 1.1**
 */

// ─── Constants (mirror the pure core under test) ────────────────────────────

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

// ─── Arbitraries ────────────────────────────────────────────────────────────

// A wide span of instants (year 2000 to 2100) as ISO 8601 UTC strings.
const instantArb = fc
  .integer({
    min: Date.UTC(2000, 0, 1),
    max: Date.UTC(2100, 0, 1),
  })
  .map((ms) => new Date(ms).toISOString())

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: weekly-attribution-digest, Property 1: Digest_Week arithmetic', () => {
  it('window opens on a Monday 00:00 SAST strictly before the instant and spans 7 days', () => {
    fc.assert(
      fc.property(instantArb, (nowIso) => {
        const nowMs = new Date(nowIso).getTime()
        const week = digestWeekFor(nowIso)

        const startMs = new Date(week.windowStartUtc).getTime()
        const endMs = new Date(week.windowEndUtc).getTime()

        // Half-open window is exactly 7 days.
        expect(endMs - startMs).toBe(WEEK_MS)

        // The opening instant is strictly before now (boundary instants resolve
        // to the week that just closed, which is still strictly before now).
        expect(startMs).toBeLessThan(nowMs)

        // The opening instant, read in the SAST wall-clock domain, is a Monday
        // at 00:00:00.000.
        const startSast = new Date(startMs + SAST_OFFSET_MS)
        // getUTCDay: Sunday = 0 ... Saturday = 6, so Monday is 1.
        expect(startSast.getUTCDay()).toBe(1)
        expect(startSast.getUTCHours()).toBe(0)
        expect(startSast.getUTCMinutes()).toBe(0)
        expect(startSast.getUTCSeconds()).toBe(0)
        expect(startSast.getUTCMilliseconds()).toBe(0)

        // weekStartIso is the SAST calendar date of that opening Monday.
        expect(week.weekStartIso).toBe(startSast.toISOString().slice(0, 10))
      }),
      { numRuns: 200 },
    )
  })

  it('is constant for every instant inside the same SAST week (idempotency key stability)', () => {
    fc.assert(
      fc.property(
        instantArb,
        // The instants that resolve to a week whose window is [start, end) are
        // the half-open interval (start, end]: an instant exactly on the
        // opening Monday 00:00 SAST boundary belongs to the week that just
        // closed, while an instant on the closing boundary belongs to this one.
        fc.integer({ min: 1, max: WEEK_MS }),
        (nowIso, offsetMs) => {
          const base = digestWeekFor(nowIso)
          const startMs = new Date(base.windowStartUtc).getTime()

          // Another instant within the same week must yield the same week.
          const otherIso = new Date(startMs + offsetMs).toISOString()
          const other = digestWeekFor(otherIso)

          expect(other).toEqual(base)
        },
      ),
      { numRuns: 200 },
    )
  })
})
