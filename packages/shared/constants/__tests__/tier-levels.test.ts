import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { getTier, TIER_LEVELS } from '../tier-levels'

/**
 * Property 2: Tier assignment monotonicity.
 * Higher check-in counts always produce equal or higher tiers.
 * Validates: Requirements 20.1
 */
describe('getTier', () => {
  const tierOrder = ['local', 'regular', 'fixture', 'institution', 'legend'] as const
  const tierIndex = (tier: string) => tierOrder.indexOf(tier as typeof tierOrder[number])

  it('is monotonic: more check-ins never produce a lower tier', () => {
    fc.assert(
      fc.property(
        fc.nat(1000),
        fc.nat(500),
        (base, delta) => {
          const lower = getTier(base)
          const higher = getTier(base + delta)
          expect(tierIndex(higher)).toBeGreaterThanOrEqual(tierIndex(lower))
        },
      ),
      { numRuns: 500 },
    )
  })

  it('returns local for 0 check-ins', () => {
    expect(getTier(0)).toBe('local')
  })

  it('returns legend for 500+ check-ins', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 10000 }), (count) => {
        expect(getTier(count)).toBe('legend')
      }),
      { numRuns: 100 },
    )
  })

  it('has contiguous thresholds with no gaps', () => {
    for (let i = 1; i < TIER_LEVELS.length; i++) {
      const prev = TIER_LEVELS[i - 1]!
      const curr = TIER_LEVELS[i]!
      expect(curr.minCheckIns).toBe((prev.maxCheckIns ?? 0) + 1)
    }
  })
})
