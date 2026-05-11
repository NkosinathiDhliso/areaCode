import { describe, it, expect } from 'vitest'
import {
  haversineDistance,
  classifyProximity,
  PROXIMITY_THRESHOLD_M,
} from '../proximity.js'

// ============================================================================
// haversineDistance
// ============================================================================

describe('haversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistance(-26.2041, 28.0473, -26.2041, 28.0473)).toBe(0)
  })

  it('computes a known distance (Johannesburg to Pretoria ~58km)', () => {
    // Johannesburg: -26.2041, 28.0473
    // Pretoria: -25.7479, 28.2293
    const distance = haversineDistance(-26.2041, 28.0473, -25.7479, 28.2293)
    // Approximately 55-60 km
    expect(distance).toBeGreaterThan(50_000)
    expect(distance).toBeLessThan(65_000)
  })

  it('returns a positive value for any two different points', () => {
    const distance = haversineDistance(0, 0, 0.001, 0.001)
    expect(distance).toBeGreaterThan(0)
  })

  it('is symmetric (distance A→B equals B→A)', () => {
    const d1 = haversineDistance(-26.2041, 28.0473, -26.2050, 28.0480)
    const d2 = haversineDistance(-26.2050, 28.0480, -26.2041, 28.0473)
    expect(d1).toBeCloseTo(d2)
  })

  it('computes approximately 111km for 1 degree latitude at equator', () => {
    const distance = haversineDistance(0, 0, 1, 0)
    // 1 degree latitude ≈ 111.19 km
    expect(distance).toBeGreaterThan(110_000)
    expect(distance).toBeLessThan(112_000)
  })
})

// ============================================================================
// classifyProximity
// ============================================================================

describe('classifyProximity', () => {
  const nodeLat = -26.2041
  const nodeLng = 28.0473

  it('returns Remote_Report when userLat is undefined', () => {
    expect(classifyProximity(undefined, 28.0473, nodeLat, nodeLng)).toBe('Remote_Report')
  })

  it('returns Remote_Report when userLng is undefined', () => {
    expect(classifyProximity(-26.2041, undefined, nodeLat, nodeLng)).toBe('Remote_Report')
  })

  it('returns Remote_Report when both user coords are undefined', () => {
    expect(classifyProximity(undefined, undefined, nodeLat, nodeLng)).toBe('Remote_Report')
  })

  it('returns Proximity_Report when user is at the same location as node', () => {
    expect(classifyProximity(nodeLat, nodeLng, nodeLat, nodeLng)).toBe('Proximity_Report')
  })

  it('returns Proximity_Report when user is within 150m of node', () => {
    // ~100m offset (approximately 0.0009 degrees latitude ≈ 100m)
    const userLat = nodeLat + 0.0009
    expect(classifyProximity(userLat, nodeLng, nodeLat, nodeLng)).toBe('Proximity_Report')
  })

  it('returns Remote_Report when user is more than 150m from node', () => {
    // ~200m offset (approximately 0.0018 degrees latitude ≈ 200m)
    const userLat = nodeLat + 0.0018
    expect(classifyProximity(userLat, nodeLng, nodeLat, nodeLng)).toBe('Remote_Report')
  })

  it('returns Proximity_Report at exactly 150m boundary', () => {
    // Use haversineDistance to find a point exactly at 150m
    // At this latitude, 1 degree ≈ 111,000m, so 150m ≈ 0.00135 degrees
    // We'll verify by computing the actual distance
    const offset = PROXIMITY_THRESHOLD_M / 111_320 // approximate degrees for 150m
    const userLat = nodeLat + offset
    const distance = haversineDistance(userLat, nodeLng, nodeLat, nodeLng)

    // The point should be very close to 150m
    expect(distance).toBeLessThanOrEqual(PROXIMITY_THRESHOLD_M + 1) // allow 1m tolerance
    expect(classifyProximity(userLat, nodeLng, nodeLat, nodeLng)).toBe('Proximity_Report')
  })

  it('uses the PROXIMITY_THRESHOLD_M constant of 150', () => {
    expect(PROXIMITY_THRESHOLD_M).toBe(150)
  })
})
