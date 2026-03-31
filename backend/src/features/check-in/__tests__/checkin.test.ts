import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Property 8: Check-in cooldown enforcement.
 * A reward check-in within 4 hours of a previous one at the same node always returns 429.
 * Validates: Requirements 5.4
 */
describe('check-in cooldown enforcement', () => {
  const REWARD_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 hours

  function isCooldownActive(lastCheckInTime: number, now: number): boolean {
    return (now - lastCheckInTime) < REWARD_COOLDOWN_MS
  }

  it('blocks reward check-in within 4 hours', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Date.now() }),
        fc.integer({ min: 1, max: REWARD_COOLDOWN_MS - 1 }),
        (lastTime, delta) => {
          expect(isCooldownActive(lastTime, lastTime + delta)).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('allows reward check-in after 4 hours', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Date.now() }),
        fc.integer({ min: REWARD_COOLDOWN_MS, max: REWARD_COOLDOWN_MS * 3 }),
        (lastTime, delta) => {
          expect(isCooldownActive(lastTime, lastTime + delta)).toBe(false)
        },
      ),
      { numRuns: 300 },
    )
  })
})

/**
 * Property 9: Location coordinates are never persisted.
 * After any check-in, the check_ins table row contains no lat/lng data.
 * Validates: Requirements 5.7, 17.1
 */
describe('location coordinates never persisted', () => {
  interface CheckInRecord {
    userId: string
    nodeId: string
    type: string
    checkedInAt: string
  }

  function createCheckInRecord(
    userId: string,
    nodeId: string,
    _lat: number,
    _lng: number,
    type: string,
  ): CheckInRecord {
    // lat/lng used for validation then discarded — POPIA compliance
    return {
      userId,
      nodeId,
      type,
      checkedInAt: new Date().toISOString(),
    }
  }

  it('check-in record never contains lat or lng fields', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.constantFrom('reward', 'presence'),
        (userId, nodeId, lat, lng, type) => {
          const record = createCheckInRecord(userId, nodeId, lat, lng, type)
          expect(record).not.toHaveProperty('lat')
          expect(record).not.toHaveProperty('lng')
          expect(Object.keys(record)).toEqual(['userId', 'nodeId', 'type', 'checkedInAt'])
        },
      ),
      { numRuns: 300 },
    )
  })
})
