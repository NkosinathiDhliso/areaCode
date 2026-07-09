import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { analyzeBenchmarks } from '../../analyzers/benchmarks.js'
import type { ReportMetrics } from '../../types.js'

/**
 * Property 9: Benchmark Computation Correctness
 *
 * For any list of 3 or more venue metric sets:
 * - benchmarkAverage = sum of metric across all venues / venue count
 * - percentAboveBelow = (venueValue − average) / average × 100
 * - When fewer than 3 venues exist, hasInsufficientData = true
 *
 * **Validates: Requirements 7.1, 7.2, 7.4**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

/** Generate a ReportMetrics object with non-negative values */
const reportMetricsArb: fc.Arbitrary<ReportMetrics> = fc.record({
  totalCheckIns: fc.integer({ min: 0, max: 10000 }),
  uniqueVisitors: fc.integer({ min: 0, max: 5000 }),
  repeatVisitorRate: fc.double({ min: 0, max: 100, noNaN: true }),
  pulseScore: fc.double({ min: 0, max: 100, noNaN: true }),
})

/** Generate a ReportMetrics object with positive values (avoids division by zero in averages) */
const positiveMetricsArb: fc.Arbitrary<ReportMetrics> = fc.record({
  totalCheckIns: fc.integer({ min: 1, max: 10000 }),
  uniqueVisitors: fc.integer({ min: 1, max: 5000 }),
  repeatVisitorRate: fc.double({ min: 0.01, max: 100, noNaN: true }),
  pulseScore: fc.double({ min: 0.01, max: 100, noNaN: true }),
})

const BENCHMARK_METRICS = ['totalCheckIns', 'uniqueVisitors', 'repeatVisitorRate', 'pulseScore'] as const

// ─── Property 9: Benchmark Computation Correctness ──────────────────────────

describe('Feature: venue-intelligence-reports, Property 9: Benchmark Computation Correctness', () => {
  it('average equals sum / count and percentAboveBelow equals (venue − avg) / avg × 100', () => {
    /**
     * **Validates: Requirements 7.1, 7.2**
     */
    fc.assert(
      fc.property(
        positiveMetricsArb,
        fc.array(positiveMetricsArb, { minLength: 3, maxLength: 20 }),
        (venueMetrics, categoryVenueMetrics) => {
          const result = analyzeBenchmarks(venueMetrics, categoryVenueMetrics)

          expect(result.hasInsufficientData).toBe(false)

          for (const key of BENCHMARK_METRICS) {
            const comparison = result.metrics[key]!

            // Verify venue value
            expect(comparison.venueValue).toBe(venueMetrics[key])

            // Verify benchmark average = sum / count
            const sum = categoryVenueMetrics.reduce((s, m) => s + m[key], 0)
            const expectedAverage = sum / categoryVenueMetrics.length
            expect(comparison.benchmarkAverage).toBeCloseTo(expectedAverage, 5)

            // Verify percentAboveBelow = (venue − avg) / avg × 100
            const expectedPercent = ((venueMetrics[key] - expectedAverage) / expectedAverage) * 100
            expect(comparison.percentAboveBelow).toBeCloseTo(expectedPercent, 5)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('returns hasInsufficientData when fewer than 3 venues', () => {
    /**
     * **Validates: Requirements 7.4**
     */
    fc.assert(
      fc.property(
        reportMetricsArb,
        fc.array(reportMetricsArb, { minLength: 0, maxLength: 2 }),
        (venueMetrics, categoryVenueMetrics) => {
          const result = analyzeBenchmarks(venueMetrics, categoryVenueMetrics)

          expect(result.hasInsufficientData).toBe(true)
          expect(Object.keys(result.metrics)).toHaveLength(0)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('handles division by zero: average = 0 results in percentAboveBelow = 0', () => {
    /**
     * **Validates: Requirements 7.1, 7.2**
     */
    const zeroMetrics: ReportMetrics = {
      totalCheckIns: 0,
      uniqueVisitors: 0,
      repeatVisitorRate: 0,
      pulseScore: 0,
    }

    const categoryMetrics = [zeroMetrics, zeroMetrics, zeroMetrics]
    const result = analyzeBenchmarks(zeroMetrics, categoryMetrics)

    expect(result.hasInsufficientData).toBe(false)

    for (const key of BENCHMARK_METRICS) {
      const comparison = result.metrics[key]!
      expect(comparison.benchmarkAverage).toBe(0)
      expect(comparison.percentAboveBelow).toBe(0)
    }
  })
})
