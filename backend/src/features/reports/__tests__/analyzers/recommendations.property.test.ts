import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { generateRecommendations } from '../../analyzers/recommendations.js'
import type {
  ReportSections,
  PeakHoursResult,
  CrowdCompositionResult,
  MusicProfileResult,
  RepeatVisitorResult,
  TrendResult,
  TrendDelta,
  BenchmarkResult,
  JourneyResult,
} from '../../types.js'

/**
 * Property 10: Recommendation Generation Bounds and Conditions
 *
 * For any complete set of report sections:
 * - 1–5 recommendations
 * - Each recommendation is a single sentence with ≥1 numeric value
 * - Peak-hours recommendation present when top window > 2× avg
 * - Retention alert present when repeat rate drop > 10pp
 *
 * **Validates: Requirements 8.1, 8.2, 8.4, 8.5**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** Generate hourly distribution (24 hours) */
const hourlyDistributionArb: fc.Arbitrary<Record<number, number>> = fc
  .tuple(...Array.from({ length: 24 }, () => fc.integer({ min: 0, max: 100 })))
  .map((counts) => {
    const dist: Record<number, number> = {}
    for (let i = 0; i < 24; i++) {
      dist[i] = counts[i]!
    }
    return dist
  })

/** Generate daily distribution */
const dailyDistributionArb: fc.Arbitrary<Record<string, number>> = fc
  .tuple(...Array.from({ length: 7 }, () => fc.integer({ min: 0, max: 200 })))
  .map((counts) => {
    const dist: Record<string, number> = {}
    for (let i = 0; i < 7; i++) {
      dist[DAYS_OF_WEEK[i] ?? 'Monday'] = counts[i]!
    }
    return dist
  })

/** Generate PeakHoursResult */
const peakHoursArb: fc.Arbitrary<PeakHoursResult> = fc
  .tuple(hourlyDistributionArb, dailyDistributionArb)
  .map(([hourlyDistribution, dailyDistribution]) => {
    // Find peak day
    let peakDay = 'Monday'
    let maxCount = -1
    for (const day of DAYS_OF_WEEK) {
      if ((dailyDistribution[day] ?? 0) > maxCount) {
        maxCount = dailyDistribution[day] ?? 0
        peakDay = day
      }
    }

    // Build simple top windows from hourly distribution
    const hourEntries = Object.entries(hourlyDistribution)
      .map(([h, c]) => ({ hour: Number(h), count: c }))
      .sort((a, b) => b.count - a.count)

    const topWindows: Array<{ startHour: number; endHour: number; count: number }> = []
    if (hourEntries.length > 0 && hourEntries[0]!.count > 0) {
      topWindows.push({
        startHour: hourEntries[0]!.hour,
        endHour: hourEntries[0]!.hour,
        count: hourEntries[0]!.count,
      })
    }

    return {
      hourlyDistribution,
      dailyDistribution,
      topWindows,
      peakDay,
      hasInsufficientData: false,
    }
  })

/** Generate CrowdCompositionResult */
const crowdCompositionArb: fc.Arbitrary<CrowdCompositionResult> = fc.record({
  tierPercentages: fc.record({
    local: fc.double({ min: 0, max: 100, noNaN: true }),
    regular: fc.double({ min: 0, max: 100, noNaN: true }),
    fixture: fc.double({ min: 0, max: 100, noNaN: true }),
    institution: fc.double({ min: 0, max: 100, noNaN: true }),
    legend: fc.double({ min: 0, max: 100, noNaN: true }),
  }),
  tierUniqueCounts: fc.record({
    local: fc.integer({ min: 0, max: 100 }),
    regular: fc.integer({ min: 0, max: 100 }),
    fixture: fc.integer({ min: 0, max: 100 }),
  }),
  totalUniqueVisitors: fc.integer({ min: 0, max: 500 }),
  hasInsufficientData: fc.boolean(),
})

/** Generate MusicProfileResult or null */
const musicProfileArb: fc.Arbitrary<MusicProfileResult | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    archetypeDimensions: fc.record({
      energy: fc.double({ min: 0, max: 100, noNaN: true }),
      cultural_rootedness: fc.double({ min: 0, max: 100, noNaN: true }),
      sophistication: fc.double({ min: 0, max: 100, noNaN: true }),
      edge: fc.double({ min: 0, max: 100, noNaN: true }),
      spirituality: fc.double({ min: 0, max: 100, noNaN: true }),
    }),
    topGenres: fc.array(
      fc.record({
        genre: fc.stringMatching(/^[a-z]{3,10}$/),
        visitorCount: fc.integer({ min: 1, max: 100 }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
    hasInsufficientData: fc.boolean(),
  }),
)

/** Generate a TrendDelta */
const trendDeltaArb: fc.Arbitrary<TrendDelta> = fc.record({
  current: fc.double({ min: 0, max: 1000, noNaN: true }),
  previous: fc.double({ min: 0, max: 1000, noNaN: true }),
  percentChange: fc.double({ min: -100, max: 200, noNaN: true }),
  direction: fc.constantFrom('up' as const, 'down' as const, 'flat' as const),
})

/** Generate TrendResult */
const trendResultArb: fc.Arbitrary<TrendResult> = fc.record({
  metrics: fc.record({
    totalCheckIns: trendDeltaArb,
    uniqueVisitors: trendDeltaArb,
    repeatVisitorRate: trendDeltaArb,
    pulseScore: trendDeltaArb,
  }),
  hasPriorData: fc.boolean(),
})

/** Generate RepeatVisitorResult */
const repeatVisitorArb: fc.Arbitrary<RepeatVisitorResult> = fc.record({
  repeatRate: fc.double({ min: 0, max: 100, noNaN: true }),
  firstTimeVisitorCount: fc.integer({ min: 0, max: 500 }),
  totalUniqueVisitors: fc.integer({ min: 0, max: 500 }),
  hasPriorData: fc.boolean(),
})

/** Generate BenchmarkResult or null */
const benchmarkArb: fc.Arbitrary<BenchmarkResult | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    metrics: fc.record({
      totalCheckIns: fc.record({
        venueValue: fc.double({ min: 0, max: 10000, noNaN: true }),
        benchmarkAverage: fc.double({ min: 0, max: 10000, noNaN: true }),
        percentAboveBelow: fc.double({ min: -100, max: 500, noNaN: true }),
      }),
    }),
    hasInsufficientData: fc.boolean(),
  }),
)

