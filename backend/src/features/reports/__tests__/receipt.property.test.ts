/**
 * Feature: Proof of demand, Property 2: Receipt conservation.
 *
 * The Receipt is the one place an owner is told how many people found them.
 * Four rules have to hold over every possible set of check-ins, or the two
 * numbers stop adding up to the room:
 *
 * 1. `foundYouVisitors + walkInVisitors === uniqueVisitors`, and all counts are
 *    non-negative integers. The split is exhaustive and disjoint: nobody is
 *    dropped and nobody is counted on both sides.
 * 2. `bySource` counts each Found_You consumer exactly once, so it sums to
 *    `foundYouVisitors` and never carries a `walk_in` key.
 * 3. `foundYouFirstTimers <= foundYouVisitors`, and an omitted
 *    earliest-check-in map reports unmeasured (suppressed), not zero demand.
 * 4. A check-in with no `foundVia` (written before the Phase 1 deploy) or an
 *    unrecognised one is a Walk_In, never a Found_You.
 *
 * The `measuredFrom` boundary and the tie-break examples are pinned in
 * `receipt.test.ts`.
 *
 * **Validates: Requirements 4.2**
 */

import { FOUND_VIA, OPEN_SOURCES } from '@area-code/shared/constants/attribution'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { RawCheckIn } from '../anonymize.js'
import { digestWeekFor, type DigestWeek } from '../digest.js'
import { computeReceipt, RECEIPT_METRIC_NAMES } from '../receipt.js'
import { SUPPRESSION_FLOOR } from '../suppression.js'

const DAY_MS = 86_400_000

/** A real Digest_Week, so the window bounds are what the pipeline computes. */
const weekArb: fc.Arbitrary<DigestWeek> = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => digestWeekFor(new Date(ms).toISOString()))

/** Small pool, so repeat visits and mixed Found_You / Walk_In users are common. */
const userIdArb = fc.integer({ min: 0, max: 12 }).map((n) => `user-${n}`)
const nodeIdArb = fc.constantFrom('node-a', 'node-b', 'node-c')
const tierArb = fc.constantFrom('starter', 'growth', 'pro')

/** Every stamped value, plus the pre-deploy absence. */
const foundViaArb = fc.constantFrom(...FOUND_VIA, undefined)

function checkInArbFor(week: DigestWeek, foundVia = foundViaArb): fc.Arbitrary<RawCheckIn> {
  const startMs = new Date(week.windowStartUtc).getTime()
  const endMs = new Date(week.windowEndUtc).getTime()

  return fc.record({
    userId: userIdArb,
    nodeId: nodeIdArb,
    tier: tierArb,
    checkedInAt: fc.integer({ min: startMs, max: endMs - 1 }).map((ms) => new Date(ms).toISOString()),
    foundVia,
  })
}

/**
 * An earliest-check-in map consistent with the window's visitors: some absent
 * (no provable earlier visit), some inside the window (first-timers), some
 * strictly before it (returning).
 */
function earliestArbFor(week: DigestWeek, checkIns: RawCheckIn[]): fc.Arbitrary<Record<string, string>> {
  const startMs = new Date(week.windowStartUtc).getTime()
  const endMs = new Date(week.windowEndUtc).getTime()
  const users = [...new Set(checkIns.map((checkIn) => checkIn.userId))]

  const placementArb = fc.oneof(
    fc.constant(null),
    fc.integer({ min: startMs, max: endMs - 1 }),
    fc.integer({ min: startMs - 400 * DAY_MS, max: startMs - 1 }),
  )

  return fc.array(placementArb, { minLength: users.length, maxLength: users.length }).map((placements) => {
    const earliest: Record<string, string> = {}
    users.forEach((userId, index) => {
      const placement = placements[index]
      if (placement !== null && placement !== undefined) {
        earliest[userId] = new Date(placement).toISOString()
      }
    })
    return earliest
  })
}

interface Scenario {
  week: DigestWeek
  checkIns: RawCheckIn[]
  earliestCheckInByUser: Record<string, string>
}

const scenarioArb: fc.Arbitrary<Scenario> = weekArb.chain((week) =>
  fc
    .array(checkInArbFor(week), { maxLength: 60 })
    .chain((checkIns) =>
      earliestArbFor(week, checkIns).map((earliestCheckInByUser) => ({ week, checkIns, earliestCheckInByUser })),
    ),
)

/** The Found_You consumers, derived independently of the implementation. */
function foundYouUsers(checkIns: RawCheckIn[]): Set<string> {
  return new Set(
    checkIns
      .filter((checkIn) => checkIn.foundVia !== undefined && checkIn.foundVia !== 'walk_in')
      .map((checkIn) => checkIn.userId),
  )
}

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0

