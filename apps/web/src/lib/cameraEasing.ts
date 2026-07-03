/**
 * Camera motion character - one home for how the map's camera moves feel.
 *
 * Mapbox's default easing is a symmetric ease-in-out (CSS `ease`). For moves a
 * user triggers by tapping a control (recenter, reset-north, zoom buttons) a
 * curve that starts at full speed and decelerates into place reads as more
 * responsive: the camera reacts the instant you tap, then settles. For the
 * zoom-driven pitch ramp and the 3D toggle the same ease-out gives a calm,
 * weighted "settle" rather than a mechanical glide.
 *
 * Keeping the curve in one place means every camera move shares the same
 * motion signature, which is what makes premium apps feel cohesive.
 */

import { reducedMotion } from './reducedMotion'

/**
 * Ease-out cubic: `1 - (1 - t)^3`. Full speed at t=0, gentle arrival at t=1.
 * Pure and total over any real `t`; callers pass the normalised [0,1] progress
 * Mapbox provides.
 */
export function easeOutCubic(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  const inv = 1 - clamped
  return 1 - inv * inv * inv
}

/**
 * Shared easing passed to Mapbox `easeTo` / `flyTo` / `zoomIn` / `zoomOut`.
 * Named export kept as a stable reference so it is cheap to pass repeatedly.
 */
export const cameraEasing = easeOutCubic

/** Animation options shared by every camera move. */
export interface CameraMotion {
  duration: number
  easing: typeof cameraEasing
}

/**
 * Builds the shared camera-move options: `duration` (0 under
 * `prefers-reduced-motion`) and the shared `easing`. One home for the tuple
 * every camera-move call site would otherwise inline.
 */
export function cameraMotion(ms: number): CameraMotion {
  return { duration: reducedMotion() ? 0 : ms, easing: cameraEasing }
}
