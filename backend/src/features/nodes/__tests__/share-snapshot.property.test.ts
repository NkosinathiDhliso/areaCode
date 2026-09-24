/**
 * Feature: Proof of demand, Property 4: Share snapshot honesty and bound.
 *
 * The share snapshot is the one line a stranger reads before deciding whether
 * to come. Three universal rules hold over the whole input space:
 *
 * 1. Zero live presence never reads as busy (`honest-presence.md`): the
 *    presence label is "Quiet right now" or "Be the first in", never
 *    Active/Buzzing/Popping, and no "N here now" clause is rendered.
 * 2. The venue name is always present, in full, for any name inside the
 *    100-character node-name validator bound.
 * 3. The line stays under `SHARE_SNAPSHOT_MAX_LENGTH`, for any input.
 *
 * The design's three worked examples are pinned in `share-snapshot.test.ts`.
 *
 * **Validates: Requirements 1.3**
 */

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildShareSnapshot, SHARE_SNAPSHOT_MAX_LENGTH } from '../share-snapshot.js'

/** Segment separator used by the snapshot (U+00B7 middle dot). */
const SEPARATOR = ' \u00b7 '

/** Labels that read as a crowd. None may appear when nobody is there. */
const BUSY_LABELS = ['Active', 'Buzzing', 'Popping']

/** The two honest readings of an empty room. */
const EMPTY_LABELS = ['Quiet right now', 'Be the first in']

/** The live-count clause shape, as a whole segment. */
const COUNT_CLAUSE = /^\d+ here now$/

/**
 * Venue name within the validator bound (100 chars), trimming to something
 * real, and free of the separator so the rendered line stays splittable.
 */
const nameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((name) => name.trim().length > 0 && !name.includes('\u00b7'))

/** Owner headline within the Dated_Slot validator bound (60 chars). */
const tonightArb = fc.option(
  fc.record({
    headline: fc.string({ maxLength: 60 }),
    startsAt: fc.option(
      fc.oneof(
        fc.constantFrom('00:00', '09:30', '21:00', '23:59'),
        fc.string({ maxLength: 8 }), // unrecognised values must be dropped, not printed
      ),
      { nil: null },
    ),
  }),
  { nil: null },
)

/**
 * Pulse score across the real band range plus the values a decayed KV read can
 * produce (negative, non-finite). None of them may promote an empty room.
 */
const pulseScoreArb = fc.oneof(
  fc.double({ min: -50, max: 500, noNaN: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
)

/** Any value that means "nobody is here right now". */
const noPresenceArb = fc.oneof(fc.integer({ min: -1000, max: 0 }), fc.constantFrom(Number.NaN, -0))

const countArb = fc.integer({ min: 0, max: 5000 })

const inputArb = fc.record({
  name: nameArb,
  pulseScore: pulseScoreArb,
  liveCheckInCount: countArb,
  activeRewardCount: fc.integer({ min: 0, max: 500 }),
  tonight: tonightArb,
})

function segmentsOf(line: string): string[] {
  return line.split(SEPARATOR)
}

describe('Feature: Proof of demand, Property 4: share snapshot never reads busy at zero presence', () => {
  it('reads quiet or first-in, and renders no live count, for any pulse score when nobody is there', () => {
    fc.assert(
      fc.property(inputArb, noPresenceArb, (input, liveCheckInCount) => {
        const line = buildShareSnapshot({ ...input, liveCheckInCount })
        const segments = segmentsOf(line)

        expect(EMPTY_LABELS).toContain(segments[1])
        for (const segment of segments) {
          expect(BUSY_LABELS).not.toContain(segment)
          expect(segment).not.toMatch(COUNT_CLAUSE)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 4: share snapshot always names the venue', () => {
  it('leads with the trimmed venue name, in full, for any name inside the validator bound', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const line = buildShareSnapshot(input)

        expect(line).toContain(input.name.trim())
        expect(segmentsOf(line)[0]).toBe(input.name.trim())
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 4: share snapshot stays under the length bound', () => {
  it('is shorter than the bound for any realistic venue', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(buildShareSnapshot(input).length).toBeLessThan(SHARE_SNAPSHOT_MAX_LENGTH)
      }),
      { numRuns: 300 },
    )
  })

  it('is shorter than the bound even for a name longer than the validator allows', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 600 }).filter((name) => name.trim().length > 0),
        pulseScoreArb,
        countArb,
        (name, pulseScore, liveCheckInCount) => {
          const line = buildShareSnapshot({
            name,
            pulseScore,
            liveCheckInCount,
            activeRewardCount: 3,
            tonight: { headline: 'Amapiano', startsAt: '21:00' },
          })

          expect(line.length).toBeLessThan(SHARE_SNAPSHOT_MAX_LENGTH)
        },
      ),
      { numRuns: 300 },
    )
  })
})