describe('Feature: Proof of demand, Property 2: the Found_You and Walk_In split conserves the room', () => {
  it('adds up to unique visitors, in non-negative integers, for any set of check-ins', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns, earliestCheckInByUser }) => {
        const receipt = computeReceipt(checkIns, week, earliestCheckInByUser)

        expect(receipt.foundYouVisitors + receipt.walkInVisitors).toBe(receipt.uniqueVisitors)
        expect(isCount(receipt.uniqueVisitors)).toBe(true)
        expect(isCount(receipt.foundYouVisitors)).toBe(true)
        expect(isCount(receipt.walkInVisitors)).toBe(true)
        expect(isCount(receipt.foundYouFirstTimers)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('counts each consumer once: unique visitors equal the distinct consumers in the window', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns, earliestCheckInByUser }) => {
        const receipt = computeReceipt(checkIns, week, earliestCheckInByUser)
        const distinct = new Set(checkIns.map((checkIn) => checkIn.userId))

        expect(receipt.uniqueVisitors).toBe(distinct.size)
        expect(receipt.foundYouVisitors).toBe(foundYouUsers(checkIns).size)
      }),
      { numRuns: 300 },
    )
  })

  it('never lets a repeat visit inflate either side: counts stay at or below the distinct consumers', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns, earliestCheckInByUser }) => {
        const receipt = computeReceipt(checkIns, week, earliestCheckInByUser)

        expect(receipt.foundYouVisitors).toBeLessThanOrEqual(receipt.uniqueVisitors)
        expect(receipt.walkInVisitors).toBeLessThanOrEqual(receipt.uniqueVisitors)
        expect(receipt.uniqueVisitors).toBeLessThanOrEqual(checkIns.length)
      }),
      { numRuns: 300 },
    )
  })

  it('is pure: the same answer twice, and the check-ins are left untouched', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns, earliestCheckInByUser }) => {
        const snapshot = JSON.stringify(checkIns)

        const first = computeReceipt(checkIns, week, earliestCheckInByUser)
        const second = computeReceipt(checkIns, week, earliestCheckInByUser)

        expect(second).toEqual(first)
        expect(JSON.stringify(checkIns)).toBe(snapshot)
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 2: bySource counts every Found_You consumer exactly once', () => {
  it('sums to the Found_You count and carries no walk_in key', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns, earliestCheckInByUser }) => {
        const receipt = computeReceipt(checkIns, week, earliestCheckInByUser)
        const total = Object.values(receipt.bySource).reduce((sum, count) => sum + count, 0)

        expect(total).toBe(receipt.foundYouVisitors)
        expect(Object.keys(receipt.bySource).sort()).toEqual([...OPEN_SOURCES].sort())
        for (const count of Object.values(receipt.bySource)) {
          expect(isCount(count)).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 2: first-timers are bounded, and unmeasured is not zero', () => {
  it('never reports more Found_You first-timers than Found_You consumers', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns, earliestCheckInByUser }) => {
        const receipt = computeReceipt(checkIns, week, earliestCheckInByUser)

        expect(receipt.foundYouFirstTimers).toBeLessThanOrEqual(receipt.foundYouVisitors)
      }),
      { numRuns: 300 },
    )
  })

  it('suppresses the first-timer line when the caller did not do the earliest-check-in read', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns }) => {
        const receipt = computeReceipt(checkIns, week)

        expect(receipt.foundYouFirstTimers).toBe(0)
        expect(receipt.suppressed).toContain('foundYouFirstTimers')
      }),
      { numRuns: 300 },
    )
  })

  it('suppresses exactly the values whose sample is below the floor', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, checkIns, earliestCheckInByUser }) => {
        const receipt = computeReceipt(checkIns, week, earliestCheckInByUser)

        for (const name of RECEIPT_METRIC_NAMES) {
          expect(receipt.suppressed.includes(name)).toBe(
            (name === 'bySource' ? receipt.foundYouVisitors : receipt[name]) < SUPPRESSION_FLOOR,
          )
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 2: only a stamped source is ever Found_You', () => {
  it('reads a window of pre-deploy check-ins as all Walk_In', () => {
    fc.assert(
      fc.property(
        weekArb.chain((week) =>
          fc.array(checkInArbFor(week, fc.constant(undefined)), { maxLength: 40 }).map((checkIns) => ({
            week,
            checkIns,
          })),
        ),
        ({ week, checkIns }) => {
          const receipt = computeReceipt(checkIns, week)

          expect(receipt.foundYouVisitors).toBe(0)
          expect(receipt.walkInVisitors).toBe(receipt.uniqueVisitors)
          expect(Object.values(receipt.bySource).every((count) => count === 0)).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('reads an unrecognised stored value as Walk_In rather than crediting it', () => {
    fc.assert(
      fc.property(
        weekArb.chain((week) =>
          fc
            .array(checkInArbFor(week, fc.constantFrom('billboard', 'flyer', '', 'WALK_IN') as fc.Arbitrary<never>), {
              maxLength: 40,
            })
            .map((checkIns) => ({ week, checkIns })),
        ),
        ({ week, checkIns }) => {
          const receipt = computeReceipt(checkIns, week)

          expect(receipt.foundYouVisitors).toBe(0)
          expect(receipt.walkInVisitors).toBe(receipt.uniqueVisitors)
        },
      ),
      { numRuns: 300 },
    )
  })
})
