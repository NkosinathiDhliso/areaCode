/**
 * Feature: Proof of demand, Property 2b: the Going night.
 *
 * One pure helper decides which night a mark belongs to, so the write path and
 * every reader agree. The rule: the SAST calendar date, rolling over at 04:00, so
 * a mark at 01:30 on Saturday belongs to Friday's night and a whole night out is
 * never split across two partitions.
 *
 * The property: every instant in `[04:00 SAST, 04:00 SAST + 24h)` maps to the
 * same night date, and that date is the SAST calendar date at the window's start.
 *
 * Validates: Requirements 9.1
 */

import { NIGHT_ROLLOVER_HOUR_SAST } from '@area-code/shared/lib/sast'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { goingNightFor, goingRowTtlEpochSeconds, GOING_DIGEST_PASS_HOUR_SAST, GOING_TTL_SLACK_HOURS } from '../going.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const SAST_OFFSET_MS = 2 * HOUR_MS

/** 00:00 SAST on a date, as epoch ms. */
function sastMidnightMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - SAST_OFFSET_MS
}

/** 04:00 SAST on a date, as epoch ms. */
function rolloverMs(date: string): number {
  return sastMidnightMs(date) + NIGHT_ROLLOVER_HOUR_SAST * HOUR_MS
}

/**
 * The weekly digest pass that covers a night: Monday 06:00 SAST after the night's
 * week closes. Derived from the dispatcher's own schedule
 * (`cron(0 4 ? * MON *)`), independently of the TTL helper under test.
 */
function digestPassMs(night: string): number {
  const daysSinceMonday = (new Date(Date.parse(`${night}T00:00:00.000Z`)).getUTCDay() + 6) % 7
  const weekStartMs = sastMidnightMs(night) - daysSinceMonday * DAY_MS
  return weekStartMs + 7 * DAY_MS + GOING_DIGEST_PASS_HOUR_SAST * HOUR_MS
}

/** Any calendar date across a few years, including leap day and month ends. */
const nightArb = fc
  .integer({ min: 0, max: 3 * 365 })
  .map((offset) => new Date(Date.parse('2025-06-01T00:00:00.000Z') + offset * DAY_MS).toISOString().slice(0, 10))

// ─── Units ───────────────────────────────────────────────────────────────────

describe('goingNightFor', () => {
  it('reads an evening as its own night', () => {
    expect(goingNightFor('2026-03-06T21:00:00.000+02:00')).toBe('2026-03-06')
  })

  it('reads the small hours as the night that is still running', () => {
    expect(goingNightFor('2026-03-07T01:30:00.000+02:00')).toBe('2026-03-06')
    expect(goingNightFor('2026-03-07T03:59:59.999+02:00')).toBe('2026-03-06')
  })

  it('rolls over at 04:00 SAST, not at midnight', () => {
    expect(goingNightFor('2026-03-07T04:00:00.000+02:00')).toBe('2026-03-07')
  })
})

// ─── Property 2b ─────────────────────────────────────────────────────────────

describe('Property 2b: one night per 24 hours from 04:00 SAST', () => {
  it('maps every instant in the window to the window start date', () => {
    fc.assert(
      fc.property(nightArb, fc.integer({ min: 0, max: DAY_MS - 1 }), (night, offsetMs) => {
        expect(goingNightFor(rolloverMs(night) + offsetMs)).toBe(night)
      }),
      { numRuns: 300 },
    )
  })

  it('moves to the next night one millisecond after the window closes', () => {
    fc.assert(
      fc.property(nightArb, (night) => {
        const nextNight = new Date(Date.parse(`${night}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10)
        expect(goingNightFor(rolloverMs(night) + DAY_MS)).toBe(nextNight)
      }),
      { numRuns: 200 },
    )
  })

  it('always yields a night whose rows outlive the digest pass that covers it', () => {
    fc.assert(
      fc.property(nightArb, fc.integer({ min: 0, max: DAY_MS - 1 }), (night, offsetMs) => {
        const markedAtMs = rolloverMs(night) + offsetMs
        const ttlMs = goingRowTtlEpochSeconds(goingNightFor(markedAtMs)) * 1000
        // The pass fires Monday 06:00 SAST over the week that closed at Monday
        // 00:00 SAST, so the row must outlive the PASS with slack, not merely the
        // week boundary, and still expire the same morning.
        expect(ttlMs).toBeGreaterThan(markedAtMs)
        expect(ttlMs).toBe(digestPassMs(night) + GOING_TTL_SLACK_HOURS * HOUR_MS)
        expect(ttlMs - digestPassMs(night)).toBeGreaterThanOrEqual(HOUR_MS)
        expect(ttlMs - markedAtMs).toBeLessThanOrEqual(8 * DAY_MS)
      }),
      { numRuns: 200 },
    )
  })
})
