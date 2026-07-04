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

import { cameraEasing, cameraMotion } from './cameraEasing'
import {
  FLY_THROUGH_MIN_PITCH,
  FLY_THROUGH_PEAK_ZOOM_FLOOR,
  FLY_THROUGH_ZOOM_DIP,
  POSITION_FRESHNESS_WINDOW,
  SHEET_FOCUS_OFFSET_RATIO,
} from './carouselConstants'

/**
 * Estimated height (px) of the top chrome that overlays the map - the search
 * button row plus the Category_Filter bar, anchored near the top safe-area
 * inset. The Active_Venue is framed *below* this band so a selected venue is
 * never pushed up behind the search/filter controls.
 */
const TOP_CHROME_PX = 88

/**
 * Pixel distance from a venue's geo-anchor - the beam tip pinned to the
 * coordinate at the *bottom* of the marker (`anchor: 'bottom'`) - up to the
 * centre of its glyph + selector ring at the beam apex.
 *
 * At browse zoom the beam stays partly lit (`BEAM_BLEND_FLOOR`), so the glyph
 * rides ~beam-height (62-158px) above the coordinate. Framing only the
 * coordinate therefore pushes the glyph and its ring off the top of the band
 * above the carousel - the venue reads as "cut off at the top" while flicking
 * through the strip. Measuring the *rendered* marker makes this adapt to pulse
 * state, business tier, and the live zoom scale without duplicating the marker
 * sizing math (which lives in `useMapMarkers`/`markerBeam`).
 *
 * Returns 0 off-DOM, when the marker is not mounted, or when the glyph sits at
 * the anchor (beam hidden), so the offset degrades cleanly to geo-anchor
 * framing.
 */
