import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { mapReward } from '../dynamodb-repository.js'
import { isVisibleInFeed, isClaimEligible } from '../lifecycle.js'
import { decideMint, type GuardState } from '../repeat-policy.js'

/**
 * Event & Offer Gets — backwards-compatibility property test.
 *
 * Covers Property 5 (Backwards compatibility) from the design doc. A `Reward`
 * row serialized BEFORE this feature has no `getCategory` attribute. The read
 * mapper (`mapReward`) must normalise it to `loyalty` (R1.1, R7.1), and the
 * normalised row must yield exactly the same feed/claim decisions as an
 * explicit pre-feature loyalty row with the same other fields (R7.2).
 *
 * **Validates: Requirements 1.1, 7.1, 7.2**
 */

// ─── Generation helpers ─────────────────────────────────────────────────────

const EPOCH_MIN = Date.parse('2000-01-01T00:00:00.000Z')
const EPOCH_MAX = Date.parse('2100-01-01T00:00:00.000Z')

const epochMsArb = fc.integer({ min: EPOCH_MIN, max: EPOCH_MAX })
const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * A legacy `Reward` row exactly as it would be persisted before this feature:
 * the loyalty fields only, with NO `getCategory`, `startsAt`, `endsAt`, or
 * `claimRequiresCheckIn` attribute.
 */
const legacyRowArb = fc
  .record({
    rewardId: fc.uuid(),
    nodeId: fc.uuid(),
    type: fc.constantFrom('nth_checkin', 'daily_first', 'streak', 'milestone'),
    title: fc.string({ minLength: 1, maxLength: 100 }),
    claimedCount: fc.nat({ max: 1000 }),
    slotsLocked: fc.boolean(),
    isActive: fc.boolean(),
    createdAt: epochMsArb.map(iso),
    updatedAt: epochMsArb.map(iso),
  })
  .map((row) => ({ ...row, id: row.rewardId }))

describe('Feature: event-and-offer-gets, Property 5: Backwards compatibility', () => {
  it('normalises a row serialized without getCategory to loyalty', () => {
    fc.assert(
      fc.property(legacyRowArb, (legacyRow) => {
        // The raw row genuinely lacks the attribute (R7.1 precondition).
        expect('getCategory' in legacyRow).toBe(false)

        const mapped = mapReward(legacyRow)
        expect(mapped.getCategory).toBe('loyalty')
      }),
    )
  })

  it('yields the same feed decision as an explicit pre-feature loyalty row', () => {
    fc.assert(
      fc.property(legacyRowArb, epochMsArb, (legacyRow, nowMs) => {
        const mapped = mapReward(legacyRow)

        // Decision for the normalised legacy row.
        const legacyVisible = isVisibleInFeed(
          { getCategory: mapped.getCategory, startsAt: mapped.startsAt, endsAt: mapped.endsAt },
          nowMs,
        )

        // Decision for an explicit loyalty row with the same (windowless) fields.
        const explicitVisible = isVisibleInFeed({ getCategory: 'loyalty' }, nowMs)

        // Both must be visible (loyalty always passes the lifecycle gate) and
        // must agree (R7.2).
        expect(legacyVisible).toBe(explicitVisible)
        expect(legacyVisible).toBe(true)
      }),
    )
  })

  it('yields the same claim decision as an explicit pre-feature loyalty row', () => {
    fc.assert(
      fc.property(
        legacyRowArb,
        fc.constantFrom('upcoming', 'live', 'ended') as fc.Arbitrary<'upcoming' | 'live' | 'ended'>,
        fc.boolean(),
        fc.boolean(),
        (legacyRow, lifecycle, claimRequiresCheckIn, hasQualifyingCheckIn) => {
          const mapped = mapReward(legacyRow)

          const legacyDecision = isClaimEligible({
            getCategory: mapped.getCategory ?? 'loyalty',
            claimRequiresCheckIn,
            lifecycle,
            hasQualifyingCheckIn,
          })

          const explicitDecision = isClaimEligible({
            getCategory: 'loyalty',
            claimRequiresCheckIn,
            lifecycle,
            hasQualifyingCheckIn,
          })

          // Loyalty is always eligible at this gate, and the normalised legacy
          // row must match the explicit loyalty row exactly (R1.1, R7.2).
          expect(legacyDecision).toEqual(explicitDecision)
          expect(legacyDecision).toEqual({ eligible: true })
        },
      ),
    )
  })
})

// ─── Loyalty Repeat Redemption — Property 5: missing repeatPolicy reads as once ─

/**
 * A `Reward` row serialized before Loyalty Repeat Redemption also lacks a
 * `repeatPolicy` attribute. The read model must surface such a row as `once`
 * (R1.1, R7.1) so an existing loyalty get stops repeating implicitly, and a
 * Claim_Guard row without a redemption stamp must decide mints exactly as an
 * explicit `once` reward does (R2.7).
 *
 * **Validates: Requirements 1.1, 2.7, 7.1**
 */

/** A Claim_Guard state as `decideMint` consumes it: expiry always present, an
 *  optional redemption stamp. `null` models "no guard row yet". */
const guardStateArb = fc.option(
  fc.record({
    codeExpiresAt: epochMsArb.map(iso),
    redeemedAt: fc.option(epochMsArb.map(iso), { nil: undefined }),
  }),
  { nil: null },
) as fc.Arbitrary<GuardState | null>

describe('Feature: loyalty-repeat-redemption, Property 5: Backwards compatibility', () => {
  it('normalises a row serialized without repeatPolicy to once', () => {
    fc.assert(
      fc.property(legacyRowArb, (legacyRow) => {
        // The raw row genuinely lacks the attribute on disk (R7.1 precondition,
        // no backfill): the read mapper is what surfaces the default.
        expect('repeatPolicy' in legacyRow).toBe(false)

        const mapped = mapReward(legacyRow)
        // The read model surfaces `once` so callers never observe `undefined`
        // and the legacy get stops repeating implicitly (R1.1, R1.2).
        expect(mapped.repeatPolicy).toBe('once')
      }),
    )
  })

  it('decides mints for a missing-policy row exactly as an explicit once reward (R1.1, R2.7)', () => {
    fc.assert(
      fc.property(legacyRowArb, guardStateArb, epochMsArb, (legacyRow, guard, nowMs) => {
        const resolved = mapReward(legacyRow).repeatPolicy ?? 'once'

        // The absent policy resolves to `once`, so its mint decision over any
        // guard state (including legacy stamp-less rows, R2.7) and any clock
        // must match an explicit `once` reward exactly.
        expect(decideMint(resolved, guard, nowMs)).toEqual(decideMint('once', guard, nowMs))
      }),
    )
  })
})
