import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { filterByTier } from '../tier-gating'
import type { Report, TeaserReport } from '../types'

/**
 * Property 12: Tier Gating Correctness
 *
 * For any full Report and business tier, when the tier is "growth" or "pro"
 * the API response SHALL contain all report sections (peakHours, crowdComposition,
 * musicProfile, repeatVisitors, trends, benchmarks, recommendations, journeyInsights),
 * and when the tier is "starter" or "payg" the response SHALL contain only the
 * summary fields (totalCheckIns, pulseState, topGenre, headlineRecommendation)
 * plus an upgradeMessage.
 *
 * **Validates: Requirements 10.1, 10.2, 10.3**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const TIERS_LIST = ['local', 'regular', 'fixture', 'institution', 'legend'] as const
const PULSE_STATES = ['dormant', 'quiet', 'active', 'buzzing', 'popping'] as const
const GENRES = [
  'amapiano',
  'deep_house',
  'afrobeats',
  'hip_hop',
  'rnb',
  'kwaito',
  'gqom',
  'jazz',
  'rock',
  'pop',
] as const
const DIMENSIONS = ['energy', 'cultural_rootedness', 'sophistication', 'edge', 'spirituality'] as const
const REC_TYPES = ['peak_hours', 'music', 'retention', 'benchmark', 'general'] as const

const safeDouble = (opts: { min: number; max: number }) =>
  fc.double({ ...opts, noNaN: true }).map((v) => {
    const rounded = Math.round(v * 100) / 100
    return Object.is(rounded, -0) ? 0 : rounded
  })

const isoDateArb = fc
  .integer({
    min: new Date('2024-01-01').getTime(),
    max: new Date('2026-12-31').getTime(),
  })
  .map((ts) => new Date(ts).toISOString())

const reportSummaryArb = fc.record({
  totalCheckIns: fc.integer({ min: 0, max: 10000 }),
  pulseState: fc.constantFrom(...PULSE_STATES),
  topGenre: fc.option(fc.constantFrom(...GENRES), { nil: null }),
  headlineRecommendation: fc.string({ minLength: 1, maxLength: 200 }),
  pulseScore: fc.integer({ min: 0, max: 100 }),
})

const peakHoursResultArb = fc.record({
  hourlyDistribution: fc.constant(
    Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, 0])) as Record<number, number>,
  ),
  dailyDistribution: fc.constant(Object.fromEntries(DAYS_OF_WEEK.map((d) => [d, 0])) as Record<string, number>),
  topWindows: fc.array(
    fc.record({
      startHour: fc.integer({ min: 0, max: 23 }),
      endHour: fc.integer({ min: 0, max: 23 }),
      count: fc.integer({ min: 0, max: 1000 }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  peakDay: fc.constantFrom(...DAYS_OF_WEEK),
  hasInsufficientData: fc.boolean(),
})

const crowdCompositionResultArb = fc.record({
  tierPercentages: fc.constant(Object.fromEntries(TIERS_LIST.map((t) => [t, 20])) as Record<string, number>),
  tierUniqueCounts: fc.constant(Object.fromEntries(TIERS_LIST.map((t) => [t, 10])) as Record<string, number>),
  totalUniqueVisitors: fc.integer({ min: 0, max: 2500 }),
  hasInsufficientData: fc.boolean(),
})

const musicProfileResultArb = fc.record({
  archetypeDimensions: fc.constant(Object.fromEntries(DIMENSIONS.map((d) => [d, 0.5])) as Record<string, number>),
  topGenres: fc.array(
    fc.record({ genre: fc.constantFrom(...GENRES), visitorCount: fc.integer({ min: 0, max: 500 }) }),
    { minLength: 0, maxLength: 5 },
  ),
  hasInsufficientData: fc.boolean(),
})

const repeatVisitorResultArb = fc.record({
  repeatRate: safeDouble({ min: 0, max: 100 }),
  hasPriorData: fc.boolean(),
  firstTimeVisitorCount: fc.integer({ min: 0, max: 1000 }),
  totalUniqueVisitors: fc.integer({ min: 0, max: 1000 }),
})

const trendDeltaArb = fc.record({
  current: safeDouble({ min: 0, max: 10000 }),
  previous: safeDouble({ min: 0, max: 10000 }),
  percentChange: safeDouble({ min: -1000, max: 1000 }),
  direction: fc.constantFrom('up' as const, 'down' as const, 'flat' as const),
})

const trendResultArb = fc.record({
  metrics: fc.record({
    totalCheckIns: trendDeltaArb,
    uniqueVisitors: trendDeltaArb,
    repeatVisitorRate: trendDeltaArb,
    pulseScore: trendDeltaArb,
  }),
  hasPriorData: fc.boolean(),
})

const benchmarkComparisonArb = fc.record({
  venueValue: safeDouble({ min: 0, max: 10000 }),
  benchmarkAverage: safeDouble({ min: 0, max: 10000 }),
  percentAboveBelow: safeDouble({ min: -1000, max: 1000 }),
})

const benchmarkResultArb = fc.record({
  metrics: fc.record({
    totalCheckIns: benchmarkComparisonArb,
    uniqueVisitors: benchmarkComparisonArb,
    repeatVisitorRate: benchmarkComparisonArb,
    pulseScore: benchmarkComparisonArb,
  }),
  hasInsufficientData: fc.boolean(),
})

const journeyResultArb = fc.record({
  topOverlapVenues: fc.array(
    fc.record({
      venueName: fc.string({ minLength: 1, maxLength: 50 }),
      overlapPercentage: safeDouble({ min: 0, max: 100 }),
      overlapCount: fc.integer({ min: 0, max: 500 }),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  partnershipSuggestions: fc.array(fc.string({ minLength: 1, maxLength: 200 }), { minLength: 0, maxLength: 2 }),
  hasInsufficientData: fc.boolean(),
})

const recommendationResultArb = fc.record({
  recommendations: fc.array(
    fc.record({
      type: fc.constantFrom(...REC_TYPES),
      text: fc.string({ minLength: 1, maxLength: 300 }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
})

const reportArb: fc.Arbitrary<Report> = fc.record({
  reportId: fc.uuid(),
  businessId: fc.uuid(),
  schemaVersion: fc.constant('v1' as const),
  periodType: fc.constantFrom('weekly' as const, 'monthly' as const),
  periodStart: isoDateArb,
  periodEnd: isoDateArb,
  generatedAt: isoDateArb,
  nodes: fc.array(fc.record({ nodeId: fc.uuid(), nodeName: fc.string({ minLength: 1, maxLength: 50 }) }), {
    minLength: 1,
    maxLength: 5,
  }),
  summary: reportSummaryArb,
  peakHours: peakHoursResultArb,
  crowdComposition: crowdCompositionResultArb,
  musicProfile: fc.option(musicProfileResultArb, { nil: null }),
  repeatVisitors: repeatVisitorResultArb,
  trends: trendResultArb,
  benchmarks: fc.option(benchmarkResultArb, { nil: null }),
  journeyInsights: fc.option(journeyResultArb, { nil: null }),
  recommendations: recommendationResultArb,
})

/** Full-access tiers */
const fullTierArb = fc.constantFrom('growth', 'pro')

