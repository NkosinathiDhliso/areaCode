import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { reportSchema } from '../types'
import type { Report } from '../types'

/**
 * Property 13: Report Serialization Round-Trip
 *
 * For any valid Report object conforming to the v1 schema,
 * serializing to JSON and then parsing back SHALL produce
 * an object deeply equal to the original.
 *
 * **Validates: Requirements 14.1, 14.4**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const TIERS = ['local', 'regular', 'fixture', 'institution', 'legend'] as const
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
  'gospel',
  'maskandi',
] as const
const DIMENSIONS = ['energy', 'cultural_rootedness', 'sophistication', 'edge', 'spirituality'] as const
const REC_TYPES = ['peak_hours', 'music', 'retention', 'benchmark', 'general'] as const

/** Avoid -0 which doesn't survive JSON round-trip (JSON.stringify(-0) === "0") */
const safeDouble = (opts: { min: number; max: number }) =>
  fc.double({ ...opts, noNaN: true }).map((v) => {
    const rounded = Math.round(v * 100) / 100
    return Object.is(rounded, -0) ? 0 : rounded
  })

const safeDouble3 = (opts: { min: number; max: number }) =>
  fc.double({ ...opts, noNaN: true }).map((v) => {
    const rounded = Math.round(v * 1000) / 1000
    return Object.is(rounded, -0) ? 0 : rounded
  })

const isoDateArb = fc
  .integer({
    min: new Date('2024-01-01').getTime(),
    max: new Date('2026-12-31').getTime(),
  })
  .map((ts) => new Date(ts).toISOString())

const peakHoursResultArb = fc.record({
  hourlyDistribution: fc
    .tuple(
      ...Array.from({ length: 24 }, (_, i) => fc.integer({ min: 0, max: 500 }).map((count) => [i, count] as const)),
    )
    .map((entries) => Object.fromEntries(entries) as Record<number, number>),
  dailyDistribution: fc
    .tuple(...DAYS_OF_WEEK.map((day) => fc.integer({ min: 0, max: 500 }).map((count) => [day, count] as const)))
    .map((entries) => Object.fromEntries(entries) as Record<string, number>),
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
  tierPercentages: fc
    .tuple(...TIERS.map((tier) => safeDouble({ min: 0, max: 100 }).map((pct) => [tier, pct] as const)))
    .map((entries) => Object.fromEntries(entries) as Record<string, number>),
  tierUniqueCounts: fc
    .tuple(...TIERS.map((tier) => fc.integer({ min: 0, max: 500 }).map((count) => [tier, count] as const)))
    .map((entries) => Object.fromEntries(entries) as Record<string, number>),
  totalUniqueVisitors: fc.integer({ min: 0, max: 2500 }),
  hasInsufficientData: fc.boolean(),
})

const musicProfileResultArb = fc.record({
  archetypeDimensions: fc
    .tuple(...DIMENSIONS.map((dim) => safeDouble3({ min: 0, max: 1 }).map((val) => [dim, val] as const)))
    .map((entries) => Object.fromEntries(entries) as Record<string, number>),
  topGenres: fc.array(
    fc.record({
      genre: fc.constantFrom(...GENRES),
      visitorCount: fc.integer({ min: 0, max: 500 }),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  hasInsufficientData: fc.boolean(),
})

const repeatVisitorResultArb = fc.record({
  repeatRate: safeDouble({ min: 0, max: 100 }),
  firstTimeVisitorCount: fc.integer({ min: 0, max: 1000 }),
  totalUniqueVisitors: fc.integer({ min: 0, max: 1000 }),
  hasPriorData: fc.boolean(),
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

const reportSummaryArb = fc.record({
  totalCheckIns: fc.integer({ min: 0, max: 10000 }),
  pulseState: fc.constantFrom(...PULSE_STATES),
  topGenre: fc.option(fc.constantFrom(...GENRES), { nil: null }),
  headlineRecommendation: fc.string({ minLength: 1, maxLength: 300 }),
  pulseScore: fc.integer({ min: 0, max: 100 }),
})

const reportArb: fc.Arbitrary<Report> = fc.record({
  reportId: fc.uuid(),
  businessId: fc.uuid(),
  schemaVersion: fc.constant('v1' as const),
  periodType: fc.constantFrom('weekly' as const, 'monthly' as const),
  periodStart: isoDateArb,
  periodEnd: isoDateArb,
  generatedAt: isoDateArb,
  nodes: fc.array(
    fc.record({
      nodeId: fc.uuid(),
      nodeName: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
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

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: venue-intelligence-reports, Property 13: Report Serialization Round-Trip', () => {
  it('JSON.parse(JSON.stringify(report)) deeply equals original for any valid Report', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const serialized = JSON.stringify(report)
        const deserialized = JSON.parse(serialized)
        expect(deserialized).toEqual(report)
      }),
      { numRuns: 25 },
    )
  })

  it('serialized report always passes Zod schema validation', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const serialized = JSON.stringify(report)
        const deserialized = JSON.parse(serialized)
        const result = reportSchema.safeParse(deserialized)
        expect(result.success).toBe(true)
      }),
      { numRuns: 25 },
    )
  })
})
