import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import {
  buildDigestCopy,
  BANNED_CAUSAL_VERBS,
  ZERO_VISITS_NEXT_STEP,
  type DigestData,
  type DigestMetricName,
  type DigestMetrics,
  type DigestDeltas,
} from '../digest'

/**
 * Property 3: Honest copy
 *
 * For any metrics vector (including all-zero), `buildDigestCopy` output
 * contains no causal verb from the banned list, renders no percentage for a
 * metric in `suppressed`, and the zero-visits branch contains exactly one
 * next step and no numeric claims.
 *
 * **Validates: Requirements 2.1, 2.3**
 */

// ─── Arbitraries ────────────────────────────────────────────────────────────

const METRIC_NAMES: DigestMetricName[] = [
  'visits',
  'uniqueVisitors',
  'firstTimeVisitors',
  'returningVisitors',
  'redemptions',
  'firstGetIssued',
  'firstGetConversions',
]

// A non-negative integer count, biased so zero appears often enough to
// exercise the zero-visits branch across the run.
const countArb = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1000 }))

const metricsArb: fc.Arbitrary<DigestMetrics> = fc.record({
  visits: countArb,
  uniqueVisitors: countArb,
  firstTimeVisitors: countArb,
  returningVisitors: countArb,
  redemptions: countArb,
  firstGetIssued: countArb,
  firstGetConversions: countArb,
  busiestDay: fc.option(fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), {
    nil: null,
  }),
  busiestHour: fc.option(fc.integer({ min: 0, max: 23 }), { nil: null }),
})

// Signed week-over-week deltas over a random subset of metrics.
const deltasArb: fc.Arbitrary<DigestDeltas> = fc.subarray(METRIC_NAMES).chain((names) =>
  fc.tuple(...names.map(() => fc.integer({ min: -500, max: 500 }))).map((values) => {
    const deltas: DigestDeltas = {}
    names.forEach((name, i) => {
      deltas[name] = values[i]
    })
    return deltas
  }),
)

const suppressedArb: fc.Arbitrary<DigestMetricName[]> = fc.subarray(METRIC_NAMES)

const digestArb: fc.Arbitrary<DigestData> = fc.record({
  metrics: metricsArb,
  deltas: fc.option(deltasArb, { nil: undefined }),
  suppressed: suppressedArb,
})

// Tier strings: the three real tiers, a lapsed variant, and arbitrary strings.
const tierArb = fc.oneof(fc.constantFrom('starter', 'growth', 'pro', 'lapsed'), fc.string())

// Case-insensitive whole-word matchers for each banned causal verb.
const bannedVerbMatchers = BANNED_CAUSAL_VERBS.map((verb) => new RegExp(`\\b${verb}\\b`, 'i'))

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: weekly-attribution-digest, Property 3: Honest copy', () => {
  it('renders no banned causal verb in any sentence, over the whole input space', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const lines = buildDigestCopy(digest, tier)
        for (const line of lines) {
          for (const matcher of bannedVerbMatchers) {
            expect(matcher.test(line)).toBe(false)
          }
        }
      }),
      { numRuns: 200 },
    )
  })

  it('renders no percentage for a suppressed metric', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const joined = buildDigestCopy(digest, tier).join(' ')
        // The only derived percentage the builder renders is the first-timer
        // share, tied to firstTimeVisitors. When that metric is suppressed, no
        // percentage may appear anywhere; no other metric renders a percentage.
        if (digest.suppressed.includes('firstTimeVisitors')) {
          expect(joined).not.toContain('%')
        }
      }),
      { numRuns: 200 },
    )
  })

  it('zero-visits branch has exactly one next step and no numeric claims', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const zeroDigest: DigestData = {
          ...digest,
          metrics: { ...digest.metrics, visits: 0 },
        }
        const lines = buildDigestCopy(zeroDigest, tier)

        // Exactly one constructive next step, equal to the shared constant.
        const nextSteps = lines.filter((line) => line === ZERO_VISITS_NEXT_STEP)
        expect(nextSteps).toHaveLength(1)

        // No numeric claims: the zero branch must not render padded numbers.
        for (const line of lines) {
          expect(line).not.toMatch(/\d/)
        }
      }),
      { numRuns: 200 },
    )
  })
})
