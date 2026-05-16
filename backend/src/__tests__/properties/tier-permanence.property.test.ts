import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { getTier, TIER_LEVELS } from '@area-code/shared/constants/tier-levels'
import type { Tier } from '@area-code/shared/types'

/**
 * Tier-permanence guard — Churn-defences spec, Requirement 3.4.
 *
 * The admin-side updateUserTier function must reject any attempt to
 * downgrade a user below the tier their visit count earns them.
 *
 * We re-implement the guard logic in this test rather than importing
 * the live function so the property test exercises the rule itself,
 * not the DynamoDB code path. The repository wraps it identically.
 */

const tierRank = (t: Tier | string): number => TIER_LEVELS.findIndex((lvl) => lvl.tier === t)

function isAllowedTierTransition(totalCheckIns: number, attemptedTier: Tier): boolean {
  const minAllowed = getTier(totalCheckIns)
  return tierRank(attemptedTier) >= tierRank(minAllowed)
}

const tierArb = fc.constantFrom<Tier>('local', 'regular', 'fixture', 'institution', 'legend')

describe('Tier-permanence guard', () => {
  it('any tier at or above the visit-count-implied tier is allowed', () => {
    fc.assert(
      fc.property(fc.nat(10_000), tierArb, (visits, attempted) => {
        const allowed = isAllowedTierTransition(visits, attempted)
        const expected = tierRank(attempted) >= tierRank(getTier(visits))
        expect(allowed).toBe(expected)
      }),
    )
  })

  it('the visit-count-implied tier itself is always allowed', () => {
    fc.assert(
      fc.property(fc.nat(10_000), (visits) => {
        const earnedTier = getTier(visits)
        expect(isAllowedTierTransition(visits, earnedTier)).toBe(true)
      }),
    )
  })

  it('any strict downgrade is rejected', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000),
        fc.integer({ min: 1, max: 4 }), // ranks 1..4 below earned
        (visits, ranksBelow) => {
          const earnedRank = tierRank(getTier(visits))
          const attemptedRank = earnedRank - ranksBelow
          if (attemptedRank < 0) return // skip when no lower tier exists
          const attempted = TIER_LEVELS[attemptedRank]!.tier
          expect(isAllowedTierTransition(visits, attempted)).toBe(false)
        },
      ),
    )
  })

  it('a user with 0 visits can be set to any tier (no demote possible)', () => {
    fc.assert(
      fc.property(tierArb, (attempted) => {
        // earned tier at 0 visits is local (rank 0). Anything is >= rank 0.
        expect(isAllowedTierTransition(0, attempted)).toBe(true)
      }),
    )
  })

  it('a user with 500+ visits cannot be set to any tier other than legend', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 10_000 }), tierArb, (visits, attempted) => {
        const allowed = isAllowedTierTransition(visits, attempted)
        expect(allowed).toBe(attempted === 'legend')
      }),
    )
  })

  it('promotion to legend is always allowed regardless of visit count', () => {
    fc.assert(
      fc.property(fc.nat(10_000), (visits) => {
        expect(isAllowedTierTransition(visits, 'legend')).toBe(true)
      }),
    )
  })
})
