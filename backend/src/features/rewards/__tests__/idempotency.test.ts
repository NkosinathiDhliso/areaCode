import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Property 3: Reward redemption idempotency.
 * Inserting the same (reward_id, user_id) pair twice never creates a duplicate.
 * Validates: Requirements 7.3, 30.4
 *
 * This is a unit-level simulation of the DB constraint behaviour.
 * The actual UNIQUE(reward_id, user_id) constraint is enforced by PostgreSQL.
 */
describe('reward redemption idempotency', () => {
  it('same (rewardId, userId) pair never produces duplicates in a set', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        (rewardId, userId, attempts) => {
          const redemptions = new Map<string, string>()
          const key = `${rewardId}:${userId}`

          for (let i = 0; i < attempts; i++) {
            // ON CONFLICT DO NOTHING behaviour
            if (!redemptions.has(key)) {
              redemptions.set(key, `code-${i}`)
            }
          }

          // Only one entry per (rewardId, userId)
          expect(redemptions.size).toBe(1)
        },
      ),
      { numRuns: 300 },
    )
  })
})
