import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { DEFAULT_PROXIMITY_CONFIG, decideProximity, effectiveRadiusM, haversineMetres } from '../proximity.js'

/**
 * Accuracy-aware proximity gating - pure property tests.
 *
 *   Property 1: effective radius is bounded, monotone, and legacy-safe when
 *               accuracy is absent.
 *   Property 2: adaptive is never more lenient than legacy (it can only tighten).
 *   Property 3: mode routing - legacy and shadow keep the legacy outcome,
 *               adaptive enforces the accuracy-aware radius.
 *
 * These guard the two operational-safety invariants: a client that does not
 * send accuracy keeps today's behaviour, and enabling adaptive can never accept
 * a check-in the legacy rule would have rejected.
 *
 * Feature: checkin-accuracy-aware-proximity
 */

const cfg = DEFAULT_PROXIMITY_CONFIG
const accuracyArb = fc.option(fc.double({ min: 0, max: 10_000, noNaN: true }), { nil: null })
const distanceArb = fc.double({ min: 0, max: 5_000, noNaN: true })
const modeArb = fc.constantFrom('legacy' as const, 'shadow' as const, 'adaptive' as const)

describe('Feature: checkin-accuracy-aware-proximity, Property 1: effective radius is bounded, monotone, legacy-safe', () => {
  it('falls back to the legacy max radius when accuracy is missing or invalid', () => {
    for (const bad of [null, undefined, NaN, -1, -250]) {
      expect(effectiveRadiusM(bad as number | null | undefined, cfg)).toBe(cfg.maxRadiusM)
    }
  })

  it('stays within [minRadius, maxRadius] for any finite accuracy', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100_000, noNaN: true }), (acc) => {
        const r = effectiveRadiusM(acc, cfg)
        expect(r).toBeGreaterThanOrEqual(cfg.minRadiusM)
        expect(r).toBeLessThanOrEqual(cfg.maxRadiusM)
      }),
    )
  })

  it('is non-decreasing in accuracy (more uncertainty never tightens the radius)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        (a, b) => {
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          expect(effectiveRadiusM(lo, cfg)).toBeLessThanOrEqual(effectiveRadiusM(hi, cfg))
        },
      ),
    )
  })
})

describe('Feature: checkin-accuracy-aware-proximity, Property 2: adaptive is never more lenient than legacy', () => {
  it('whenever adaptive accepts, legacy also accepts, and the adaptive radius never exceeds the legacy max', () => {
    fc.assert(
      fc.property(distanceArb, accuracyArb, (distanceM, accuracyM) => {
        const d = decideProximity({ distanceM, accuracyM, mode: 'adaptive', config: cfg })
        expect(d.adaptiveRadiusM).toBeLessThanOrEqual(cfg.maxRadiusM)
        if (d.adaptiveAccepted) expect(d.legacyAccepted).toBe(true)
      }),
    )
  })
})

describe('Feature: checkin-accuracy-aware-proximity, Property 3: mode routing', () => {
  it('legacy and shadow keep the legacy outcome; adaptive enforces the accuracy-aware radius', () => {
    fc.assert(
      fc.property(distanceArb, accuracyArb, modeArb, (distanceM, accuracyM, mode) => {
        const d = decideProximity({ distanceM, accuracyM, mode, config: cfg })
        expect(d.legacyAccepted).toBe(distanceM <= cfg.maxRadiusM)
        expect(d.adaptiveAccepted).toBe(distanceM <= effectiveRadiusM(accuracyM, cfg))
        if (mode === 'adaptive') expect(d.accepted).toBe(d.adaptiveAccepted)
        else expect(d.accepted).toBe(d.legacyAccepted)
      }),
    )
  })
})

describe('checkin-accuracy-aware-proximity: haversine sanity', () => {
  it('is zero at the same point and grows with separation', () => {
    expect(haversineMetres(-26.2, 28.04, -26.2, 28.04)).toBe(0)
    // ~1 km north (0.009 deg latitude) should land in a sane band.
    const d = haversineMetres(-26.2, 28.04, -26.191, 28.04)
    expect(d).toBeGreaterThan(800)
    expect(d).toBeLessThan(1200)
  })
})
