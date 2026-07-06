/**
 * Pure rapid-tap (tap-burst) detector for Hidden_Delights.
 *
 * This module is intentionally **pure** - it imports no React, no DOM, and no
 * timers of its own - so it is the single source of truth shared by every
 * word-of-mouth delight that fires on a burst of quick taps:
 *   - Trophy_Tap (HD-2): 3 fast taps on the profile rank card, and
 *   - the diagnostics card (HD-3): 7 fast taps on the Settings version row.
 *
 * It lives in `@area-code/shared/lib` (like the toast admission and schedule
 * cores) so web and React Native both reuse one implementation. Time is
 * injectable, so the logic is deterministic and fast-check testable.
 *
 * Deliberately distinct from the press-and-hold long-press primitive planned
 * in `spotlight-mode`: press-and-hold and tap-burst are different gestures
 * with different state machines. Two homes because they are two concepts, not
 * a fork of one.
 *
 * Feature: rank-prestige
 */

/**
 * Number of consecutive fast taps that triggers Trophy_Tap (Requirement 4.2).
 */
export const TROPHY_TAP_COUNT = 3

/**
 * Maximum milliseconds allowed between consecutive Trophy_Tap taps
 * (Requirement 4.2). A slower tap restarts the count.
 */
export const TROPHY_TAP_GAP_MS = 500

/** Minimum meaningful threshold: a "burst" needs at least two taps. */
const MIN_TAPS = 2

export interface RapidTapOptions {
  /** Consecutive-tap threshold that fires the detector. Must be >= 2. */
  taps: number
  /** Maximum milliseconds between consecutive taps. Must be >= 0. */
  gapMs: number
  /** Injectable clock (ms). Defaults to {@link Date.now}. */
  now?: () => number
}

export interface RapidTapDetector {
  /**
   * Registers a tap. Returns `true` (and fully resets) when `taps` consecutive
   * taps have each landed within `gapMs` of the previous one; otherwise returns
   * `false`. A tap slower than `gapMs` restarts the count at one.
   */
  tap(): boolean
}

/**
 * Creates a pure rapid-tap detector (design D5).
 *
 * State is `count` and `lastTapAt`. On each {@link RapidTapDetector.tap}: if the
 * new timestamp is within `gapMs` of the previous tap the count increments,
 * otherwise it restarts at one. When the count reaches `taps` the detector
 * resets to its initial state and returns `true`, so a fresh burst is required
 * to fire again (Requirement 4.1, post-fire reset).
 *
 * There is no window timer, so nothing to clean up and nothing to leak;
 * staleness falls out of the timestamp comparison at the next tap. Equal
 * timestamps are tolerated (monotonic time is assumed non-strictly), so two
 * taps sharing a clock reading still count as consecutive.
 *
 * @throws if `taps` is not an integer >= 2, or `gapMs` is not a finite number
 *   >= 0. A misconfigured detector is a bug, not a runtime guess.
 */
export function createRapidTapDetector(opts: RapidTapOptions): RapidTapDetector {
  const { taps, gapMs } = opts
  if (!Number.isInteger(taps) || taps < MIN_TAPS) {
    throw new Error(`createRapidTapDetector: taps must be an integer >= ${MIN_TAPS}, got ${taps}`)
  }
  if (!Number.isFinite(gapMs) || gapMs < 0) {
    throw new Error(`createRapidTapDetector: gapMs must be a finite number >= 0, got ${gapMs}`)
  }
  const now = opts.now ?? Date.now

  let count = 0
  let lastTapAt: number | undefined

  return {
    tap(): boolean {
      const t = now()
      if (lastTapAt !== undefined && t - lastTapAt <= gapMs) {
        count += 1
      } else {
        count = 1
      }
      lastTapAt = t
      if (count === taps) {
        count = 0
        lastTapAt = undefined
        return true
      }
      return false
    },
  }
}