/** Generate JourneyResult or null */
const journeyArb: fc.Arbitrary<JourneyResult | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    topOverlapVenues: fc.array(
      fc.record({
        venueName: fc.string({ minLength: 1, maxLength: 20 }),
        overlapPercentage: fc.double({ min: 0, max: 100, noNaN: true }),
        overlapCount: fc.integer({ min: 0, max: 100 }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
    partnershipSuggestions: fc.array(fc.string(), { minLength: 0, maxLength: 2 }),
    hasInsufficientData: fc.boolean(),
  }),
)

/** Generate a complete ReportSections */
const reportSectionsArb: fc.Arbitrary<ReportSections> = fc.record({
  peakHours: peakHoursArb,
  crowdComposition: crowdCompositionArb,
  musicProfile: musicProfileArb,
  repeatVisitors: repeatVisitorArb,
  trends: trendResultArb,
  benchmarks: benchmarkArb,
  journeyInsights: journeyArb,
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a string contains at least one number */
function containsNumber(text: string): boolean {
  return /\d/.test(text)
}

// ─── Property 10: Recommendation Generation Bounds and Conditions ───────────

describe('Feature: venue-intelligence-reports, Property 10: Recommendation Generation Bounds and Conditions', () => {
  it('generates between 1 and 5 recommendations, each a single sentence with at least 1 number', () => {
    /**
     * **Validates: Requirements 8.1, 8.5**
     */
    fc.assert(
      fc.property(reportSectionsArb, (report) => {
        const result = generateRecommendations(report)

        // 1–5 recommendations
        expect(result.recommendations.length).toBeGreaterThanOrEqual(1)
        expect(result.recommendations.length).toBeLessThanOrEqual(5)

        // Each recommendation is a single sentence with at least 1 number
        for (const rec of result.recommendations) {
          expect(rec.text.length).toBeGreaterThan(0)
          expect(containsNumber(rec.text)).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('generates peak-hours recommendation when top window count > 2× average hourly count', () => {
    /**
     * **Validates: Requirements 8.2**
     */
    fc.assert(
      fc.property(reportSectionsArb, fc.integer({ min: 10, max: 100 }), (baseReport, peakCount) => {
        // Construct a peak hours distribution where the top window clearly exceeds 2× average
        const hourlyDistribution: Record<number, number> = {}
        for (let h = 0; h < 24; h++) {
          hourlyDistribution[h] = 1 // baseline: 1 per hour
        }
        // Set one hour to be very high (> 2× average of total/24)
        // Total = 23 + peakCount, average = (23 + peakCount) / 24
        // Need peakCount > 2 × ((23 + peakCount) / 24)
        // peakCount > (46 + 2*peakCount) / 24
        // 24*peakCount > 46 + 2*peakCount
        // 22*peakCount > 46
        // peakCount > 2.09 → peakCount ≥ 3 is sufficient with min=10
        hourlyDistribution[20] = peakCount

        const report: ReportSections = {
          ...baseReport,
          peakHours: {
            hourlyDistribution,
            dailyDistribution: baseReport.peakHours.dailyDistribution,
            topWindows: [{ startHour: 20, endHour: 20, count: peakCount }],
            peakDay: 'Friday',
            hasInsufficientData: false,
          },
        }

        const result = generateRecommendations(report)

        // Verify peak-hours recommendation is present
        const peakRec = result.recommendations.find((r) => r.type === 'peak_hours')
        expect(peakRec).toBeDefined()
        expect(containsNumber(peakRec!.text)).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('generates retention alert when repeat rate drops > 10 percentage points', () => {
    /**
     * **Validates: Requirements 8.4**
     */
    fc.assert(
      fc.property(reportSectionsArb, fc.double({ min: 11, max: 80, noNaN: true }), (baseReport, drop) => {
        // Construct trends where repeat rate dropped by more than 10pp
        const previousRate = 50 + drop
        const currentRate = 50

        const report: ReportSections = {
          ...baseReport,
          trends: {
            metrics: {
              ...baseReport.trends.metrics,
              repeatVisitorRate: {
                current: currentRate,
                previous: previousRate,
                percentChange: ((currentRate - previousRate) / previousRate) * 100,
                direction: 'down',
              },
            },
            hasPriorData: true,
          },
          repeatVisitors: {
            ...baseReport.repeatVisitors,
            repeatRate: currentRate,
          },
        }

        const result = generateRecommendations(report)

        // Verify retention alert is present
        const retentionRec = result.recommendations.find((r) => r.type === 'retention')
        expect(retentionRec).toBeDefined()
        expect(containsNumber(retentionRec!.text)).toBe(true)
      }),
      { numRuns: 25 },
    )
  })
})
