import type { Node } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { RankInput, ViewportBounds } from './carouselRanking'
import { haversineMeters, scopeToViewport, vibeRank } from './carouselRanking'

/**
 * Map Discovery - proximity-biased ranking + viewport scoping property tests.
 *
 * These were the design's deferred ranking properties (tasks 2.2-2.5):
 *   - Property 8:  Proximity_Biased_Ranking is deterministic with a total tie-break
 *   - Property 9:  Ranking falls back to buzz without a fresh position
 *   - Property 10: Carousel_Order respects viewport scope
 *   - Property 11: Active_Venue is never dropped on recompute
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5
 */

function makeNode(id: string, lat: number, lng: number): Node {
  return {
    id,
    name: id,
    slug: id,
    category: 'nightlife',
    lat,
    lng,
    cityId: 'city-jhb',
    businessId: null,
    submittedBy: null,
    claimStatus: 'unclaimed',
    claimCipcStatus: null,
    nodeColour: '#3B7DD8',
    nodeIcon: null,
    qrCheckinEnabled: true,
    isVerified: false,
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  } as Node
}

const latArb = fc.double({ min: -85, max: 85, noNaN: true })
const lngArb = fc.double({ min: -180, max: 180, noNaN: true })

/** Unique-id venues so the id tie-break is unambiguous. */
const venuesArb = (minLength: number) =>
  fc
    .uniqueArray(fc.record({ id: fc.string({ minLength: 1, maxLength: 5 }), lat: latArb, lng: lngArb }), {
      minLength,
      maxLength: 8,
      selector: (v) => v.id,
    })
    .map((vs) => vs.map((v) => makeNode(v.id, v.lat, v.lng)))

/** A full ranking scenario: venues, their score maps, a position, and freshness. */
const scenarioArb = venuesArb(0).chain((venues) =>
  fc.record({
    venues: fc.constant(venues),
    pulse: fc.array(fc.nat({ max: 100 }), { minLength: venues.length, maxLength: venues.length }),
    checkin: fc.array(fc.nat({ max: 100 }), { minLength: venues.length, maxLength: venues.length }),
    position: fc.option(fc.record({ lat: latArb, lng: lngArb }), { nil: null }),
    positionFresh: fc.boolean(),
  }),
)

function toMaps(venues: Node[], pulse: number[], checkin: number[]) {
  const pulseScores: Record<string, number> = {}
  const checkInCounts: Record<string, number> = {}
  venues.forEach((v, i) => {
    pulseScores[v.id] = pulse[i]!
    checkInCounts[v.id] = checkin[i]!
  })
  return { pulseScores, checkInCounts }
}

