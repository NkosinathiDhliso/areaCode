import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { mapReward } from '../dynamodb-repository.js'
import { isVisibleInFeed, isClaimEligible } from '../lifecycle.js'

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
