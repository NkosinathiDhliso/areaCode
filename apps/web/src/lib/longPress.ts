/**
 * Long-press core: one pure, DOM-event-shaped hold-timer used by both
 * spotlight triggers (marker glyph in `useMapMarkers`, Venue_Card in
 * `PeekCarousel`). No React, no store, no Mapbox, so it is property-testable
 * without a DOM (design § "Long-press core").
 *
 * Semantics: the timer starts on pointer-down; any of move past the tolerance,
 * pointer-up, pointer-cancel, or pointer-leave before `durationMs` cancels the
 * hold with no action; on fire the callback runs once and `didFire()` returns
 * true for exactly the next click query (used to suppress the synthetic click
 * that follows a touch hold, the proven `BottomNav` pattern). `BottomNav` keeps
 * its own React-local timer and is deliberately not migrated (design D10).
 *
 * Feature: spotlight-mode
 */

import { DRAG_AXIS_THRESHOLD } from './carouselConstants'

/** Hold duration (ms) before a press fires. Matches the app-wide long-press. */
export const LONG_PRESS_MS = 500

export interface LongPressOptions {
  /** Continuous contact required before firing. Defaults to {@link LONG_PRESS_MS}. */
  durationMs?: number
  /** Movement past this distance (px) from pointer-down cancels the hold.
   *  Defaults to {@link DRAG_AXIS_THRESHOLD}, the app's own drag standard. */
  moveTolerancePx?: number
  /** Runs once when the hold fires, with the originating pointer-down event. */
  onLongPress: (e: PointerEvent) => void
}

export interface LongPressHandlers {
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onPointerCancel: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  /** Prevent the browser context menu a touch hold would otherwise open. */
  onContextMenu: (e: Event) => void
  /** True exactly once after a fired hold, for the click that follows it. */
  didFire: () => boolean
}

export function createLongPressHandlers(opts: LongPressOptions): LongPressHandlers {
  const durationMs = opts.durationMs ?? LONG_PRESS_MS
  const moveTolerancePx = opts.moveTolerancePx ?? DRAG_AXIS_THRESHOLD

  // Ambient setTimeout/clearTimeout: vitest fake timers patch the globals, so
  // no injection params are needed (DRY, no speculative flexibility).
  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  // Set when the timer elapses; read-and-reset by didFire() to gate one click.
  let fired = false

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function onPointerDown(e: PointerEvent): void {
    clearTimer()
    fired = false
    startX = e.clientX
    startY = e.clientY
    timer = setTimeout(() => {
      timer = null
      fired = true
      opts.onLongPress(e)
    }, durationMs)
  }

  function onPointerMove(e: PointerEvent): void {
    if (timer === null) return
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY)
    if (dist > moveTolerancePx) clearTimer()
  }

  function onContextMenu(e: Event): void {
    e.preventDefault()
  }

  function didFire(): boolean {
    if (!fired) return false
    fired = false
    return true
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clearTimer,
    onPointerCancel: clearTimer,
    onPointerLeave: clearTimer,
    onContextMenu,
    didFire,
  }
}
