import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  checkinCooldownReward,
  checkinCooldownPresence,
  checkinToday,
  userConsent,
  leaderboard,
  nodesPulse,
  rateLimit,
  toastSurgeSeen,
} from '../keys'

/**
 * Property 4: Redis key uniqueness.
 * Different input combinations always produce different key strings.
 * Validates: Requirements 18.11
 */
describe('Redis key helpers', () => {
  const uuidArb = fc.uuid()

  it('checkinCooldownReward produces unique keys for different inputs', () => {
    fc.assert(
      fc.property(uuidArb, uuidArb, uuidArb, uuidArb, (u1, n1, u2, n2) => {
        if (u1 === u2 && n1 === n2) return true // same inputs → same key is fine
        expect(checkinCooldownReward(u1, n1)).not.toBe(checkinCooldownReward(u2, n2))
        return true
      }),
      { numRuns: 300 },
    )
  })

  it('reward and presence cooldown keys never collide', () => {
    fc.assert(
      fc.property(uuidArb, uuidArb, (userId, nodeId) => {
        expect(checkinCooldownReward(userId, nodeId))
          .not.toBe(checkinCooldownPresence(userId, nodeId))
      }),
      { numRuns: 200 },
    )
  })

  it('different key functions never produce the same string', () => {
    fc.assert(
      fc.property(uuidArb, (id) => {
        const keys = [
          checkinToday(id),
          userConsent(id),
          leaderboard(id),
          nodesPulse(id),
        ]
        const unique = new Set(keys)
        expect(unique.size).toBe(keys.length)
      }),
      { numRuns: 200 },
    )
  })

  it('rateLimit keys include both key and identifier', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (key, id) => {
          const result = rateLimit(key, id)
          expect(result).toContain(key)
          expect(result).toContain(id)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('toastSurgeSeen includes both userId and nodeId', () => {
    fc.assert(
      fc.property(uuidArb, uuidArb, (userId, nodeId) => {
        const key = toastSurgeSeen(userId, nodeId)
        expect(key).toContain(userId)
        expect(key).toContain(nodeId)
      }),
      { numRuns: 200 },
    )
  })
})
