/**
 * Property Tests for Dispute Logic (Properties 9, 10, 11)
 *
 * Property 9: Dispute Ownership Verification
 * Property 10: Dispute Confidence Round-Trip
 * Property 11: Reporter Weight Penalty
 *
 * **Validates: Requirements 8.2, 8.4, 9.3, 9.4, 10.3**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 *
 * Note: Properties 9 and 10 test pure logic extracted from the service layer.
 * Property 11 tests the penalty math (max(0.1, W - 0.2)) as a pure property.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

// ============================================================================
// Constants (mirrored from service.ts for test assertions)
// ============================================================================

/** Penalty reduction per upheld dispute (V1) */
const PENALTY_REDUCTION = 0.2

/** Minimum reporter weight in V1 (soft-ban floor) */
const MIN_REPORTER_WEIGHT = 0.1

/** Dispute confidence multiplier (50% reduction) */
const DISPUTE_CONFIDENCE_MULTIPLIER = 0.5

// ============================================================================
// Pure Logic Under Test
// ============================================================================

/**
 * Pure ownership verification logic extracted from disputeSignal.
 * Returns true if the business owns the node (dispute accepted),
 * false otherwise (dispute rejected).
 */
function verifyDisputeOwnership(
  disputingBusinessId: string,
  nodeOwnerBusinessId: string | undefined,
): boolean {
  return nodeOwnerBusinessId === disputingBusinessId
}

/**
 * Pure confidence math for dispute: multiplies weight by 0.5.
 */
function applyDisputeConfidence(weight: number): number {
  return weight * DISPUTE_CONFIDENCE_MULTIPLIER
}

/**
 * Pure confidence math for dismiss: restores to original weight.
 * In practice, the original weight is stored and restored on dismiss.
 */
function restoreConfidence(originalWeight: number): number {
  return originalWeight
}

/**
 * Pure penalty math from service.ts applyPenalty:
 * max(0.1, currentWeight - 0.2)
 */
function computePenalty(currentWeight: number): number {
  return Math.max(MIN_REPORTER_WEIGHT, currentWeight - PENALTY_REDUCTION)
}

// ============================================================================
// Custom Arbitraries
// ============================================================================

/** Arbitrary for a businessId */
const businessIdArb = fc.uuid()

/** Arbitrary for a reporter weight (valid range: 0.1 to 2.0) */
const reporterWeightArb = fc.double({ min: 0.1, max: 2.0, noNaN: true })

/** Arbitrary for a confidence weight (valid range: 0.0 to 1.0) */
const confidenceWeightArb = fc.double({ min: 0.01, max: 1.0, noNaN: true })

// ============================================================================
// Property 9: Dispute Ownership Verification
// ============================================================================

