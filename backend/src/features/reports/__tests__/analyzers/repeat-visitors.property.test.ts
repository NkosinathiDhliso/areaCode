import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { analyzeRepeatVisitors } from '../../analyzers/repeat-visitors.js'

/**
 * Property 7: Repeat Visitor Rate Computation
 *
 * For any two sets of visitor tokens (current period and previous period):
 * - repeatRate = |intersection(current, previous)| / |current| × 100
 * - firstTimeVisitorCount = |current| − |intersection(current, previous)|
 *
 * **Validates: Requirements 5.1, 5.2**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

/** Generate a 64-char hex string (SHA-256 hash format) */
const hexTokenArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))

/** Generate a Set of unique visitor tokens */
const visitorSetArb = fc.uniqueArray(hexTokenArb, { minLength: 0, maxLength: 50 }).map((tokens) => new Set(tokens))

/** Generate two visitor sets with controlled overlap */
function visitorPairArb() {
  return fc
    .tuple(
      fc.uniqueArray(hexTokenArb, { minLength: 0, maxLength: 30 }),
      fc.uniqueArray(hexTokenArb, { minLength: 0, maxLength: 30 }),
      fc.uniqueArray(hexTokenArb, { minLength: 0, maxLength: 20 }),
    )
    .map(([currentOnly, previousOnly, shared]) => {
      const currentSet = new Set([...currentOnly, ...shared])
      const previousSet = new Set([...previousOnly, ...shared])
      return { currentSet, previousSet }
    })
}

// ─── Property 7: Repeat Visitor Rate Computation ────────────────────────────

describe('Feature: venue-intelligence-reports, Property 7: Repeat Visitor Rate Computation', () => {
  it('repeatRate equals |intersection| / |current| × 100', () => {
    /**
     * **Validates: Requirements 5.1, 5.2**
     */
    fc.assert(
      fc.property(visitorPairArb(), ({ currentSet, previousSet }) => {
        const result = analyzeRepeatVisitors(currentSet, previousSet)

        // Manually compute intersection
        let intersectionCount = 0
        for (const visitor of currentSet) {
          if (previousSet.has(visitor)) intersectionCount++
        }

        if (currentSet.size === 0) {
          expect(result.repeatRate).toBe(0)
        } else {
          const expectedRate = (intersectionCount / currentSet.size) * 100
          expect(result.repeatRate).toBeCloseTo(expectedRate, 10)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('firstTimeVisitorCount equals |current| − |intersection|', () => {
    /**
     * **Validates: Requirements 5.1, 5.2**
     */
    fc.assert(
      fc.property(visitorPairArb(), ({ currentSet, previousSet }) => {
        const result = analyzeRepeatVisitors(currentSet, previousSet)

        // Manually compute intersection
        let intersectionCount = 0
        for (const visitor of currentSet) {
          if (previousSet.has(visitor)) intersectionCount++
        }

        const expectedFirstTime = currentSet.size - intersectionCount
        expect(result.firstTimeVisitorCount).toBe(expectedFirstTime)
      }),
      { numRuns: 25 },
    )
  })

  it('totalUniqueVisitors equals |current|', () => {
    /**
     * **Validates: Requirements 5.1, 5.2**
     */
    fc.assert(
      fc.property(visitorPairArb(), ({ currentSet, previousSet }) => {
        const result = analyzeRepeatVisitors(currentSet, previousSet)
        expect(result.totalUniqueVisitors).toBe(currentSet.size)
      }),
      { numRuns: 25 },
    )
  })

  it('empty current set produces repeatRate = 0 and firstTimeVisitorCount = 0', () => {
    /**
     * **Validates: Requirements 5.1, 5.2**
     */
    fc.assert(
      fc.property(visitorSetArb, (previousSet) => {
        const result = analyzeRepeatVisitors(new Set(), previousSet)
        expect(result.repeatRate).toBe(0)
        expect(result.firstTimeVisitorCount).toBe(0)
        expect(result.totalUniqueVisitors).toBe(0)
      }),
      { numRuns: 25 },
    )
  })

  it('repeatRate is between 0 and 100 inclusive', () => {
    /**
     * **Validates: Requirements 5.1, 5.2**
     */
    fc.assert(
      fc.property(visitorPairArb(), ({ currentSet, previousSet }) => {
        const result = analyzeRepeatVisitors(currentSet, previousSet)
        expect(result.repeatRate).toBeGreaterThanOrEqual(0)
        expect(result.repeatRate).toBeLessThanOrEqual(100)
      }),
      { numRuns: 25 },
    )
  })
})
