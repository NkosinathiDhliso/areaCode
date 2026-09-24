// The Boost_Scoreboard: what one Boost_Window recorded, next to the same clock
// window a week earlier.
//
// Feature: proof-of-demand (R7.1, R7.2, R7.3, R7.5)
//
// Data only, no words. The owner-facing lines come from the panel (task 6.4)
// and the split counts come from `computeReceipt`, so this file adds neither
// copy nor a second way to count Found_You. What it owns is exactly two things:
// where the comparison window sits, and whether a comparison may be shown at
// all.
//
// Nothing here describes the boost as having done anything. A boost window that
// recorded nothing reports zeros, which is neither a failure nor a claim (R7.5).
//
// I/O-free like `computeReceipt` and `resolveReceiptWindow`: the caller reads
// the check-ins once, covering the baseline start through the window end, and
// hands them over. That is what makes the offset and the floor rule property
// testable without DynamoDB, and it is why the closed-window cache (R7.2) can
// store a value this function produced without the cache ever changing it.

import { computeReceipt, type ReceiptCheckIn, type ReceiptWindow } from '../reports/receipt.js'
import { SUPPRESSION_FLOOR } from '../reports/suppression.js'

/**
 * How far back the comparison window sits: exactly seven days, to the
 * millisecond (R7.1).
 *
 * Seven days rather than "the window just before" because the question the
 * scoreboard answers is about the same hours of the same weekday. Boosts are
 * bought in 2, 6 and 24 hour lengths, so the window immediately before a 20:00
 * to 22:00 boost is 18:00 to 20:00 the same night, and a Friday 18:00 room is
 * not a like-for-like reading of a Friday 20:00 room. Offsetting by whole days
 * holds both the weekday and the clock hours fixed, so the one thing that
 * differs is the week.
 *
 * SAST is UTC+2 year round with no daylight saving, so shifting the UTC
 * instants by whole days preserves the local clock hours exactly. This constant
 * would need revisiting only for a city in a DST zone.
 */
export const BOOST_SCOREBOARD_BASELINE_OFFSET_MS = 7 * 24 * 60 * 60 * 1000

/**
 * One window's readings. The instants are echoed back so a cached scoreboard
 * (R7.2) records which windows it described and can be rendered later without
 * recomputing them.
 *
 * - `checkIns`: check-ins recorded in the window. Visits, not visitors.
 * - `visitors`: distinct consumers, always `foundYou + walkIns`.
 * - `foundYou`: consumers with at least one Found_You check-in in the window.
 * - `walkIns`: consumers in the window with Walk_In check-ins only.
 */
export interface BoostScoreboardPeriod extends ReceiptWindow {
  checkIns: number
  visitors: number
  foundYou: number
  walkIns: number
}

/** Window minus baseline, per reading. Signed: negative is a real answer. */
export interface BoostScoreboardDelta {
  checkIns: number
  visitors: number
  foundYou: number
  walkIns: number
}

/**
 * The scoreboard for one boost purchase.
 *
 * - `window`: the Boost_Window's readings.
 * - `baseline`: the same clock window seven days earlier.
 * - `comparable`: whether the two windows may be set against each other at all.
 *   False when either window's sample is below the Suppression_Floor (R7.3).
 * - `delta`: window minus baseline, and `null` whenever `comparable` is false,
 *   so a caller cannot render a comparison the sample does not support. The
 *   counts on both periods always render; only the comparison is withheld.
 */
export interface BoostScoreboard {
  window: BoostScoreboardPeriod
  baseline: BoostScoreboardPeriod
  comparable: boolean
  delta: BoostScoreboardDelta | null
}

function instant(iso: string, field: string): number {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) {
    throw new Error(`computeBoostScoreboard: invalid ${field} "${iso}"`)
  }
  return ms
}

/**
 * The comparison window for a Boost_Window: the same length, offset back by
 * exactly seven days.
 *
 * Exported because the caller (R7.2) needs `windowStartUtc` to know how far
 * back to read check-ins. Deriving it here rather than at the call site keeps
 * the offset in one place, so a read range and the arithmetic it feeds can
 * never disagree about which week the baseline is.
 */