/** Restricted tiers */
const restrictedTierArb = fc.constantFrom('starter', 'payg', 'free')

// ─── Sections that must be present on a full report ─────────────────────────

const FULL_REPORT_SECTIONS = [
  'peakHours',
  'crowdComposition',
  'musicProfile',
  'repeatVisitors',
  'trends',
  'benchmarks',
  'recommendations',
  'journeyInsights',
] as const

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: venue-intelligence-reports, Property 12: Tier Gating Correctness', () => {
  it('growth/pro tiers → all report sections present', () => {
    fc.assert(
      fc.property(reportArb, fullTierArb, (report, tier) => {
        const result = filterByTier(report, tier)

        // Should return the full report (not a teaser)
        for (const section of FULL_REPORT_SECTIONS) {
          expect(result).toHaveProperty(section)
        }

        // Should NOT have upgradeMessage
        expect(result).not.toHaveProperty('upgradeMessage')

        // All section values should match the original report
        const fullResult = result as Report
        expect(fullResult.peakHours).toEqual(report.peakHours)
        expect(fullResult.crowdComposition).toEqual(report.crowdComposition)
        expect(fullResult.musicProfile).toEqual(report.musicProfile)
        expect(fullResult.repeatVisitors).toEqual(report.repeatVisitors)
        expect(fullResult.trends).toEqual(report.trends)
        expect(fullResult.benchmarks).toEqual(report.benchmarks)
        expect(fullResult.recommendations).toEqual(report.recommendations)
        expect(fullResult.journeyInsights).toEqual(report.journeyInsights)
      }),
      { numRuns: 25 },
    )
  })

  it('starter/payg/free tiers → only summary + upgradeMessage', () => {
    fc.assert(
      fc.property(reportArb, restrictedTierArb, (report, tier) => {
        const result = filterByTier(report, tier)

        // Should have summary fields
        const teaser = result as TeaserReport
        expect(teaser.reportId).toBe(report.reportId)
        expect(teaser.businessId).toBe(report.businessId)
        expect(teaser.schemaVersion).toBe('v1')
        expect(teaser.periodType).toBe(report.periodType)
        expect(teaser.periodStart).toBe(report.periodStart)
        expect(teaser.periodEnd).toBe(report.periodEnd)
        expect(teaser.generatedAt).toBe(report.generatedAt)
        expect(teaser.summary).toEqual(report.summary)

        // Should have upgradeMessage
        expect(teaser.upgradeMessage).toBeDefined()
        expect(typeof teaser.upgradeMessage).toBe('string')
        expect(teaser.upgradeMessage.length).toBeGreaterThan(0)

        // Should NOT have detailed sections
        for (const section of FULL_REPORT_SECTIONS) {
          expect(result).not.toHaveProperty(section)
        }
      }),
      { numRuns: 25 },
    )
  })
})
