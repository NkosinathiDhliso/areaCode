import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { analyzeTrends } from '../../analyzers/trends.js'
import type { ReportMetrics } from '../../types.js'

/**
 * Property 8: Trend Computation Correctness
 *
 * For any pair of current and previous metric values where previous > 0:
 * - percentChange = (current − previous) / previous × 100
 * - direction = "up" when percentChange > 1, "down" when < −1, "flat" when ±1
 * - When previous metrics are null, hasPriorData = false
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

/** Generate a ReportMetrics object with non-negative values */
const reportMetricsArb: fc.Arbitrary<ReportMetrics> = fc.record({
  totalCheckIns: fc.integer({ min: 0, max: 10000 }),
  uniqueVisitors: fc.integer({ min: 0, max: 5000 }),
  repeatVisitorRate: fc.double({ min: 0, max: 100, noNaN: true }),
  pulseScore: fc.double({ min: 0, max: 100, noNaN: true }),
})

/** Generate a ReportMetrics object with all positive values (no division by zero) */
const positiveMetricsArb: fc.Arbitrary<ReportMetrics> = fc.record({
  totalCheckIns: fc.integer({ min: 1, max: 10000 }),
  uniqueVisitors: fc.integer({ min: 1, max: 5000 }),
  repeatVisitorRate: fc.double({ min: 0.01, max: 100, noNaN: true }),
  pulseScore: fc.double({ min: 0.01, max: 100, noNaN: true }),
})

const TREND_METRICS = [
  'totalCheckIns',
  'uniqueVisitors',
  'repeatVisitorRate',
  'pulseScore',
] as const

// ─── Property 8: Trend Computation Correctness ──────────────────────────────

describe('Feature: venue-intelligence-reports, Property 8: Trend Computation Correctness', () => {
  it('percentChange equals (current − previous) / previous × 100 when previous > 0', () => {
    /**
     * **Validates: Requirements 6.1, 6.2**
     */
    fc.assert(
      fc.property(
        reportMetricsArb,
        positiveMetricsArb,
        (currentMetrics, previousMetrics) => {
          const result = analyzeTrends(currentMetrics, previousMetrics)

          expect(result.hasPriorData).toBe(true)

          for (const key of TREND_METRICS) {
            const delta = result.metrics[key]!
            const current = currentMetrics[key]
            const previous = previousMetrics[key]

            const expectedChange = ((current - previous) / previous) * 100
            expect(delta.percentChange).toBeCloseTo(expectedChange, 5)
            expect(delta.current).toBe(current)
            expect(delta.previous).toBe(previous)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('direction labels are correct per ±1% threshold', () => {
    /**
     * **Validates: Requirements 6.2**
     */
    fc.assert(
      fc.property(
        reportMetricsArb,
        positiveMetricsArb,
        (currentMetrics, previousMetrics) => {
          const result = analyzeTrends(currentMetrics, previousMetrics)

          for (const key of TREND_METRICS) {
            const delta = result.metrics[key]!
            const { percentChange, direction } = delta

            if (percentChange > 1) {
              expect(direction).toBe('up')
            } else if (percentChange < -1) {
              expect(direction).toBe('down')
            } else {
              expect(direction).toBe('flat')
            }
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('hasPriorData is false when previousMetrics is null', () => {
    /**
     * **Validates: Requirements 6.3**
     */
    fc.assert(
      fc.property(reportMetricsArb, (currentMetrics) => {
        const result = analyzeTrends(currentMetrics, null)

        expect(result.hasPriorData).toBe(false)

        // All metrics should still be present with current values
        for (const key of TREND_METRICS) {
          const delta = result.metrics[key]!
          expect(delta.current).toBe(currentMetrics[key])
        }
      }),
      { numRuns: 100 },
    )
  })

  it('handles division by zero: previous = 0, current > 0 → direction = "up", percentChange = 100', () => {
    /**
     * **Validates: Requirements 6.1, 6.2**
     */
    const zeroMetrics: ReportMetrics = {
      totalCheckIns: 0,
      uniqueVisitors: 0,
      repeatVisitorRate: 0,
      pulseScore: 0,
    }

    fc.assert(
      fc.property(positiveMetricsArb, (currentMetrics) => {
        const result = analyzeTrends(currentMetrics, zeroMetrics)

        expect(result.hasPriorData).toBe(true)

        for (const key of TREND_METRICS) {
          const delta = result.metrics[key]!
          // current > 0 and previous = 0 → up with 100%
          expect(delta.direction).toBe('up')
          expect(delta.percentChange).toBe(100)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('handles division by zero: previous = 0, current = 0 → direction = "flat", percentChange = 0', () => {
    /**
     * **Validates: Requirements 6.1, 6.2**
     */
    const zeroMetrics: ReportMetrics = {
      totalCheckIns: 0,
      uniqueVisitors: 0,
      repeatVisitorRate: 0,
      pulseScore: 0,
    }

    const result = analyzeTrends(zeroMetrics, zeroMetrics)

    expect(result.hasPriorData).toBe(true)

    for (const key of TREND_METRICS) {
      const delta = result.metrics[key]!
      expect(delta.direction).toBe('flat')
      expect(delta.percentChange).toBe(0)
    }
  })
})
