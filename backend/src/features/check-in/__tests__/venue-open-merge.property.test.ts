/**
 * Feature: Proof of demand, Property 1b: Venue_Open merge keeps the earliest
 * open, ORs away, and never shortens the window.
 *
 * **Validates: Requirements 2.3**
 *
 * A consumer may open the same venue several times before they walk in: from the
 * map at home, again from a share link on the taxi, again at the door. Exactly one
 * of those opens decides the Away_Gate, and it must be the first one — otherwise a
 * consumer who reopens the venue in the room would refresh their way out of a
 * Walk_In and "found you" would start counting people who were already there.
 *
 * Three clauses over `mergeVenueOpen`, the pure fold the service applies before it
 * writes:
 *
 *   1. Earliest wins: the merged `openedAt` is the earlier of the two, and the
 *      merged `source` is that same row's source (the pair is never crossed).
 *   2. `away` is a three-valued OR: any `true` wins, else any `false`, else
 *      `null` (unknown). An away open is never discarded.
 *   3. Order independence: merging in either direction gives the same row, so two
 *      opens landing in either sequence cannot produce two different receipts.
 *
 * The TTL half of the rule (a repeat open never shortens the window) is asserted
 * on the write itself in `venue-open-route.test.ts`, because the TTL is an
 * argument to the KV write rather than a field of the row.
 */

import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import type { VenueOpenRow } from '../found-via.js'
import { mergeVenueOpen } from '../venue-open.js'

const BASE_MS = Date.UTC(2026, 8, 28, 18, 0, 0)

/** Opens spread over a night, so pairs land both before and after each other. */
const rowArb: fc.Arbitrary<VenueOpenRow> = fc.record({
  source: fc.constantFrom('map' as const, 'share' as const, 'search' as const, 'push' as const),
  openedAt: fc
    .integer({ min: -6 * 60 * 60 * 1000, max: 6 * 60 * 60 * 1000 })
    .map((offsetMs) => new Date(BASE_MS + offsetMs).toISOString()),
  away: fc.constantFrom(true, false, null),
})

function expectedAway(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true || b === true) return true
  if (a === false || b === false) return false
  return null
}

describe('Feature: Proof of demand, Property 1b: Venue_Open merge', () => {
  it('keeps the earliest open together with its own source', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (existing, incoming) => {
        const merged = mergeVenueOpen(existing, incoming)
        const earliest = Date.parse(existing.openedAt) <= Date.parse(incoming.openedAt) ? existing : incoming

        expect(merged.openedAt).toBe(earliest.openedAt)
        expect(merged.source).toBe(earliest.source)
        // The window can only ever be measured from earlier, never from later.
        expect(Date.parse(merged.openedAt)).toBeLessThanOrEqual(Date.parse(incoming.openedAt))
        expect(Date.parse(merged.openedAt)).toBeLessThanOrEqual(Date.parse(existing.openedAt))
      }),
      { numRuns: 300 },
    )
  })

  it('ORs away over three values, so an away open is never discarded', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (existing, incoming) => {
        const merged = mergeVenueOpen(existing, incoming)

        expect(merged.away).toBe(expectedAway(existing.away, incoming.away))
        if (existing.away === true || incoming.away === true) expect(merged.away).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('does not depend on the order the two opens arrived in', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (a, b) => {
        // Two opens at the very same instant have no earlier one to prefer, so
        // which source survives is arbitrary by construction; the ordering
        // guarantee is about distinct instants.
        fc.pre(a.openedAt !== b.openedAt)

        expect(mergeVenueOpen(a, b)).toEqual(mergeVenueOpen(b, a))
      }),
      { numRuns: 300 },
    )
  })

  it('takes the incoming open unchanged when there is no row yet', () => {
    fc.assert(
      fc.property(rowArb, (incoming) => {
        expect(mergeVenueOpen(null, incoming)).toEqual(incoming)
      }),
      { numRuns: 100 },
    )
  })
})
