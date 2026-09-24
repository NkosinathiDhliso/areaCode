/**
 * Boost_Scoreboard boundary examples (proof-of-demand R7.1, R7.3, R7.5).
 *
 * The property test holds the general rules over generated windows; these pin
 * the edges a generator reaches rarely and a reader needs to see spelled out:
 * exactly at the Suppression_Floor, the half-open window bounds, the three real
 * boost lengths, a zero-length window and an inverted one.
 *
 * **Validates: Requirements 7.1, 7.3, 7.5**
 */

import type { FoundVia } from '@area-code/shared/constants/attribution'
import { describe, expect, it } from 'vitest'

import type { ReceiptCheckIn, ReceiptWindow } from '../../reports/receipt.js'
import { SUPPRESSION_FLOOR } from '../../reports/suppression.js'
import {
  boostScoreboardBaselineWindow,
  computeBoostScoreboard,
  BOOST_SCOREBOARD_BASELINE_OFFSET_MS,
} from '../boost-scoreboard.js'
import { boostWindowEnd } from '../types.js'

// A Friday 20:00 SAST purchase (18:00 UTC), the shape a boost is actually bought in.
const PAID_AT = '2026-03-06T18:00:00.000Z'
const WINDOW: ReceiptWindow = { windowStartUtc: PAID_AT, windowEndUtc: boostWindowEnd(PAID_AT, '2hr') }
const BASELINE = boostScoreboardBaselineWindow(WINDOW)

const HOUR_MS = 60 * 60 * 1000

function at(window: ReceiptWindow, offsetMs: number): string {
  return new Date(new Date(window.windowStartUtc).getTime() + offsetMs).toISOString()
}

/** `count` distinct consumers in `window`, all Found_You unless told otherwise. */
function visitors(window: ReceiptWindow, count: number, prefix: string, foundVia: FoundVia = 'map'): ReceiptCheckIn[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `${prefix}-${index}`,
    checkedInAt: at(window, index * 60_000),
    foundVia,
  }))
}

describe('computeBoostScoreboard: the comparison window', () => {
  it('is the same clock window seven days earlier', () => {
    expect(BASELINE.windowStartUtc).toBe('2026-02-27T18:00:00.000Z')
    expect(BASELINE.windowEndUtc).toBe('2026-02-27T20:00:00.000Z')
  })

  it('matches the boost window length exactly, for each duration a boost is sold in', () => {
    for (const duration of ['2hr', '6hr', '24hr'] as const) {
      const window: ReceiptWindow = { windowStartUtc: PAID_AT, windowEndUtc: boostWindowEnd(PAID_AT, duration) }
      const board = computeBoostScoreboard([], window)

      const windowLength = new Date(board.window.windowEndUtc).getTime() - new Date(PAID_AT).getTime()
      const baselineLength =
        new Date(board.baseline.windowEndUtc).getTime() - new Date(board.baseline.windowStartUtc).getTime()

      expect(baselineLength).toBe(windowLength)
      expect(new Date(PAID_AT).getTime() - new Date(board.baseline.windowStartUtc).getTime()).toBe(
        BOOST_SCOREBOARD_BASELINE_OFFSET_MS,
      )
    }
  })

  it('counts the window half-open: a check-in at the start counts, one at the end does not', () => {
    const board = computeBoostScoreboard(
      [
        { userId: 'u1', checkedInAt: WINDOW.windowStartUtc, foundVia: 'map' },
        { userId: 'u2', checkedInAt: WINDOW.windowEndUtc, foundVia: 'map' },
      ],
      WINDOW,
    )

    expect(board.window.checkIns).toBe(1)
    expect(board.window.foundYou).toBe(1)
  })

  it('ignores rows in the gap between the two windows', () => {
    const board = computeBoostScoreboard(
      [{ userId: 'u1', checkedInAt: at(WINDOW, -3 * 24 * HOUR_MS), foundVia: 'share' }],
      WINDOW,
    )

    expect(board.window.checkIns).toBe(0)
    expect(board.baseline.checkIns).toBe(0)
  })
})

