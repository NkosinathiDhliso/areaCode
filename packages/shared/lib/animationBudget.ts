/**
 * Animation budget system for map markers.
 * Limits simultaneous animations to prevent performance issues on mid-range devices.
 *
 * Requirements: 30.1, 30.2, 30.5, 30.6
 */

const MAX_ANIMATIONS_DEFAULT = 8
const MAX_ANIMATIONS_LOW_END = 4

export interface AnimationBudgetConfig {
  /** navigator.hardwareConcurrency value */
  hardwareConcurrency: number
  /** Whether user prefers reduced motion */
  prefersReducedMotion: boolean
}

export interface MarkerAnimationInput {
  id: string
  pulseScore: number
  isInViewport: boolean
}

/**
 * Get the maximum number of simultaneous animations allowed.
 * - Low-end devices (hardwareConcurrency <= 4): 4
 * - Standard devices: 8
 * - prefers-reduced-motion: 0
 */
export function getMaxAnimations(config: AnimationBudgetConfig): number {
  if (config.prefersReducedMotion) return 0
  if (config.hardwareConcurrency <= 4) return MAX_ANIMATIONS_LOW_END
  return MAX_ANIMATIONS_DEFAULT
}

/**
 * Determine which markers should receive animations based on the budget.
 * Assigns animations to the highest pulse score markers within the viewport.
 * Markers outside viewport never get animations.
 *
 * Returns a Set of marker IDs that should animate.
 */
export function allocateAnimationBudget(
  markers: MarkerAnimationInput[],
  config: AnimationBudgetConfig,
): Set<string> {
  const maxAnimations = getMaxAnimations(config)

  if (maxAnimations === 0) return new Set()

  // Only viewport markers are eligible
  const viewportMarkers = markers.filter((m) => m.isInViewport)

  // Sort by pulse score descending (highest first)
  const sorted = [...viewportMarkers].sort((a, b) => b.pulseScore - a.pulseScore)

  // Take top N by budget
  const animated = sorted.slice(0, maxAnimations)

  return new Set(animated.map((m) => m.id))
}

export { MAX_ANIMATIONS_DEFAULT, MAX_ANIMATIONS_LOW_END }
