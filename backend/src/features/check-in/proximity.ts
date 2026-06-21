/**
 * Accuracy-aware proximity gating for GPS check-ins.
 *
 * The legacy rule accepts any GPS check-in within a flat 500 m of the venue.
 * That is generous enough to let a user 400 m away farm reward check-ins, and
 * it ignores the device-reported GPS accuracy entirely. This module makes the
 * acceptance radius a function of that accuracy, so a precise fix is held to a
 * tight radius while a poor fix is granted its own uncertainty as slack (a real
 * visitor indoors is not rejected), with a hard cap so a spoofed huge accuracy
 * cannot buy an unbounded radius.
 *
 * Everything here is pure and total (no DB, no env, no throw) so it can be
 * exhaustively property-tested. Env reading and the rollout mode live in the
 * service. Two operational-safety invariants hold by construction:
 *   - Missing / invalid accuracy falls back to `maxRadiusM`, so a client that
 *     does not send accuracy keeps exactly today's behaviour.
 *   - The adaptive radius never exceeds `maxRadiusM`, so the adaptive rule can
 *     only ever tighten the legacy decision, never accept a check-in the legacy
 *     rule would have rejected.
 *
 * Feature: checkin-accuracy-aware-proximity
 */

/** Rollout mode for the proximity decision. */
export type ProximityMode = 'legacy' | 'shadow' | 'adaptive'

export interface ProximityConfig {
  /** Flat radius for legacy mode and the upper bound everywhere (metres). */
  maxRadiusM: number
  /** Radius granted to a perfect-accuracy fix in adaptive mode (metres). */
  baseRadiusM: number
  /** Lower bound on the adaptive effective radius (metres). */
  minRadiusM: number
  /** Cap on how much reported accuracy may widen the radius (metres). */
  accuracySlopCapM: number
}

export const DEFAULT_PROXIMITY_CONFIG: ProximityConfig = {
  maxRadiusM: 500,
  baseRadiusM: 150,
  minRadiusM: 150,
  accuracySlopCapM: 250,
}

const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance in metres between two coordinates (haversine). */
export function haversineMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/**
 * Effective acceptance radius (metres) for a GPS check-in given the
 * device-reported accuracy (the 1-sigma error radius from the Geolocation API).
 *
 * Missing, non-finite, or negative accuracy returns `maxRadiusM` — the
 * operational-safety fallback that keeps clients which do not send accuracy on
 * today's behaviour. Otherwise the radius is
 * `clamp(baseRadiusM + min(accuracy, accuracySlopCapM), minRadiusM, maxRadiusM)`.
 */
export function effectiveRadiusM(
  accuracyM: number | null | undefined,
  config: ProximityConfig = DEFAULT_PROXIMITY_CONFIG,
): number {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM < 0) {
    return config.maxRadiusM
  }
  const slop = Math.min(accuracyM, config.accuracySlopCapM)
  return clamp(config.baseRadiusM + slop, config.minRadiusM, config.maxRadiusM)
}

export interface ProximityDecisionInput {
  /** Distance from the user's reported position to the venue, in metres. */
  distanceM: number
  /** Device-reported accuracy (metres), or null when not supplied. */
  accuracyM: number | null | undefined
  /** Active rollout mode. */
  mode: ProximityMode
  config?: ProximityConfig
}

export interface ProximityDecision {
  /** The outcome the active mode enforces. */
  accepted: boolean
  /** The radius the adaptive rule uses (for logging / shadow comparison). */
  adaptiveRadiusM: number
  /** Whether the adaptive rule would accept. */
  adaptiveAccepted: boolean
  /** Whether the legacy flat-radius rule accepts. */
  legacyAccepted: boolean
}

/**
 * Decide a GPS check-in's proximity outcome under the active mode.
 *
 * - `legacy`   accepts iff `distance <= maxRadiusM` (exactly today's behaviour).
 * - `shadow`   enforces the legacy outcome but still computes the adaptive
 *              decision so the caller can log divergence on live traffic before
 *              enforcing. The user-visible result is identical to `legacy`.
 * - `adaptive` accepts iff `distance <= effectiveRadius(accuracy)`.
 *
 * Pure and total; never throws.
 */
export function decideProximity({
  distanceM,
  accuracyM,
  mode,
  config = DEFAULT_PROXIMITY_CONFIG,
}: ProximityDecisionInput): ProximityDecision {
  const legacyAccepted = distanceM <= config.maxRadiusM
  const adaptiveRadiusM = effectiveRadiusM(accuracyM, config)
  const adaptiveAccepted = distanceM <= adaptiveRadiusM
  const accepted = mode === 'adaptive' ? adaptiveAccepted : legacyAccepted
  return { accepted, adaptiveRadiusM, adaptiveAccepted, legacyAccepted }
}