export function boostScoreboardBaselineWindow(boostWindow: ReceiptWindow): ReceiptWindow {
  const startMs = instant(boostWindow.windowStartUtc, 'windowStartUtc')
  const endMs = instant(boostWindow.windowEndUtc, 'windowEndUtc')
  return {
    windowStartUtc: new Date(startMs - BOOST_SCOREBOARD_BASELINE_OFFSET_MS).toISOString(),
    windowEndUtc: new Date(endMs - BOOST_SCOREBOARD_BASELINE_OFFSET_MS).toISOString(),
  }
}

/**
 * Readings for one window, over the check-ins that fall inside it.
 *
 * The half-open filter `[start, end)` lives here because `computeReceipt`
 * trusts its caller to have scoped the rows, and both windows are scoped from
 * one read. The split itself is never recomputed: `foundYou` and `walkIns` are
 * the Receipt's, so the scoreboard and the Monday digest cannot drift.
 */
function readPeriod(checkIns: readonly ReceiptCheckIn[], window: ReceiptWindow): BoostScoreboardPeriod {
  const startMs = instant(window.windowStartUtc, 'windowStartUtc')
  const endMs = instant(window.windowEndUtc, 'windowEndUtc')

  const inWindow = checkIns.filter((checkIn) => {
    const at = new Date(checkIn.checkedInAt).getTime()
    return !Number.isNaN(at) && at >= startMs && at < endMs
  })

  const receipt = computeReceipt(inWindow, window)

  return {
    windowStartUtc: window.windowStartUtc,
    windowEndUtc: window.windowEndUtc,
    checkIns: inWindow.length,
    visitors: receipt.uniqueVisitors,
    foundYou: receipt.foundYouVisitors,
    walkIns: receipt.walkInVisitors,
  }
}

/**
 * Compute the scoreboard for one Boost_Window.
 *
 * @param checkIns Check-ins at the boosted node, covering at least the baseline
 *   start through the boost window end. Rows outside both windows are ignored,
 *   so the caller may read a wider range than it needs.
 * @param boostWindow The Boost_Window, half-open `[start, end)`. Its start is
 *   the purchase's `paidAt` and its end is `boostWindowEnd(paidAt, duration)`.
 *
 * @throws when either instant is unreadable, or when the window ends before it
 *   starts. An inverted window is a caller bug, and counting an impossible
 *   window would put a fabricated number in front of an owner who paid.
 */
export function computeBoostScoreboard(
  checkIns: readonly ReceiptCheckIn[],
  boostWindow: ReceiptWindow,
): BoostScoreboard {
  const startMs = instant(boostWindow.windowStartUtc, 'windowStartUtc')
  const endMs = instant(boostWindow.windowEndUtc, 'windowEndUtc')
  if (endMs < startMs) {
    throw new Error(
      `computeBoostScoreboard: window ends before it starts "${boostWindow.windowStartUtc}".."${boostWindow.windowEndUtc}"`,
    )
  }

  const window = readPeriod(checkIns, boostWindow)
  const baseline = readPeriod(checkIns, boostScoreboardBaselineWindow(boostWindow))

  // The Suppression_Floor is a minimum of underlying events, so the sample each
  // window has to clear is its check-in count. Both must clear it: a boost
  // window with 40 check-ins against a baseline of 1 is not a comparison, it is
  // one quiet hour last week amplified into a trend.
  const comparable = window.checkIns >= SUPPRESSION_FLOOR && baseline.checkIns >= SUPPRESSION_FLOOR

  return {
    window,
    baseline,
    comparable,
    delta: comparable
      ? {
          checkIns: window.checkIns - baseline.checkIns,
          visitors: window.visitors - baseline.visitors,
          foundYou: window.foundYou - baseline.foundYou,
          walkIns: window.walkIns - baseline.walkIns,
        }
      : null,
  }
}
