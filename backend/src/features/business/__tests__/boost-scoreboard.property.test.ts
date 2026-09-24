/**
 * Feature: Proof of demand, Property 7: the Boost_Scoreboard baseline is the
 * same clock window seven days earlier, and no comparison survives below the
 * Suppression_Floor.
 *
 * An owner reads this scoreboard to decide whether to buy a second boost, so
 * two things have to hold over every window and every set of check-ins:
 *
 * 1. The comparison window is exactly the boost window shifted back seven days:
 *    same length to the millisecond, same weekday, same clock hours. A baseline
 *    of a different length or a different part of the evening would make the
 *    comparison a different question than the one the owner is asking.
 * 2. A comparison is offered only when both windows clear the floor.
 *    `comparable` is false when either sample is short, and `delta` is null
 *    exactly then, so no caller can render a comparison the sample does not
 *    support. The counts themselves always render.
 *
 * Also held here: the split is the Receipt's (`foundYou + walkIns === visitors`
 * in both windows, one home for the count), and the scoreboard carries no copy
 * at all. The only strings it returns are the four window instants, so there is
 * no label in which a causal verb could appear, and a boost window that
 * recorded nothing reports zeros rather than a failure or a claim.
 *
 * Boundary examples (exactly at the floor, length equality, zero-length and
 * inverted windows) are pinned in `boost-scoreboard.test.ts`.
 *
 * **Validates: Requirements 7.1, 7.3, 7.5**
 */

import { FOUND_VIA } from '@area-code/shared/constants/attribution'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { ReceiptCheckIn, ReceiptWindow } from '../../reports/receipt.js'
import { SUPPRESSION_FLOOR } from '../../reports/suppression.js'
import {
  boostScoreboardBaselineWindow,
  computeBoostScoreboard,
  BOOST_SCOREBOARD_BASELINE_OFFSET_MS,
  type BoostScoreboardPeriod,
} from '../boost-scoreboard.js'
import { BOOST_DURATION_HOURS, boostWindowEnd, type BoostDuration } from '../types.js'

const HOUR_MS = 60 * 60 * 1000

/** The three lengths a boost can actually be bought in (`BOOST_PRICING`). */
const durationArb: fc.Arbitrary<BoostDuration> = fc.constantFrom(
  ...(Object.keys(BOOST_DURATION_HOURS) as BoostDuration[]),
)

/** A real Boost_Window: `paidAt` plus the purchased duration, as the webhook writes it. */
const boostWindowArb: fc.Arbitrary<ReceiptWindow> = fc
  .tuple(fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) }), durationArb)
  .map(([paidAtMs, duration]) => {
    const windowStartUtc = new Date(paidAtMs).toISOString()
    return { windowStartUtc, windowEndUtc: boostWindowEnd(windowStartUtc, duration) }
  })

/**
 * Check-ins spread across the baseline window, the boost window and the gap
 * between them, so both windows see traffic and rows outside both are common.
 * The pool of consumers is small, so repeat visits and mixed Found_You /
 * Walk_In consumers occur often.
 */
function checkInsArbFor(window: ReceiptWindow): fc.Arbitrary<ReceiptCheckIn[]> {
  const startMs = new Date(window.windowStartUtc).getTime()
  const endMs = new Date(window.windowEndUtc).getTime()
  const baselineStartMs = startMs - BOOST_SCOREBOARD_BASELINE_OFFSET_MS

  const atArb = fc.integer({ min: baselineStartMs - 2 * HOUR_MS, max: endMs + 2 * HOUR_MS })

  return fc.array(
    fc.record({
      userId: fc.integer({ min: 0, max: 14 }).map((n) => `user-${n}`),
      checkedInAt: atArb.map((ms) => new Date(ms).toISOString()),
      // Every stamped value, plus the pre-spec absence that reads as Walk_In.
      foundVia: fc.constantFrom(...FOUND_VIA, undefined),
    }),
    { maxLength: 60 },
  )
}

interface Scenario {
  window: ReceiptWindow
  checkIns: ReceiptCheckIn[]
}

const scenarioArb: fc.Arbitrary<Scenario> = boostWindowArb.chain((window) =>
  checkInsArbFor(window).map((checkIns) => ({ window, checkIns })),
)

const lengthOf = (window: ReceiptWindow): number =>
  new Date(window.windowEndUtc).getTime() - new Date(window.windowStartUtc).getTime()

/** Rows inside a half-open window, counted independently of the implementation. */
function rowsIn(checkIns: readonly ReceiptCheckIn[], window: ReceiptWindow): ReceiptCheckIn[] {
  const startMs = new Date(window.windowStartUtc).getTime()
  const endMs = new Date(window.windowEndUtc).getTime()
  return checkIns.filter((checkIn) => {
    const at = new Date(checkIn.checkedInAt).getTime()
    return at >= startMs && at < endMs
  })
}

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0

function expectCounts(period: BoostScoreboardPeriod): void {
  expect(isCount(period.checkIns)).toBe(true)
  expect(isCount(period.visitors)).toBe(true)
  expect(isCount(period.foundYou)).toBe(true)
  expect(isCount(period.walkIns)).toBe(true)
  expect(period.foundYou + period.walkIns).toBe(period.visitors)
  expect(period.visitors).toBeLessThanOrEqual(period.checkIns)
}

