import { TIER_SIZE_MULTIPLIER } from '@area-code/shared/constants'
import type { BusinessTier, Node } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { BrowseState, RankInput, ViewportBounds } from './carouselRanking'
import {
  browseReducer,
  deriveBrowseStrip,
  haversineMeters,
  resolveArchetype,
  scopeToViewport,
  tasteMatchScore,
  vibeRank,
} from './carouselRanking'

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

// ─── Browse Strip State Machine (browseReducer) ─────────────────────────────

describe('Feature: vibe-ranked-browse, browseReducer unit tests', () => {
  it('OPEN resets to the initial top-2 reveal', () => {
    expect(browseReducer({ visibleCount: 7 }, { type: 'OPEN' })).toEqual({ visibleCount: 2 })
    expect(browseReducer({ visibleCount: 2 }, { type: 'OPEN' })).toEqual({ visibleCount: 2 })
  })

  it('TAP_MORE reveals one more venue', () => {
    expect(browseReducer({ visibleCount: 2 }, { type: 'TAP_MORE' })).toEqual({ visibleCount: 3 })
    expect(browseReducer({ visibleCount: 3 }, { type: 'TAP_MORE' })).toEqual({ visibleCount: 4 })
  })

  it('DISMISS resets to the initial top-2 reveal', () => {
    expect(browseReducer({ visibleCount: 5 }, { type: 'DISMISS' })).toEqual({ visibleCount: 2 })
  })

  it('FILTER_CHANGE resets to the initial top-2 reveal', () => {
    expect(browseReducer({ visibleCount: 5 }, { type: 'FILTER_CHANGE' })).toEqual({ visibleCount: 2 })
  })

  it('STEP does not change state', () => {
    const revealed: BrowseState = { visibleCount: 4 }
    const initial: BrowseState = { visibleCount: 2 }
    expect(browseReducer(revealed, { type: 'STEP' })).toBe(revealed)
    expect(browseReducer(initial, { type: 'STEP' })).toBe(initial)
  })
})

// ─── Progressive reveal selector (deriveBrowseStrip) ────────────────────────

describe('Feature: vibe-ranked-browse, deriveBrowseStrip unit tests', () => {
  const nodes = [makeNode('a', 0, 0), makeNode('b', 1, 1), makeNode('c', 2, 2), makeNode('d', 3, 3)]

  it('shows the top 2 + showMore at the initial reveal when >= 3 venues', () => {
    const result = deriveBrowseStrip(nodes, 2)
    expect(result.visible).toHaveLength(2)
    expect(result.visible[0]!.id).toBe('a')
    expect(result.visible[1]!.id).toBe('b')
    expect(result.showMore).toBe(true)
  })

  it('reveals one more venue per step, keeping showMore until the list is exhausted', () => {
    const step3 = deriveBrowseStrip(nodes, 3)
    expect(step3.visible.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(step3.showMore).toBe(true)

    const step4 = deriveBrowseStrip(nodes, 4)
    expect(step4.visible.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(step4.showMore).toBe(false)
  })

  it('clamps an over-reveal to the list length with no showMore', () => {
    const result = deriveBrowseStrip(nodes, 99)
    expect(result.visible).toHaveLength(4)
    expect(result.showMore).toBe(false)
  })

  it('shows all venues with showMore=false when there are fewer than the initial reveal', () => {
    const twoNodes = [makeNode('x', 0, 0), makeNode('y', 1, 1)]
    const result = deriveBrowseStrip(twoNodes, 2)
    expect(result.visible).toHaveLength(2)
    expect(result.showMore).toBe(false)
  })

  it('returns empty visible and showMore=false for empty list', () => {
    const result = deriveBrowseStrip([], 2)
    expect(result.visible).toHaveLength(0)
    expect(result.showMore).toBe(false)
  })

  it('exactly 3 venues at initial reveal shows top 2 + showMore', () => {
    const threeNodes = [makeNode('a', 0, 0), makeNode('b', 1, 1), makeNode('c', 2, 2)]
    const result = deriveBrowseStrip(threeNodes, 2)
    expect(result.visible).toHaveLength(2)
    expect(result.showMore).toBe(true)
  })

  it('1 venue at initial reveal shows all with no showMore', () => {
    const one = [makeNode('z', 5, 5)]
    const result = deriveBrowseStrip(one, 2)
    expect(result.visible).toHaveLength(1)
    expect(result.showMore).toBe(false)
  })
})

// ─── Boost ranking level containment (billing-revenue-integrity) ────────────

/**
 * Property 4: a paid boost lives entirely inside vibeRank level 3 and can never
 * cross the taste (level 1) or aliveness (level 2) signals. Within venues that
 * are equal on taste and aliveness, `boostActive` orders ahead of business tier
 * (boost breaks before tier). Extends the vibeRank property suite above.
 *
 * Validates: Requirements 5.3, 5.5
 */
const BOOST_TIERS: BusinessTier[] = ['free', 'starter', 'payg', 'growth', 'pro']
const BOOST_ARCHETYPES = ['archetype-a', 'archetype-b', 'archetype-c']

/** A venue carrying the level-3 signals (boost, tier) plus a taste archetype. */
function makeBoostNode(id: string, boostActive: boolean, businessTier: BusinessTier, defaultArchetypeId: string): Node {
  return { ...makeNode(id, 0, 0), boostActive, businessTier, defaultArchetypeId } as Node
}

const boostScenarioArb = fc
  .uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 5 }),
      boostActive: fc.boolean(),
      businessTier: fc.constantFrom(...BOOST_TIERS),
      defaultArchetypeId: fc.constantFrom(...BOOST_ARCHETYPES),
      // Small score ranges so ties on taste and aliveness are common, forcing
      // the comparator down into level 3 where boost lives.
      pulse: fc.nat({ max: 6 }),
      checkin: fc.nat({ max: 6 }),
      friends: fc.nat({ max: 3 }),
    }),
    { minLength: 2, maxLength: 8, selector: (v) => v.id },
  )
  .chain((venues) =>
    fc.record({
      venues: fc.constant(venues),
      // A null archetype degrades taste to friends-only; a set one creates
      // strict taste winners and losers to test level-1 containment.
      consumerArchetypeId: fc.option(fc.constantFrom(...BOOST_ARCHETYPES), { nil: null }),
    }),
  )

