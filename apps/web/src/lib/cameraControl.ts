/**
 * Camera coordination for the Map Discovery / Peek-Carousel experience.
 *
 * This module centralises every camera move that the carousel triggers so the
 * `flyTo` + Sheet_Focus_Offset + Reduced_Motion rules live in exactly one place
 * (design § "Camera coordination"). It is deliberately thin and side-effect-only
 * at the edges: the offset math and the reduced-motion decision are pure, and
 * the single `flyTo` call is the only interaction with the map.
 *
 * Recenter freshness gating (`canRecenter`, `recenterIfFresh`) is appended by a
 * sibling task (8.3); keep additions below `moveCameraToActive`.
 *
 * Feature: map-discovery-experience
 */

import type { MapInstance, Node } from '@area-code/shared/types'

import { POSITION_FRESHNESS_WINDOW, SHEET_FOCUS_OFFSET_RATIO } from './carouselConstants'

/**
 * Vertical screen offset (in pixels) applied to `flyTo` so the Active_Venue
 * lands in the visible strip above the open Peek_Carousel rather than hidden
 * behind it. Mirrors the legacy `sheetFocusOffset()` in `MapScreen`, but sourced
 * from the shared {@link SHEET_FOCUS_OFFSET_RATIO} so the carousel, camera, and
 * marker layers all agree on the same fraction of viewport height.
 *
 * Computed per-call so it adapts to the current device viewport. Falls back to
 * an 800px viewport when `window` is unavailable (SSR / test environments).
 */
export function sheetFocusOffset(): [number, number] {
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  return [0, -Math.round(h * SHEET_FOCUS_OFFSET_RATIO)]
}

/** Options governing how the camera moves to the Active_Venue. */
export interface MoveCameraOptions {
  /**
   * When true the consumer has `prefers-reduced-motion: reduce` set, so the
   * camera moves with zero duration (a non-animated jump) rather than an
   * animated fly-to (Requirements 1.5, 8.5).
   */
  reducedMotion: boolean
  /**
   * Optional target zoom. When omitted the map keeps its current zoom and only
   * recentres - the carousel browse flow biases toward preserving the user's
   * chosen zoom while stepping between venues.
   */
  zoom?: number
}

/**
 * Move the Map_Canvas camera to the Active_Venue, applying the
 * Sheet_Focus_Offset so the venue is not occluded by the open Peek_Carousel.
 *
 * Issues **exactly one** `flyTo` per call (Requirement 1.4 / Property 7): the
 * move is animated when Reduced_Motion is unset, and zero-duration (effectively
 * a jump, no animated transition) when Reduced_Motion is set (Requirements 1.5,
 * 8.5). The underlying `MapInstance.flyTo` already fails open if the map has
 * been torn down, so callers need no extra guarding.
 *
 * Validates: Requirements 1.4, 1.5, 8.5
 */
export function moveCameraToActive(map: MapInstance, node: Node, { reducedMotion, zoom }: MoveCameraOptions): void {
  map.flyTo({
    center: [node.lng, node.lat],
    offset: sheetFocusOffset(),
    // Reduced_Motion → zero-duration jump; otherwise let the map use its
    // default animated fly-to easing.
    ...(reducedMotion ? { duration: 0 } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
  })
}

// ─── Recenter freshness gating (task 8.3) ────────────────────────────────────
//
// The Recenter_Control may only fly the Map_Canvas to the Last_Known_Position
// when that fix is still fresh, mirroring the 60s gate already enforced inside
// `useMapInit`'s `recenterUser`. The decision is split into a pure, total
// predicate (`canRecenter`) and a thin side-effecting wrapper (`recenterIfFresh`)
// so the gate itself can be property-tested without a map or a clock.

/**
 * Zoom the recenter fly-to targets - roughly a 20 km radius around the user.
 * Kept in sync with `USER_VIEW_ZOOM` in `useMapInit` so the carousel-driven
 * recenter and the map-control recenter land at the same zoom (Requirement 11.1).
 */
export const USER_VIEW_ZOOM = 10

/**
 * Pure, total freshness predicate for the Recenter_Control.
 *
 * Returns `true` iff a position was captured (`capturedAt` is a finite number)
 * and its age relative to `now` does not exceed `freshnessWindow`
 * (Requirements 11.1, 11.2). A missing capture time (`null`/`undefined`) or a
 * non-finite input yields `false`. A capture timestamp in the future (negative
 * age) is treated as fresh, since it cannot be stale.
 *
 * Never throws - callers can pass raw store values directly.
 *
 * Validates: Requirements 11.1, 11.2
 */
export function canRecenter(
  capturedAt: number | null | undefined,
  now: number,
  freshnessWindow: number = POSITION_FRESHNESS_WINDOW,
): boolean {
  if (capturedAt == null || !Number.isFinite(capturedAt) || !Number.isFinite(now)) return false
  return now - capturedAt <= freshnessWindow
}

/** Inputs governing a freshness-gated recenter. */
export interface RecenterIfFreshInput {
  /** The live map instance, or null when the map has not initialised. */
  map: MapInstance | null
  /**
   * Whether the Map_Canvas reports loaded. When false the activation is ignored
   * without raising (error-handling row 11.3); the underlying `flyTo` also fails
   * open, so this is a defensive guard rather than the only one.
   */
  mapLoaded: boolean
  /** The Last_Known_Position, or null when no position has been captured. */
  position: { lat: number; lng: number } | null | undefined
  /** Capture time of {@link position} (ms epoch), or null when absent. */
  capturedAt: number | null | undefined
  /** Current time (ms epoch). Defaults to `Date.now()`. */
  now?: number
  /** Freshness window in ms. Defaults to {@link POSITION_FRESHNESS_WINDOW}. */
  freshnessWindow?: number
  /** Target zoom for the recenter fly-to. Defaults to {@link USER_VIEW_ZOOM}. */
  zoom?: number
}

/**
 * Fly the Map_Canvas to the Last_Known_Position at user-view zoom, but only
 * when a position exists, that position is fresh within the
 * Position_Freshness_Window, and the map reports loaded. In every other case
 * this is a no-op (Requirements 11.1, 11.2, 11.3 / Property 16).
 *
 * Returns `true` when a fly-to was issued and `false` when the gate suppressed
 * it, so callers (and tests) can assert the gating decision directly.
 *
 * Validates: Requirements 11.1, 11.2, 11.3
 */
export function recenterIfFresh({
  map,
  mapLoaded,
  position,
  capturedAt,
  now = Date.now(),
  freshnessWindow = POSITION_FRESHNESS_WINDOW,
  zoom = USER_VIEW_ZOOM,
}: RecenterIfFreshInput): boolean {
  if (!map || !mapLoaded) return false
  if (!position) return false
  if (!canRecenter(capturedAt, now, freshnessWindow)) return false

  map.flyTo({ center: [position.lng, position.lat], zoom, duration: 1000 })
  return true
}
