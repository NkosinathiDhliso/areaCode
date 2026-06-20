import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { isVisibleInFeed, classifyLifecycle } from '../lifecycle.js'

/**
 * Event & Offer Gets — feed lifecycle filter property tests.
 *
 * Covers Property 4 (Feed lifecycle filter) from the design doc. The predicate
 * under test, `isVisibleInFeed`, is the exact production filter applied by
 * `getRewardsNearMe` in `service.ts` after the proximity query (the service
 * imports and calls this same helper), so this test exercises real behaviour
 * rather than a copy.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4**
 */

// ─── Generation helpers ─────────────────────────────────────────────────────

/** Bound epoch-ms generation to a sane real-world range so ISO strings parse. */
const EPOCH_MIN = Date.parse('2000-01-01T00:00:00.000Z')
const EPOCH_MAX = Date.parse('2100-01-01T00:00:00.000Z')
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const epochMsArb = fc.integer({ min: EPOCH_MIN, max: EPOCH_MAX })

/** ISO-8601 UTC ms string, matching how the service produces timestamps. */
const iso = (ms: number): string => new Date(ms).toISOString()

type FeedRow = {
  getCategory: 'loyalty' | 'event' | 'offer'
  startsAt?: string | null
  endsAt?: string | null
}

/** A loyalty row — never carries a window. */
const loyaltyRowArb: fc.Arbitrary<FeedRow> = fc.constant({ getCategory: 'loyalty' as const })

/**
 * An event/offer row with a valid ordered window. The window is positioned
 * relative to a clock so that across many runs we cover upcoming/live/ended.
 */
const windowedRowArb = (nowMs: number): fc.Arbitrary<FeedRow> =>
  fc
    .tuple(fc.constantFrom('event' as const, 'offer' as const), epochMsArb, fc.integer({ min: 1, max: MAX_WINDOW_MS }))
    .map(([getCategory, startMs, durationMs]) => ({
      getCategory,
      startsAt: iso(startMs),
      endsAt: iso(startMs + durationMs),
    }))

/** An event/offer row missing one or both window bounds. */
const missingWindowRowArb: fc.Arbitrary<FeedRow> = fc
  .tuple(
    fc.constantFrom('event' as const, 'offer' as const),
    fc.option(epochMsArb.map(iso), { nil: null }),
    fc.option(epochMsArb.map(iso), { nil: null }),
  )
  .filter(([, s, e]) => s === null || e === null)
  .map(([getCategory, startsAt, endsAt]) => ({ getCategory, startsAt, endsAt }))

// ─── Property 4: Feed lifecycle filter ──────────────────────────────────────

describe('Feature: event-and-offer-gets, Property 4: Feed lifecycle filter', () => {
  it('keeps every loyalty row regardless of the clock', () => {
    fc.assert(
      fc.property(fc.array(loyaltyRowArb), epochMsArb, (rows, nowMs) => {
        for (const row of rows) {
          expect(isVisibleInFeed(row, nowMs)).toBe(true)
        }
      }),
    )
  })

  it('keeps an event/offer row iff its window is live at nowMs', () => {
    fc.assert(
      fc.property(
        epochMsArb.chain((nowMs) => fc.tuple(fc.constant(nowMs), windowedRowArb(nowMs))),
        ([nowMs, row]) => {
          const expectedLive = classifyLifecycle(row.startsAt as string, row.endsAt as string, nowMs) === 'live'
          expect(isVisibleInFeed(row, nowMs)).toBe(expectedLive)
        },
      ),
    )
  })

  it('excludes an event/offer row missing either window bound', () => {
    fc.assert(
      fc.property(missingWindowRowArb, epochMsArb, (row, nowMs) => {
        expect(isVisibleInFeed(row, nowMs)).toBe(false)
      }),
    )
  })

  it('returns every loyalty row and exactly the live event/offer rows for an arbitrary mix', () => {
    fc.assert(
      fc.property(
        epochMsArb.chain((nowMs) =>
          fc.tuple(
            fc.constant(nowMs),
            fc.array(fc.oneof(loyaltyRowArb, windowedRowArb(nowMs), missingWindowRowArb), {
              maxLength: 30,
            }),
          ),
        ),
        ([nowMs, rows]) => {
          const visible = rows.filter((r) => isVisibleInFeed(r, nowMs))

          // Every loyalty row survives the filter (R3.3).
          const loyaltyRows = rows.filter((r) => r.getCategory === 'loyalty')
          expect(visible.filter((r) => r.getCategory === 'loyalty')).toEqual(loyaltyRows)

          // Exactly the live event/offer rows survive (R3.2, R3.4).
          const expectedEventOffer = rows.filter(
            (r) =>
              r.getCategory !== 'loyalty' &&
              !!r.startsAt &&
              !!r.endsAt &&
              classifyLifecycle(r.startsAt, r.endsAt, nowMs) === 'live',
          )
          expect(visible.filter((r) => r.getCategory !== 'loyalty')).toEqual(expectedEventOffer)
        },
      ),
    )
  })
})
