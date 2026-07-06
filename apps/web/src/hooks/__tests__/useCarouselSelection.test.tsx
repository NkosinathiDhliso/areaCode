// @vitest-environment jsdom
import { useLocationStore, useMapStore, useSelectionStore } from '@area-code/shared/stores'
import type { Node, NodeCategory } from '@area-code/shared/types'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAP_ARRIVAL_ZOOM } from '../../lib/carouselConstants'
import { useCarouselSelection, type UseCarouselSelectionParams } from '../useCarouselSelection'

/**
 * Map Discovery - selection orchestration tests (deferred tasks 9.2-9.5).
 *
 *   - Property 6:  Selection coherence across all input sources
 *   - Property 12: Filter change reassigns the Active_Venue deterministically
 *   - Property 23: Consumed Focus_Signal is cleared
 *   - Property 29: Browse_Mode order is stable during an in-progress swipe
 *
 * The hook reads the live map only through the abstracted `MapInstance`
 * (`getBounds().toArray()`), so an in-memory stub drives it with no Mapbox/WebGL.
 *
 * Validates: Requirements 3.6, 13.3, 15.2, 15.4, 18.3
 */

function node(id: string, category: NodeCategory, lat = -26.2, lng = 28.04): Node {
  return { id, name: `Venue ${id}`, category, lat, lng } as Node
}

// Bounds covering the whole globe so every seeded venue is in-viewport.
const fakeMap = {
  getBounds: () => ({
    toArray: () => [
      [-180, -85],
      [180, 85],
    ],
  }),
  flyTo: vi.fn(),
}

