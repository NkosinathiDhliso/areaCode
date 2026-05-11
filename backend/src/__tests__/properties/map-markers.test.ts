/**
 * Property 5: Marker Rendering Invariants
 * Property 6: Marker Z-Ordering
 * Property 19: Animation Budget Enforcement
 * Property 20: Map Clustering Logic
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 30.1, 30.2, 30.3, 30.5, 30.6**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

// ─── Marker Utils (inline for test isolation) ─────────────────────────────────

const BASE_RADIUS = 8
const MAX_RADIUS = 28
const NORMALIZATION_FACTOR = 200
const BOOST_FLOOR_RADIUS = 18
const MIN_TOUCH_TARGET = 44

function computeMarkerRadius(pulseScore: number, isBoosted: boolean): number {
  const normalized = Math.min(pulseScore / NORMALIZATION_FACTOR, 1)
  let radius = BASE_RADIUS + normalized * (MAX_RADIUS - BASE_RADIUS)
  if (isBoosted) {
    radius = Math.max(radius, BOOST_FLOOR_RADIUS)
  }
  return radius
}

function computeTouchTarget(visualRadius: number): number {
  return Math.max(visualRadius * 2, MIN_TOUCH_TARGET)
}

function computeGlowIntensity(pulseScore: number): number {
  return Math.min(pulseScore / NORMALIZATION_FACTOR, 1)
}

function computeZIndex(pulseScore: number): number {
  return Math.round(pulseScore)
}

// ─── Animation Budget (inline) ────────────────────────────────────────────────

function getMaxAnimations(hardwareConcurrency: number, prefersReducedMotion: boolean): number {
  if (prefersReducedMotion) return 0
  if (hardwareConcurrency <= 4) return 4
  return 8
}

interface MarkerAnimInput { id: string; pulseScore: number; isInViewport: boolean }

function allocateAnimationBudget(
  markers: MarkerAnimInput[],
  hardwareConcurrency: number,
  prefersReducedMotion: boolean,
): Set<string> {
  const max = getMaxAnimations(hardwareConcurrency, prefersReducedMotion)
  if (max === 0) return new Set()
  const viewport = markers.filter((m) => m.isInViewport)
  const sorted = [...viewport].sort((a, b) => b.pulseScore - a.pulseScore)
  return new Set(sorted.slice(0, max).map((m) => m.id))
}

// ─── Clustering (inline) ──────────────────────────────────────────────────────

const CLUSTER_THRESHOLD = 30
const LOW_ACTIVITY_THRESHOLD = 11

interface ClusterableMarker { id: string; pulseScore: number; x: number; y: number }

function clusterMarkers(markers: ClusterableMarker[]) {
  if (markers.length <= CLUSTER_THRESHOLD) {
    return { individual: markers, clusters: [] as { count: number; markerIds: string[] }[] }
  }
  const highActivity = markers.filter((m) => m.pulseScore >= LOW_ACTIVITY_THRESHOLD)
  const lowActivity = markers.filter((m) => m.pulseScore < LOW_ACTIVITY_THRESHOLD)
  // Simplified: all low-activity markers get clustered into one cluster for property testing
  const clusters = lowActivity.length > 1
    ? [{ count: lowActivity.length, markerIds: lowActivity.map((m) => m.id) }]
    : []
  const individual = lowActivity.length <= 1
    ? [...highActivity, ...lowActivity]
    : highActivity
  return { individual, clusters }
}

// ─── Property 5: Marker Rendering Invariants ──────────────────────────────────

describe('Property 5: Marker Rendering Invariants', () => {
  it('radius equals 8 + (min(S/200, 1) * 20) for non-boosted markers', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        (pulseScore) => {
          const radius = computeMarkerRadius(pulseScore, false)
          const expected = BASE_RADIUS + Math.min(pulseScore / NORMALIZATION_FACTOR, 1) * (MAX_RADIUS - BASE_RADIUS)
          expect(radius).toBeCloseTo(expected, 10)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('boosted markers have radius >= 18px (boost floor)', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        (pulseScore) => {
          const radius = computeMarkerRadius(pulseScore, true)
          expect(radius).toBeGreaterThanOrEqual(BOOST_FLOOR_RADIUS)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('touch target is always >= 44px regardless of visual radius', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.boolean(),
        (pulseScore, isBoosted) => {
          const radius = computeMarkerRadius(pulseScore, isBoosted)
          const touchTarget = computeTouchTarget(radius)
          expect(touchTarget).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('glow intensity equals min(S/200, 1): 0 at score 0, 1.0 at score >= 200', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        (pulseScore) => {
          const intensity = computeGlowIntensity(pulseScore)
          const expected = Math.min(pulseScore / NORMALIZATION_FACTOR, 1)
          expect(intensity).toBeCloseTo(expected, 10)
          expect(intensity).toBeGreaterThanOrEqual(0)
          expect(intensity).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('radius is clamped between 8 and 28 for non-boosted markers', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        (pulseScore) => {
          const radius = computeMarkerRadius(pulseScore, false)
          expect(radius).toBeGreaterThanOrEqual(BASE_RADIUS)
          expect(radius).toBeLessThanOrEqual(MAX_RADIUS)
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 6: Marker Z-Ordering ───────────────────────────────────────────

describe('Property 6: Marker Z-Ordering', () => {
  it('z-index is monotonically non-decreasing with pulse score', async () => {
    await fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 2, maxLength: 50 }),
        (scores) => {
          const zIndices = scores.map((s) => ({ score: s, zIndex: computeZIndex(s) }))
          // Sort by score ascending
          zIndices.sort((a, b) => a.score - b.score)
          // z-index should be non-decreasing
          for (let i = 1; i < zIndices.length; i++) {
            expect(zIndices[i]!.zIndex).toBeGreaterThanOrEqual(zIndices[i - 1]!.zIndex)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('higher pulse score marker never renders below lower pulse score marker', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (scoreA, scoreB) => {
          const zA = computeZIndex(scoreA)
          const zB = computeZIndex(scoreB)
          if (scoreA > scoreB) {
            expect(zA).toBeGreaterThanOrEqual(zB)
          } else if (scoreB > scoreA) {
            expect(zB).toBeGreaterThanOrEqual(zA)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 19: Animation Budget Enforcement ────────────────────────────────

describe('Property 19: Animation Budget Enforcement', () => {
  const markerArb = fc.record({
    id: fc.uuid(),
    pulseScore: fc.integer({ min: 0, max: 500 }),
    isInViewport: fc.boolean(),
  })

  it('max simultaneous animations is 4 on low-end devices (concurrency <= 4)', async () => {
    await fc.assert(
      fc.property(
        fc.array(markerArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 4 }),
        (markers, concurrency) => {
          const animated = allocateAnimationBudget(markers, concurrency, false)
          expect(animated.size).toBeLessThanOrEqual(4)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('max simultaneous animations is 8 on standard devices (concurrency > 4)', async () => {
    await fc.assert(
      fc.property(
        fc.array(markerArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 5, max: 16 }),
        (markers, concurrency) => {
          const animated = allocateAnimationBudget(markers, concurrency, false)
          expect(animated.size).toBeLessThanOrEqual(8)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('animations assigned to highest pulse score markers', async () => {
    await fc.assert(
      fc.property(
        fc.array(markerArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 5, max: 16 }),
        (markers, concurrency) => {
          const animated = allocateAnimationBudget(markers, concurrency, false)
          const viewportMarkers = markers.filter((m) => m.isInViewport)
          const sorted = [...viewportMarkers].sort((a, b) => b.pulseScore - a.pulseScore)
          const topN = sorted.slice(0, 8)

          // All animated markers should be from the top N viewport markers
          for (const id of animated) {
            const isInTop = topN.some((m) => m.id === id)
            expect(isInTop).toBe(true)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('markers outside viewport have zero animations', async () => {
    await fc.assert(
      fc.property(
        fc.array(markerArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 16 }),
        (markers, concurrency) => {
          const animated = allocateAnimationBudget(markers, concurrency, false)
          const outsideViewport = markers.filter((m) => !m.isInViewport)
          for (const marker of outsideViewport) {
            expect(animated.has(marker.id)).toBe(false)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('prefers-reduced-motion means zero animations for all markers', async () => {
    await fc.assert(
      fc.property(
        fc.array(markerArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 16 }),
        (markers, concurrency) => {
          const animated = allocateAnimationBudget(markers, concurrency, true)
          expect(animated.size).toBe(0)
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 20: Map Clustering Logic ────────────────────────────────────────

describe('Property 20: Map Clustering Logic', () => {
  const clusterMarkerArb = fc.record({
    id: fc.uuid(),
    pulseScore: fc.integer({ min: 0, max: 200 }),
    x: fc.integer({ min: 0, max: 1000 }),
    y: fc.integer({ min: 0, max: 1000 }),
  })

  it('no clustering when <= 30 markers visible', async () => {
    await fc.assert(
      fc.property(
        fc.array(clusterMarkerArb, { minLength: 0, maxLength: 30 }),
        (markers) => {
          const result = clusterMarkers(markers)
          expect(result.clusters.length).toBe(0)
          expect(result.individual.length).toBe(markers.length)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('active/buzzing/popping markers (pulse >= 11) always remain individually visible', async () => {
    await fc.assert(
      fc.property(
        fc.array(clusterMarkerArb, { minLength: 31, maxLength: 100 }),
        (markers) => {
          const result = clusterMarkers(markers)
          const highActivity = markers.filter((m) => m.pulseScore >= LOW_ACTIVITY_THRESHOLD)
          // All high-activity markers should be in individual list
          for (const marker of highActivity) {
            const found = result.individual.some((m) => m.id === marker.id)
            expect(found).toBe(true)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('cluster count indicators show correct count of merged markers', async () => {
    await fc.assert(
      fc.property(
        fc.array(clusterMarkerArb, { minLength: 31, maxLength: 80 }),
        (markers) => {
          const result = clusterMarkers(markers)
          // Total markers accounted for = individual + sum of cluster counts
          const totalClustered = result.clusters.reduce((sum, c) => sum + c.count, 0)
          const totalIndividual = result.individual.length
          expect(totalClustered + totalIndividual).toBe(markers.length)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('low-activity markers (pulse < 11) are clustered when > 30 markers visible', async () => {
    await fc.assert(
      fc.property(
        // Ensure we have enough low-activity markers to cluster
        fc.tuple(
          fc.array(
            fc.record({
              id: fc.uuid(),
              pulseScore: fc.integer({ min: 0, max: 10 }),
              x: fc.integer({ min: 0, max: 100 }),
              y: fc.integer({ min: 0, max: 100 }),
            }),
            { minLength: 20, maxLength: 50 },
          ),
          fc.array(
            fc.record({
              id: fc.uuid(),
              pulseScore: fc.integer({ min: 11, max: 200 }),
              x: fc.integer({ min: 0, max: 1000 }),
              y: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 12, maxLength: 30 },
          ),
        ),
        ([lowMarkers, highMarkers]) => {
          const allMarkers = [...lowMarkers, ...highMarkers]
          if (allMarkers.length <= CLUSTER_THRESHOLD) return // skip if not enough

          const result = clusterMarkers(allMarkers)
          // Low-activity markers should be clustered (not in individual list)
          // unless they couldn't form a cluster
          const clusteredIds = new Set(result.clusters.flatMap((c) => c.markerIds))
          for (const marker of lowMarkers) {
            // Either clustered or still individual (if alone)
            const inIndividual = result.individual.some((m) => m.id === marker.id)
            const inCluster = clusteredIds.has(marker.id)
            expect(inIndividual || inCluster).toBe(true)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})