describe('Feature: billing-revenue-integrity, Property 4: boost never crosses ranking levels', () => {
  it('boost stays inside level 3: it never reorders a taste or aliveness winner, and orders ahead of tier', () => {
    fc.assert(
      fc.property(boostScenarioArb, ({ venues, consumerArchetypeId }) => {
        const nodes = venues.map((v) => makeBoostNode(v.id, v.boostActive, v.businessTier, v.defaultArchetypeId))
        const pulseScores: Record<string, number> = {}
        const checkInCounts: Record<string, number> = {}
        const friendsAtVenue: Record<string, string[]> = {}
        venues.forEach((v) => {
          pulseScores[v.id] = v.pulse
          checkInCounts[v.id] = v.checkin
          friendsAtVenue[v.id] = Array.from({ length: v.friends }, (_, i) => `u${i}`)
        })

        const input: RankInput = {
          venues: nodes,
          pulseScores,
          checkInCounts,
          lastKnownPosition: null,
          positionFresh: false,
          consumerArchetypeId,
          venueArchetypeIds: {},
          friendsAtVenue,
          hasLiveGets: {},
        }
        const ranked = vibeRank(input)

        const taste = (v: Node) =>
          tasteMatchScore(consumerArchetypeId, resolveArchetype(v, {}), (friendsAtVenue[v.id] ?? []).length)
        const alive = (v: Node) => (pulseScores[v.id] ?? 0) + (checkInCounts[v.id] ?? 0)
        const boost = (v: Node) => (v.boostActive ? 1 : 0)
        const tier = (v: Node) => TIER_SIZE_MULTIPLIER[v.businessTier ?? 'starter']

        // For every ordered pair (A before B), the lexicographic level hierarchy
        // holds. This proves a boost assignment can never reorder a pair that is
        // separated on taste (1) or aliveness (2): whenever A strictly beats B on
        // taste, or ties taste but strictly beats aliveness, A precedes B no
        // matter how boostActive is assigned to B. Only when A and B tie on both
        // does boost decide, and it sorts ahead of tier.
        for (let i = 0; i < ranked.length; i++) {
          for (let j = i + 1; j < ranked.length; j++) {
            const a = ranked[i]!
            const b = ranked[j]!
            expect(taste(a)).toBeGreaterThanOrEqual(taste(b))
            if (taste(a) === taste(b)) {
              expect(alive(a)).toBeGreaterThanOrEqual(alive(b))
              if (alive(a) === alive(b)) {
                // Equal on taste + aliveness: boostActive orders ahead (level 3a).
                expect(boost(a)).toBeGreaterThanOrEqual(boost(b))
                // Boost breaks before tier: tier only decides once boost ties (3b).
                if (boost(a) === boost(b)) {
                  expect(tier(a)).toBeGreaterThanOrEqual(tier(b))
                }
              }
            }
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})
