/**
 * Pure marker presentation helpers: zoom tiers, visibility scale, and
 * Constellation-mode membership cap. No React or Mapbox imports.
 */

import type { Node } from '@area-code/shared/types'

import {
  CONSTELLATION_DORMANT_CUTOFF_ZOOM,
  CONSTELLATION_MIN_ZOOM,
  GLYPH_ZOOM_THRESHOLD,
  MIN_MARKER_ZOOM,
  RECOMMENDED_LIMIT,
} from './carouselConstants'
import { getNodeState } from './mapHelpers'

export type MarkerPresentationTier = 'beam' | 'dot' | 'glyph'

export const BASE_PRESENTATION_ZOOM = GLYPH_ZOOM_THRESHOLD

const ZOOM_SIZE_SLOPE = 0.12
const ZOOM_SIZE_MIN = 0.7
const ZOOM_SIZE_MAX = 1.6

/** Beam visibility ramp at Constellation zoom (4 → 8). */
const BEAM_SCALE_MIN = 0.35
const BEAM_SCALE_MAX = 0.85

/**
 * Zoom tier for the Marker_Layer (Property 17).
 * Constellation (beam) replaces the former hidden tier below z8.
 */
export function presentationTierForZoom(zoom: number): MarkerPresentationTier {
  if (zoom >= GLYPH_ZOOM_THRESHOLD) return 'glyph'
  if (zoom < MIN_MARKER_ZOOM) return 'beam'
  return 'dot'
}

/**
 * Presence-channel scale: beam ramp (4–8), dot ramp (8–12.5), full at glyph+.
 */
export function scaleForZoom(zoom: number): number {
  if (zoom >= GLYPH_ZOOM_THRESHOLD) return 1
  if (zoom >= MIN_MARKER_ZOOM) {
    return (zoom - MIN_MARKER_ZOOM) / (GLYPH_ZOOM_THRESHOLD - MIN_MARKER_ZOOM)
  }
  if (zoom < CONSTELLATION_MIN_ZOOM) return 0
  const t = (zoom - CONSTELLATION_MIN_ZOOM) / (MIN_MARKER_ZOOM - CONSTELLATION_MIN_ZOOM)
  return BEAM_SCALE_MIN + t * (BEAM_SCALE_MAX - BEAM_SCALE_MIN)
}

export function zoomSizeFactor(zoom: number): number {
  const factor = 1 + (zoom - BASE_PRESENTATION_ZOOM) * ZOOM_SIZE_SLOPE
  return Math.min(ZOOM_SIZE_MAX, Math.max(ZOOM_SIZE_MIN, factor))
}

export function isActiveMarker(nodeId: string, activeVenueId: string | null): boolean {
  return activeVenueId !== null && nodeId === activeVenueId
}

/**
 * At Constellation zoom, which venue ids may render a beam. Returns `null` at
 * Embers/Glyphs zoom (no cap). Always retains {@link activeVenueId}.
 */
export function constellationVisibleIds(
  ranked: Node[],
  zoom: number,
  activeVenueId: string | null,
  pulseScores: Record<string, number>,
): Set<string> | null {
  if (zoom >= MIN_MARKER_ZOOM) return null

  let candidates = ranked.slice(0, RECOMMENDED_LIMIT)
  if (zoom < CONSTELLATION_DORMANT_CUTOFF_ZOOM) {
    candidates = candidates.filter((n) => getNodeState(pulseScores[n.id] ?? 0) !== 'dormant')
  }

  if (activeVenueId && !candidates.some((n) => n.id === activeVenueId)) {
    const active = ranked.find((n) => n.id === activeVenueId)
    if (active) candidates.push(active)
  }

  return new Set(candidates.map((n) => n.id))
}
