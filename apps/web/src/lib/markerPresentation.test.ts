import type { Node } from '@area-code/shared/types'
import { describe, expect, it } from 'vitest'

import {
  CONSTELLATION_DORMANT_CUTOFF_ZOOM,
  CONSTELLATION_MIN_ZOOM,
  GLYPH_ZOOM_THRESHOLD,
  MIN_MARKER_ZOOM,
  RECOMMENDED_LIMIT,
} from './carouselConstants'
import { constellationVisibleIds, presentationTierForZoom, scaleForZoom } from './markerPresentation'

function node(id: string, lat = -26.2, lng = 28.04): Node {
  return { id, name: id, category: 'nightlife', lat, lng } as Node
}

describe('markerPresentation', () => {
  it('uses beam tier below MIN_MARKER_ZOOM', () => {
    expect(presentationTierForZoom(5)).toBe('beam')
    expect(presentationTierForZoom(MIN_MARKER_ZOOM - 0.01)).toBe('beam')
    expect(presentationTierForZoom(MIN_MARKER_ZOOM)).toBe('dot')
    expect(presentationTierForZoom(GLYPH_ZOOM_THRESHOLD)).toBe('glyph')
  })

  it('ramps beam visibility between CONSTELLATION_MIN_ZOOM and MIN_MARKER_ZOOM', () => {
    expect(scaleForZoom(CONSTELLATION_MIN_ZOOM - 1)).toBe(0)
    expect(scaleForZoom(CONSTELLATION_MIN_ZOOM)).toBeGreaterThan(0)
    expect(scaleForZoom(MIN_MARKER_ZOOM - 0.01)).toBeGreaterThan(scaleForZoom(CONSTELLATION_MIN_ZOOM))
    expect(scaleForZoom(MIN_MARKER_ZOOM)).toBe(0)
  })

  it('caps Constellation beams to RECOMMENDED_LIMIT by rank', () => {
    const ranked = Array.from({ length: 25 }, (_, i) => node(`v${i}`))
    const pulseScores = Object.fromEntries(ranked.map((n) => [n.id, 15]))
    const ids = constellationVisibleIds(ranked, 7, null, pulseScores)
    expect(ids?.size).toBe(RECOMMENDED_LIMIT)
  })

  it('retains the active venue even when past the cap', () => {
    const ranked = Array.from({ length: 25 }, (_, i) => node(`v${i}`))
    const ids = constellationVisibleIds(ranked, 5, 'v24', {})
    expect(ids?.has('v24')).toBe(true)
  })

  it('drops dormant venues below CONSTELLATION_DORMANT_CUTOFF_ZOOM', () => {
    const ranked = [node('alive'), node('dead')]
    const ids = constellationVisibleIds(ranked, CONSTELLATION_DORMANT_CUTOFF_ZOOM - 0.5, null, {
      alive: 20,
      dead: 0,
    })
    expect(ids?.has('alive')).toBe(true)
    expect(ids?.has('dead')).toBe(false)
  })

  it('returns null cap at Embers zoom and above', () => {
    expect(constellationVisibleIds([node('a')], MIN_MARKER_ZOOM, null, {})).toBeNull()
  })
})
