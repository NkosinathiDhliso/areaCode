import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { easeOutCubic } from './cameraEasing'

/**
 * Feature: map-camera-gesture-feel, Property 3: camera easing is well-formed
 *
 * A camera easing curve must map normalised progress [0,1] to [0,1],
 * anchor its endpoints (0->0, 1->1), stay monotonic (the camera never
 * reverses mid-move), and decelerate (ease-out: covers more ground early).
 */

const tArb = fc.double({ min: 0, max: 1, noNaN: true })

describe('Feature: map-camera-gesture-feel, Property 3: camera easing is well-formed', () => {
  it('anchors both endpoints', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('stays within [0, 1] for any progress in [0, 1]', () => {
    fc.assert(
      fc.property(tArb, (t) => {
        const v = easeOutCubic(t)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }),
      { numRuns: 200 },
    )
  })

  it('is monotonically non-decreasing (the camera never reverses)', () => {
    fc.assert(
      fc.property(tArb, tArb, (a, b) => {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        expect(easeOutCubic(hi)).toBeGreaterThanOrEqual(easeOutCubic(lo))
      }),
      { numRuns: 200 },
    )
  })

  it('eases out: progress is ahead of linear at every interior point (fast start, gentle settle)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 0.99, noNaN: true }), (t) => {
        // Ease-out covers more ground than linear at every interior point.
        expect(easeOutCubic(t)).toBeGreaterThanOrEqual(t)
      }),
      { numRuns: 200 },
    )
  })

  it('clamps out-of-range progress instead of overshooting', () => {
    expect(easeOutCubic(-0.5)).toBe(0)
    expect(easeOutCubic(1.5)).toBe(1)
  })
})
