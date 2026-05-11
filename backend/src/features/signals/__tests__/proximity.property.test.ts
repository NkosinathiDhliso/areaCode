/**
 * Property 3: Proximity Classification
 *
 * For any signal submission with user coordinates (lat, lng) and a node's coordinates,
 * the signal SHALL be classified as a Proximity_Report if and only if the haversine
 * distance between the two points is less than or equal to 150 metres. When no
 * coordinates are provided, the signal SHALL always be classified as a Remote_Report.
 *
 * **Validates: Requirements 2.5, 2.6**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  haversineDistance,
  classifyProximity,
  PROXIMITY_THRESHOLD_M,
} from '../proximity.js'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid latitude (-90 to 90) */
const latArb = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true })

/** Arbitrary for a valid longitude (-180 to 180) */
const lngArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true })

/** Arbitrary for a coordinate pair (lat, lng) */
const coordArb = fc.tuple(latArb, lngArb)

/**
 * Generates a coordinate pair that is within a given distance (in metres) of a base point.
 * Strategy: offset the base latitude by a small amount that guarantees the haversine
 * distance is within the target. We use a random bearing and a random fraction of the
 * target distance to create diverse within-threshold points.
 */
function coordWithinDistance(
  baseLat: number,
  baseLng: number,
  maxDistanceM: number,
): fc.Arbitrary<[number, number]> {
  return fc
    .tuple(
      // Random fraction of max distance (0 to maxDistanceM)
      fc.double({ min: 0, max: maxDistanceM, noNaN: true, noDefaultInfinity: true }),
      // Random bearing in radians (0 to 2π)
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, noDefaultInfinity: true }),
    )
    .map(([distance, bearing]) => {
      // Convert distance to approximate degree offsets
      // 1 degree latitude ≈ 111,320 metres
      const latOffset = (distance * Math.cos(bearing)) / 111_320
      // 1 degree longitude varies by latitude: ≈ 111,320 * cos(lat) metres
      const cosLat = Math.cos((baseLat * Math.PI) / 180)
      const lngOffset =
        cosLat > 0.001 ? (distance * Math.sin(bearing)) / (111_320 * cosLat) : 0

      let newLat = baseLat + latOffset
      let newLng = baseLng + lngOffset

      // Clamp to valid ranges
      newLat = Math.max(-90, Math.min(90, newLat))
      newLng = Math.max(-180, Math.min(180, newLng))

      return [newLat, newLng] as [number, number]
    })
}

/**
 * Generates a coordinate pair that is beyond a given distance (in metres) of a base point.
 * Strategy: offset by a distance guaranteed to exceed the threshold.
 */