describe('computeBoostScoreboard: the split comes from the Receipt', () => {
  it('separates Found_You from Walk_In per consumer, and reads an unstamped check-in as a Walk_In', () => {
    const board = computeBoostScoreboard(
      [
        { userId: 'u1', checkedInAt: at(WINDOW, 0), foundVia: 'share' },
        // Same consumer again: one visitor, two check-ins.
        { userId: 'u1', checkedInAt: at(WINDOW, HOUR_MS), foundVia: 'walk_in' },
        { userId: 'u2', checkedInAt: at(WINDOW, 0), foundVia: 'walk_in' },
        // Pre-spec row, no `foundVia` at all.
        { userId: 'u3', checkedInAt: at(WINDOW, 0) },
      ],
      WINDOW,
    )

    expect(board.window.checkIns).toBe(4)
    expect(board.window.visitors).toBe(3)
    expect(board.window.foundYou).toBe(1)
    expect(board.window.walkIns).toBe(2)
  })
})

describe('computeBoostScoreboard: the Suppression_Floor', () => {
  it('compares when both windows sit exactly at the floor', () => {
    const board = computeBoostScoreboard(
      [...visitors(WINDOW, SUPPRESSION_FLOOR, 'now'), ...visitors(BASELINE, SUPPRESSION_FLOOR, 'then', 'walk_in')],
      WINDOW,
    )

    expect(board.window.checkIns).toBe(SUPPRESSION_FLOOR)
    expect(board.baseline.checkIns).toBe(SUPPRESSION_FLOOR)
    expect(board.comparable).toBe(true)
    expect(board.delta).toEqual({ checkIns: 0, visitors: 0, foundYou: SUPPRESSION_FLOOR, walkIns: -SUPPRESSION_FLOOR })
  })

  it('withholds the comparison when the baseline is one short, and still reports both sets of counts', () => {
    const board = computeBoostScoreboard(
      [...visitors(WINDOW, SUPPRESSION_FLOOR + 20, 'now'), ...visitors(BASELINE, SUPPRESSION_FLOOR - 1, 'then')],
      WINDOW,
    )

    expect(board.comparable).toBe(false)
    expect(board.delta).toBeNull()
    expect(board.window.foundYou).toBe(SUPPRESSION_FLOOR + 20)
    expect(board.baseline.foundYou).toBe(SUPPRESSION_FLOOR - 1)
  })

  it('withholds the comparison when the boost window is one short', () => {
    const board = computeBoostScoreboard(
      [...visitors(WINDOW, SUPPRESSION_FLOOR - 1, 'now'), ...visitors(BASELINE, SUPPRESSION_FLOOR, 'then')],
      WINDOW,
    )

    expect(board.comparable).toBe(false)
    expect(board.delta).toBeNull()
  })

  it('reports an empty boost window as zeros with no comparison, neither a failure nor a claim', () => {
    const board = computeBoostScoreboard(visitors(BASELINE, SUPPRESSION_FLOOR + 3, 'then'), WINDOW)

    expect(board.window).toEqual({
      windowStartUtc: WINDOW.windowStartUtc,
      windowEndUtc: WINDOW.windowEndUtc,
      checkIns: 0,
      visitors: 0,
      foundYou: 0,
      walkIns: 0,
    })
    expect(board.comparable).toBe(false)
    expect(board.delta).toBeNull()
  })
})

describe('computeBoostScoreboard: degenerate windows', () => {
  it('reports a zero-length window as zeros with no comparison', () => {
    const empty: ReceiptWindow = { windowStartUtc: PAID_AT, windowEndUtc: PAID_AT }
    const board = computeBoostScoreboard([{ userId: 'u1', checkedInAt: PAID_AT, foundVia: 'map' }], empty)

    expect(board.window.checkIns).toBe(0)
    expect(board.baseline.checkIns).toBe(0)
    expect(board.comparable).toBe(false)
    expect(board.delta).toBeNull()
  })

  it('throws on an inverted window rather than counting an impossible one', () => {
    const inverted: ReceiptWindow = { windowStartUtc: WINDOW.windowEndUtc, windowEndUtc: WINDOW.windowStartUtc }

    expect(() => computeBoostScoreboard([], inverted)).toThrow(/ends before it starts/)
  })

  it('throws on an unreadable instant rather than substituting one', () => {
    expect(() => computeBoostScoreboard([], { windowStartUtc: 'not-a-date', windowEndUtc: PAID_AT })).toThrow(
      /invalid windowStartUtc/,
    )
    expect(() => computeBoostScoreboard([], { windowStartUtc: PAID_AT, windowEndUtc: 'not-a-date' })).toThrow(
      /invalid windowEndUtc/,
    )
  })
})
