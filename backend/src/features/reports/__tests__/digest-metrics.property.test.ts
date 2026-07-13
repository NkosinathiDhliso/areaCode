import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import type { RawCheckIn } from '../anonymize'
import {
  computeDigest,
  digestWeekFor,
  DIGEST_METRIC_NAMES,
  type DigestWeek,
  type DigestSources,
  type DigestMetrics,
} from '../digest'

/**
 * Property 2: Metric conservation
 *
 * For any generated set of check-in events, firstTimeVisitors +
 * returningVisitors === uniqueVisitors, uniqueVisitors <= visits, and every
 * numeric Attribution_Metric is a non-negative integer.
 *
 * **Validates: Requirements 1.2, 1.3**
 */

// The reports anonymization salt only bins check-ins for busiest day/hour; the
// conservation invariants are independent of its value, so a fixed salt is fine.
const SALT = 'digest-metric-property-salt'

const DAY_MS = 24 * 60 * 60 * 1000

// ─── Arbitraries ────────────────────────────────────────────────────────────

// A Digest_Week derived from a real instant (year 2000-2100), so the window
// bounds are exactly what the pipeline would compute.
const weekArb: fc.Arbitrary<DigestWeek> = fc
  .integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) })
  .map((ms) => digestWeekFor(new Date(ms).toISOString()))

const nodeIdArb = fc.constantFrom('node-a', 'node-b', 'node-c')
const tierArb = fc.constantFrom('starter', 'growth', 'pro')

// Build a full DigestSources for a given week: window check-ins timestamped
// inside the window, an earliest-check-in map consistent with those visitors
// (some first-timers with an earliest inside the window or absent, some
// returning with an earliest strictly before the window), plus the pass-through
// redemption and First-Get counts.
function sourcesArbFor(week: DigestWeek): fc.Arbitrary<DigestSources> {
  const windowStartMs = new Date(week.windowStartUtc).getTime()
  const windowEndMs = new Date(week.windowEndUtc).getTime()

  // Small user pool so unique-visitor collisions (repeat visits) happen often.
  const userIdArb = fc.integer({ min: 0, max: 12 }).map((n) => `user-${n}`)

  const checkInArb: fc.Arbitrary<RawCheckIn> = fc.record({
    userId: userIdArb,
    nodeId: nodeIdArb,
    tier: tierArb,
    checkedInAt: fc.integer({ min: windowStartMs, max: windowEndMs - 1 }).map((ms) => new Date(ms).toISOString()),
  })

  return fc.array(checkInArb, { maxLength: 60 }).chain((windowCheckIns) => {
    const uniqueUsers = [...new Set(windowCheckIns.map((c) => c.userId))]

    // For each visitor, pick an earliest-check-in classification:
    //  - 'omit': no recorded earlier visit (counted as first-timer)
    //  - in-window ISO: earliest inside the window (first-timer)
    //  - pre-window ISO: earliest strictly before the window (returning)
    const perUserArb = fc.oneof(
      fc.constant<'omit'>('omit'),
      fc.integer({ min: windowStartMs, max: windowEndMs - 1 }).map((ms) => new Date(ms).toISOString()),
      fc.integer({ min: windowStartMs - 400 * DAY_MS, max: windowStartMs - 1 }).map((ms) => new Date(ms).toISOString()),
    )

    const earliestArb = fc.tuple(...uniqueUsers.map(() => perUserArb)).map((choices) => {
      const earliestCheckInByUser: Record<string, string> = {}
      uniqueUsers.forEach((user, i) => {
        const choice = choices[i]
        // `choices` is built as a tuple of the same length as `uniqueUsers`, so
        // `choices[i]` is always present; the explicit undefined guard narrows
        // the noUncheckedIndexedAccess `string | undefined` to `string`. 'omit'
        // means no recorded earlier visit; any ISO string is a real earliest.
        if (choice !== undefined && choice !== 'omit') {
          earliestCheckInByUser[user] = choice
        }
      })
      return earliestCheckInByUser
    })

    return fc.record({
      windowCheckIns: fc.constant(windowCheckIns),
      earliestCheckInByUser: earliestArb,
      redemptions: fc.nat({ max: 1000 }),
      firstGetIssued: fc.nat({ max: 1000 }),
      firstGetConversions: fc.nat({ max: 1000 }),
      shares: fc.nat({ max: 1000 }),
    })
  })
}

// Optional prior-week metrics, to exercise the delta pass alongside the metric
// computation (deltas never affect the conservation invariants).
const priorMetricsArb: fc.Arbitrary<DigestMetrics | null> = fc.option(
  fc.record({
    visits: fc.nat({ max: 1000 }),
    uniqueVisitors: fc.nat({ max: 1000 }),
    firstTimeVisitors: fc.nat({ max: 1000 }),
    returningVisitors: fc.nat({ max: 1000 }),
    redemptions: fc.nat({ max: 1000 }),
    firstGetIssued: fc.nat({ max: 1000 }),
    firstGetConversions: fc.nat({ max: 1000 }),
    shares: fc.nat({ max: 1000 }),
    busiestDay: fc.constantFrom('Monday', 'Friday', 'Sunday', null),
    busiestHour: fc.option(fc.integer({ min: 0, max: 23 }), { nil: null }),
  }),
  { nil: null },
)

const scenarioArb = weekArb.chain((week) =>
  fc.record({
    week: fc.constant(week),
    sources: sourcesArbFor(week),
    priorMetrics: priorMetricsArb,
  }),
)

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: weekly-attribution-digest, Property 2: Metric conservation', () => {
  it('conserves visitor counts and keeps every metric a non-negative integer', () => {
    fc.assert(
      fc.property(scenarioArb, ({ week, sources, priorMetrics }) => {
        const { metrics } = computeDigest(week, sources, SALT, priorMetrics)

        // firstTimeVisitors + returningVisitors === uniqueVisitors.
        expect(metrics.firstTimeVisitors + metrics.returningVisitors).toBe(metrics.uniqueVisitors)

        // uniqueVisitors <= visits.
        expect(metrics.uniqueVisitors).toBeLessThanOrEqual(metrics.visits)

        // Every numeric Attribution_Metric is a non-negative integer.
        for (const name of DIGEST_METRIC_NAMES) {
          const value = metrics[name]
          expect(Number.isInteger(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
        }
      }),
      { numRuns: 200 },
    )
  })
})