function seed(nodes: Node[]): void {
  const byId: Record<string, Node> = {}
  for (const n of nodes) byId[n.id] = n
  useMapStore.setState({
    nodes: byId,
    pulseScores: {},
    checkInCounts: {},
    archetypeIds: {},
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

const baseParams: UseCarouselSelectionParams = { categoryFilter: null, mapReady: true, reducedMotion: true }

afterEach(() => {
  vi.clearAllMocks()
})

describe('Feature: map-discovery-experience, Property 6: Selection coherence across all input sources', () => {
  beforeEach(() => seed([node('a', 'nightlife'), node('b', 'nightlife'), node('c', 'nightlife')]))

  it('every input source writes the same single Active_Venue', () => {
    const { result } = renderHook(() => useCarouselSelection(baseParams))

    act(() => result.current.selectVenue('a', 'search'))
    expect(result.current.activeVenueId).toBe('a')

    act(() => result.current.onMarkerTap('b'))
    expect(result.current.activeVenueId).toBe('b')

    act(() => result.current.onSearchSelect('c'))
    expect(result.current.activeVenueId).toBe('c')

    // The store holds exactly one Active_Venue id - the single source of truth.
    expect(useSelectionStore.getState().activeVenueId).toBe('c')
  })

  it('stepping moves the Active_Venue within the Carousel_Order and never outside it', () => {
    const { result } = renderHook(() => useCarouselSelection(baseParams))
    act(() => result.current.onMarkerTap('a'))

    const order = result.current.carouselOrder
    expect(order).toEqual(['a', 'b', 'c'])

    act(() => result.current.onSwipe(1))
    expect(order).toContain(result.current.activeVenueId)

    act(() => result.current.onSwipe(-1))
    expect(result.current.activeVenueId).toBe('a')
  })
})

describe('Feature: map-discovery-experience, Property 23: Consumed Focus_Signal is cleared', () => {
  beforeEach(() => seed([node('a', 'nightlife'), node('b', 'nightlife')]))

  it('selects the focused venue and clears the signal so it is not re-applied', () => {
    useMapStore.setState({ focusNodeId: 'b' })
    const { result } = renderHook(() => useCarouselSelection(baseParams))

    expect(useMapStore.getState().focusNodeId).toBeNull()
    expect(result.current.activeVenueId).toBe('b')
    expect(result.current.openedFromFocus).toBe(true)
  })

  it('clears a Focus_Signal for an unknown venue without selecting (R15.5)', () => {
    useMapStore.setState({ focusNodeId: 'zzz' })
    const { result } = renderHook(() => useCarouselSelection(baseParams))

    expect(useMapStore.getState().focusNodeId).toBeNull()
    expect(result.current.activeVenueId).toBeNull()
  })
})

describe('Feature: map-discovery-experience, Property 12: Filter change reassigns the Active_Venue deterministically', () => {
  it('reassigns to the first matching venue when the Active_Venue no longer matches', () => {
    seed([node('a', 'nightlife'), node('b', 'food'), node('c', 'nightlife')])
    const { result, rerender } = renderHook((props: UseCarouselSelectionParams) => useCarouselSelection(props), {
      initialProps: baseParams,
    })

    act(() => result.current.selectVenue('b', 'marker'))
    expect(result.current.activeVenueId).toBe('b')

    act(() => rerender({ ...baseParams, categoryFilter: 'nightlife' }))
    const active = result.current.activeVenueId
    expect(active).not.toBe('b')
    expect(useMapStore.getState().nodes[active!]?.category).toBe('nightlife')
  })

  it('dismisses the carousel when the filter leaves no venues', () => {
    seed([node('a', 'nightlife'), node('c', 'nightlife')])
    const { result, rerender } = renderHook((props: UseCarouselSelectionParams) => useCarouselSelection(props), {
      initialProps: baseParams,
    })

    act(() => result.current.selectVenue('a', 'marker'))
    expect(result.current.activeVenueId).toBe('a')

    act(() => rerender({ ...baseParams, categoryFilter: 'food' as NodeCategory }))
    expect(result.current.activeVenueId).toBeNull()
    expect(result.current.mode).toBe('closed')
  })
})

describe('Feature: map-discovery-experience, Property 29: Browse_Mode order is stable during an in-progress swipe', () => {
  beforeEach(() => seed([node('a', 'nightlife'), node('b', 'nightlife'), node('c', 'nightlife')]))

  it('ignores recomputes while a swipe is locked, then applies them on settle', () => {
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))
    act(() => result.current.onMarkerTap('a'))

    const locked = result.current.carouselOrder
    expect(locked).toEqual(['a', 'b', 'c'])

    act(() => result.current.setSwipeInProgress(true))
    act(() => {
      // Shrink the node set and force a recompute - locked, so order must hold.
      useMapStore.setState({ nodes: { a: node('a', 'nightlife') } })
      result.current.recomputeOrder()
    })
    expect(result.current.carouselOrder).toEqual(locked)

    // Settle the swipe - the deferred recompute now applies.
    act(() => result.current.setSwipeInProgress(false))
    expect(result.current.carouselOrder).toEqual(['a'])
  })
})

describe('Feature: live-vibe-on-map, cold-open arrival zoom', () => {
  // A map stub that reports a country-overview zoom so the first camera move
  // is treated as a cold open. Globe-spanning bounds keep every venue
  // in-viewport so the order is populated.
  function coldOpenMap(zoom: number) {
    // Track zoom like the real map: a flyTo carrying a zoom updates subsequent
    // getZoom() reads, so the "snap in only while below the marker threshold"
    // rule is exercised realistically across successive moves.
    let currentZoom = zoom
    return {
      getZoom: () => currentZoom,
      getBounds: () => ({
        toArray: () => [
          [-180, -85],
          [180, 85],
        ],
      }),
      flyTo: vi.fn((opts?: { zoom?: number }) => {
        if (typeof opts?.zoom === 'number') currentZoom = opts.zoom
      }),
    }
  }

  function seedWithMap(map: { flyTo: ReturnType<typeof vi.fn> }) {
    useMapStore.setState({
      nodes: { a: node('a', 'nightlife'), b: node('b', 'nightlife', -26.1, 28.05) },
      pulseScores: {},
      checkInCounts: {},
      archetypeIds: {},
      focusNodeId: null,
      mapInstance: map as never,
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

  it('pans without zoom at country overview (Constellation peek)', () => {
    const map = coldOpenMap(5)
    seedWithMap(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))
    map.flyTo.mockClear()

    act(() => result.current.onMarkerTap('a'))

    expect(map.flyTo).toHaveBeenCalled()
    expect(map.flyTo.mock.calls.every((c) => c[0]?.zoom === undefined)).toBe(true)
    expect(useSelectionStore.getState().mode).toBe('constellation')
  })

  it('commitZoom flies to MAP_ARRIVAL_ZOOM from Constellation peek', () => {
    const map = coldOpenMap(5)
    seedWithMap(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))
    map.flyTo.mockClear()

    act(() => result.current.onMarkerTap('a'))
    map.flyTo.mockClear()
    act(() => result.current.commitZoom())

    expect(map.flyTo.mock.calls.some((c) => c[0]?.zoom === MAP_ARRIVAL_ZOOM)).toBe(true)
    expect(useSelectionStore.getState().mode).toBe('browse')
  })

  it('does NOT force a zoom on the first move when the map is already zoomed in (warm open)', () => {
    const map = coldOpenMap(14)
    seedWithMap(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))
    map.flyTo.mockClear()

    act(() => result.current.selectVenue('a', 'marker'))

    // No camera move forces a zoom when the user is already zoomed in.
    expect(map.flyTo).toHaveBeenCalled()
    expect(map.flyTo.mock.calls.every((c) => c[0]?.zoom === undefined)).toBe(true)
  })

  it('preserves zoom on subsequent browse moves after Constellation commit', () => {
    const map = coldOpenMap(5)
    seedWithMap(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))
    map.flyTo.mockClear()

    act(() => result.current.onMarkerTap('a'))
    act(() => result.current.commitZoom())
    const callsAfterArrival = map.flyTo.mock.calls.length
    act(() => result.current.selectVenue('b', 'marker'))

    const browseCalls = map.flyTo.mock.calls.slice(callsAfterArrival)
    expect(browseCalls.length).toBeGreaterThan(0)
    expect(browseCalls.every((c) => c[0]?.zoom === undefined)).toBe(true)
  })
})

