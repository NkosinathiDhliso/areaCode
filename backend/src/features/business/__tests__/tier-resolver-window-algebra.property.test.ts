import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { getEffectiveTier } from '../service.js'

/**
 * Feature: billing-revenue-integrity, Property 3: Tier_Resolver window algebra.
 *
 * **Validates: Requirements 4.1**
 *
 * For all combinations of `tier`, `trialEndsAt`, `paidUntil`, and
 * `paymentGraceUntil` relative to a fixed `now`:
 *
 *   1. A free/starter stored tier always resolves to `starter`.
 *   2. A paid stored tier (growth/pro/payg) resolves to the stored tier iff at
 *      least one of trialEndsAt / paidUntil / paymentGraceUntil is a future
 *      instant ( > now ); otherwise it resolves to `starter`.
 *   3. The resolver is total: it never throws on any input, including malformed
 *      date strings and junk tier values.
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * `now` is pinned to a fixed millisecond value passed explicitly to
 * `getEffectiveTier`, so window activeness is deterministic and independent of
 * wall-clock. Each of the three window fields is generated independently as one
 * of {absent, null, a past ISO instant, a future ISO instant, a malformed
 * string}, tagged with whether it is a future instant so the expected outcome
 * can be computed by an oracle that mirrors the design's algebra (not the
 * implementation's internals). The tier is drawn from the real tier vocabulary
 * plus junk strings and `undefined` to exercise totality.
 */

// ─── Fixed clock ──────────────────────────────────────────────────────────────

// 2026-06-15T12:00:00.000Z. Any window instant is classified relative to this.
const FIXED_NOW_MS = Date.UTC(2026, 5, 15, 12, 0, 0)

// ─── Arbitraries ────────────────────────────────────────────────────────────

interface WindowField {
  // The value stored on the business row for this window attribute.
  value: string | null | undefined
  // True only when `value` is an ISO instant strictly after FIXED_NOW_MS.
  isFuture: boolean
}

// Past ISO instant: strictly before now (2000-01-01 .. now-1ms).
const pastIsoArb: fc.Arbitrary<string> = fc
  .integer({ min: 946_684_800_000, max: FIXED_NOW_MS - 1 })
  .map((ms) => new Date(ms).toISOString())

// Future ISO instant: strictly after now (now+1ms .. 2100-01-01).
const futureIsoArb: fc.Arbitrary<string> = fc
  .integer({ min: FIXED_NOW_MS + 1, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString())

// Malformed strings that never parse to a valid instant (Date -> NaN), so they
// can never be classified as a future window.
const malformedArb: fc.Arbitrary<string> = fc.constantFrom(
  'not-a-date',
  'garbage',
  '2026-13-45',
  '31/02/2026',
  'true',
  '',
)

const windowFieldArb: fc.Arbitrary<WindowField> = fc.oneof(
  fc.constant<WindowField>({ value: undefined, isFuture: false }),
  fc.constant<WindowField>({ value: null, isFuture: false }),
  pastIsoArb.map<WindowField>((value) => ({ value, isFuture: false })),
  futureIsoArb.map<WindowField>((value) => ({ value, isFuture: true })),
  malformedArb.map<WindowField>((value) => ({ value, isFuture: false })),
)

// Full tier vocabulary plus junk strings and undefined (absent tier).
const anyTierArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constantFrom('growth', 'pro', 'payg'),
  fc.constantFrom('free', 'starter'),
  fc.constantFrom('enterprise', 'GROWTH', 'xyz', '123', ''),
  fc.constant(undefined),
)

const paidTierArb: fc.Arbitrary<string> = fc.constantFrom('growth', 'pro', 'payg')
const freeishTierArb: fc.Arbitrary<string> = fc.constantFrom('free', 'starter')

const RUN = { numRuns: 300 } as const

function buildBiz(
  tier: string | undefined,
  trial: WindowField,
  paid: WindowField,
  grace: WindowField,
): {
  tier?: string
  trialEndsAt?: string | null
  paidUntil?: string | null
  paymentGraceUntil?: string | null
} {
  return {
    tier,
    trialEndsAt: trial.value,
    paidUntil: paid.value,
    paymentGraceUntil: grace.value,
  }
}

describe('Feature: billing-revenue-integrity, Property 3: Tier_Resolver window algebra', () => {
  it('resolves per the window algebra for any tier and window combination (R4.1)', () => {
    fc.assert(
      fc.property(anyTierArb, windowFieldArb, windowFieldArb, windowFieldArb, (tier, trial, paid, grace) => {
        const result = getEffectiveTier(buildBiz(tier, trial, paid, grace), FIXED_NOW_MS)

        const storedTier = tier ?? 'free'
        const isFreeish = storedTier === 'free' || storedTier === 'starter'
        const anyWindowActive = trial.isFuture || paid.isFuture || grace.isFuture
        const expected = isFreeish ? 'starter' : anyWindowActive ? storedTier : 'starter'

        expect(result).toBe(expected)
      }),
      RUN,
    )
  })

  it('free/starter stored tier always resolves to starter regardless of windows', () => {
    fc.assert(
      fc.property(freeishTierArb, windowFieldArb, windowFieldArb, windowFieldArb, (tier, trial, paid, grace) => {
        const result = getEffectiveTier(buildBiz(tier, trial, paid, grace), FIXED_NOW_MS)
        expect(result).toBe('starter')
      }),
      RUN,
    )
  })

  it('paid stored tier resolves the stored tier iff a window is future, else starter', () => {
    fc.assert(
      fc.property(paidTierArb, windowFieldArb, windowFieldArb, windowFieldArb, (tier, trial, paid, grace) => {
        const result = getEffectiveTier(buildBiz(tier, trial, paid, grace), FIXED_NOW_MS)
        const anyWindowActive = trial.isFuture || paid.isFuture || grace.isFuture
        expect(result).toBe(anyWindowActive ? tier : 'starter')
      }),
      RUN,
    )
  })

  it('never throws on any input, including malformed date strings and junk tiers', () => {
    fc.assert(
      fc.property(anyTierArb, windowFieldArb, windowFieldArb, windowFieldArb, (tier, trial, paid, grace) => {
        expect(() => getEffectiveTier(buildBiz(tier, trial, paid, grace), FIXED_NOW_MS)).not.toThrow()
      }),
      RUN,
    )
  })
})
