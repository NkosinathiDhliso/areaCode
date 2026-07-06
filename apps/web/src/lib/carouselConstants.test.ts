import type { Node } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  CONSTELLATION_MIN_ZOOM,
  DEFAULT_ARCHETYPE_ID,
  DRAG_AXIS_THRESHOLD,
  GLYPH_ZOOM_THRESHOLD,
  MIN_MARKER_ZOOM,
  POSITION_FRESHNESS_WINDOW,
  SHEET_FOCUS_OFFSET_RATIO,
  SPOTLIGHT_EXIT_ZOOM_DELTA,
  shouldExitSpotlight,
  toVenueCardVM,
} from './carouselConstants'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'node-1',
    name: 'The Test Venue',
    slug: 'the-test-venue',
    category: 'nightlife',
    lat: -26.2,
    lng: 28.04,
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
    ...overrides,
  } as Node
}

describe('carousel constants', () => {
  it('expose the documented values', () => {
    expect(DRAG_AXIS_THRESHOLD).toBe(8)
    expect(POSITION_FRESHNESS_WINDOW).toBe(60_000)
    expect(GLYPH_ZOOM_THRESHOLD).toBe(12.5)
    expect(MIN_MARKER_ZOOM).toBe(8)
    expect(SHEET_FOCUS_OFFSET_RATIO).toBe(0.3)
  })
})

describe('toVenueCardVM', () => {
  it('derives the card model from the live store maps', () => {
    const node = makeNode()
    const vm = toVenueCardVM(
      node,
      { 'node-1': 12 },
      { 'node-1': 35 }, // → buzzing
      { 'node-1': 'archetype-festival-spirit' },
    )

    expect(vm).toEqual({
      id: 'node-1',
      name: 'The Test Venue',
      liveCheckInCount: 12,
      pulseState: 'buzzing',
      archetypeId: 'archetype-festival-spirit',
      isFirstIn: false,
      momentum: 'steady',
    })
  })

  it('surfaces the momentum from the momentum map, defaulting to steady', () => {
    expect(toVenueCardVM(makeNode(), { 'node-1': 5 }, { 'node-1': 35 }, {}, { 'node-1': 'filling_up' }).momentum).toBe(
      'filling_up',
    )
    // Missing entry → steady (no trend to claim).
    expect(toVenueCardVM(makeNode(), { 'node-1': 5 }, { 'node-1': 35 }, {}).momentum).toBe('steady')
  })

  it('renders the "be the first in" state when the live count is zero', () => {
    const vm = toVenueCardVM(makeNode(), {}, { 'node-1': 0 }, {})

    expect(vm.liveCheckInCount).toBe(0)
    expect(vm.isFirstIn).toBe(true)
    expect(vm.pulseState).toBe('dormant')
  })

  it('falls back through live → node default → eclectic for the archetype id', () => {
    // Live archetype takes precedence.
    expect(
      toVenueCardVM(
        makeNode({ defaultArchetypeId: 'archetype-jazz' }),
        {},
        {},
        {
          'node-1': 'archetype-live',
        },
      ).archetypeId,
    ).toBe('archetype-live')

    // No live value → node default.
    expect(toVenueCardVM(makeNode({ defaultArchetypeId: 'archetype-jazz' }), {}, {}, {}).archetypeId).toBe(
      'archetype-jazz',
    )

    // Neither → eclectic fallback.
    expect(toVenueCardVM(makeNode(), {}, {}, {}).archetypeId).toBe(DEFAULT_ARCHETYPE_ID)
  })

  it('treats missing count and pulse entries as zero', () => {
    const vm = toVenueCardVM(makeNode(), {}, {}, {})
    expect(vm.liveCheckInCount).toBe(0)
    expect(vm.pulseState).toBe('dormant')
    expect(vm.isFirstIn).toBe(true)
  })
})

// ─── shouldExitSpotlight (R11.3) ─────────────────────────────────────────────
//
// The pure predicate returns true when EITHER the user has zoomed out by at
// least `delta` from the zoom recorded at spotlight entry, OR the current zoom
// has dropped below MIN_MARKER_ZOOM (the Constellation floor). Otherwise false.

