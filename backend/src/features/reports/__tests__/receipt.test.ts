/**
 * `computeReceipt` examples: the boundaries and the cases an owner would argue
 * about. The universal split rules are in `receipt.property.test.ts`.
 *
 * Feature: proof-of-demand (R4.1, R4.2, R4.8)
 */

import { RECEIPT_MEASURED_FROM_ISO } from '@area-code/shared/constants/attribution'
import { describe, expect, it } from 'vitest'

import type { RawCheckIn } from '../anonymize.js'
import { computeReceipt, type ReceiptWindow } from '../receipt.js'

const MEASURED_FROM_MS = new Date(RECEIPT_MEASURED_FROM_ISO).getTime()
const WEEK_MS = 7 * 86_400_000

/** A week window opening at `startMs`. */
function windowFrom(startMs: number): ReceiptWindow {
  return {
    windowStartUtc: new Date(startMs).toISOString(),
    windowEndUtc: new Date(startMs + WEEK_MS).toISOString(),
  }
}

const WINDOW = windowFrom(MEASURED_FROM_MS)

function checkIn(userId: string, minutesIn: number, foundVia?: RawCheckIn['foundVia']): RawCheckIn {
  return {
    userId,
    nodeId: 'node-a',
    tier: 'local',
    checkedInAt: new Date(MEASURED_FROM_MS + minutesIn * 60_000).toISOString(),
    ...(foundVia === undefined ? {} : { foundVia }),
  }
}

describe('computeReceipt — the split between Found_You and Walk_In', () => {
  it('counts a consumer with any Found_You check-in as Found_You, not both', () => {
    const receipt = computeReceipt(
      [checkIn('user-1', 0, 'walk_in'), checkIn('user-1', 60, 'map'), checkIn('user-2', 30, 'walk_in')],
      WINDOW,
    )

    expect(receipt.foundYouVisitors).toBe(1)
    expect(receipt.walkInVisitors).toBe(1)
    expect(receipt.uniqueVisitors).toBe(2)
  })

  it('reads a check-in with no stamp as a Walk_In', () => {
    const receipt = computeReceipt([checkIn('user-1', 0), checkIn('user-2', 10)], WINDOW)

    expect(receipt.foundYouVisitors).toBe(0)
    expect(receipt.walkInVisitors).toBe(2)
  })

  it('returns an empty Receipt for a window with no check-ins', () => {
    const receipt = computeReceipt([], WINDOW)

    expect(receipt.uniqueVisitors).toBe(0)
    expect(receipt.foundYouVisitors).toBe(0)
    expect(receipt.walkInVisitors).toBe(0)
    expect(receipt.bySource).toEqual({ map: 0, share: 0, search: 0, push: 0 })
  })
})

describe('computeReceipt — bySource', () => {
  it('counts a consumer under the source of their earliest Found_You check-in', () => {
    const receipt = computeReceipt([checkIn('user-1', 120, 'push'), checkIn('user-1', 30, 'share')], WINDOW)

    expect(receipt.bySource).toEqual({ map: 0, share: 1, search: 0, push: 0 })
    expect(receipt.foundYouVisitors).toBe(1)
  })

  it('resolves a same-instant tie the same way whatever order the rows are read in', () => {
    const rows = [checkIn('user-1', 30, 'push'), checkIn('user-1', 30, 'map')]

    const forwards = computeReceipt(rows, WINDOW)
    const backwards = computeReceipt([...rows].reverse(), WINDOW)

    expect(forwards.bySource).toEqual(backwards.bySource)
    expect(forwards.bySource.map).toBe(1)
  })

  it('spreads distinct consumers across their sources', () => {
    const receipt = computeReceipt(
      [checkIn('user-1', 0, 'map'), checkIn('user-2', 0, 'share'), checkIn('user-3', 0, 'map')],
      WINDOW,
    )

    expect(receipt.bySource).toEqual({ map: 2, share: 1, search: 0, push: 0 })
  })
})

describe('computeReceipt — Found_You first-timers', () => {
  const rows = [checkIn('user-1', 0, 'map'), checkIn('user-2', 0, 'share'), checkIn('user-3', 0, 'walk_in')]

  it('counts only Found_You consumers whose first-ever visit falls in the window', () => {
    const receipt = computeReceipt(rows, WINDOW, {
      // Returning: first visit predates the window.
      'user-1': new Date(MEASURED_FROM_MS - 86_400_000).toISOString(),
      // First-timer: first visit is this one.
      'user-2': rows[1]!.checkedInAt,
      'user-3': rows[2]!.checkedInAt,
    })

    expect(receipt.foundYouFirstTimers).toBe(1)
  })

  it('treats a consumer with no recorded earlier visit as a first-timer', () => {
    const receipt = computeReceipt(rows, WINDOW, {})

    expect(receipt.foundYouFirstTimers).toBe(2)
  })

  it('reports unmeasured rather than zero when the earliest-check-in read was skipped', () => {
    const receipt = computeReceipt(rows, WINDOW)

    expect(receipt.foundYouFirstTimers).toBe(0)
    expect(receipt.suppressed).toContain('foundYouFirstTimers')
  })
})

describe('computeReceipt — measured-from annotation (R4.8)', () => {
  it('carries the measurement instant when the window opens before the deploy', () => {
    const receipt = computeReceipt([], windowFrom(MEASURED_FROM_MS - 1))

    expect(receipt.measuredFrom).toBe(RECEIPT_MEASURED_FROM_ISO)
  })

  it('carries nothing when the window opens exactly at the deploy', () => {
    expect(computeReceipt([], windowFrom(MEASURED_FROM_MS)).measuredFrom).toBeNull()
  })

  it('carries nothing for a window fully after the deploy', () => {
    expect(computeReceipt([], windowFrom(MEASURED_FROM_MS + WEEK_MS)).measuredFrom).toBeNull()
  })
})

describe('computeReceipt — a window it refuses to trust', () => {
  it('throws on an unreadable window rather than reporting a silent zero', () => {
    expect(() => computeReceipt([], { windowStartUtc: 'last week', windowEndUtc: 'tonight' })).toThrow(/invalid window/)
  })
})
