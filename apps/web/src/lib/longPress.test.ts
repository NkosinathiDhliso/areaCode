import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DRAG_AXIS_THRESHOLD } from './carouselConstants'
import { createLongPressHandlers, LONG_PRESS_MS } from './longPress'

/**
 * Long-press core property + unit tests (task 9.2, Requirement 11.2).
 *
 * The handlers rely on ambient setTimeout/clearTimeout, so vitest fake timers
 * drive firing deterministically. The handlers only read `.clientX`,
 * `.clientY` (pointer handlers) and `.preventDefault()` (contextmenu), so a
 * minimal event shape cast to the DOM type is enough - no DOM/jsdom needed.
 *
 * Properties:
 *   - Property 1: fires only after the full duration with sub-tolerance movement
 *   - Property 2: any cancel path (move, up, cancel, leave) before the timer
 *                 prevents firing
 *
 * Validates: Requirements 11.2
 */

/** Minimal PointerEvent-shaped object: only the fields the handlers read. */
function evt(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY, preventDefault: () => {} } as unknown as PointerEvent
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Feature: spotlight-mode, Property 1: fires only after the full duration with sub-tolerance movement', () => {
  it('does not fire before the duration, fires exactly once at the duration, and movement within tolerance never cancels', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (durationMs, tolerance, x, y, angle, frac) => {
          const onLongPress = vi.fn()
          const h = createLongPressHandlers({ durationMs, moveTolerancePx: tolerance, onLongPress })

          h.onPointerDown(evt(x, y))

          // Advance to just before the threshold: must not have fired yet.
          vi.advanceTimersByTime(durationMs - 1)
          expect(onLongPress).not.toHaveBeenCalled()

          // A move within tolerance (hypot = frac * tolerance <= tolerance) must not cancel.
          const r = frac * tolerance
          h.onPointerMove(evt(x + Math.cos(angle) * r, y + Math.sin(angle) * r))
          expect(onLongPress).not.toHaveBeenCalled()

          // Cross the threshold: fires exactly once, with the pointer-down event.
          vi.advanceTimersByTime(1)
          expect(onLongPress).toHaveBeenCalledTimes(1)
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('Feature: spotlight-mode, Property 2: any cancel path before the timer prevents firing', () => {
  it('never fires when up/cancel/leave or a move past tolerance happens before the duration elapses', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.constantFrom('up', 'cancel', 'leave', 'move'),
        fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
        fc.double({ min: 1, max: 500, noNaN: true }),
        (durationMs, tolerance, partialRaw, x, y, path, angle, beyond) => {
          const onLongPress = vi.fn()
          const h = createLongPressHandlers({ durationMs, moveTolerancePx: tolerance, onLongPress })

          h.onPointerDown(evt(x, y))

          // Fire the cancel path strictly before the timer would elapse.
          const partial = partialRaw % durationMs
          vi.advanceTimersByTime(partial)

          if (path === 'up') {
            h.onPointerUp(evt(x, y))
          } else if (path === 'cancel') {
            h.onPointerCancel(evt(x, y))
          } else if (path === 'leave') {
            h.onPointerLeave(evt(x, y))
          } else {
            // Move past tolerance: hypot = tolerance + beyond > tolerance.
            const r = tolerance + beyond
            h.onPointerMove(evt(x + Math.cos(angle) * r, y + Math.sin(angle) * r))
          }

          // Advance well past the original duration: the cancelled hold must stay silent.
          vi.advanceTimersByTime(durationMs)
          expect(onLongPress).not.toHaveBeenCalled()
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('createLongPressHandlers: didFire() single-shot gate', () => {
  it('returns false before any fire', () => {
    const h = createLongPressHandlers({ onLongPress: () => {} })
    expect(h.didFire()).toBe(false)
  })

  it('returns true exactly once after a fired hold, then false', () => {
    const onLongPress = vi.fn()
    const h = createLongPressHandlers({ durationMs: 500, onLongPress })

    h.onPointerDown(evt(0, 0))
    vi.advanceTimersByTime(500)

    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(h.didFire()).toBe(true)
    expect(h.didFire()).toBe(false)
  })

  it('returns false after a cancelled hold', () => {
    const onLongPress = vi.fn()
    const h = createLongPressHandlers({ durationMs: 500, onLongPress })

    h.onPointerDown(evt(0, 0))
    vi.advanceTimersByTime(200)
    h.onPointerUp(evt(0, 0))
    vi.advanceTimersByTime(500)

    expect(onLongPress).not.toHaveBeenCalled()
    expect(h.didFire()).toBe(false)
  })

  it('a fresh onPointerDown resets the fired flag before the new hold elapses', () => {
    const onLongPress = vi.fn()
    const h = createLongPressHandlers({ durationMs: 500, onLongPress })

    // First hold fires.
    h.onPointerDown(evt(0, 0))
    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalledTimes(1)

    // A new press before querying didFire clears the pending gate.
    h.onPointerDown(evt(0, 0))
    expect(h.didFire()).toBe(false)
  })
})

describe('createLongPressHandlers: contextmenu suppression', () => {
  it('calls preventDefault on the context menu event', () => {
    const h = createLongPressHandlers({ onLongPress: () => {} })
    const preventDefault = vi.fn()
    h.onContextMenu({ preventDefault } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('createLongPressHandlers: defaults', () => {
  it('defaults durationMs to LONG_PRESS_MS and moveTolerancePx to DRAG_AXIS_THRESHOLD', () => {
    const onLongPress = vi.fn()
    const h = createLongPressHandlers({ onLongPress })

    h.onPointerDown(evt(0, 0))

    // A move within the default tolerance does not cancel.
    h.onPointerMove(evt(DRAG_AXIS_THRESHOLD, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(onLongPress).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })
})