const DELTA = SPOTLIGHT_EXIT_ZOOM_DELTA

describe('Feature: spotlight-mode, Property 4: false within the delta band above the constellation floor', () => {
  it('stays in spotlight when at/above the floor and the zoom-out gap is under delta', () => {
    fc.assert(
      fc.property(
        // currentZoom at or above the Constellation floor.
        fc.double({ min: MIN_MARKER_ZOOM, max: 22, noNaN: true }),
        // gap = entryZoom - currentZoom, kept clear of the exact delta edge so
        // the recomputed (entryZoom - currentZoom) can never round up to delta.
        // gap may be negative when the user has zoomed IN relative to entry.
        fc.double({ min: -10, max: DELTA - 0.01, noNaN: true }),
        (currentZoom, gap) => {
          const entryZoom = currentZoom + gap
          expect(shouldExitSpotlight(entryZoom, currentZoom, DELTA)).toBe(false)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('Feature: spotlight-mode, Property 5: true whenever zoomed out by at least delta', () => {
  it('exits spotlight once the zoom-out gap reaches or exceeds delta', () => {
    fc.assert(
      fc.property(
        fc.double({ min: MIN_MARKER_ZOOM, max: 22, noNaN: true }),
        // Clear of the exact delta edge so the recomputed gap always exceeds
        // delta (the exact-delta boundary is covered by the unit tests below).
        fc.double({ min: 0.01, max: 10, noNaN: true }),
        (currentZoom, extra) => {
          const entryZoom = currentZoom + DELTA + extra
          expect(shouldExitSpotlight(entryZoom, currentZoom, DELTA)).toBe(true)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('Feature: spotlight-mode, Property 6: true whenever currentZoom is below the constellation floor', () => {
  it('exits spotlight below MIN_MARKER_ZOOM regardless of entryZoom or delta', () => {
    fc.assert(
      fc.property(
        // currentZoom strictly below the floor.
        fc.double({ min: CONSTELLATION_MIN_ZOOM, max: MIN_MARKER_ZOOM, noNaN: true }),
        // arbitrary entryZoom.
        fc.double({ min: CONSTELLATION_MIN_ZOOM, max: 22, noNaN: true }),
        (currentZoom, entryZoom) => {
          fc.pre(currentZoom < MIN_MARKER_ZOOM)
          expect(shouldExitSpotlight(entryZoom, currentZoom, DELTA)).toBe(true)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('Feature: spotlight-mode, Property 7: matches the exit-condition oracle', () => {
  it('agrees with the direct formula across the full input space', () => {
    fc.assert(
      fc.property(
        fc.double({ min: CONSTELLATION_MIN_ZOOM, max: 22, noNaN: true }),
        fc.double({ min: CONSTELLATION_MIN_ZOOM, max: 22, noNaN: true }),
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        (entryZoom, currentZoom, delta) => {
          const expected = currentZoom < MIN_MARKER_ZOOM || entryZoom - currentZoom >= delta
          expect(shouldExitSpotlight(entryZoom, currentZoom, delta)).toBe(expected)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('shouldExitSpotlight boundaries', () => {
  it('exits at exactly delta zoomed out (13 → 11.5)', () => {
    expect(shouldExitSpotlight(13, 11.5)).toBe(true)
  })

  it('stays just under delta (13 → 11.6)', () => {
    expect(shouldExitSpotlight(13, 11.6)).toBe(false)
  })

  it('exits below the constellation floor (13 → 7.9)', () => {
    expect(shouldExitSpotlight(13, 7.9)).toBe(true)
  })

  it('stays when the zoom has not changed (13 → 13)', () => {
    expect(shouldExitSpotlight(13, 13)).toBe(false)
  })

  it('uses the default delta arg when called with two arguments', () => {
    // Default delta is SPOTLIGHT_EXIT_ZOOM_DELTA (1.5).
    expect(shouldExitSpotlight(13, 11.5)).toBe(true)
    expect(shouldExitSpotlight(13, 11.6)).toBe(false)
  })
})
