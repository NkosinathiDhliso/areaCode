/**
 * Feature: Proof of demand, Property 5: Going isolation (consumer side).
 *
 * A Going mark is intent, not presence, so it may not touch a single thing the
 * map decides about how alive a venue is
 * (`.kiro/steering/honest-presence.md`, R9.4). This is the consumer half of the
 * property; the server half (pulse, live count, momentum, the Receipt) lives in
 * `backend/src/features/nodes/__tests__/going-isolation.property.test.ts`.
 *
 * Asserted as an invariance: the same venues are ranked and presented twice, once
 * carrying an arbitrary `goingCount` and once with the field absent, and the
 * Carousel_Order, the set of beams that survive the Constellation cap, and every
 * beam's Pulse_State geometry must be identical. Plus the directional case the
 * discovery DNA turns on: a venue with any number of marks never climbs over a
 * more-alive one.
 *
 * Validates: Requirements 9.4
 */

import type { Node } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { vibeRank, type RankInput } from './carouselRanking'
import { getNodeState } from './mapHelpers'
import { beamContainerSize, beamHeightForState } from './markerBeam'
import { constellationVisibleIds } from './markerPresentation'

function makeNode(id: string, lat: number, lng: number, goingCount?: number): Node {
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
    ...(goingCount === undefined ? {} : { goingCount }),
  } as Node
}

interface Scenario {
  venues: Array<{ id: string; lat: number; lng: number; pulse: number; checkIns: number; going: number }>
  zoom: number
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  venues: fc.uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 5 }),
      lat: fc.double({ min: -34, max: -22, noNaN: true }),
      lng: fc.double({ min: 16, max: 33, noNaN: true }),
      pulse: fc.nat({ max: 100 }),
      checkIns: fc.nat({ max: 50 }),
      // Any Going count, including one far larger than any real crowd.
      going: fc.nat({ max: 500 }),
    }),
    { minLength: 1, maxLength: 10, selector: (v) => v.id },
  ),
  // Across the Constellation band and the glyph band, so the beam cap is
  // exercised on both sides of MIN_MARKER_ZOOM.
  zoom: fc.double({ min: 4, max: 14, noNaN: true }),
})

/** The ranking input for one scenario, with or without the Going counts. */
function rankInput(scenario: Scenario, carryGoing: boolean): RankInput {
  const pulseScores: Record<string, number> = {}
  const checkInCounts: Record<string, number> = {}
  for (const v of scenario.venues) {
    pulseScores[v.id] = v.pulse
    checkInCounts[v.id] = v.checkIns
  }
  return {
    venues: scenario.venues.map((v) => makeNode(v.id, v.lat, v.lng, carryGoing ? v.going : undefined)),
    pulseScores,
    checkInCounts,
    lastKnownPosition: { lat: -26.2041, lng: 28.0473 },
    positionFresh: true,
  }
}

/** Every beam's geometry, keyed by venue: what the eye actually reads as aliveness. */
function beamGeometry(ranked: Node[], pulseScores: Record<string, number>): Record<string, unknown> {
  const geometry: Record<string, unknown> = {}
  for (const node of ranked) {
    const state = getNodeState(pulseScores[node.id] ?? 0)
    geometry[node.id] = { state, height: beamHeightForState(state), size: beamContainerSize(state) }
  }
  return geometry
}

// ─── Property 5 ──────────────────────────────────────────────────────────────

describe('Property 5: Going never moves the order or the beams', () => {
  it('ranks venues identically whether or not a Going count rides along', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const withGoing = vibeRank(rankInput(scenario, true)).map((v) => v.id)
        const without = vibeRank(rankInput(scenario, false)).map((v) => v.id)

        expect(withGoing).toEqual(without)
      }),
      { numRuns: 200 },
    )
  })

  it('shows the same beams, with the same height and footprint', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const inputWith = rankInput(scenario, true)
        const inputWithout = rankInput(scenario, false)
        const rankedWith = vibeRank(inputWith)
        const rankedWithout = vibeRank(inputWithout)

        const visibleWith = constellationVisibleIds(rankedWith, scenario.zoom, null, inputWith.pulseScores)
        const visibleWithout = constellationVisibleIds(rankedWithout, scenario.zoom, null, inputWithout.pulseScores)

        expect(visibleWith === null).toBe(visibleWithout === null)
        expect([...(visibleWith ?? [])].sort()).toEqual([...(visibleWithout ?? [])].sort())
        expect(beamGeometry(rankedWith, inputWith.pulseScores)).toEqual(
          beamGeometry(rankedWithout, inputWithout.pulseScores),
        )
      }),
      { numRuns: 200 },
    )
  })

  it('never lets marks carry a quiet venue over an alive one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 500 }), (pulse, marks) => {
        // The quiet venue is also the nearer one, so proximity cannot rescue it
        // either (`discovery-dna-vibe-over-convenience.md`).
        const input: RankInput = {
          venues: [makeNode('quiet-but-intended', -26.2041, 28.0473, marks), makeNode('alive', -26.3, 28.2, 0)],
          pulseScores: { 'quiet-but-intended': 0, alive: pulse },
          checkInCounts: {},
          lastKnownPosition: { lat: -26.2041, lng: 28.0473 },
          positionFresh: true,
        }

        expect(vibeRank(input).map((v) => v.id)).toEqual(['alive', 'quiet-but-intended'])
      }),
      { numRuns: 100 },
    )
  })
})
