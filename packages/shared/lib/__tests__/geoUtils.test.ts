import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { haversineDistance } from '../geoUtils'

/**
 * Property 1: Haversine distance symmetry.
 * haversine(a, b) === haversine(b, a) for all coordinate pairs.
 * Validates: Requirements 8.9
 */
describe('haversineDistance', () => {
  const coordArb = fc.record({
    lat: fc.double({ min: -90, max: 90, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
  })

  it('is symmetric: distance(a, b) === distance(b, a)', () => {
    fc.assert(
      fc.property(coordArb, coordArb, (a, b) => {
        const ab = haversineDistance(a.lat, a.lng, b.lat, b.lng)
        const ba = haversineDistance(b.lat, b.lng, a.lat, a.lng)
        expect(Math.abs(ab - ba)).toBeLessThan(0.001)
      }),
      { numRuns: 200 },
    )
  })

  it('returns 0 for identical points', () => {
    fc.assert(
      fc.property(coordArb, (a) => {
        expect(haversineDistance(a.lat, a.lng, a.lat, a.lng)).toBe(0)
      }),
      { numRuns: 100 },
    )
  })

  it('always returns a non-negative value', () => {
    fc.assert(
      fc.property(coordArb, coordArb, (a, b) => {
        expect(haversineDistance(a.lat, a.lng, b.lat, b.lng)).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 200 },
    )
  })
})
