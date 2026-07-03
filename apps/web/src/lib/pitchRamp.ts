/**
 * Pure pitch-ramp helpers extracted from useMapInit for testability.
 *
 * The zoom-driven pitch ramp tilts the camera from the overview pitch (62°) up
 * toward street level (80°) as the consumer zooms into a venue. These helpers
 * compute the target pitch as a pure function of zoom and manual offset.
 */

/** Overview pitch at low/mid zoom (seeing nodes & buildings from the side). */
export const PITCH_3D = 62
/** Flat pitch (2D mode). */
export const PITCH_FLAT = 0
/** Near-ground pitch reached at street zoom. Kept under mapbox's 85° cap. */
export const PITCH_STREET = 80
/** Mapbox hard cap on pitch. */
export const MAX_PITCH = 85
/** Below this zoom the camera holds the overview pitch. */
export const PITCH_RAMP_START_ZOOM = 13.5
/** At/above this zoom the camera holds PITCH_STREET. */
export const PITCH_RAMP_END_ZOOM = 17.5

/**
 * Target camera pitch for a given zoom: a linear ramp from PITCH_3D up to
 * PITCH_STREET across [PITCH_RAMP_START_ZOOM, PITCH_RAMP_END_ZOOM]. Pure and
 * total so it can be reasoned about and tested without a live map.
 */
export function pitchForZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= PITCH_RAMP_START_ZOOM) return PITCH_3D
  if (zoom >= PITCH_RAMP_END_ZOOM) return PITCH_STREET
  const t = (zoom - PITCH_RAMP_START_ZOOM) / (PITCH_RAMP_END_ZOOM - PITCH_RAMP_START_ZOOM)
  return PITCH_3D + t * (PITCH_STREET - PITCH_3D)
}

/**
 * Compute the ramp target pitch given a zoom and a sticky manual offset.
 * Result is always clamped to [PITCH_FLAT, MAX_PITCH].
 */
export function computeRampTarget(zoom: number, manualOffset: number): number {
  return Math.max(PITCH_FLAT, Math.min(MAX_PITCH, pitchForZoom(zoom) + manualOffset))
}
