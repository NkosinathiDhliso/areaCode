/**
 * Map marker computation utilities.
 * Handles radius, touch target, glow intensity, z-ordering, and animation budget.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 30.1, 30.2, 30.5, 30.6
 */

const BASE_RADIUS = 8
const MAX_RADIUS = 28
const NORMALIZATION_FACTOR = 200
const BOOST_FLOOR_RADIUS = 18
const MIN_TOUCH_TARGET = 44

export interface MarkerComputedStyle {
  /** Visual radius in px (8-28) */
  radius: number
  /** Touch target in px (always >= 44) */
  touchTarget: number
  /** Glow intensity 0-1 */
  glowIntensity: number
  /** Z-index based on pulse score */
  zIndex: number
  /** Whether this marker should animate */
  hasAnimation: boolean
  /** Type of animation to apply */
  animationType: 'none' | 'breathing' | 'pulsing'
  /** Whether to show gold ring (boosted) */
  hasGoldRing: boolean
}

/**
 * Compute the visual radius for a marker based on pulse score and boost state.
 * Formula: 8 + (Math.min(pulseScore / 200, 1) * 20)
 * Boost floor: 18px minimum when boosted.
 */
export function computeMarkerRadius(pulseScore: number, isBoosted: boolean): number {
  const normalized = Math.min(pulseScore / NORMALIZATION_FACTOR, 1)
  let radius = BASE_RADIUS + normalized * (MAX_RADIUS - BASE_RADIUS)
  if (isBoosted) {
    radius = Math.max(radius, BOOST_FLOOR_RADIUS)
  }
  return radius
}

/**
 * Compute the touch target size. Always >= 44px regardless of visual radius.
 */
export function computeTouchTarget(visualRadius: number): number {
  return Math.max(visualRadius * 2, MIN_TOUCH_TARGET)
}

/**
 * Compute glow intensity from pulse score. 0 at score 0, 1.0 at score >= 200.
 */
export function computeGlowIntensity(pulseScore: number): number {
  return Math.min(pulseScore / NORMALIZATION_FACTOR, 1)
}

/**
 * Compute z-index from pulse score. Higher score = higher z-index.
 */
export function computeZIndex(pulseScore: number): number {
  return Math.round(pulseScore)
}

/**
 * Determine animation type based on pulse state and boost.
 * - Boosted: pulsing (gold ring + continuous pulse)
 * - Popping (score >= 61): breathing (1.0 → 1.15 scale, 2s)
 * - Otherwise: none
 */
export function computeAnimationType(
  pulseScore: number,
  isBoosted: boolean,
): 'none' | 'breathing' | 'pulsing' {
  if (isBoosted) return 'pulsing'
  if (pulseScore >= 61) return 'breathing'
  return 'none'
}

/**
 * Compute full marker style from inputs.
 */
export function computeMarkerStyle(
  pulseScore: number,
  isBoosted: boolean,
  isInViewport: boolean,
  animationBudgetExhausted: boolean,
  prefersReducedMotion: boolean,
): MarkerComputedStyle {
  const radius = computeMarkerRadius(pulseScore, isBoosted)
  const touchTarget = computeTouchTarget(radius)
  const glowIntensity = computeGlowIntensity(pulseScore)
  const zIndex = computeZIndex(pulseScore)
  const rawAnimationType = computeAnimationType(pulseScore, isBoosted)

  // Determine if animation should play
  let hasAnimation = rawAnimationType !== 'none'
  let animationType = rawAnimationType

  if (prefersReducedMotion || !isInViewport || animationBudgetExhausted) {
    hasAnimation = false
    animationType = 'none'
  }

  return {
    radius,
    touchTarget,
    glowIntensity,
    zIndex,
    hasAnimation,
    animationType,
    hasGoldRing: isBoosted,
  }
}

export { BASE_RADIUS, MAX_RADIUS, NORMALIZATION_FACTOR, BOOST_FLOOR_RADIUS, MIN_TOUCH_TARGET }
