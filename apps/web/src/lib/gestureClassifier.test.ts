import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { classifyDrag, stepIndex } from './gestureClassifier'

/**
 * Map Discovery - gesture classification + index stepping property tests
 * (deferred task 3.2).
 *
 *   - Property 13: Gesture dominant-axis classification
 *   - Property 5 (stepping core): wrap-around index stepping
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.5, 3.2, 3.3
 */

const pxArb = fc.double({ min: -2000, max: 2000, noNaN: true })
const thresholdArb = fc.double({ min: 0, max: 50, noNaN: true })
const dirArb = fc.constantFrom<1 | -1>(1, -1)

describe('Feature: map-discovery-experience, Property 13: Gesture dominant-axis classification', () => {
  it('classifies by the dominant axis exceeding the threshold margin', () => {
    fc.assert(
      fc.property(pxArb, pxArb, thresholdArb, (dx, dy, threshold) => {
        const axis = classifyDrag(dx, dy, threshold)
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        if (absDx - absDy > threshold) expect(axis).toBe('horizontal')
        else if (absDy - absDx > threshold) expect(axis).toBe('vertical')
        else expect(axis).toBe('indeterminate')
      }),
    )
  })

  it('is sign-symmetric - only magnitudes matter', () => {
    fc.assert(
      fc.property(pxArb, pxArb, thresholdArb, (dx, dy, threshold) => {
        const base = classifyDrag(dx, dy, threshold)
        expect(classifyDrag(-dx, dy, threshold)).toBe(base)
        expect(classifyDrag(dx, -dy, threshold)).toBe(base)
        expect(classifyDrag(-dx, -dy, threshold)).toBe(base)
      }),
    )
  })

  it('always returns one of the three defined axes', () => {
    fc.assert(
      fc.property(pxArb, pxArb, thresholdArb, (dx, dy, threshold) => {
        expect(['horizontal', 'vertical', 'indeterminate']).toContain(classifyDrag(dx, dy, threshold))
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 5 (stepping core): stepIndex wraps deterministically', () => {
  it('stays in range and matches modular arithmetic for length > 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), dirArb, fc.integer({ min: 2, max: 50 }), (current, dir, length) => {
        const c = current % length
        const next = stepIndex(c, dir, length)
        expect(next).toBeGreaterThanOrEqual(0)
        expect(next).toBeLessThan(length)
        expect(next).toBe((((c + dir) % length) + length) % length)
      }),
    )
  })

  it('returns the input unchanged for empty or single-element lists', () => {
    fc.assert(
      fc.property(fc.integer(), dirArb, fc.integer({ min: -5, max: 1 }), (current, dir, length) => {
        expect(stepIndex(current, dir, length)).toBe(current)
      }),
    )
  })

  it('a forward step followed by a backward step is the identity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 2, max: 50 }), (current, length) => {
        const c = current % length
        expect(stepIndex(stepIndex(c, 1, length), -1, length)).toBe(c)
      }),
    )
  })
})
