/**
 * Tactile + reduced-motion helpers shared across portals.
 *
 * The Vibration API is the only haptic primitive a PWA has. These wrappers
 * no-op safely off-DOM, where the API is missing (iOS Safari/standalone does
 * not implement navigator.vibrate), and when the user prefers reduced motion.
 *
 * Canonical home for the reduced-motion check. Other call sites
 * (useConstellationSweep, useCarouselSelection, markerBeam) still inline their
 * own copy; consolidate them onto this when next touched.
 */

/** Reads `prefers-reduced-motion: reduce`, defaulting to false off-DOM. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Fires a short haptic tick (or pattern) where supported. No-ops when the
 * Vibration API is unavailable or the user prefers reduced motion.
 */
export function haptic(pattern: number | number[] = 8): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (prefersReducedMotion()) return
  navigator.vibrate(pattern)
}