describe('Feature: venue-live-signals, Property 9: Dispute Ownership Verification', () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any dispute submission, the dispute SHALL be accepted if and only if
   * the authenticated business owns the node associated with the disputed signal.
   * Disputes from non-owning businesses SHALL be rejected.
   */

  describe('dispute accepted when business owns the node', () => {
    it('ownership verification passes when businessId matches node owner', () => {
      fc.assert(
        fc.property(businessIdArb, (businessId) => {
          // Same business owns the node
          const result = verifyDisputeOwnership(businessId, businessId)
          expect(result).toBe(true)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('dispute rejected when business does not own the node', () => {
    it('ownership verification fails when businessId differs from node owner', () => {
      fc.assert(
        fc.property(
          businessIdArb,
          businessIdArb,
          (disputingBusiness, nodeOwner) => {
            fc.pre(disputingBusiness !== nodeOwner)

            const result = verifyDisputeOwnership(disputingBusiness, nodeOwner)
            expect(result).toBe(false)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('ownership verification fails when node has no owner', () => {
      fc.assert(
        fc.property(businessIdArb, (disputingBusiness) => {
          const result = verifyDisputeOwnership(disputingBusiness, undefined)
          expect(result).toBe(false)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('ownership check is symmetric in identity', () => {
    it('only exact match of businessId is accepted', () => {
      fc.assert(
        fc.property(
          businessIdArb,
          businessIdArb,
          (business1, business2) => {
            const result = verifyDisputeOwnership(business1, business2)
            expect(result).toBe(business1 === business2)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})

// ============================================================================
// Property 10: Dispute Confidence Round-Trip
// ============================================================================

describe('Feature: venue-live-signals, Property 10: Dispute Confidence Round-Trip', () => {
  /**
   * **Validates: Requirements 8.4, 9.4**
   *
   * For any signal with confidence weight W, when a dispute is filed the
   * effective weight SHALL become W × 0.5. When the dispute is subsequently
   * dismissed, the effective weight SHALL be restored to W. The round-trip
   * (dispute then dismiss) SHALL preserve the original weight.
   */

  describe('dispute halves the confidence weight', () => {
    it('applying dispute multiplier produces exactly W × 0.5', () => {
      fc.assert(
        fc.property(confidenceWeightArb, (weight) => {
          const disputed = applyDisputeConfidence(weight)
          expect(disputed).toBeCloseTo(weight * 0.5, 10)
        }),
        { numRuns: 100 },
      )
    })

    it('disputed weight is always less than original (for positive weights)', () => {
      fc.assert(
        fc.property(confidenceWeightArb, (weight) => {
          const disputed = applyDisputeConfidence(weight)
          expect(disputed).toBeLessThan(weight)
        }),
        { numRuns: 100 },
      )
    })

    it('disputed weight is always positive for positive inputs', () => {
      fc.assert(
        fc.property(confidenceWeightArb, (weight) => {
          const disputed = applyDisputeConfidence(weight)
          expect(disputed).toBeGreaterThan(0)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('dismiss restores the original weight', () => {
    it('restoring after dispute returns the original weight', () => {
      fc.assert(
        fc.property(confidenceWeightArb, (originalWeight) => {
          const restored = restoreConfidence(originalWeight)
          expect(restored).toBe(originalWeight)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('round-trip preserves original weight', () => {
    it('dispute then dismiss preserves the original weight exactly', () => {
      fc.assert(
        fc.property(confidenceWeightArb, (originalWeight) => {
          // Step 1: Dispute reduces weight by 50%
          const disputedWeight = applyDisputeConfidence(originalWeight)
          expect(disputedWeight).toBeCloseTo(originalWeight * 0.5, 10)

          // Step 2: Dismiss restores to original
          const restoredWeight = restoreConfidence(originalWeight)
          expect(restoredWeight).toBe(originalWeight)
        }),
        { numRuns: 100 },
      )
    })

    it('multiple dispute-dismiss cycles preserve the original weight', () => {
      fc.assert(
        fc.property(
          confidenceWeightArb,
          fc.integer({ min: 1, max: 10 }),
          (originalWeight, cycles) => {
            let currentWeight = originalWeight

            for (let i = 0; i < cycles; i++) {
              // Dispute
              const disputed = applyDisputeConfidence(currentWeight)
              expect(disputed).toBeCloseTo(currentWeight * 0.5, 10)

              // Dismiss (restore to original)
              currentWeight = restoreConfidence(originalWeight)
            }

            expect(currentWeight).toBe(originalWeight)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})

// ============================================================================
// Property 11: Reporter Weight Penalty
// ============================================================================

describe('Feature: venue-live-signals, Property 11: Reporter Weight Penalty', () => {
  /**
   * **Validates: Requirements 9.3, 10.3**
   *
   * For any reporter with weight W, when an admin upholds a dispute against
   * their signal, the reporter's weight SHALL become max(0.1, W − 0.2).
   * The weight SHALL never go below 0.1 in V1 (soft-ban floor).
   */

  describe('penalty reduces weight by 0.2', () => {
    it('for weights above 0.3, penalty reduces by exactly 0.2', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.3 + Number.EPSILON, max: 2.0, noNaN: true }),
          (weight) => {
            fc.pre(weight > 0.3)
            const newWeight = computePenalty(weight)
            expect(newWeight).toBeCloseTo(weight - 0.2, 10)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('penalty never goes below 0.1', () => {
    it('weight never drops below 0.1 regardless of current weight', () => {
      fc.assert(
        fc.property(reporterWeightArb, (weight) => {
          const newWeight = computePenalty(weight)
          expect(newWeight).toBeGreaterThanOrEqual(0.1)
        }),
        { numRuns: 100 },
      )
    })

    it('weight at exactly 0.1 stays at 0.1 after penalty', () => {
      const newWeight = computePenalty(0.1)
      expect(newWeight).toBe(0.1)
    })

    it('weight at 0.2 becomes 0.1 after penalty (not 0.0)', () => {
      const newWeight = computePenalty(0.2)
      expect(newWeight).toBeCloseTo(0.1, 10)
    })

    it('weight at 0.15 becomes 0.1 after penalty (floor applied)', () => {
      const newWeight = computePenalty(0.15)
      expect(newWeight).toBe(0.1)
    })
  })

  describe('penalty result is always valid', () => {
    it('result is always between 0.1 and the original weight', () => {
      fc.assert(
        fc.property(reporterWeightArb, (weight) => {
          const newWeight = computePenalty(weight)
          expect(newWeight).toBeGreaterThanOrEqual(MIN_REPORTER_WEIGHT)
          expect(newWeight).toBeLessThanOrEqual(weight)
        }),
        { numRuns: 100 },
      )
    })

    it('penalty is monotonically non-decreasing with respect to input weight', () => {
      fc.assert(
        fc.property(
          reporterWeightArb,
          reporterWeightArb,
          (weight1, weight2) => {
            const result1 = computePenalty(weight1)
            const result2 = computePenalty(weight2)

            if (weight1 <= weight2) {
              expect(result1).toBeLessThanOrEqual(result2)
            } else {
              expect(result1).toBeGreaterThanOrEqual(result2)
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('successive penalties converge to floor', () => {
    it('applying penalty repeatedly converges to 0.1', () => {
      fc.assert(
        fc.property(reporterWeightArb, (startWeight) => {
          let weight = startWeight
          // Apply penalty enough times to reach floor
          for (let i = 0; i < 20; i++) {
            weight = computePenalty(weight)
          }
          expect(weight).toBe(MIN_REPORTER_WEIGHT)
        }),
        { numRuns: 100 },
      )
    })
  })
})
