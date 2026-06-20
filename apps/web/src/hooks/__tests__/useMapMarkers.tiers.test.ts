// @vitest-environment jsdom
import * as fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

// Stub mapbox-gl so importing the hook module does not require WebGL/browser
// globals. The Marker class is only constructed inside the hook, never at import.
vi.mock('mapbox-gl', () => ({ default: { Marker: class {} } }))

import { GLYPH_ZOOM_THRESHOLD, MIN_MARKER_ZOOM } from '../../lib/carouselConstants'
import { isActiveMarker, presentationTierForZoom, scaleForZoom } from '../useMapMarkers'

/**
 * Map Discovery — Marker_Layer presentation property tests (deferred tasks
 * 13.2-13.4). Targets the real exported pure helpers.
 *
 *   - Property 17: Marker presentation tier is a function of zoom
 *   - Property 18: Markers stay geo-anchored across transitions (continuous scale)
 *   - Property 19: Active_Venue marker is visually distinguished
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.6, 18.1
 */

const zoomArb = fc.double({ min: 0, max: 24, noNaN: true })

describe('Feature: map-discovery-experience, Property 17: Marker presentation tier is a function of zoom', () => {
  it('selects glyph / dot / hidden by the documented zoom thresholds', () => {
    fc.assert(
      fc.property(zoomArb, (zoom) => {
        const tier = presentationTierForZoom(zoom)
        if (zoom >= GLYPH_ZOOM_THRESHOLD) expect(tier).toBe('glyph')
        else if (zoom < MIN_MARKER_ZOOM) expect(tier).toBe('hidden')
        else expect(tier).toBe('dot')
      }),
    )
  })

  it('is pure — the same zoom always yields the same tier', () => {
    fc.assert(
      fc.property(zoomArb, (z) => {
        expect(presentationTierForZoom(z)).toBe(presentationTierForZoom(z))
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 18: Markers stay geo-anchored across transitions', () => {
  it('keeps scale within [0,1] and monotonic non-decreasing in zoom (no detaching jump)', () => {
    fc.assert(
      fc.property(zoomArb, zoomArb, (z1, z2) => {
        const lo = Math.min(z1, z2)
        const hi = Math.max(z1, z2)
        const sLo = scaleForZoom(lo)
        const sHi = scaleForZoom(hi)
        for (const s of [sLo, sHi]) {
          expect(s).toBeGreaterThanOrEqual(0)
          expect(s).toBeLessThanOrEqual(1)
        }
        expect(sLo).toBeLessThanOrEqual(sHi)
      }),
    )
  })

  it('is 1 in the glyph tier, 0 in the hidden tier, and partial across the dot tier', () => {
    fc.assert(
      fc.property(zoomArb, (zoom) => {
        const tier = presentationTierForZoom(zoom)
        const scale = scaleForZoom(zoom)
        if (tier === 'glyph') expect(scale).toBe(1)
        if (tier === 'hidden') expect(scale).toBe(0)
        if (tier === 'dot') {
          expect(scale).toBeGreaterThanOrEqual(0)
          expect(scale).toBeLessThan(1)
        }
      }),
    )
  })

  it('is continuous at both tier thresholds', () => {
    expect(scaleForZoom(MIN_MARKER_ZOOM)).toBe(0)
    expect(scaleForZoom(GLYPH_ZOOM_THRESHOLD)).toBe(1)
  })
})

describe('Feature: map-discovery-experience, Property 19: Active_Venue marker is visually distinguished', () => {
  const idArb = fc.string({ minLength: 1, maxLength: 6 })

  it('flags exactly the Active_Venue among a marker set, and none when there is no active venue', () => {
    fc.assert(
      fc.property(fc.uniqueArray(idArb, { maxLength: 12 }), fc.option(idArb, { nil: null }), (ids, active) => {
        const flagged = ids.filter((id) => isActiveMarker(id, active))
        if (active === null) expect(flagged).toEqual([])
        else expect(flagged).toEqual(ids.filter((id) => id === active))
        expect(flagged.length).toBeLessThanOrEqual(1)
      }),
    )
  })
})
