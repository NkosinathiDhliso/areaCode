import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure search logic extracted from the service/repository layer ───────────
// The actual implementation in repository.ts does:
//   const q = query.toLowerCase()
//   items.filter(n => (n.name || '').toLowerCase().includes(q))
// We replicate this pure logic here to test the property without DynamoDB.

interface Venue {
  id: string
  name: string
}

/**
 * Pure venue search function matching the implementation in
 * backend/src/features/nodes/repository.ts (searchNodes) and
 * backend/src/features/nodes/service.ts (DEV_MODE branch).
 *
 * Performs case-insensitive substring matching on venue name.
 */
function searchVenues(venues: Venue[], query: string): Venue[] {
  if (query.length < 2) return []
  const q = query.toLowerCase()
  return venues.filter((v) => v.name.toLowerCase().includes(q))
}

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a venue name: printable string of 1–50 characters */
const venueNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0)

/** Generate a venue with a unique id and a name */
const venueArb = fc.record({
  id: fc.uuid(),
  name: venueNameArb,
})

/** Generate a list of venues (0–30 items) */
const venueListArb = fc.array(venueArb, { minLength: 0, maxLength: 30 })

/** Generate a search query of 2+ characters (the minimum required by the API) */
const searchQueryArb = fc.string({ minLength: 2, maxLength: 20 }).filter((s) => s.trim().length >= 2)

// ─── Property 5: Venue search returns only matching results ─────────────────

describe('Property 5: Venue search returns only matching results', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any list of venues and any search query of two or more characters,
   * every venue in the search results SHALL have a name that contains the
   * query string (case-insensitive), and no venue whose name contains the
   * query string SHALL be excluded from the results.
   */

  it('every venue in search results has a name containing the query (case-insensitive)', () => {
    fc.assert(
      fc.property(venueListArb, searchQueryArb, (venues, query) => {
        const results = searchVenues(venues, query)
        const q = query.toLowerCase()

        for (const venue of results) {
          expect(venue.name.toLowerCase()).toContain(q)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('no venue whose name contains the query is excluded from results', () => {
    fc.assert(
      fc.property(venueListArb, searchQueryArb, (venues, query) => {
        const results = searchVenues(venues, query)
        const q = query.toLowerCase()

        // Find all venues that SHOULD match
        const expectedMatches = venues.filter((v) => v.name.toLowerCase().includes(q))

        // Every expected match must be in the results
        for (const expected of expectedMatches) {
          const found = results.some((r) => r.id === expected.id)
          expect(found).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('search results are exactly the set of venues whose names contain the query', () => {
    fc.assert(
      fc.property(venueListArb, searchQueryArb, (venues, query) => {
        const results = searchVenues(venues, query)
        const q = query.toLowerCase()

        const expectedMatches = venues.filter((v) => v.name.toLowerCase().includes(q))

        // Same count — no extras, no omissions
        expect(results.length).toBe(expectedMatches.length)

        // Same set of IDs
        const resultIds = new Set(results.map((r) => r.id))
        const expectedIds = new Set(expectedMatches.map((v) => v.id))
        expect(resultIds).toEqual(expectedIds)
      }),
      { numRuns: 25 },
    )
  })

  it('search is case-insensitive: query "ABC" matches venue "abc" and vice versa', () => {
    fc.assert(
      fc.property(venueListArb, searchQueryArb, (venues, query) => {
        const resultsLower = searchVenues(venues, query.toLowerCase())
        const resultsUpper = searchVenues(venues, query.toUpperCase())
        const resultsMixed = searchVenues(venues, query)

        // All case variants produce the same result set
        const idsLower = new Set(resultsLower.map((r) => r.id))
        const idsUpper = new Set(resultsUpper.map((r) => r.id))
        const idsMixed = new Set(resultsMixed.map((r) => r.id))

        expect(idsLower).toEqual(idsUpper)
        expect(idsLower).toEqual(idsMixed)
      }),
      { numRuns: 25 },
    )
  })

  it('queries shorter than 2 characters return no results', () => {
    fc.assert(
      fc.property(venueListArb, fc.string({ minLength: 0, maxLength: 1 }), (venues, query) => {
        const results = searchVenues(venues, query)
        expect(results).toHaveLength(0)
      }),
      { numRuns: 25 },
    )
  })

  it('a query that is a substring of a venue name always includes that venue', () => {
    fc.assert(
      fc.property(
        venueArb,
        fc.integer({ min: 0, max: 48 }),
        fc.integer({ min: 2, max: 20 }),
        (venue, startOffset, length) => {
          // Extract a substring from the venue name to use as query
          const name = venue.name
          if (name.length < 2) return // skip if name too short

          const start = startOffset % Math.max(1, name.length - 1)
          const end = Math.min(start + Math.max(2, length), name.length)
          const query = name.slice(start, end)

          if (query.length < 2) return // skip if extracted query too short

          const results = searchVenues([venue], query)
          expect(results.length).toBe(1)
          expect(results[0]!.id).toBe(venue.id)
        },
      ),
      { numRuns: 25 },
    )
  })
})
