import type { MapInstance, Node } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

import { POSITION_FRESHNESS_WINDOW } from './carouselConstants'
import { canRecenter, moveCameraToActive, recenterIfFresh } from './cameraControl'

/**
 * Map Discovery - camera coordination + recenter gating property tests
 * (deferred tasks 8.2, 8.4).
 *
 *   - Property 7:  Camera move on Active_Venue change honours Reduced_Motion
 *   - Property 16: Recenter is gated on position freshness
 *
 * Validates: Requirements 1.4, 1.5, 8.5, 11.1, 11.2, 11.3
 */

type FakeMap = MapInstance & { flyTo: ReturnType<typeof vi.fn> }
const fakeMap = (): FakeMap => ({ flyTo: vi.fn() }) as unknown as FakeMap
const node = (lat: number, lng: number): Node => ({ id: 'n', lat, lng }) as unknown as Node

const latArb = fc.double({ min: -85, max: 85, noNaN: true })
const lngArb = fc.double({ min: -180, max: 180, noNaN: true })

describe('Feature: map-discovery-experience, Property 7: Camera move on Active_Venue change honours Reduced_Motion', () => {
  it('issues exactly one flyTo, centred on the node, with a focus offset', () => {
    fc.assert(
      fc.property(latArb, lngArb, fc.boolean(), (lat, lng, reducedMotion) => {
        const map = fakeMap()
        moveCameraToActive(map, node(lat, lng), { reducedMotion })

        expect(map.flyTo).toHaveBeenCalledTimes(1)
        const arg = map.flyTo.mock.calls[0]![0]
        expect(arg.center).toEqual([lng, lat])
        expect(Array.isArray(arg.offset)).toBe(true)
      }),
    )
  })

  it('uses a zero-duration jump under Reduced_Motion and an animated move otherwise', () => {
    fc.assert(
      fc.property(latArb, lngArb, (lat, lng) => {
        const reduced = fakeMap()
        moveCameraToActive(reduced, node(lat, lng), { reducedMotion: true })
        expect(reduced.flyTo.mock.calls[0]![0].duration).toBe(0)

        const animated = fakeMap()
        moveCameraToActive(animated, node(lat, lng), { reducedMotion: false })
        expect(animated.flyTo.mock.calls[0]![0].duration).toBeUndefined()
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 16: Recenter is gated on position freshness', () => {
  it('canRecenter is true iff a finite capture time is within the window', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: -10_000_000, max: 10_000_000 }), { nil: null }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 600_000 }),
        (capturedAt, now, windowMs) => {
          const expected = capturedAt != null && Number.isFinite(capturedAt) && now - capturedAt <= windowMs
          expect(canRecenter(capturedAt, now, windowMs)).toBe(expected)
        },
      ),
    )
  })

  it('flies to the position exactly when map, mapLoaded, position and freshness all hold', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.option(fc.record({ lat: latArb, lng: lngArb }), { nil: null }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        (hasMap, mapLoaded, position, capturedAt, now) => {
          const map = hasMap ? fakeMap() : null
          const issued = recenterIfFresh({
            map,
            mapLoaded,
            position,
            capturedAt,
            now,
            freshnessWindow: POSITION_FRESHNESS_WINDOW,
          })

          const expected = !!map && mapLoaded && !!position && now - capturedAt <= POSITION_FRESHNESS_WINDOW
          expect(issued).toBe(expected)
          if (map) expect(map.flyTo).toHaveBeenCalledTimes(expected ? 1 : 0)
        },
      ),
    )
  })
})