function markerApexOffset(nodeId: string): number {
  if (typeof document === 'undefined') return 0
  let marker: Element | null = null
  try {
    const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nodeId) : nodeId.replace(/["\\]/g, '\\$&')
    marker = document.querySelector(`.node-marker[data-node-id="${sel}"]`)
  } catch {
    return 0
  }
  if (!marker) return 0
  const glyph = marker.querySelector('[data-layer="glyph-wrapper"]')
  if (!glyph) return 0
  const m = marker.getBoundingClientRect()
  const g = glyph.getBoundingClientRect()
  const apex = m.bottom - (g.top + g.height / 2)
  return Number.isFinite(apex) && apex > 0 ? apex : 0
}

/**
 * Vertical screen offset (in pixels) applied to `flyTo` so the Active_Venue
 * lands in the visible band above the open Peek_Carousel rather than hidden
 * behind it.
 *
 * The offset is measured from the *actual* open carousel sheet rather than a
 * fixed fraction of the viewport. The sheet's bottom edge aligns with the top
 * of the bottom-nav (its `margin-bottom` is the nav height), which is also the
 * bottom edge of the Map_Canvas container, so the sheet always covers the
 * bottom `sheetHeight` pixels of the map. Centring the venue in the band
 * between {@link TOP_CHROME_PX} and the sheet's top edge gives, relative to the
 * map-container centre:
 *
 *     dy = (TOP_CHROME_PX - sheetHeight) / 2
 *
 * This adapts to a short Browse_Mode strip and a tall Commit_Mode detail body
 * alike, so tapping a Venue_Card always frames its node in view instead of
 * jamming it under the top chrome (short sheet) or behind the sheet (tall one).
 *
 * `markerApexPx` shifts the framed point up from the geo-anchor (the beam tip)
 * to the glyph + selector ring at the beam apex, so the part of the marker the
 * consumer actually reads is centred in the band rather than cut off above it.
 * The beam tail is allowed to descend behind the carousel - the glyph is the
 * hero. Defaults to 0 (frame the geo-anchor) when the apex is unknown.
 *
 * Falls back to the legacy {@link SHEET_FOCUS_OFFSET_RATIO} of the viewport
 * height when the sheet is not mounted or the DOM/window is unavailable
 * (SSR / test environments).
 */
export function sheetFocusOffset(markerApexPx = 0): [number, number] {
  if (typeof document !== 'undefined') {
    const carousel = document.querySelector('[data-peek-carousel]')
    const sheet = carousel?.closest('[role="dialog"]') as HTMLElement | null
    const sheetHeight = sheet ? sheet.getBoundingClientRect().height : 0
    if (sheetHeight > 0) {
      return [0, Math.round((TOP_CHROME_PX - sheetHeight) / 2 + markerApexPx)]
    }
  }
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  return [0, Math.round(-h * SHEET_FOCUS_OFFSET_RATIO + markerApexPx)]
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
 * Peak zoom for a dramatic 3D fly-through, or `undefined` when the move should
 * stay a direct glide.
 *
 * The arc engages only when the camera is tilted into 3D (pitch at or above
 * {@link FLY_THROUGH_MIN_PITCH}) and the caller is preserving the user's zoom
 * (no explicit target `zoom` - the browse "step between venues" case). It pulls
 * the flight path back by {@link FLY_THROUGH_ZOOM_DIP} zoom levels, floored at
 * {@link FLY_THROUGH_PEAK_ZOOM_FLOOR}, so the camera rises off the rooftops,
 * sweeps across the city, and descends onto the next venue. The destination
 * zoom is untouched, honouring the map-carousel "preserve the user's zoom"
 * contract - only the path in between is shaped.
 *
 * Returns `undefined` (no arc) when: the map is flat/2D, pitch or zoom cannot
 * be read (test stubs, torn-down map), or the venue is already so far out that
 * a dip would be imperceptible or would drop below the legibility floor.
 */
function flyThroughPeakZoom(map: MapInstance): number | undefined {
  let pitch: number
  try {
    pitch = map.getPitch?.() ?? 0
  } catch {
    return undefined
  }
  if (!Number.isFinite(pitch) || pitch < FLY_THROUGH_MIN_PITCH) return undefined

  let currentZoom: number
  try {
    currentZoom = map.getZoom()
  } catch {
    return undefined
  }
  if (!Number.isFinite(currentZoom)) return undefined

  const peak = Math.max(currentZoom - FLY_THROUGH_ZOOM_DIP, FLY_THROUGH_PEAK_ZOOM_FLOOR)
  // A dip smaller than half a zoom level does not read as a fly-through; skip it
  // so a near-floor venue glides directly rather than doing a token bob.
  if (currentZoom - peak < 0.5) return undefined
  return peak
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
 * When the map is tilted into 3D and the move preserves the user's zoom
 * (stepping between venues), the flight path arcs up and over the city - a
 * dramatic fly-through rather than a flat pan - via {@link flyThroughPeakZoom}.
 * Reduced_Motion and an explicit target `zoom` (cold-open dive, commit-zoom)
 * both keep the direct move.
 *
 * Validates: Requirements 1.4, 1.5, 8.5
 */
export function moveCameraToActive(map: MapInstance, node: Node, { reducedMotion, zoom }: MoveCameraOptions): void {
  // Shared camera easing (Req 11.2) rides on every move; the duration stays
  // param-driven so the exactly-one-flyTo + Reduced_Motion zero-duration
  // contract is preserved: a jump under Reduced_Motion, otherwise the map's
  // default animated fly-to (no explicit duration). Spread so `easing` reaches
  // the adapter without the MapInstance option literal rejecting it.
  const motion = { easing: cameraEasing, ...(reducedMotion ? { duration: 0 } : {}) }

  // Dramatic 3D fly-through arc, only when animating and preserving the zoom.
  const peakZoom = !reducedMotion && zoom === undefined ? flyThroughPeakZoom(map) : undefined

  map.flyTo({
    center: [node.lng, node.lat],
    offset: sheetFocusOffset(markerApexOffset(node.id)),
    ...motion,
    ...(zoom !== undefined ? { zoom } : {}),
    ...(peakZoom !== undefined ? { minZoom: peakZoom } : {}),
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

  // Shared motion signature (Req 11.2): the recenter fly-to carries the common
  // easing and honours Reduced_Motion (zero duration) like every other camera
  // move, instead of a bare 1000ms glide.
  map.flyTo({ center: [position.lng, position.lat], zoom, ...cameraMotion(1000) })
  return true
}
