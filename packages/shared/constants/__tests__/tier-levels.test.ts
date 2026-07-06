import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { getTier, getTierLabel, TIER_LEVELS } from '../tier-levels'
import type { Tier } from '../../types'

/**
 * Property 2: Tier assignment monotonicity.
 * Higher check-in counts always produce equal or higher tiers.
 * Validates: Requirements 20.1
 */
describe('getTier', () => {
  const tierOrder = ['local', 'regular', 'fixture', 'institution', 'legend'] as const
  const tierIndex = (tier: string) => tierOrder.indexOf(tier as (typeof tierOrder)[number])

  it('is monotonic: more check-ins never produce a lower tier', () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.nat(500), (base, delta) => {
        const lower = getTier(base)
        const higher = getTier(base + delta)
        expect(tierIndex(higher)).toBeGreaterThanOrEqual(tierIndex(lower))
      }),
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

/**
 * getTierLabel is the one bridge from a tier id to human-facing copy.
 * The rank-prestige rename keeps ids as the storage enum but changes the
 * labels: Regular->Insider, Fixture->Patron, Institution->Icon (Local and
 * Legend unchanged). These assertions lock in the new labels and guard the
 * "no raw id in copy" contract.
 * Validates: Requirements 1.1, 1.2, 8.2
 */
describe('getTierLabel', () => {
  it('maps each tier id to its prestige label', () => {
    expect(getTierLabel('local')).toBe('Local')
    expect(getTierLabel('regular')).toBe('Insider')
    expect(getTierLabel('fixture')).toBe('Patron')
    expect(getTierLabel('institution')).toBe('Icon')
    expect(getTierLabel('legend')).toBe('Legend')
  })

  it('never returns the raw id for the renamed tiers', () => {
    const renamed: Tier[] = ['regular', 'fixture', 'institution']
    for (const tier of renamed) {
      const label = getTierLabel(tier)
      expect(label).not.toBe(tier)
      expect(label.toLowerCase()).not.toBe(tier)
    }
  })

  it('throws for an unknown tier id', () => {
    expect(() => getTierLabel('platinum' as Tier)).toThrow()
  })
})
