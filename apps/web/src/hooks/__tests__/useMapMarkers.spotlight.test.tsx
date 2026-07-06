// @vitest-environment jsdom
import { useLocationStore, useMapStore, useSelectionStore } from '@area-code/shared/stores'
import type { Node, NodeCategory } from '@area-code/shared/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Spotlight_Mode - Marker_Layer membership (task 9.5).
 *
 * Integration-style: the hook is rendered against an in-memory Mapbox stub
 * whose Marker class records add/remove, so the test counts how many markers
 * are live on the map. It proves the single reconcile path (no parallel
 * renderer) narrows membership to the one spotlit venue on enter and rebuilds
 * the full filtered set on exit (R4.1, R4.2).
 *
 * Validates: Requirements 11.5
 */

// vi.mock is hoisted above imports, so the shared `liveMarkers` set and the
// FakeMarker class it mutates are created with vi.hoisted (tech.md: "Mock
// shared hooks with vi.hoisted so the factory can reference mutable mock
// state"). The factory below and the test body both read the same set.
const { liveMarkers, FakeMarker } = vi.hoisted(() => {
  const live = new Set<{ getElement: () => HTMLElement }>()
  class FakeMarker {
    private _el: HTMLElement
    constructor(opts: { element: HTMLElement }) {
      this._el = opts.element
    }
    setLngLat() {
      return this
    }
    addTo() {
      live.add(this)
      return this
    }
    remove() {
      live.delete(this)
    }
    getElement() {
      return this._el
    }
  }
  return { liveMarkers: live, FakeMarker }
})

vi.mock('mapbox-gl', () => ({ default: { Marker: FakeMarker } }))

import { useMapMarkers } from '../useMapMarkers'

function node(id: string, category: NodeCategory = 'nightlife', lat = -26.2, lng = 28.04): Node {
  return { id, name: `Venue ${id}`, category, lat, lng } as Node
}

// A country-overview-independent glyph zoom (>= GLYPH_ZOOM_THRESHOLD 12.5 and
// >= MIN_MARKER_ZOOM 8) so every node renders as a glyph marker and the beam
// cap (`constellationVisibleIds`) returns null - membership is then governed
// purely by the spotlight filter, which is what this test targets.
const fakeMap = {
  getZoom: () => 13,
  getBounds: () => ({
    toArray: () => [
      [-180, -85],
      [180, 85],
    ],
  }),
  on: vi.fn(),
  off: vi.fn(),
}
const mapRef = { current: fakeMap } as unknown as React.RefObject<mapboxgl.Map | null>

const onTap = vi.fn()

function seed(): void {
  useMapStore.setState({
    nodes: { a: node('a'), b: node('b'), c: node('c') },
    pulseScores: {},
    checkInCounts: {},
    archetypeIds: {},
    friendsAtVenue: {},
    hasLiveGets: {},
    focusNodeId: null,
    mapInstance: fakeMap as never,
  })
  useLocationStore.setState({ lastKnownPosition: null, capturedAt: null })
  useSelectionStore.setState({
    activeVenueId: null,
    mode: 'closed',
    carouselOrder: [],
    openedFromFocus: false,
    lastVenueId: null,
    spotlightVenueId: null,
  })
}

function liveNodeIds(): string[] {
  return [...liveMarkers].map((m) => m.getElement().dataset['nodeId'] ?? '').sort()
}

beforeEach(() => {
  liveMarkers.clear()
  onTap.mockClear()
  seed()
})

describe('Feature: spotlight-mode, Marker_Layer membership (R11.5)', () => {
  it('renders one marker per venue when not spotlit', () => {
    renderHook(() => useMapMarkers(mapRef, null, onTap, true, null, {}))

    expect(liveMarkers.size).toBe(3)
    expect(liveNodeIds()).toEqual(['a', 'b', 'c'])
  })

  it('narrows to exactly one marker on entering Spotlight_Mode', () => {
    renderHook(() => useMapMarkers(mapRef, null, onTap, true, null, {}))
    expect(liveMarkers.size).toBe(3)

    // Enter spotlight on "b": the reconcile effect is keyed on spotlightVenueId
    // (task 5.1), so the store write re-runs it and tears down every non-member.
    act(() => {
      useSelectionStore.setState({ spotlightVenueId: 'b', activeVenueId: 'b' })
    })

    expect(liveMarkers.size).toBe(1)
    expect(liveNodeIds()).toEqual(['b'])
  })

  it('restores the full filtered set on exiting Spotlight_Mode', () => {
    renderHook(() => useMapMarkers(mapRef, null, onTap, true, null, {}))

    act(() => {
      useSelectionStore.setState({ spotlightVenueId: 'b', activeVenueId: 'b' })
    })
    expect(liveMarkers.size).toBe(1)

    // Clear spotlight - the same reconcile path rebuilds the full membership.
    act(() => {
      useSelectionStore.setState({ spotlightVenueId: null })
    })

    expect(liveMarkers.size).toBe(3)
    expect(liveNodeIds()).toEqual(['a', 'b', 'c'])
  })
})
