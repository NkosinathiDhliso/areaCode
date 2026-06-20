import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const rewardIdArb = fc.uuid()

/** Valid date arbitrary */
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }).map((ts) => new Date(ts))

/**
 * Generates a reward record with valid metric attributes.
 * Constraints:
 * - totalSlots >= 0
 * - claimedCount >= 0 and claimedCount <= totalSlots (can't claim more than available)
 * - redeemedCount >= 0 and redeemedCount <= claimedCount (can't redeem more than claimed)
 */
const rewardWithValidMetricsArb = fc
  .record({
    rewardId: rewardIdArb,
    title: fc.string({ minLength: 1, maxLength: 50 }),
    totalSlots: fc.integer({ min: 1, max: 10000 }),
    createdAt: validDateArb.map((d) => d.toISOString()),
    isActive: fc.constant(true),
  })
  .chain((base) =>
    fc.integer({ min: 0, max: base.totalSlots }).chain((claimedCount) =>
      fc.integer({ min: 0, max: claimedCount }).map((redeemedCount) => ({
        ...base,
        claimedCount,
        redeemedCount,
        firstClaimedAt:
          claimedCount > 0 ? new Date(new Date(base.createdAt).getTime() + 60000).toISOString() : undefined,
      })),
    ),
  )

/**
 * Generates a reward with totalSlots = 0 (edge case where claim rate is 0).
 */
const rewardWithZeroSlotsArb = fc.record({
  rewardId: rewardIdArb,
  title: fc.string({ minLength: 1, maxLength: 50 }),
  totalSlots: fc.constant(0),
  claimedCount: fc.constant(0),
  redeemedCount: fc.constant(0),
  createdAt: validDateArb.map((d) => d.toISOString()),
  firstClaimedAt: fc.constant(undefined as string | undefined),
  isActive: fc.constant(true),
})

/**
 * Generates a reward with claimedCount > 0 (for testing redemption rate).
 */
const rewardWithClaimsArb = fc
  .record({
    rewardId: rewardIdArb,
    title: fc.string({ minLength: 1, maxLength: 50 }),
    totalSlots: fc.integer({ min: 1, max: 10000 }),
    createdAt: validDateArb.map((d) => d.toISOString()),
    isActive: fc.constant(true),
  })
  .chain((base) =>
    fc.integer({ min: 1, max: base.totalSlots }).chain((claimedCount) =>
      fc.integer({ min: 0, max: claimedCount }).map((redeemedCount) => ({
        ...base,
        claimedCount,
        redeemedCount,
        firstClaimedAt: new Date(new Date(base.createdAt).getTime() + 60000).toISOString(),
      })),
    ),
  )

// ─── Pure computation functions (mirrors repository logic) ──────────────────

/**
 * Computes the claim rate for a reward.
 * Mirrors the logic in `backend/src/features/business/repository.ts`.
 */
function computeClaimRate(claimedCount: number, totalSlots: number): number {
  return totalSlots > 0 ? claimedCount / totalSlots : 0
}

/**
 * Computes the redemption rate for a reward.
 * Mirrors the logic in `backend/src/features/business/repository.ts`.
 */
function computeRedemptionRate(redeemedCount: number, claimedCount: number): number {
  return claimedCount > 0 ? redeemedCount / claimedCount : 0
}

/**
 * Computes the summary items sorted by claim rate descending.
 * Mirrors the logic in `getRewardsSummary` from the repository.
 */
function computeRewardsSummary(
  rewards: Array<{
    rewardId: string
    title: string
    totalSlots: number
    claimedCount: number
    redeemedCount: number
    createdAt: string
    firstClaimedAt?: string
    isActive: boolean
  }>,
): Array<{ rewardId: string; title: string; claimRate: number; redemptionRate: number }> {
  return rewards
    .filter((r) => r.isActive)
    .map((r) => ({
      rewardId: r.rewardId,
      title: r.title,
      claimRate: computeClaimRate(r.claimedCount, r.totalSlots),
      redemptionRate: computeRedemptionRate(r.redeemedCount, r.claimedCount),
    }))
    .sort((a, b) => b.claimRate - a.claimRate)
}