describe('Feature: vibe-ranked-browse, hybrid browse scope (recommended vs area)', () => {
  // A map whose bounds tightly enclose only venue "a"; "b" and "c" sit far
  // outside, so area scope drops them while recommended scope keeps them.
  function mutableTightMap(initialLat = -26.2, initialLng = 28.04, zoom = 13) {
    let centerLat = initialLat
    let centerLng = initialLng
    const delta = 0.05
    return {
      setCenter(lat: number, lng: number) {
        centerLat = lat
        centerLng = lng
      },
      getZoom: () => zoom,
      getBounds: () => ({
        toArray: () => [
          [centerLng - delta, centerLat - delta],
          [centerLng + delta, centerLat + delta],
        ],
      }),
      flyTo: vi.fn(),
      once: vi.fn(),
    }
  }

  function seedTight(map: ReturnType<typeof mutableTightMap>) {
    useMapStore.setState({
      nodes: {
        a: node('a', 'nightlife', -26.2, 28.04),
        b: node('b', 'nightlife', -25.0, 29.0),
        c: node('c', 'nightlife', -27.0, 27.0),
      },
      pulseScores: {},
      checkInCounts: {},
      archetypeIds: {},
      focusNodeId: null,
      mapInstance: map as never,
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

  it('defaults to citywide recommended scope, independent of the viewport', () => {
    seedTight(mutableTightMap())
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))

    act(() => result.current.selectVenue('a', 'marker'))

    expect(result.current.browseScope).toBe('recommended')
    // All three venues appear even though only "a" is within the map bounds.
    expect([...result.current.carouselOrder].sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not flip to area scope on a micro pan while recommended', () => {
    const map = mutableTightMap()
    seedTight(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))
    act(() => result.current.selectVenue('a', 'marker'))

    // Establish baseline, then nudge the centre by ~100 m (well under the 400 m
    // threshold) - scope must stay citywide.
    act(() => result.current.notifyViewportChanged())
    act(() => {
      map.setCenter(-26.2009, 28.04)
      result.current.notifyViewportChanged()
    })

    expect(result.current.browseScope).toBe('recommended')
    expect([...result.current.carouselOrder].sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not flip to area scope while below MIN_MARKER_ZOOM', () => {
    const map = mutableTightMap()
    seedTight(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))

    act(() => {
      useMapStore.setState({
        mapInstance: {
          ...map,
          getZoom: () => 5,
        } as never,
      })
    })

    act(() => result.current.notifyViewportChanged())
    act(() => {
      map.setCenter(-26.21, 28.04)
      result.current.notifyViewportChanged()
    })

    expect(result.current.browseScope).toBe('recommended')
  })

  it('switches to area scope on a meaningful pan, then restores recommended', () => {
    const map = mutableTightMap()
    seedTight(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))
    act(() => result.current.selectVenue('a', 'marker'))

    // Baseline snapshot, then a ~1.1 km pan - meaningful enough to enter area scope.
    act(() => result.current.notifyViewportChanged())
    act(() => {
      map.setCenter(-26.21, 28.04)
      result.current.notifyViewportChanged()
    })
    act(() => result.current.recomputeOrder())
    expect(result.current.browseScope).toBe('area')
    expect(result.current.carouselOrder).toEqual(['a'])

    // "Back to recommended" restores the citywide list.
    act(() => result.current.showRecommended())
    expect(result.current.browseScope).toBe('recommended')
    expect([...result.current.carouselOrder].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('Feature: spotlight-mode, carousel scoping', () => {
  // A map whose bounds tightly enclose only venue "a"; "b" and "c" sit far
  // outside, so an area-scope recompute would drop them - which lets the
  // exit re-baseline test prove a meaningful pan is NOT retroactively counted.
  function mutableTightMap(initialLat = -26.2, initialLng = 28.04, zoom = 13) {
    let centerLat = initialLat
    let centerLng = initialLng
    const delta = 0.05
    return {
      setCenter(lat: number, lng: number) {
        centerLat = lat
        centerLng = lng
      },
      getZoom: () => zoom,
      getBounds: () => ({
        toArray: () => [
          [centerLng - delta, centerLat - delta],
          [centerLng + delta, centerLat + delta],
        ],
      }),
      flyTo: vi.fn(),
      once: vi.fn(),
    }
  }

  function seedTight(map: ReturnType<typeof mutableTightMap>) {
    useMapStore.setState({
      nodes: {
        a: node('a', 'nightlife', -26.2, 28.04),
        b: node('b', 'nightlife', -25.0, 29.0),
        c: node('c', 'nightlife', -27.0, 27.0),
      },
      pulseScores: {},
      checkInCounts: {},
      archetypeIds: {},
      focusNodeId: null,
      mapInstance: map as never,
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

  it('order collapses to [spotlightVenueId] while set and restores on exit (R5.1)', () => {
    // Globe-spanning bounds keep all three venues in-viewport (recommended scope).
    seed([node('a', 'nightlife'), node('b', 'nightlife'), node('c', 'nightlife')])
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))

    act(() => result.current.onMarkerTap('a'))
    expect(result.current.carouselOrder).toEqual(['a', 'b', 'c'])
    expect(result.current.browseScope).toBe('recommended')

    // Enter spotlight on a different venue; computeOrder short-circuits to [id].
    act(() => result.current.enterSpotlight('b'))
    act(() => result.current.recomputeOrder())
    expect(result.current.spotlightVenueId).toBe('b')
    expect(result.current.activeVenueId).toBe('b')
    expect(result.current.carouselOrder).toEqual(['b'])

    // Exit restores the full citywide set around the still-selected venue.
    act(() => result.current.exitSpotlight())
    expect(result.current.spotlightVenueId).toBeNull()
    expect(result.current.activeVenueId).toBe('b')
    expect([...result.current.carouselOrder].sort()).toEqual(['a', 'b', 'c'])
  })

  it('notifyViewportChanged is a no-op while spotlit (R5.2)', () => {
    // Tight bounds: a meaningful pan would normally flip recommended -> area and
    // collapse the order to the in-viewport venue. While spotlit it must not.
    const map = mutableTightMap()
    seedTight(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))

    act(() => result.current.enterSpotlight('b'))
    act(() => result.current.recomputeOrder())
    expect(result.current.browseScope).toBe('recommended')
    expect(result.current.carouselOrder).toEqual(['b'])

    // A ~1.1 km pan (well past the 400 m threshold) plus a viewport-change
    // notification - the spotlight early-return means no scope flip, no recompute.
    act(() => {
      map.setCenter(-26.21, 28.04)
      result.current.notifyViewportChanged()
    })

    expect(result.current.browseScope).toBe('recommended')
    expect(result.current.carouselOrder).toEqual(['b'])
  })

  it('exit re-baselines the viewport so the next moveend does not flip scope (R5.4)', () => {
    const map = mutableTightMap()
    seedTight(map)
    const { result } = renderHook(() => useCarouselSelection({ ...baseParams, recomputeDebounceMs: 100_000 }))

    act(() => result.current.selectVenue('a', 'marker'))
    act(() => result.current.enterSpotlight('a'))
    act(() => result.current.recomputeOrder())
    expect(result.current.carouselOrder).toEqual(['a'])

    // Pan far WHILE spotlit. notifyViewportChanged no-ops, so nothing happens yet
    // and the pre-spotlight baseline is never measured against this move.
    act(() => {
      map.setCenter(-25.0, 29.0)
      result.current.notifyViewportChanged()
    })
    expect(result.current.browseScope).toBe('recommended')

    // Exit re-baselines the snapshot to the panned camera (D12) and recomputes.
    act(() => result.current.exitSpotlight())
    expect(result.current.spotlightVenueId).toBeNull()
    expect(result.current.browseScope).toBe('recommended')

    // First moveend after the re-baseline: measured from the panned-to position,
    // not the pre-spotlight one, so the isolation lifting does not flip to area.
    act(() => result.current.notifyViewportChanged())
    expect(result.current.browseScope).toBe('recommended')
    expect([...result.current.carouselOrder].sort()).toEqual(['a', 'b', 'c'])
  })
})
