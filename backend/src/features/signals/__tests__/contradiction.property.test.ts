/**
 * Property Tests for Contradiction Detection (Property 15)
 *
 * Property 15: For any signal where 3+ existing reports from different users
 * agree on a different value, flag as contradiction. Fewer than 3 → no flag.
 *
 * **Validates: Requirements 10.2**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { detectContradiction } from '../service'
import { MUSIC_GENRES, QUEUE_VALUES } from '../types'
import type { SignalRecord } from '../types'

// ============================================================================
// Custom Arbitraries
// ============================================================================

/** Arbitrary for a valid genre value */
const genreArb = fc.constantFrom(...MUSIC_GENRES)

/** Arbitrary for a valid queue value */
const queueValueArb = fc.constantFrom(...QUEUE_VALUES)

/** Arbitrary for any valid signal value */
const signalValueArb = fc.oneof(genreArb, queueValueArb)

/**
 * Helper: creates a minimal SignalRecord for contradiction testing.
 */
function makeSignal(opts: {
  userId: string
  value: string
  nodeId?: string
}): SignalRecord {
  return {
    signalId: `sig-${opts.userId}`,
    nodeId: opts.nodeId ?? 'node-1',
    userId: opts.userId,
    type: 'genre_playing',
    value: opts.value,
    reporterWeight: 1.0,
    isProximity: false,
    isOwner: false,
    createdAt: new Date().toISOString(),
  }
}

// ============================================================================
// Property 15: Contradiction Detection
// ============================================================================

