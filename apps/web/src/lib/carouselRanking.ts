import type { Node } from '@area-code/shared/types'

/**
 * Pure proximity-biased ranking and viewport scoping for the Peek-Carousel.
 *
 * This module is the deterministic logic core behind `Carousel_Order`. It is
 * intentionally free of React and Mapbox so it can be exhaustively property
 * tested. All functions are total: they never throw on valid-shaped input.
 *
 * Design: .kiro/specs/map-discovery-experience/design.md
 *   - Components and Interfaces → "Key interfaces"
 *   - "proximityBiasedRank algorithm"
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5
 */

// Ranking weights. These mirror the documented values in design.md
// (Data Models → Constants) and will be re-exported by
// `apps/web/src/lib/carouselConstants.ts` once task 1.1 lands. Defined
// locally here so this pure core stays self-contained and buildable.
const BUZZ_WEIGHT = 1.0
const PROX_WEIGHT = 0.5

/** Mean Earth radius in metres (spherical approximation). */
const EARTH_RADIUS_M = 6_371_000

export interface RankInput {
  venues: Node[]
  pulseScores: Record<string, number>
  checkInCounts: Record<string, number>
  lastKnownPosition: { lat: number; lng: number } | null
  /** True when `capturedAt` is within the Position_Freshness_Window. */
  positionFresh: boolean
}

export interface ViewportBounds {
  west: number
  east: number
  south: number
  north: number
}

/**
 * Great-circle distance between two coordinates in metres using the
 * haversine formula. Total and deterministic for any finite input.
 */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_RADIUS_M * c
}

/**
 * Order venues by a deterministic proximity-biased score, descending.
 *
 *   buzz(v)      = (pulseScores[v.id] ?? 0) + (checkInCounts[v.id] ?? 0)
 *   proximity(v) = positionFresh ? 1 / (1 + km(v)) : 0
 *   score(v)     = buzz(v) * BUZZ_WEIGHT + proximity(v) * PROX_WEIGHT
 *
 * Ties (equal score) are broken by venue id ascending so the ordering is a
 * total, stable order — two consecutive computations on identical inputs
 * yield identical arrays (R5.3, R5.5). When `positionFresh` is false (or no
 * `lastKnownPosition` exists) the proximity term is zero for every venue, so
 * ranking falls back to buzz alone without raising an error (R5.2).
 */
export function proximityBiasedRank(input: RankInput): Node[] {
  const { venues, pulseScores, checkInCounts, lastKnownPosition, positionFresh } = input

  const useProximity = positionFresh && lastKnownPosition !== null

  const scoreOf = (v: Node): number => {
    const buzz = (pulseScores[v.id] ?? 0) + (checkInCounts[v.id] ?? 0)
    const proximity = useProximity
      ? 1 / (1 + haversineMeters(lastKnownPosition as { lat: number; lng: number }, { lat: v.lat, lng: v.lng }) / 1000)
      : 0
    return buzz * BUZZ_WEIGHT + proximity * PROX_WEIGHT
  }

  return [...venues].sort((a, b) => {
    const sa = scoreOf(a)
    const sb = scoreOf(b)
    if (sb !== sa) return sb - sa
    // Total, deterministic tie-break by venue id ascending (R5.5).
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })
}

/**
 * Restrict an already-ranked list to venues within the current Map_Canvas
 * bounds while never dropping the Active_Venue (R6.1, R6.2, R6.5).
 *
 * - With non-null `bounds`: returns the ranked venues that fall within the
 *   viewport, preserving their ranked order. If an Active_Venue is set but
 *   would fall outside the viewport, it is re-inserted at the front so it is
 *   never silently dropped mid-selection.
 * - With `null` bounds (e.g. map not yet ready): the viewport is unknown, so
 *   the function returns the Active_Venue alone (or an empty list when none
 *   is set). It always returns the Active_Venue for null bounds.
 */
export function scopeToViewport(ranked: Node[], bounds: ViewportBounds | null, activeVenueId: string | null): Node[] {
  if (bounds === null) {
    if (activeVenueId === null) return []
    const active = ranked.find((v) => v.id === activeVenueId)
    return active ? [active] : []
  }

  const inViewport = ranked.filter((v) => withinBounds(v, bounds))

  if (activeVenueId === null) return inViewport
  if (inViewport.some((v) => v.id === activeVenueId)) return inViewport

  const active = ranked.find((v) => v.id === activeVenueId)
  return active ? [active, ...inViewport] : inViewport
}

/** True when the coordinate lies inside the bounds, handling antimeridian wrap. */
function withinBounds(v: { lat: number; lng: number }, b: ViewportBounds): boolean {
  const latOk = v.lat >= b.south && v.lat <= b.north
  return latOk && lngWithin(v.lng, b.west, b.east)
}

/**
 * Longitude containment that tolerates a viewport crossing the antimeridian,
 * where Mapbox can report `west > east`.
 */
function lngWithin(lng: number, west: number, east: number): boolean {
  if (west <= east) return lng >= west && lng <= east
  return lng >= west || lng <= east
}