describe('Feature: Proof of demand, Property 7: the baseline is the same clock window seven days earlier', () => {
  it('offsets both bounds by exactly seven days and keeps the length identical', () => {
    fc.assert(
      fc.property(scenarioArb, ({ window, checkIns }) => {
        const board = computeBoostScoreboard(checkIns, window)

        expect(board.window.windowStartUtc).toBe(window.windowStartUtc)
        expect(board.window.windowEndUtc).toBe(window.windowEndUtc)

        const startDelta = new Date(window.windowStartUtc).getTime() - new Date(board.baseline.windowStartUtc).getTime()
        const endDelta = new Date(window.windowEndUtc).getTime() - new Date(board.baseline.windowEndUtc).getTime()

        expect(startDelta).toBe(BOOST_SCOREBOARD_BASELINE_OFFSET_MS)
        expect(endDelta).toBe(BOOST_SCOREBOARD_BASELINE_OFFSET_MS)
        expect(lengthOf(board.baseline)).toBe(lengthOf(board.window))
      }),
      { numRuns: 300 },
    )
  })

  it('lands on the same weekday and the same clock time in SAST, the local reading the owner compares', () => {
    fc.assert(
      fc.property(boostWindowArb, (window) => {
        const baseline = boostScoreboardBaselineWindow(window)
        // SAST is UTC+2 all year, so a local reading is the UTC instant plus two
        // hours; whole-day arithmetic must leave weekday and clock hours fixed.
        const sast = (iso: string): Date => new Date(new Date(iso).getTime() + 2 * HOUR_MS)
        const windowLocal = sast(window.windowStartUtc)
        const baselineLocal = sast(baseline.windowStartUtc)

        expect(baselineLocal.getUTCDay()).toBe(windowLocal.getUTCDay())
        expect(baselineLocal.getUTCHours()).toBe(windowLocal.getUTCHours())
        expect(baselineLocal.getUTCMinutes()).toBe(windowLocal.getUTCMinutes())
      }),
      { numRuns: 300 },
    )
  })

  it('reads each window from its own rows only: traffic outside both windows changes nothing', () => {
    fc.assert(
      fc.property(scenarioArb, ({ window, checkIns }) => {
        const board = computeBoostScoreboard(checkIns, window)

        expect(board.window.checkIns).toBe(rowsIn(checkIns, window).length)
        expect(board.baseline.checkIns).toBe(rowsIn(checkIns, boostScoreboardBaselineWindow(window)).length)

        // Dropping every row outside the two windows leaves the whole scoreboard
        // identical, so a wider read than needed can never shift a number.
        const inEither = new Set([
          ...rowsIn(checkIns, window),
          ...rowsIn(checkIns, boostScoreboardBaselineWindow(window)),
        ])
        expect(computeBoostScoreboard([...inEither], window)).toEqual(board)
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 7: no comparison below the Suppression_Floor', () => {
  it('is comparable only when both windows clear the floor, and withholds the delta exactly then', () => {
    fc.assert(
      fc.property(scenarioArb, ({ window, checkIns }) => {
        const board = computeBoostScoreboard(checkIns, window)
        const bothClear = board.window.checkIns >= SUPPRESSION_FLOOR && board.baseline.checkIns >= SUPPRESSION_FLOOR

        expect(board.comparable).toBe(bothClear)
        expect(board.delta === null).toBe(!board.comparable)

        if (!board.comparable) {
          // Either window being short is enough to withhold the comparison.
          expect(board.window.checkIns < SUPPRESSION_FLOOR || board.baseline.checkIns < SUPPRESSION_FLOOR).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('always renders both sets of counts, and the delta is window minus baseline when it is offered', () => {
    fc.assert(
      fc.property(scenarioArb, ({ window, checkIns }) => {
        const board = computeBoostScoreboard(checkIns, window)

        expectCounts(board.window)
        expectCounts(board.baseline)

        if (board.delta !== null) {
          expect(board.delta.checkIns).toBe(board.window.checkIns - board.baseline.checkIns)
          expect(board.delta.visitors).toBe(board.window.visitors - board.baseline.visitors)
          expect(board.delta.foundYou).toBe(board.window.foundYou - board.baseline.foundYou)
          expect(board.delta.walkIns).toBe(board.window.walkIns - board.baseline.walkIns)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: Proof of demand, Property 7: the scoreboard is data, never a claim', () => {
  it('returns no strings beyond the four window instants, so no label can carry a verb', () => {
    fc.assert(
      fc.property(scenarioArb, ({ window, checkIns }) => {
        const board = computeBoostScoreboard(checkIns, window)
        const baseline = boostScoreboardBaselineWindow(window)

        const strings = JSON.stringify(board).match(/"[^"]*"/g) ?? []
        const values = strings.map((quoted) => quoted.slice(1, -1))
        const instants = [window.windowStartUtc, window.windowEndUtc, baseline.windowStartUtc, baseline.windowEndUtc]
        for (const value of values) {
          // Every string is either a field name on the shape above or an instant.
          const isKey =
            /^(window|baseline|comparable|delta|windowStartUtc|windowEndUtc|checkIns|visitors|foundYou|walkIns)$/.test(
              value,
            )
          expect(isKey || instants.includes(value)).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('is pure: the same answer twice, and the check-ins are left untouched', () => {
    fc.assert(
      fc.property(scenarioArb, ({ window, checkIns }) => {
        const snapshot = JSON.stringify(checkIns)

        const first = computeBoostScoreboard(checkIns, window)
        const second = computeBoostScoreboard(checkIns, window)

        expect(second).toEqual(first)
        expect(JSON.stringify(checkIns)).toBe(snapshot)
      }),
      { numRuns: 300 },
    )
  })
})
