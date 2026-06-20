import { getTier, TIER_LEVELS } from '@area-code/shared/constants/tier-levels'
import type { TierLevel } from '@area-code/shared/constants/tier-levels'
import type { Tier } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

// ─── Tier Threshold Table ───────────────────────────────────────────────────

/**
 * The canonical tier threshold table from the design document:
 *   0–9   → local
 *   10–49 → regular
 *   50–149 → fixture
 *   150–499 → institution
 *   500+  → legend
 */
const TIER_THRESHOLDS: Array<{ tier: Tier; min: number; max: number | null }> = [
  { tier: 'local', min: 0, max: 9 },
  { tier: 'regular', min: 10, max: 49 },
  { tier: 'fixture', min: 50, max: 149 },
  { tier: 'institution', min: 150, max: 499 },
  { tier: 'legend', min: 500, max: null },
]

// ─── Helper: Compute expected tier from threshold table ─────────────────────

function expectedTier(checkInCount: number): Tier {
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    const t = TIER_THRESHOLDS[i]!
    if (checkInCount >= t.min) {
      return t.tier
    }
  }
  return 'local'
}

// ─── Helper: Compute remaining check-ins to next tier ───────────────────────

/**
 * Mirrors the logic in profile-handler.ts:
 * - Find the current tier level in TIER_LEVELS
 * - If there's a next tier, remaining = max(0, nextTierMinCheckIns - currentCount)
 * - If already at legend (max tier), remaining = 0
 */
function computeCheckInsRemaining(checkInCount: number): number {
  const currentTier = getTier(checkInCount)
  const currentLevel = TIER_LEVELS.find((l: TierLevel) => l.tier === currentTier)!
  const currentIdx = TIER_LEVELS.indexOf(currentLevel)
  const nextLevel = currentIdx < TIER_LEVELS.length - 1 ? TIER_LEVELS[currentIdx + 1] : null

  if (!nextLevel) return 0
  return Math.max(0, nextLevel.minCheckIns - checkInCount)
}

// ─── Property 3: Tier computation is correct for any check-in count ─────────

describe('Property 3: Tier computation is correct for any check-in count', () => {
  /**
   * **Validates: Requirements 2.4, 2.5**
   *
   * For any non-negative check-in count, the computed tier SHALL match the
   * expected tier based on the threshold table (0–9 → local, 10–49 → regular,
   * 50–149 → fixture, 150–499 → institution, 500+ → legend), and the
   * "remaining check-ins to next tier" SHALL equal max(0, nextThreshold - currentCount).
   */

  it('computed tier matches the threshold table for any non-negative check-in count', () => {
    fc.assert(
      fc.property(fc.nat(10000), (checkInCount) => {
        const computed = getTier(checkInCount)
        const expected = expectedTier(checkInCount)
        expect(computed).toBe(expected)
      }),
      { numRuns: 25 },
    )
  })

  it('tier is local for check-in counts 0–9', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (checkInCount) => {
        expect(getTier(checkInCount)).toBe('local')
      }),
      { numRuns: 25 },
    )
  })

  it('tier is regular for check-in counts 10–49', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 49 }), (checkInCount) => {
        expect(getTier(checkInCount)).toBe('regular')
      }),
      { numRuns: 25 },
    )
  })

  it('tier is fixture for check-in counts 50–149', () => {
    fc.assert(
      fc.property(fc.integer({ min: 50, max: 149 }), (checkInCount) => {
        expect(getTier(checkInCount)).toBe('fixture')
      }),
      { numRuns: 25 },
    )
  })

  it('tier is institution for check-in counts 150–499', () => {
    fc.assert(
      fc.property(fc.integer({ min: 150, max: 499 }), (checkInCount) => {
        expect(getTier(checkInCount)).toBe('institution')
      }),
      { numRuns: 25 },
    )
  })

  it('tier is legend for check-in counts 500+', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 100000 }), (checkInCount) => {
        expect(getTier(checkInCount)).toBe('legend')
      }),
      { numRuns: 25 },
    )
  })

  it('remaining check-ins to next tier equals max(0, nextThreshold - currentCount)', () => {
    fc.assert(
      fc.property(fc.nat(10000), (checkInCount) => {
        const remaining = computeCheckInsRemaining(checkInCount)

        const currentTier = getTier(checkInCount)
        const currentLevel = TIER_LEVELS.find((l: TierLevel) => l.tier === currentTier)!
        const currentIdx = TIER_LEVELS.indexOf(currentLevel)
        const nextLevel = currentIdx < TIER_LEVELS.length - 1 ? TIER_LEVELS[currentIdx + 1] : null

        if (!nextLevel) {
          // At legend tier — no next tier, remaining should be 0
          expect(remaining).toBe(0)
        } else {
          // remaining = max(0, nextThreshold - currentCount)
          const expectedRemaining = Math.max(0, nextLevel.minCheckIns - checkInCount)
          expect(remaining).toBe(expectedRemaining)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('remaining check-ins is always non-negative', () => {
    fc.assert(
      fc.property(fc.nat(10000), (checkInCount) => {
        const remaining = computeCheckInsRemaining(checkInCount)
        expect(remaining).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 25 },
    )
  })

  it('remaining check-ins is 0 for legend tier (already at max)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 100000 }), (checkInCount) => {
        const remaining = computeCheckInsRemaining(checkInCount)
        expect(remaining).toBe(0)
      }),
      { numRuns: 25 },
    )
  })

  it('remaining check-ins is positive for all non-legend tiers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 499 }), (checkInCount) => {
        const remaining = computeCheckInsRemaining(checkInCount)
        expect(remaining).toBeGreaterThan(0)
      }),
      { numRuns: 25 },
    )
  })

  it('reaching exactly the next threshold transitions to the next tier', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }), // index into non-legend tiers
        (tierIdx) => {
          const level = TIER_LEVELS[tierIdx]
          const nextLevel = TIER_LEVELS[tierIdx + 1]
          if (!level || !nextLevel) return // skip if no next tier

          // One below the threshold — still current tier
          const belowThreshold = nextLevel.minCheckIns - 1
          expect(getTier(belowThreshold)).toBe(level.tier)

          // Exactly at the threshold — transitions to next tier
          expect(getTier(nextLevel.minCheckIns)).toBe(nextLevel.tier)
        },
      ),
      { numRuns: 25 },
    )
  })
})
