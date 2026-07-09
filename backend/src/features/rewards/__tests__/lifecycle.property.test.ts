import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { classifyLifecycle, validateWindow } from '../lifecycle.js'

/**
 * Event & Offer Gets — pure lifecycle + window-validation property tests.
 *
 * Covers Property 1 (Lifecycle partition) and Property 2 (Window validation)
 * from the design doc.
 *
 * **Validates: Requirements 3.1, 3.5, 1.3, 1.6, 2.4**
 */

// ─── Constants mirrored from lifecycle.ts (kept local so the test pins them) ─

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const PAST_SKEW_MS = 5 * 60 * 1000 // 5 minutes

/** Bound epoch-ms generation to a sane real-world range so ISO strings parse. */
const EPOCH_MIN = Date.parse('2000-01-01T00:00:00.000Z')
const EPOCH_MAX = Date.parse('2100-01-01T00:00:00.000Z')

const epochMsArb = fc.integer({ min: EPOCH_MIN, max: EPOCH_MAX })

/** ISO-8601 UTC ms string from epoch ms, matching how the service produces them. */
const iso = (ms: number): string => new Date(ms).toISOString()

// ─── Property 1: Lifecycle partition ────────────────────────────────────────

describe('Feature: event-and-offer-gets, Property 1: Lifecycle partition', () => {
  /**
   * Generate a valid ordered window (startsAt < endsAt) plus an arbitrary clock.
   */
  const orderedWindowAndClock = fc
    .tuple(epochMsArb, fc.integer({ min: 1, max: MAX_WINDOW_MS }), epochMsArb)
    .map(([startMs, durationMs, nowMs]) => ({
      startMs,
      endMs: startMs + durationMs,
      nowMs,
    }))

  it('returns exactly one of upcoming/live/ended for any ordered window and clock', () => {
    fc.assert(
      fc.property(orderedWindowAndClock, ({ startMs, endMs, nowMs }) => {
        const state = classifyLifecycle(iso(startMs), iso(endMs), nowMs)
        expect(['upcoming', 'live', 'ended']).toContain(state)
      }),
    )
  })

  it('classifies into contiguous, non-overlapping half-open regions', () => {
    fc.assert(
      fc.property(orderedWindowAndClock, ({ startMs, endMs, nowMs }) => {
        const startsAt = iso(startMs)
        const endsAt = iso(endMs)
        // Re-parse to compare against the same precision the classifier uses.
        const start = Date.parse(startsAt)
        const end = Date.parse(endsAt)
        const state = classifyLifecycle(startsAt, endsAt, nowMs)

        if (nowMs < start) {
          expect(state).toBe('upcoming')
        } else if (nowMs < end) {
          expect(state).toBe('live')
        } else {
          expect(state).toBe('ended')
        }
      }),
    )
  })

  it('uses half-open boundaries: nowMs == startsAt is live, nowMs == endsAt is ended', () => {
    fc.assert(
      fc.property(orderedWindowAndClock, ({ startMs, endMs }) => {
        const startsAt = iso(startMs)
        const endsAt = iso(endMs)
        // Parse back so boundary equality is exact at ms precision.
        const start = Date.parse(startsAt)
        const end = Date.parse(endsAt)

        expect(classifyLifecycle(startsAt, endsAt, start)).toBe('live')
        expect(classifyLifecycle(startsAt, endsAt, end)).toBe('ended')
      }),
    )
  })
})

// ─── Property 2: Window validation soundness ────────────────────────────────

describe('Feature: event-and-offer-gets, Property 2: Window validation', () => {
  /**
   * Generate arbitrary (possibly invalid) windows + clock. We allow startMs and
   * endMs to be independent so disordered windows are exercised, and let the
   * duration occasionally exceed 30 days and the start fall well into the past.
   */
  const arbitraryWindowAndClock = fc
    .tuple(epochMsArb, epochMsArb, epochMsArb)
    .map(([startMs, endMs, nowMs]) => ({ startMs, endMs, nowMs }))

  it('accepts iff startsAt < endsAt AND duration <= 30 days AND startsAt >= nowMs - 5min', () => {
    fc.assert(
      fc.property(arbitraryWindowAndClock, ({ startMs, endMs, nowMs }) => {
        const startsAt = iso(startMs)
        const endsAt = iso(endMs)
        const start = Date.parse(startsAt)
        const end = Date.parse(endsAt)

        const expectedOk = start < end && end - start <= MAX_WINDOW_MS && start >= nowMs - PAST_SKEW_MS

        const result = validateWindow(startsAt, endsAt, nowMs)
        expect(result.ok).toBe(expectedOk)
      }),
    )
  })

  it('returns the correct rejection code respecting precedence (invalid > too_long > past)', () => {
    fc.assert(
      fc.property(arbitraryWindowAndClock, ({ startMs, endMs, nowMs }) => {
        const startsAt = iso(startMs)
        const endsAt = iso(endMs)
        const start = Date.parse(startsAt)
        const end = Date.parse(endsAt)

        const result = validateWindow(startsAt, endsAt, nowMs)

        if (start >= end) {
          expect(result).toEqual({ ok: false, code: 'invalid_window' })
        } else if (end - start > MAX_WINDOW_MS) {
          expect(result).toEqual({ ok: false, code: 'window_too_long' })
        } else if (start < nowMs - PAST_SKEW_MS) {
          expect(result).toEqual({ ok: false, code: 'starts_in_past' })
        } else {
          expect(result).toEqual({ ok: true })
        }
      }),
    )
  })

  it('rejects unparseable bounds with invalid_window', () => {
    fc.assert(
      fc.property(epochMsArb, (nowMs) => {
        expect(validateWindow('not-a-date', '2030-01-01T00:00:00.000Z', nowMs)).toEqual({
          ok: false,
          code: 'invalid_window',
        })
        expect(validateWindow('2030-01-01T00:00:00.000Z', 'not-a-date', nowMs)).toEqual({
          ok: false,
          code: 'invalid_window',
        })
      }),
    )
  })
})
