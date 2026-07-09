import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { beamBlendForZoom, computePresentationKey, presentationTierForZoom } from './markerPresentation'

/**
 * Feature: map-camera-gesture-feel, Property 2: presentation-key gating
 *
 * For any zoom walk, the keyed restyle fires iff (tier, dim, blend@0.05)
 * changed, and tier flips are never missed.
 *
 * Validates: Requirements 3.2, 3.3
 */

const zoomArb = fc.double({ min: 0, max: 22, noNaN: true })
const dimArb = fc.boolean()
const zoomWalkArb = fc.array(zoomArb, { minLength: 2, maxLength: 50 })

/** Quantise blend the same way the production code does. */
function quantiseBlend(zoom: number): number {
  return Math.round(beamBlendForZoom(zoom) * 20) / 20
}

describe('Feature: map-camera-gesture-feel, Property 2: presentation-key gating', () => {
  it('restyle fires iff key changed: key differs between consecutive steps iff tier, dim, or quantised blend differs', () => {
    fc.assert(
      fc.property(zoomWalkArb, dimArb, (zooms, hasActiveVenue) => {
        for (let i = 1; i < zooms.length; i++) {
          const prevKey = computePresentationKey(zooms[i - 1]!, hasActiveVenue)
          const currKey = computePresentationKey(zooms[i]!, hasActiveVenue)

          const prevTier = presentationTierForZoom(zooms[i - 1]!)
          const currTier = presentationTierForZoom(zooms[i]!)
          const prevBlend = quantiseBlend(zooms[i - 1]!)
          const currBlend = quantiseBlend(zooms[i]!)

          // dim is the same for both (same hasActiveVenue), so key changes
          // iff tier or blend changed
          const inputsChanged = prevTier !== currTier || prevBlend !== currBlend
          const keyChanged = prevKey !== currKey

          expect(keyChanged).toBe(inputsChanged)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('tier flips are never missed: crossing a tier threshold always produces a different key', () => {
    fc.assert(
      fc.property(zoomArb, zoomArb, dimArb, (z1, z2, hasActiveVenue) => {
        const tier1 = presentationTierForZoom(z1)
        const tier2 = presentationTierForZoom(z2)

        if (tier1 !== tier2) {
          const key1 = computePresentationKey(z1, hasActiveVenue)
          const key2 = computePresentationKey(z2, hasActiveVenue)
          expect(key1).not.toBe(key2)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('quantisation correctness: blend component is always a multiple of 0.05', () => {
    fc.assert(
      fc.property(zoomArb, dimArb, (zoom, hasActiveVenue) => {
        const key = computePresentationKey(zoom, hasActiveVenue)
        const blendStr = key.split('|')[2]!
        const blend = parseFloat(blendStr)

        // blend / 0.05 should be an integer (within floating-point tolerance)
        const steps = blend / 0.05
        expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-10)
      }),
      { numRuns: 200 },
    )
  })

  it('key stability within a step: same tier, same quantised blend, same dim yields same key', () => {
    fc.assert(
      fc.property(zoomArb, zoomArb, dimArb, (z1, z2, hasActiveVenue) => {
        const tier1 = presentationTierForZoom(z1)
        const tier2 = presentationTierForZoom(z2)
        const blend1 = quantiseBlend(z1)
        const blend2 = quantiseBlend(z2)

        if (tier1 === tier2 && blend1 === blend2) {
          const key1 = computePresentationKey(z1, hasActiveVenue)
          const key2 = computePresentationKey(z2, hasActiveVenue)
          expect(key1).toBe(key2)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('dim state change always flips the key', () => {
    fc.assert(
      fc.property(zoomArb, (zoom) => {
        const keyActive = computePresentationKey(zoom, true)
        const keyInactive = computePresentationKey(zoom, false)
        expect(keyActive).not.toBe(keyInactive)
      }),
      { numRuns: 200 },
    )
  })
})