describe('Feature: map-discovery-experience, Property 8: vibe-first ranking with proximity tiebreak and total order', () => {
  it('is a permutation; vibe never decreases, proximity breaks vibe ties, id breaks the rest', () => {
    fc.assert(
      fc.property(scenarioArb, ({ venues, pulse, checkin, position, positionFresh }) => {
        const { pulseScores, checkInCounts } = toMaps(venues, pulse, checkin)
        const input: RankInput = { venues, pulseScores, checkInCounts, lastKnownPosition: position, positionFresh }
        const ranked = vibeRank(input)

        // Permutation: same multiset of ids, no drops or dupes.
        expect([...ranked.map((v) => v.id)].sort()).toEqual([...venues.map((v) => v.id)].sort())

        const vibe = (v: Node) => (pulseScores[v.id] ?? 0) + (checkInCounts[v.id] ?? 0)
        const useProx = positionFresh && position !== null
        const dist = (v: Node) => (useProx ? haversineMeters(position!, { lat: v.lat, lng: v.lng }) : 0)

        for (let i = 1; i < ranked.length; i++) {
          const prev = ranked[i - 1]!
          const next = ranked[i]!
          // 1) Vibe is the hero signal: it never increases as we descend the order.
          expect(vibe(prev)).toBeGreaterThanOrEqual(vibe(next))
          if (vibe(prev) === vibe(next)) {
            // 2) Equal vibe -> proximity tiebreak, nearer first (never outranks vibe).
            expect(dist(prev)).toBeLessThanOrEqual(dist(next))
            // 3) Equal vibe and distance -> deterministic id tiebreak.
            if (dist(prev) === dist(next)) expect(prev.id < next.id).toBe(true)
          }
        }
      }),
      { numRuns: 200 },
    )
  })

  it('is deterministic - two computations on identical input agree exactly', () => {
    fc.assert(
      fc.property(scenarioArb, ({ venues, pulse, checkin, position, positionFresh }) => {
        const { pulseScores, checkInCounts } = toMaps(venues, pulse, checkin)
        const input: RankInput = { venues, pulseScores, checkInCounts, lastKnownPosition: position, positionFresh }
        expect(vibeRank(input).map((v) => v.id)).toEqual(vibeRank(input).map((v) => v.id))
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 9: Ranking falls back to buzz without a fresh position', () => {
  it('orders by buzz alone (id tie-break) when the position is stale or absent, and never throws', () => {
    fc.assert(
      fc.property(
        venuesArb(0).chain((venues) =>
          fc.record({
            venues: fc.constant(venues),
            pulse: fc.array(fc.nat({ max: 100 }), { minLength: venues.length, maxLength: venues.length }),
            checkin: fc.array(fc.nat({ max: 100 }), { minLength: venues.length, maxLength: venues.length }),
            // Position may be present but is never fresh, so proximity is ignored.
            position: fc.option(fc.record({ lat: latArb, lng: lngArb }), { nil: null }),
          }),
        ),
        ({ venues, pulse, checkin, position }) => {
          const { pulseScores, checkInCounts } = toMaps(venues, pulse, checkin)
          const ranked = vibeRank({
            venues,
            pulseScores,
            checkInCounts,
            lastKnownPosition: position,
            positionFresh: false,
          })

          const buzz = (v: Node) => (pulseScores[v.id] ?? 0) + (checkInCounts[v.id] ?? 0)
          const expected = [...venues].sort((a, b) => buzz(b) - buzz(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          expect(ranked.map((v) => v.id)).toEqual(expected.map((v) => v.id))
        },
      ),
    )
  })
})

const boundsArb: fc.Arbitrary<ViewportBounds> = fc
  .record({ a: latArb, b: latArb, c: lngArb, d: lngArb })
  .map(({ a, b, c, d }) => ({
    south: Math.min(a, b),
    north: Math.max(a, b),
    west: Math.min(c, d),
    east: Math.max(c, d),
  }))

function within(v: Node, b: ViewportBounds): boolean {
  return v.lat >= b.south && v.lat <= b.north && v.lng >= b.west && v.lng <= b.east
}

function rankByIdOnly(venues: Node[]): Node[] {
  return vibeRank({ venues, pulseScores: {}, checkInCounts: {}, lastKnownPosition: null, positionFresh: false })
}

describe('Feature: map-discovery-experience, Property 10: Carousel_Order respects viewport scope', () => {
  it('returns exactly the ranked venues inside the bounds, preserving ranked order', () => {
    fc.assert(
      fc.property(venuesArb(0), boundsArb, (venues, bounds) => {
        const ranked = rankByIdOnly(venues)
        const scoped = scopeToViewport(ranked, bounds, null)

        for (const v of scoped) expect(within(v, bounds)).toBe(true)
        expect(scoped.map((v) => v.id)).toEqual(ranked.filter((v) => within(v, bounds)).map((v) => v.id))
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 11: Active_Venue is never dropped on recompute', () => {
  it('always retains the Active_Venue, even when it falls outside the viewport', () => {
    fc.assert(
      fc.property(venuesArb(1), boundsArb, fc.nat(), (venues, bounds, idx) => {
        const ranked = rankByIdOnly(venues)
        const activeId = venues[idx % venues.length]!.id

        const scoped = scopeToViewport(ranked, bounds, activeId)
        expect(scoped.some((v) => v.id === activeId)).toBe(true)

        // Null bounds (map not ready) returns the Active_Venue alone.
        expect(scopeToViewport(ranked, null, activeId).map((v) => v.id)).toEqual([activeId])
      }),
    )
  })

  it('returns an empty list for null bounds with no Active_Venue', () => {
    fc.assert(
      fc.property(venuesArb(0), (venues) => {
        expect(scopeToViewport(rankByIdOnly(venues), null, null)).toEqual([])
      }),
    )
  })
})