function coordBeyondDistance(
  baseLat: number,
  baseLng: number,
  minDistanceM: number,
): fc.Arbitrary<[number, number]> {
  return fc
    .tuple(
      // Distance beyond the threshold (minDistanceM + 1 to minDistanceM + 10000)
      fc.double({
        min: minDistanceM + 1,
        max: minDistanceM + 10_000,
        noNaN: true,
        noDefaultInfinity: true,
      }),
      // Random bearing in radians (0 to 2π)
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, noDefaultInfinity: true }),
    )
    .map(([distance, bearing]) => {
      const latOffset = (distance * Math.cos(bearing)) / 111_320
      const cosLat = Math.cos((baseLat * Math.PI) / 180)
      const lngOffset =
        cosLat > 0.001 ? (distance * Math.sin(bearing)) / (111_320 * cosLat) : 0

      let newLat = baseLat + latOffset
      let newLng = baseLng + lngOffset

      // Clamp to valid ranges
      newLat = Math.max(-90, Math.min(90, newLat))
      newLng = Math.max(-180, Math.min(180, newLng))

      return [newLat, newLng] as [number, number]
    })
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: venue-live-signals, Property 3: Proximity Classification', () => {
  describe('haversine distance <= 150m → Proximity_Report', () => {
    it('classifies as Proximity_Report when user is within 150m of node', () => {
      fc.assert(
        fc.property(
          // Generate a base node coordinate (avoid extreme poles where lng offsets collapse)
          fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true }),
          lngArb,
          fc.double({ min: 0, max: PROXIMITY_THRESHOLD_M - 1, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, noDefaultInfinity: true }),
          (nodeLat, nodeLng, distance, bearing) => {
            // Compute user position at the given distance from node
            const latOffset = (distance * Math.cos(bearing)) / 111_320
            const cosLat = Math.cos((nodeLat * Math.PI) / 180)
            const lngOffset =
              cosLat > 0.001
                ? (distance * Math.sin(bearing)) / (111_320 * cosLat)
                : 0

            const userLat = Math.max(-90, Math.min(90, nodeLat + latOffset))
            const userLng = Math.max(-180, Math.min(180, nodeLng + lngOffset))

            const actualDistance = haversineDistance(userLat, userLng, nodeLat, nodeLng)

            // Only assert classification when the actual haversine distance is within threshold
            // (clamping may cause slight deviations from the intended distance)
            if (actualDistance <= PROXIMITY_THRESHOLD_M) {
              const result = classifyProximity(userLat, userLng, nodeLat, nodeLng)
              expect(result).toBe('Proximity_Report')
            }
          },
        ),
        { numRuns: 100 },
      )
    })

    it('classifies as Proximity_Report when user is at the exact same location', () => {
      fc.assert(
        fc.property(coordArb, ([lat, lng]) => {
          const result = classifyProximity(lat, lng, lat, lng)
          expect(result).toBe('Proximity_Report')
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('haversine distance > 150m → Remote_Report', () => {
    it('classifies as Remote_Report when user is beyond 150m from node', () => {
      fc.assert(
        fc.property(
          // Generate a base node coordinate (avoid extreme poles)
          fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true }),
          lngArb,
          fc.double({
            min: PROXIMITY_THRESHOLD_M + 10,
            max: PROXIMITY_THRESHOLD_M + 10_000,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, noDefaultInfinity: true }),
          (nodeLat, nodeLng, distance, bearing) => {
            const latOffset = (distance * Math.cos(bearing)) / 111_320
            const cosLat = Math.cos((nodeLat * Math.PI) / 180)
            const lngOffset =
              cosLat > 0.001
                ? (distance * Math.sin(bearing)) / (111_320 * cosLat)
                : 0

            const userLat = Math.max(-90, Math.min(90, nodeLat + latOffset))
            const userLng = Math.max(-180, Math.min(180, nodeLng + lngOffset))

            const actualDistance = haversineDistance(userLat, userLng, nodeLat, nodeLng)

            // Only assert classification when the actual haversine distance exceeds threshold
            // (clamping may cause slight deviations from the intended distance)
            if (actualDistance > PROXIMITY_THRESHOLD_M) {
              const result = classifyProximity(userLat, userLng, nodeLat, nodeLng)
              expect(result).toBe('Remote_Report')
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('no coordinates → Remote_Report', () => {
    it('classifies as Remote_Report when userLat is undefined', () => {
      fc.assert(
        fc.property(lngArb, coordArb, (userLng, [nodeLat, nodeLng]) => {
          const result = classifyProximity(undefined, userLng, nodeLat, nodeLng)
          expect(result).toBe('Remote_Report')
        }),
        { numRuns: 100 },
      )
    })

    it('classifies as Remote_Report when userLng is undefined', () => {
      fc.assert(
        fc.property(latArb, coordArb, (userLat, [nodeLat, nodeLng]) => {
          const result = classifyProximity(userLat, undefined, nodeLat, nodeLng)
          expect(result).toBe('Remote_Report')
        }),
        { numRuns: 100 },
      )
    })

    it('classifies as Remote_Report when both user coords are undefined', () => {
      fc.assert(
        fc.property(coordArb, ([nodeLat, nodeLng]) => {
          const result = classifyProximity(undefined, undefined, nodeLat, nodeLng)
          expect(result).toBe('Remote_Report')
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('classification is consistent with haversine distance', () => {
    it('classifyProximity result matches manual threshold comparison for any coordinate pair', () => {
      fc.assert(
        fc.property(coordArb, coordArb, ([userLat, userLng], [nodeLat, nodeLng]) => {
          const distance = haversineDistance(userLat, userLng, nodeLat, nodeLng)
          const result = classifyProximity(userLat, userLng, nodeLat, nodeLng)

          if (distance <= PROXIMITY_THRESHOLD_M) {
            expect(result).toBe('Proximity_Report')
          } else {
            expect(result).toBe('Remote_Report')
          }
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('haversine distance properties', () => {
    it('haversine distance is always non-negative', () => {
      fc.assert(
        fc.property(coordArb, coordArb, ([lat1, lng1], [lat2, lng2]) => {
          const distance = haversineDistance(lat1, lng1, lat2, lng2)
          expect(distance).toBeGreaterThanOrEqual(0)
        }),
        { numRuns: 100 },
      )
    })

    it('haversine distance is symmetric', () => {
      fc.assert(
        fc.property(coordArb, coordArb, ([lat1, lng1], [lat2, lng2]) => {
          const d1 = haversineDistance(lat1, lng1, lat2, lng2)
          const d2 = haversineDistance(lat2, lng2, lat1, lng1)
          expect(d1).toBeCloseTo(d2, 6)
        }),
        { numRuns: 100 },
      )
    })

    it('haversine distance is zero for identical points', () => {
      fc.assert(
        fc.property(coordArb, ([lat, lng]) => {
          const distance = haversineDistance(lat, lng, lat, lng)
          expect(distance).toBe(0)
        }),
        { numRuns: 100 },
      )
    })
  })
})
