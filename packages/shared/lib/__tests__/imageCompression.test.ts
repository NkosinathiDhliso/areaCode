import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { computeTargetDimensions } from '../imageCompression'

// `computeTargetDimensions` is the pure core of header-image compression: it
// decides the output size that fits within a max longest-edge while preserving
// aspect ratio and never enlarging. The DOM canvas encode around it is covered
// by component/e2e tests, not here.

const dimArb = fc.integer({ min: 1, max: 12000 })
const maxArb = fc.integer({ min: 1, max: 4000 })

// Realistic photo dimensions (no 1px degeneracy) for the ratio property, where
// rounding to whole pixels stays negligible.
const photoDimArb = fc.integer({ min: 200, max: 12000 })
const photoMaxArb = fc.integer({ min: 200, max: 4000 })

describe('computeTargetDimensions', () => {
  // Feature: header-image-compression, Property 1: never exceeds the cap
  it('keeps the longest edge within maxDimension', () => {
    fc.assert(
      fc.property(dimArb, dimArb, maxArb, (w, h, max) => {
        const out = computeTargetDimensions(w, h, max)
        expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(max)
      }),
      { numRuns: 200 },
    )
  })

  // Feature: header-image-compression, Property 2: never enlarges
  it('returns the original size when already within the cap', () => {
    fc.assert(
      fc.property(dimArb, dimArb, maxArb, (w, h, max) => {
        fc.pre(Math.max(w, h) <= max)
        const out = computeTargetDimensions(w, h, max)
        expect(out).toEqual({ width: w, height: h })
      }),
      { numRuns: 200 },
    )
  })

  // Feature: header-image-compression, Property 3: preserves aspect ratio
  it('preserves the aspect ratio within a rounding tolerance', () => {
    fc.assert(
      fc.property(photoDimArb, photoDimArb, photoMaxArb, (w, h, max) => {
        const out = computeTargetDimensions(w, h, max)
        const sourceRatio = w / h
        const outRatio = out.width / out.height
        // Rounding to whole pixels can shift the ratio; tolerance scales with
        // how small the smaller output edge is (± ~1px of rounding).
        const tolerance = Math.max(0.05, 2 / Math.min(out.width, out.height))
        expect(Math.abs(outRatio - sourceRatio)).toBeLessThanOrEqual(sourceRatio * tolerance)
      }),
      { numRuns: 200 },
    )
  })

  it('returns zeroes for non-positive input', () => {
    expect(computeTargetDimensions(0, 100, 800)).toEqual({ width: 0, height: 0 })
    expect(computeTargetDimensions(100, 0, 800)).toEqual({ width: 0, height: 0 })
  })

  it('downscales a landscape HD photo to the cap', () => {
    expect(computeTargetDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
  })
})