describe('Feature: venue-live-signals, Property 15: Contradiction Detection', () => {
  /**
   * **Validates: Requirements 10.2**
   *
   * For any signal submission where 3 or more existing reports from different
   * users agree on a different value for the same node and type, the new signal
   * SHALL be flagged as a contradiction. When fewer than 3 reports agree on a
   * different value, the signal SHALL NOT be flagged.
   */

  describe('3+ different users agreeing on a different value triggers contradiction', () => {
    it('flags contradiction when exactly 3 different users agree on a different value', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          signalValueArb,
          signalValueArb,
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          (nodeId, newValue, existingValue, newUserId, user1, user2, user3) => {
            // Ensure the new value differs from the existing consensus value
            fc.pre(newValue !== existingValue)
            // Ensure all users are different
            fc.pre(new Set([newUserId, user1, user2, user3]).size === 4)

            const newSignal = { value: newValue, userId: newUserId }
            const existingSignals: SignalRecord[] = [
              makeSignal({ userId: user1, value: existingValue, nodeId }),
              makeSignal({ userId: user2, value: existingValue, nodeId }),
              makeSignal({ userId: user3, value: existingValue, nodeId }),
            ]

            const result = detectContradiction(newSignal, existingSignals)
            expect(result).toBe(true)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('flags contradiction when more than 3 different users agree on a different value', () => {
      fc.assert(
        fc.property(
          signalValueArb,
          signalValueArb,
          fc.uuid(),
          fc.array(fc.uuid(), { minLength: 3, maxLength: 10 }),
          (newValue, existingValue, newUserId, existingUserIds) => {
            // Ensure the new value differs from the existing consensus value
            fc.pre(newValue !== existingValue)
            // Ensure all users are unique and different from the new user
            const allUsers = new Set([newUserId, ...existingUserIds])
            fc.pre(allUsers.size === existingUserIds.length + 1)

            const newSignal = { value: newValue, userId: newUserId }
            const existingSignals: SignalRecord[] = existingUserIds.map((uid) =>
              makeSignal({ userId: uid, value: existingValue }),
            )

            const result = detectContradiction(newSignal, existingSignals)
            expect(result).toBe(true)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('fewer than 3 agreeing users does NOT trigger contradiction', () => {
    it('does not flag when only 1 user reports a different value', () => {
      fc.assert(
        fc.property(
          signalValueArb,
          signalValueArb,
          fc.uuid(),
          fc.uuid(),
          (newValue, existingValue, newUserId, user1) => {
            fc.pre(newValue !== existingValue)
            fc.pre(newUserId !== user1)

            const newSignal = { value: newValue, userId: newUserId }
            const existingSignals: SignalRecord[] = [
              makeSignal({ userId: user1, value: existingValue }),
            ]

            const result = detectContradiction(newSignal, existingSignals)
            expect(result).toBe(false)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('does not flag when only 2 users report a different value', () => {
      fc.assert(
        fc.property(
          signalValueArb,
          signalValueArb,
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          (newValue, existingValue, newUserId, user1, user2) => {
            fc.pre(newValue !== existingValue)
            fc.pre(new Set([newUserId, user1, user2]).size === 3)

            const newSignal = { value: newValue, userId: newUserId }
            const existingSignals: SignalRecord[] = [
              makeSignal({ userId: user1, value: existingValue }),
              makeSignal({ userId: user2, value: existingValue }),
            ]

            const result = detectContradiction(newSignal, existingSignals)
            expect(result).toBe(false)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('does not flag when no existing signals exist', () => {
      fc.assert(
        fc.property(
          signalValueArb,
          fc.uuid(),
          (newValue, newUserId) => {
            const newSignal = { value: newValue, userId: newUserId }
            const result = detectContradiction(newSignal, [])
            expect(result).toBe(false)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('same value does not trigger contradiction', () => {
    it('does not flag when existing signals agree with the new signal value', () => {
      fc.assert(
        fc.property(
          signalValueArb,
          fc.uuid(),
          fc.array(fc.uuid(), { minLength: 3, maxLength: 10 }),
          (value, newUserId, existingUserIds) => {
            // All users unique and different from new user
            const allUsers = new Set([newUserId, ...existingUserIds])
            fc.pre(allUsers.size === existingUserIds.length + 1)

            const newSignal = { value, userId: newUserId }
            // All existing signals have the SAME value as the new signal
            const existingSignals: SignalRecord[] = existingUserIds.map((uid) =>
              makeSignal({ userId: uid, value }),
            )

            const result = detectContradiction(newSignal, existingSignals)
            expect(result).toBe(false)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('signals from the same user as the new signal are excluded', () => {
    it('does not count signals from the new signal user toward the threshold', () => {
      fc.assert(
        fc.property(
          signalValueArb,
          signalValueArb,
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          (newValue, existingValue, newUserId, user1, user2) => {
            fc.pre(newValue !== existingValue)
            fc.pre(new Set([newUserId, user1, user2]).size === 3)

            const newSignal = { value: newValue, userId: newUserId }
            // Only 2 different users + the new user's own signal (should be excluded)
            const existingSignals: SignalRecord[] = [
              makeSignal({ userId: user1, value: existingValue }),
              makeSignal({ userId: user2, value: existingValue }),
              makeSignal({ userId: newUserId, value: existingValue }), // same user as new signal
            ]

            const result = detectContradiction(newSignal, existingSignals)
            // Should NOT flag because the new user's signal is excluded,
            // leaving only 2 different users
            expect(result).toBe(false)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('duplicate signals from the same user count as one', () => {
    it('multiple signals from the same user count as one unique user', () => {
      fc.assert(
        fc.property(
          signalValueArb,
          signalValueArb,
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          (newValue, existingValue, newUserId, user1, user2) => {
            fc.pre(newValue !== existingValue)
            fc.pre(new Set([newUserId, user1, user2]).size === 3)

            const newSignal = { value: newValue, userId: newUserId }
            // user1 reports multiple times, user2 reports once = only 2 unique users
            const existingSignals: SignalRecord[] = [
              makeSignal({ userId: user1, value: existingValue }),
              makeSignal({ userId: user1, value: existingValue }),
              makeSignal({ userId: user1, value: existingValue }),
              makeSignal({ userId: user2, value: existingValue }),
            ]

            const result = detectContradiction(newSignal, existingSignals)
            // Only 2 unique users, so no contradiction
            expect(result).toBe(false)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})
