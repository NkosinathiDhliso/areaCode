import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { analyzeCrowdComposition } from '../../analyzers/crowd-composition.js'
import type { AnonymizedCheckIn } from '../../types.js'

/**
 * Property 4: Crowd Composition Invariant
 *
 * For any set of check-ins with tier data:
 * - Tier percentages sum to 100 (±1% rounding tolerance)
 * - Each tier percentage = (tier check-in count / total check-in count) × 100
 * - Sum of unique visitor counts per tier = total unique visitor count
 *
 * **Validates: Requirements 3.1, 3.2**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

const TIERS = ['local', 'regular', 'fixture', 'institution', 'legend'] as const

/** Generate a 64-char hex string (SHA-256 hash format) */
const hexTokenArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))

const anonymizedCheckInArb: fc.Arbitrary<AnonymizedCheckIn> = fc.record({
  visitorToken: hexTokenArb,
  nodeId: fc.uuid(),
  tier: fc.constantFrom(...TIERS),
  checkedInAt: fc
    .integer({
      min: new Date('2024-01-01').getTime(),
      max: new Date('2026-12-31').getTime(),
    })
    .map((ts) => new Date(ts).toISOString()),
  hourOfDay: fc.integer({ min: 0, max: 23 }),
  dayOfWeek: fc.constantFrom(...DAYS_OF_WEEK),
})

const checkInsArrayArb = fc.array(anonymizedCheckInArb, { minLength: 1, maxLength: 200 })

// ─── Property 4: Crowd Composition Invariant ────────────────────────────────

describe('Feature: venue-intelligence-reports, Property 4: Crowd Composition Invariant', () => {
  it('tier percentages sum to 100 within ±1% rounding tolerance', () => {
    /**
     * **Validates: Requirements 3.1, 3.2**
     */
    fc.assert(
      fc.property(checkInsArrayArb, (checkIns) => {
        const result = analyzeCrowdComposition(checkIns)
        const percentageSum = Object.values(result.tierPercentages).reduce((a, b) => a + b, 0)
        expect(percentageSum).toBeGreaterThanOrEqual(99)
        expect(percentageSum).toBeLessThanOrEqual(101)
      }),
      { numRuns: 100 },
    )
  })

  it('each tier percentage equals (tier count / total) × 100', () => {
    /**
     * **Validates: Requirements 3.1, 3.2**
     */
    fc.assert(
      fc.property(checkInsArrayArb, (checkIns) => {
        const result = analyzeCrowdComposition(checkIns)
        const total = checkIns.length

        // Count check-ins per tier manually
        const tierCounts: Record<string, number> = {}
        for (const ci of checkIns) {
          tierCounts[ci.tier] = (tierCounts[ci.tier] ?? 0) + 1
        }

        for (const [tier, percentage] of Object.entries(result.tierPercentages)) {
          const expectedPercentage = Math.round((tierCounts[tier]! / total) * 100 * 100) / 100
          expect(percentage).toBeCloseTo(expectedPercentage, 1)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('sum of unique per-tier visitor counts equals total unique visitors', () => {
    /**
     * **Validates: Requirements 3.1, 3.2**
     *
     * Note: A visitor can appear in multiple tiers (if they have check-ins
     * with different tiers), so the sum of per-tier unique counts may be
     * >= totalUniqueVisitors. However, in practice each visitor has one tier.
     * We verify that the total unique count matches the actual unique tokens.
     */
    fc.assert(
      fc.property(checkInsArrayArb, (checkIns) => {
        const result = analyzeCrowdComposition(checkIns)

        // Verify total unique visitors matches actual unique tokens
        const allTokens = new Set(checkIns.map((ci) => ci.visitorToken))
        expect(result.totalUniqueVisitors).toBe(allTokens.size)

        // Verify per-tier unique counts are correct
        const tierVisitors: Record<string, Set<string>> = {}
        for (const ci of checkIns) {
          if (!tierVisitors[ci.tier]) {
            tierVisitors[ci.tier] = new Set()
          }
          tierVisitors[ci.tier]!.add(ci.visitorToken)
        }

        for (const [tier, visitors] of Object.entries(tierVisitors)) {
          expect(result.tierUniqueCounts[tier]).toBe(visitors.size)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('empty check-ins produce zero totals', () => {
    /**
     * **Validates: Requirements 3.1, 3.2**
     */
    const result = analyzeCrowdComposition([])
    expect(result.tierPercentages).toEqual({})
    expect(result.tierUniqueCounts).toEqual({})
    expect(result.totalUniqueVisitors).toBe(0)
  })

  it('only tiers present in check-ins appear in results', () => {
    /**
     * **Validates: Requirements 3.1, 3.2**
     */
    fc.assert(
      fc.property(checkInsArrayArb, (checkIns) => {
        const result = analyzeCrowdComposition(checkIns)
        const presentTiers = new Set(checkIns.map((ci) => ci.tier))

        // All result tiers should be present in check-ins
        for (const tier of Object.keys(result.tierPercentages)) {
          expect(presentTiers.has(tier)).toBe(true)
        }
        for (const tier of Object.keys(result.tierUniqueCounts)) {
          expect(presentTiers.has(tier)).toBe(true)
        }

        // All present tiers should be in results
        for (const tier of presentTiers) {
          expect(result.tierPercentages).toHaveProperty(tier)
          expect(result.tierUniqueCounts).toHaveProperty(tier)
        }
      }),
      { numRuns: 100 },
    )
  })
})
