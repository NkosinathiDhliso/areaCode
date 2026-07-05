import type { Node } from '@area-code/shared/types'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ARCHETYPE_ID,
  DRAG_AXIS_THRESHOLD,
  GLYPH_ZOOM_THRESHOLD,
  MIN_MARKER_ZOOM,
  POSITION_FRESHNESS_WINDOW,
  SHEET_FOCUS_OFFSET_RATIO,
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
