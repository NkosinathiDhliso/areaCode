import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { analyzeJourney } from '../../analyzers/journey.js'

/**
 * Property 11: Journey Analysis Correctness
 *
 * For any venue with at least 10 unique visitors and a map of other venues' visitor sets:
 * - Top overlap venues sorted descending by overlap count
 * - Length ≤ 5
 * - Overlap % = overlapCount / venueUniqueVisitors × 100
 * - Partnership suggestions ≤ 2
 * - Insufficient data when < 10 visitors
 *
 * **Validates: Requirements 9.1, 9.2, 9.4, 9.5**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

/** Generate a unique token string */
const tokenArb = fc.stringMatching(/^[0-9a-f]{8,16}$/)

/** Generate a set of visitor tokens of a given size */
function visitorSetArb(minSize: number, maxSize: number): fc.Arbitrary<Set<string>> {
  return fc.array(tokenArb, { minLength: minSize, maxLength: maxSize }).map((arr) => new Set(arr))
}

/** Generate a venue visitor map with some overlap with the target venue */
function venueVisitorMapArb(venueTokens: string[]): fc.Arbitrary<Map<string, { name: string; visitors: Set<string> }>> {
  return fc
    .array(
      fc.tuple(
        fc.stringMatching(/^[A-Za-z ]{1,20}$/).filter((s) => s.trim().length > 0),
        // Mix of overlapping tokens from venue and unique tokens
        fc
          .tuple(fc.subarray(venueTokens, { minLength: 0 }), fc.array(tokenArb, { minLength: 0, maxLength: 10 }))
          .map(([overlap, unique]) => new Set([...overlap, ...unique])),
      ),
      { minLength: 0, maxLength: 10 },
    )
    .map((entries) => {
      const map = new Map<string, { name: string; visitors: Set<string> }>()
      for (const [name, visitors] of entries) {
        const key = `venue-${map.size}`
        map.set(key, { name, visitors })
      }
      return map
    })
}

// ─── Property 11: Journey Analysis Correctness ──────────────────────────────

describe('Feature: venue-intelligence-reports, Property 11: Journey Analysis Correctness', () => {
  it('top venues sorted descending by overlap count, length ≤ 5, overlap % correct, partnerships ≤ 2', () => {
    /**
     * **Validates: Requirements 9.1, 9.2, 9.5**
     */
    fc.assert(
      fc.property(
        // Generate venue with at least 10 visitors
        fc.array(tokenArb, { minLength: 10, maxLength: 50 }).chain((tokens) => {
          const uniqueTokens = [...new Set(tokens)]
          // Ensure we have at least 10 unique tokens
          if (uniqueTokens.length < 10) {
            // Pad with additional unique tokens
            while (uniqueTokens.length < 10) {
              uniqueTokens.push(`pad-${uniqueTokens.length}-${Math.random().toString(36)}`)
            }
          }
          return fc.tuple(fc.constant(new Set(uniqueTokens)), venueVisitorMapArb(uniqueTokens))
        }),
        ([venueTokens, allVenueMap]) => {
          const result = analyzeJourney(venueTokens, allVenueMap)

          expect(result.hasInsufficientData).toBe(false)

          // Top venues length ≤ 5
          expect(result.topOverlapVenues.length).toBeLessThanOrEqual(5)

          // Sorted descending by overlap count
          for (let i = 1; i < result.topOverlapVenues.length; i++) {
            expect(result.topOverlapVenues[i]!.overlapCount).toBeLessThanOrEqual(
              result.topOverlapVenues[i - 1]!.overlapCount,
            )
          }

          // Overlap percentage = overlapCount / venueTokens.size × 100
          for (const venue of result.topOverlapVenues) {
            const expectedPercentage = (venue.overlapCount / venueTokens.size) * 100
            expect(venue.overlapPercentage).toBeCloseTo(expectedPercentage, 5)
          }

          // Partnership suggestions ≤ 2
          expect(result.partnershipSuggestions.length).toBeLessThanOrEqual(2)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('returns hasInsufficientData when fewer than 10 visitors', () => {
    /**
     * **Validates: Requirements 9.4**
     */
    fc.assert(
      fc.property(visitorSetArb(0, 9), (venueTokens) => {
        const emptyMap = new Map<string, { name: string; visitors: Set<string> }>()
        const result = analyzeJourney(venueTokens, emptyMap)

        expect(result.hasInsufficientData).toBe(true)
        expect(result.topOverlapVenues).toHaveLength(0)
        expect(result.partnershipSuggestions).toHaveLength(0)
      }),
      { numRuns: 25 },
    )
  })
})
