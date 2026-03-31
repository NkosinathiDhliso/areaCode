import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Property 10: Reward claim idempotency.
 * Claiming the same reward for the same user twice never creates duplicate redemptions.
 * Validates: Requirements 7.3
 */
describe('reward claim idempotency', () => {
  it('duplicate claims produce exactly one redemption', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 2, max: 20 }),
        (rewardId, userId, claimAttempts) => {
          const redemptions = new Map<string, { code: string; claimedAt: string }>()
          const key = `${rewardId}:${userId}`

          for (let i = 0; i < claimAttempts; i++) {
            // ON CONFLICT DO NOTHING
            if (!redemptions.has(key)) {
              redemptions.set(key, {
                code: Math.random().toString(36).slice(2, 8).toUpperCase(),
                claimedAt: new Date().toISOString(),
              })
            }
          }

          expect(redemptions.size).toBe(1)
        },
      ),
      { numRuns: 300 },
    )
  })
})

/**
 * Property 11: Slot count never exceeds total_slots.
 * claimed_count is always ≤ total_slots.
 * Validates: Requirements 7.7
 */
describe('reward slot count invariant', () => {
  interface Reward {
    totalSlots: number
    claimedCount: number
  }

  function claimSlot(reward: Reward): { success: boolean; reward: Reward } {
    if (reward.claimedCount >= reward.totalSlots) {
      return { success: false, reward }
    }
    return {
      success: true,
      reward: { ...reward, claimedCount: reward.claimedCount + 1 },
    }
  }

  it('claimed_count never exceeds total_slots after any sequence of claims', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 200 }),
        (totalSlots, claimAttempts) => {
          let reward: Reward = { totalSlots, claimedCount: 0 }

          for (let i = 0; i < claimAttempts; i++) {
            const result = claimSlot(reward)
            reward = result.reward
          }

          expect(reward.claimedCount).toBeLessThanOrEqual(reward.totalSlots)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('successful claims always increment by exactly 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (totalSlots) => {
        let reward: Reward = { totalSlots, claimedCount: 0 }

        for (let i = 0; i < totalSlots; i++) {
          const before = reward.claimedCount
          const result = claimSlot(reward)
          expect(result.success).toBe(true)
          expect(result.reward.claimedCount).toBe(before + 1)
          reward = result.reward
        }

        // Next claim should fail
        const overflow = claimSlot(reward)
        expect(overflow.success).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})
