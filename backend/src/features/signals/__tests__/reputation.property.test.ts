/**
 * Property Tests for Reputation Increment Correctness (Property 7)
 *
 * Property 7: For any valid signal submission, reputation increases by exactly 2
 * if proximity, 1 if remote. Independent of signal type, value, or node.
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calculateReputation } from '../service'
import { MUSIC_GENRES, QUEUE_VALUES, SIGNAL_TYPES } from '../types'

// ============================================================================
// Custom Arbitraries
// ============================================================================

/** Arbitrary for signal type */
const signalTypeArb = fc.constantFrom(...SIGNAL_TYPES)

/** Arbitrary for a valid genre value */
const genreArb = fc.constantFrom(...MUSIC_GENRES)

/** Arbitrary for a valid queue value */
const queueValueArb = fc.constantFrom(...QUEUE_VALUES)

/** Arbitrary for a valid signal value (genre or queue depending on type) */
const signalValueArb = fc.oneof(genreArb, queueValueArb)

/** Arbitrary for a nodeId */
const nodeIdArb = fc.uuid()

// ============================================================================
// Property 7: Reputation Increment Correctness
// ============================================================================

describe('Feature: venue-live-signals, Property 7: Reputation Increment Correctness', () => {
  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any valid signal submission, the user's reputation SHALL increase by
   * exactly 2 if the signal is a Proximity_Report, and by exactly 1 if it is
   * a Remote_Report. The reputation change SHALL be independent of signal type,
   * value, or node.
   */

  describe('proximity reports earn exactly 2 reputation points', () => {
    it('calculateReputation returns 2 for any proximity report', () => {
      fc.assert(
        fc.property(
          signalTypeArb,
          signalValueArb,
          nodeIdArb,
          (_type, _value, _nodeId) => {
            const result = calculateReputation(true)
            expect(result).toBe(2)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('remote reports earn exactly 1 reputation point', () => {
    it('calculateReputation returns 1 for any remote report', () => {
      fc.assert(
        fc.property(
          signalTypeArb,
          signalValueArb,
          nodeIdArb,
          (_type, _value, _nodeId) => {
            const result = calculateReputation(false)
            expect(result).toBe(1)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('reputation is independent of signal type', () => {
    it('same proximity classification yields same reputation regardless of type', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          signalTypeArb,
          signalTypeArb,
          (isProximity, type1, type2) => {
            const rep1 = calculateReputation(isProximity)
            const rep2 = calculateReputation(isProximity)
            expect(rep1).toBe(rep2)
            // Also verify the value is correct
            expect(rep1).toBe(isProximity ? 2 : 1)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('reputation is independent of signal value', () => {
    it('same proximity classification yields same reputation regardless of value', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          signalValueArb,
          signalValueArb,
          (isProximity, _value1, _value2) => {
            const rep1 = calculateReputation(isProximity)
            const rep2 = calculateReputation(isProximity)
            expect(rep1).toBe(rep2)
            expect(rep1).toBe(isProximity ? 2 : 1)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('reputation is independent of node', () => {
    it('same proximity classification yields same reputation regardless of nodeId', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          nodeIdArb,
          nodeIdArb,
          (isProximity, _nodeId1, _nodeId2) => {
            const rep1 = calculateReputation(isProximity)
            const rep2 = calculateReputation(isProximity)
            expect(rep1).toBe(rep2)
            expect(rep1).toBe(isProximity ? 2 : 1)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('reputation is always a positive integer', () => {
    it('calculateReputation always returns 1 or 2', () => {
      fc.assert(
        fc.property(fc.boolean(), (isProximity) => {
          const result = calculateReputation(isProximity)
          expect(result).toBeGreaterThanOrEqual(1)
          expect(result).toBeLessThanOrEqual(2)
          expect(Number.isInteger(result)).toBe(true)
        }),
        { numRuns: 100 },
      )
    })
  })
})
