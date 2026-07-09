import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { computeEffectiveThreshold } from '../../features/rewards/threshold-lock.js'

/**
 * Threshold-lock — Churn-defences spec, Requirement 1.
 *
 * The pure helper `computeEffectiveThreshold` is the kernel of the
 * grandfathering rule. We exhaustively prove its behaviour with
 * property-based tests.
 */

const positiveInt = fc.integer({ min: 1, max: 10_000 })

describe('computeEffectiveThreshold', () => {
  it('returns the current threshold when no lock exists', () => {
    fc.assert(
      fc.property(positiveInt, (current) => {
        expect(computeEffectiveThreshold(current, null)).toBe(current)
      }),
    )
  })

  it('returns the locked threshold when current is higher (grandfather a raise)', () => {
    fc.assert(
      fc.property(positiveInt, positiveInt, (locked, raise) => {
        const current = locked + raise
        expect(computeEffectiveThreshold(current, locked)).toBe(locked)
      }),
    )
  })

  it('returns the current threshold when current is lower (better deal wins)', () => {
    fc.assert(
      fc.property(positiveInt, positiveInt, (current, riseAbove) => {
        const locked = current + riseAbove
        expect(computeEffectiveThreshold(current, locked)).toBe(current)
      }),
    )
  })

  it('is monotonically non-increasing as the venue lowers the threshold', () => {
    fc.assert(
      fc.property(positiveInt, fc.array(positiveInt, { minLength: 1, maxLength: 10 }), (initial, sequence) => {
        let effective = initial
        let locked = initial
        for (const newCurrent of sequence) {
          const next = computeEffectiveThreshold(newCurrent, locked)
          expect(next).toBeLessThanOrEqual(effective)
          locked = next
          effective = next
        }
      }),
    )
  })

  it('never produces an effective threshold higher than the locked value', () => {
    fc.assert(
      fc.property(positiveInt, positiveInt, (current, locked) => {
        expect(computeEffectiveThreshold(current, locked)).toBeLessThanOrEqual(locked)
      }),
    )
  })

  it('never produces an effective threshold higher than the current value', () => {
    fc.assert(
      fc.property(positiveInt, positiveInt, (current, locked) => {
        expect(computeEffectiveThreshold(current, locked)).toBeLessThanOrEqual(current)
      }),
    )
  })
})
