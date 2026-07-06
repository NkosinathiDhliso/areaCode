/**
 * Trophy_Tap animation config (pure data, unit-testable).
 *
 * The per-tier choreography table from design D7. `RankTrophyOverlay` consumes
 * these descriptors to build its SVG + CSS keyframe layers; keeping the numbers
 * here (not in the component) keeps the component under the size limit and lets
 * the config be tested in isolation.
 *
 * All effects animate `transform`/`opacity` only (compositor-only). Colours are
 * applied by the component via the existing `--tier-*` CSS variables.
 *
 * Requirements: 5.3 (spectacle escalates with rank), 5.4 (per-rank duration
 * plus a hard cap that guarantees the overlay can never persist).
 */

import type { Tier } from '@area-code/shared/types'

/**
 * Hard cap on how long the overlay may ever stay mounted, independent of the
 * per-tier `durationMs` or a missed animation-end event. A second guard behind
 * the per-rank auto-dismiss timer (Requirement 5.4).
 */
export const TROPHY_MAX_DURATION_MS = 6000

/**
 * The reduced-motion variant runs a flat fade (in, hold, out) for every rank,
 * regardless of tier (design D7). No particles, rays, or shimmer.
 */
export const TROPHY_REDUCED_MOTION_DURATION_MS = 2000

/**
 * Compositor budget: the overlay animates at most this many nodes within any
 * one choreography phase, all `transform`/`opacity` (design D7). Effects are
 * staggered into phases so no single phase exceeds this.
 */
export const TROPHY_MAX_ANIMATED_NODES = 24

/**
 * One rank's full-motion choreography. Every rank does the badge pop (scale 0.6
 * to 1, spring); the fields below describe the escalation layered on top. A
 * count of 0 or a `false` flag means the effect is absent for that rank.
 */
export interface TrophyDescriptor {
  /** Tier id this descriptor choreographs. */
  tier: Tier
  /**
   * Full-motion play length in ms. Always within [2000, TROPHY_MAX_DURATION_MS)
   * and monotonically escalating with rank (design D7).
   */
  durationMs: number
  /** Concentric ring ripples emitted from the badge (Local 1, Icon 2). */
  rippleRings: number
  /** Radial spark particles in the initial burst. */
  sparkBurst: number
  /** Sparks that orbit the badge after the burst. */
  orbitingSparks: number
  /** Sweeping light rays fanned behind the badge. */
  rays: number
  /** Rising particles in the fountain effect. */
  fountainParticles: number
  /** Particles in the starfield burst (Legend spectacle). */
  starfieldParticles: number
  /** Tier-colour glow pulse behind the badge. */
  glowPulse: boolean
  /** Shimmer sweep across the badge, reusing the existing shimmer language. */
  shimmerSweep: boolean
}

/**
 * The D7 table, keyed by tier id for O(1) lookup. Each row encodes exactly the
 * effects that design D7 lists for that rank (escalation is not strictly
 * additive: e.g. Icon drops the spark burst in favour of rays + fountain).
 */
const TROPHY_DESCRIPTORS: Readonly<Record<Tier, TrophyDescriptor>> = {
  // Local: badge pop + one ring ripple.
  local: {
    tier: 'local',
    durationMs: 2000,
    rippleRings: 1,
    sparkBurst: 0,
    orbitingSparks: 0,
    rays: 0,
    fountainParticles: 0,
    starfieldParticles: 0,
    glowPulse: false,
    shimmerSweep: false,
  },
  // Insider: pop + 8-spark radial burst.
  regular: {
    tier: 'regular',
    durationMs: 2400,
    rippleRings: 0,
    sparkBurst: 8,
    orbitingSparks: 0,
    rays: 0,
    fountainParticles: 0,
    starfieldParticles: 0,
    glowPulse: false,
    shimmerSweep: false,
  },
  // Patron: pop + burst + 3 orbiting sparks + tier-colour glow pulse.
  fixture: {
    tier: 'fixture',
    durationMs: 2800,
    rippleRings: 0,
    sparkBurst: 8,
    orbitingSparks: 3,
    rays: 0,
    fountainParticles: 0,
    starfieldParticles: 0,
    glowPulse: true,
    shimmerSweep: false,
  },
  // Icon: pop + 12 rays sweep + double ripple + rising particle fountain.
  institution: {
    tier: 'institution',
    durationMs: 3200,
    rippleRings: 2,
    sparkBurst: 0,
    orbitingSparks: 0,
    rays: 12,
    fountainParticles: 8,
    starfieldParticles: 0,
    glowPulse: true,
    shimmerSweep: false,
  },
  // Legend: pop + shimmer sweep + gold rays + 24-particle starfield burst.
  legend: {
    tier: 'legend',
    durationMs: 3600,
    rippleRings: 0,
    sparkBurst: 0,
    orbitingSparks: 0,
    rays: 12,
    fountainParticles: 0,
    starfieldParticles: 24,
    glowPulse: true,
    shimmerSweep: true,
  },
} as const

/**
 * The one bridge from a tier id to its trophy choreography. Every tier has a
 * descriptor, so this is total over `Tier` and never returns undefined.
 */
export function getTrophyDescriptor(tier: Tier): TrophyDescriptor {
  return TROPHY_DESCRIPTORS[tier]
}