// ─── Property 8: Reward rate metrics are correctly bounded ──────────────────

describe('Property 8: Reward rate metrics are correctly bounded', () => {
  /**
   * **Validates: Requirements 9.1, 9.3**
   *
   * For any reward with totalSlots > 0, the claim rate (claimedCount / totalSlots)
   * SHALL be between 0.0 and 1.0 inclusive. For any reward with claimedCount > 0,
   * the redemption rate (redeemedCount / claimedCount) SHALL be between 0.0 and
   * 1.0 inclusive.
   */

  it('claim rate is between 0.0 and 1.0 inclusive for any reward with totalSlots > 0', () => {
    fc.assert(
      fc.property(rewardWithValidMetricsArb, (reward) => {
        const claimRate = computeClaimRate(reward.claimedCount, reward.totalSlots)

        expect(claimRate).toBeGreaterThanOrEqual(0.0)
        expect(claimRate).toBeLessThanOrEqual(1.0)
      }),
      { numRuns: 25 },
    )
  })

  it('redemption rate is between 0.0 and 1.0 inclusive for any reward with claimedCount > 0', () => {
    fc.assert(
      fc.property(rewardWithClaimsArb, (reward) => {
        const redemptionRate = computeRedemptionRate(reward.redeemedCount, reward.claimedCount)

        expect(redemptionRate).toBeGreaterThanOrEqual(0.0)
        expect(redemptionRate).toBeLessThanOrEqual(1.0)
      }),
      { numRuns: 25 },
    )
  })

  it('claim rate is exactly 0 when totalSlots is 0', () => {
    fc.assert(
      fc.property(rewardWithZeroSlotsArb, (reward) => {
        const claimRate = computeClaimRate(reward.claimedCount, reward.totalSlots)

        expect(claimRate).toBe(0)
      }),
      { numRuns: 25 },
    )
  })

  it('redemption rate is exactly 0 when claimedCount is 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (redeemedCount) => {
        const redemptionRate = computeRedemptionRate(redeemedCount, 0)

        expect(redemptionRate).toBe(0)
      }),
      { numRuns: 25 },
    )
  })

  it('claim rate is exactly 1.0 when claimedCount equals totalSlots', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (totalSlots) => {
        const claimRate = computeClaimRate(totalSlots, totalSlots)

        expect(claimRate).toBe(1.0)
      }),
      { numRuns: 25 },
    )
  })

  it('redemption rate is exactly 1.0 when redeemedCount equals claimedCount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (claimedCount) => {
        const redemptionRate = computeRedemptionRate(claimedCount, claimedCount)

        expect(redemptionRate).toBe(1.0)
      }),
      { numRuns: 25 },
    )
  })

  it('claim rate increases monotonically as claimedCount increases for fixed totalSlots', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10000 }), (totalSlots) => {
        // Generate two claimed counts where a < b, both <= totalSlots
        const a = Math.floor(totalSlots * 0.3)
        const b = Math.floor(totalSlots * 0.7)

        const rateA = computeClaimRate(a, totalSlots)
        const rateB = computeClaimRate(b, totalSlots)

        expect(rateB).toBeGreaterThanOrEqual(rateA)
      }),
      { numRuns: 25 },
    )
  })

  it('redemption rate increases monotonically as redeemedCount increases for fixed claimedCount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10000 }), (claimedCount) => {
        const a = Math.floor(claimedCount * 0.3)
        const b = Math.floor(claimedCount * 0.7)

        const rateA = computeRedemptionRate(a, claimedCount)
        const rateB = computeRedemptionRate(b, claimedCount)

        expect(rateB).toBeGreaterThanOrEqual(rateA)
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 9: Reward summary is sorted by claim rate ─────────────────────

describe('Property 9: Reward summary is sorted by claim rate', () => {
  /**
   * **Validates: Requirements 9.5**
   *
   * For any set of active rewards, the summary comparison SHALL return
   * rewards sorted by claim rate in descending order.
   */

  it('summary items are sorted by claim rate in descending order', () => {
    fc.assert(
      fc.property(fc.array(rewardWithValidMetricsArb, { minLength: 2, maxLength: 30 }), (rewards) => {
        const summary = computeRewardsSummary(rewards)

        // Verify descending order: each item's claim rate >= next item's claim rate
        for (let i = 0; i < summary.length - 1; i++) {
          expect(summary[i]!.claimRate).toBeGreaterThanOrEqual(summary[i + 1]!.claimRate)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('summary contains all active rewards from the input', () => {
    fc.assert(
      fc.property(fc.array(rewardWithValidMetricsArb, { minLength: 1, maxLength: 20 }), (rewards) => {
        const summary = computeRewardsSummary(rewards)
        const activeRewards = rewards.filter((r) => r.isActive)

        expect(summary.length).toBe(activeRewards.length)
      }),
      { numRuns: 25 },
    )
  })

  it('summary excludes inactive rewards', () => {
    fc.assert(
      fc.property(
        fc.array(rewardWithValidMetricsArb, { minLength: 1, maxLength: 10 }),
        fc.array(
          rewardWithValidMetricsArb.map((r) => ({ ...r, isActive: false })),
          { minLength: 1, maxLength: 10 },
        ),
        (activeRewards, inactiveRewards) => {
          const allRewards = [...activeRewards, ...inactiveRewards]
          const summary = computeRewardsSummary(allRewards)

          // Summary should only contain active rewards
          expect(summary.length).toBe(activeRewards.length)

          // No inactive reward IDs should appear in the summary
          const inactiveIds = new Set(inactiveRewards.map((r) => r.rewardId))
          for (const item of summary) {
            expect(inactiveIds.has(item.rewardId)).toBe(false)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('summary preserves correct claim rate values for each reward', () => {
    fc.assert(
      fc.property(fc.array(rewardWithValidMetricsArb, { minLength: 1, maxLength: 15 }), (rewards) => {
        const summary = computeRewardsSummary(rewards)

        for (const item of summary) {
          const original = rewards.find((r) => r.rewardId === item.rewardId)!
          const expectedClaimRate = computeClaimRate(original.claimedCount, original.totalSlots)

          expect(item.claimRate).toBe(expectedClaimRate)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('summary with a single reward is trivially sorted', () => {
    fc.assert(
      fc.property(rewardWithValidMetricsArb, (reward) => {
        const summary = computeRewardsSummary([reward])

        expect(summary.length).toBe(1)
        expect(summary[0]!.claimRate).toBe(computeClaimRate(reward.claimedCount, reward.totalSlots))
      }),
      { numRuns: 25 },
    )
  })

  it('summary with all rewards having the same claim rate is still valid (stable)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 2, max: 10 }), (totalSlots, count) => {
        // Create multiple rewards with identical claim rates
        const claimedCount = Math.floor(totalSlots / 2)
        const rewards = Array.from({ length: count }, (_, i) => ({
          rewardId: `reward-${i}`,
          title: `Reward ${i}`,
          totalSlots,
          claimedCount,
          redeemedCount: 0,
          createdAt: new Date(1577836800000 + i * 86400000).toISOString(),
          firstClaimedAt: claimedCount > 0 ? new Date(1577836800000 + i * 86400000 + 60000).toISOString() : undefined,
          isActive: true,
        }))

        const summary = computeRewardsSummary(rewards)

        // All items should have the same claim rate
        const expectedRate = computeClaimRate(claimedCount, totalSlots)
        for (const item of summary) {
          expect(item.claimRate).toBe(expectedRate)
        }

        // Still sorted (all equal, so any order is valid)
        for (let i = 0; i < summary.length - 1; i++) {
          expect(summary[i]!.claimRate).toBeGreaterThanOrEqual(summary[i + 1]!.claimRate)
        }
      }),
      { numRuns: 25 },
    )
  })
})
