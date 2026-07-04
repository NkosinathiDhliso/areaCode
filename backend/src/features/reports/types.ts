import { z } from 'zod'

// ============================================================================
// Internal Processing Types (never stored in reports)
// ============================================================================

export interface AnonymizedCheckIn {
  visitorToken: string // SHA-256 hash of userId + salt (period-stable)
  nodeId: string
  tier: string
  checkedInAt: string // ISO 8601
  hourOfDay: number // 0-23 SAST
  dayOfWeek: string // Monday-Sunday
}

export interface MusicPrefs {
  energy: number
  cultural_rootedness: number
  sophistication: number
  edge: number
  spirituality: number
  genres: string[]
}

export interface ReportMetrics {
  totalCheckIns: number
  uniqueVisitors: number
  repeatVisitorRate: number
  pulseScore: number
}

// ============================================================================
// Analyzer Result Types
// ============================================================================

export interface PeakHoursResult {
  hourlyDistribution: Record<number, number> // hour (0-23) -> count
  dailyDistribution: Record<string, number> // day name -> count
  topWindows: Array<{ startHour: number; endHour: number; count: number }> // top 3
  peakDay: string | null // null => no peak day (no check-ins)
  hasInsufficientData: boolean // check-in count below minimum
}

export interface CrowdCompositionResult {
  tierPercentages: Record<string, number> // tier -> percentage
  tierUniqueCounts: Record<string, number> // tier -> unique visitor count
  totalUniqueVisitors: number
  hasInsufficientData: boolean // unique visitor count below minimum
}

export interface MusicProfileResult {
  archetypeDimensions: Record<string, number> // dimension -> avg score
  topGenres: Array<{ genre: string; visitorCount: number }> // top 5
  hasInsufficientData: boolean
}

export interface RepeatVisitorResult {
  repeatRate: number // 0-100 percentage (meaningful only when hasPriorData)
  firstTimeVisitorCount: number
  totalUniqueVisitors: number
  hasPriorData: boolean // false => no prior-period tokens, repeat rate is unavailable
}

export interface TrendDelta {
  current: number
  previous: number
  percentChange: number
  direction: 'up' | 'down' | 'flat'
  // Per-metric prior-data availability. Optional for backward compatibility:
  // reports generated before this field default to "prior available" at the
  // result level. When false, the prior value for this specific metric is
  // genuinely unknown (e.g. the prior report predates pulseScore persistence),
  // so the UI must not render a fabricated +100% delta from a 0 baseline.
  hasPriorData?: boolean
}

export interface TrendResult {
  metrics: Record<string, TrendDelta>
  hasPriorData: boolean
}

export interface BenchmarkComparison {
  venueValue: number
  benchmarkAverage: number
  percentAboveBelow: number
}

export interface BenchmarkResult {
  metrics: Record<string, BenchmarkComparison>
  hasInsufficientData: boolean // fewer than 3 venues in category
}

export interface JourneyResult {
  topOverlapVenues: Array<{
    venueName: string
    overlapPercentage: number
    overlapCount: number
  }> // top 5
  partnershipSuggestions: string[] // up to 2
  hasInsufficientData: boolean // fewer than 10 unique visitors
}

export interface RecommendationResult {
  recommendations: Array<{
    type: 'peak_hours' | 'music' | 'retention' | 'benchmark' | 'general'
    text: string
  }> // 1-5 items
}

// ============================================================================
// Report Section Aggregate (used by recommendation engine)
// ============================================================================

export interface ReportSections {
  peakHours: PeakHoursResult
  crowdComposition: CrowdCompositionResult
  musicProfile: MusicProfileResult | null
  repeatVisitors: RepeatVisitorResult
  trends: TrendResult
  benchmarks: BenchmarkResult | null
  journeyInsights: JourneyResult | null
}

// ============================================================================
// Report Summary
// ============================================================================

export interface ReportSummary {
  totalCheckIns: number
  pulseState: string
  topGenre: string | null
  headlineRecommendation: string
  // Persisted so the next period can read the real previous pulse score for the
  // pulse-score trend (never a hardcoded 0). Optional because reports generated
  // before pulse persistence do not carry it; a missing value means the prior
  // pulse baseline is genuinely unavailable, not zero.
  pulseScore?: number
}

// ============================================================================
// Full Report & Teaser Report
// ============================================================================

export interface Report {
  reportId: string
  businessId: string
  schemaVersion: 'v1'
  periodType: 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  generatedAt: string
  nodes: Array<{ nodeId: string; nodeName: string }>

  // Sections
  summary: ReportSummary
  peakHours: PeakHoursResult
  crowdComposition: CrowdCompositionResult
  musicProfile: MusicProfileResult | null
  repeatVisitors: RepeatVisitorResult
  trends: TrendResult
  benchmarks: BenchmarkResult | null
  journeyInsights: JourneyResult | null
  recommendations: RecommendationResult
}

export interface TeaserReport {
  reportId: string
  businessId: string
  schemaVersion: 'v1'
  periodType: 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  generatedAt: string
  summary: ReportSummary
  upgradeMessage: string
}

// ============================================================================
// Pipeline Message Types
// ============================================================================

export interface GenerateReportMessage {
  businessId: string
  periodType: 'weekly' | 'monthly'
  periodStart: string // ISO 8601
  periodEnd: string // ISO 8601
}

export interface DispatchEvent {
  source: 'eventbridge'
  periodType: 'weekly' | 'monthly'
}

// ============================================================================
// PII Scanner Result
// ============================================================================

export interface PiiScanResult {
  clean: boolean
  violations: string[] // field paths containing PII
}

// ============================================================================
// Zod Schemas
// ============================================================================

const reportSummarySchema = z.object({
  totalCheckIns: z.number().int().min(0),
  pulseState: z.string().min(1),
  topGenre: z.string().nullable(),
  headlineRecommendation: z.string().min(1),
  // Optional: reports generated before pulse persistence lack this field.
  pulseScore: z.number().min(0).optional(),
})

const peakHoursResultSchema = z.object({
  hourlyDistribution: z.record(z.coerce.number(), z.number()),
  dailyDistribution: z.record(z.string(), z.number()),
  topWindows: z.array(
    z.object({
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
      count: z.number().int().min(0),
    }),
  ),
  peakDay: z.string().nullable(),
  hasInsufficientData: z.boolean(),
})

const crowdCompositionResultSchema = z.object({
  tierPercentages: z.record(z.string(), z.number()),
  tierUniqueCounts: z.record(z.string(), z.number().int()),
  totalUniqueVisitors: z.number().int().min(0),
  hasInsufficientData: z.boolean(),
})

const musicProfileResultSchema = z.object({
  archetypeDimensions: z.record(z.string(), z.number()),
  topGenres: z.array(
    z.object({
      genre: z.string(),
      visitorCount: z.number().int().min(0),
    }),
  ),
  hasInsufficientData: z.boolean(),
})

const repeatVisitorResultSchema = z.object({
  repeatRate: z.number().min(0).max(100),
  firstTimeVisitorCount: z.number().int().min(0),
  totalUniqueVisitors: z.number().int().min(0),
  hasPriorData: z.boolean(),
})

const trendDeltaSchema = z.object({
  current: z.number(),
  previous: z.number(),
  percentChange: z.number(),
  direction: z.enum(['up', 'down', 'flat']),
  // Optional: absent on reports generated before per-metric prior-data marking.
  hasPriorData: z.boolean().optional(),
})

const trendResultSchema = z.object({
  metrics: z.record(z.string(), trendDeltaSchema),
  hasPriorData: z.boolean(),
})

const benchmarkComparisonSchema = z.object({
  venueValue: z.number(),
  benchmarkAverage: z.number(),
  percentAboveBelow: z.number(),
})

const benchmarkResultSchema = z.object({
  metrics: z.record(z.string(), benchmarkComparisonSchema),
  hasInsufficientData: z.boolean(),
})

const journeyResultSchema = z.object({
  topOverlapVenues: z.array(
    z.object({
      venueName: z.string(),
      overlapPercentage: z.number(),
      overlapCount: z.number().int().min(0),
    }),
  ),
  partnershipSuggestions: z.array(z.string()),
  hasInsufficientData: z.boolean(),
})

const recommendationResultSchema = z.object({
  recommendations: z.array(
    z.object({
      type: z.enum(['peak_hours', 'music', 'retention', 'benchmark', 'general']),
      text: z.string().min(1),
    }),
  ),
})

export const reportSchema = z.object({
  reportId: z.string().min(1),
  businessId: z.string().min(1),
  schemaVersion: z.literal('v1'),
  periodType: z.enum(['weekly', 'monthly']),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  generatedAt: z.string().min(1),
  nodes: z.array(
    z.object({
      nodeId: z.string().min(1),
      nodeName: z.string().min(1),
    }),
  ),
  summary: reportSummarySchema,
  peakHours: peakHoursResultSchema,
  crowdComposition: crowdCompositionResultSchema,
  musicProfile: musicProfileResultSchema.nullable(),
  repeatVisitors: repeatVisitorResultSchema,
  trends: trendResultSchema,
  benchmarks: benchmarkResultSchema.nullable(),
  journeyInsights: journeyResultSchema.nullable(),
  recommendations: recommendationResultSchema,
})

// ============================================================================
// Report Visitor Tokens (companion row)
// ============================================================================

/**
 * Per-period hashed visitor token set for a business, stored server-side only.
 *
 * Persisted in a companion row (`pk=REPORT_TOKENS#{businessId}`,
 * `sk={periodType}#{periodStart}`) with a TTL so consecutive periods can be
 * intersected to compute the repeat-visitor rate. Tokens are one-way hashes of
 * userId + salt (no PII) and are never returned to clients.
 */
export interface ReportTokens {
  businessId: string
  periodType: 'weekly' | 'monthly'
  periodStart: string
  tokens: string[]
}

export const reportTokensSchema = z.object({
  businessId: z.string().min(1),
  periodType: z.enum(['weekly', 'monthly']),
  periodStart: z.string().min(1),
  tokens: z.array(z.string().min(1)),
})

// ============================================================================
// Business Metrics Row (benchmark cache)
// ============================================================================

/**
 * Cached per-business period metrics, written at the end of each successful
 * report generation and read by the benchmark analyzer's
 * `loadCategoryVenueMetrics` to compare a venue against comparable venues.
 *
 * Stored as a single latest-wins row (`pk=BIZ_METRICS#{businessId}`,
 * `sk=LATEST`). It carries the four `ReportMetrics` fields plus `updatedAt` so
 * a stale row is identifiable. Contains no PII.
 */
export interface BusinessMetrics extends ReportMetrics {
  updatedAt: string
}

export const businessMetricsSchema = z.object({
  totalCheckIns: z.number().int().min(0),
  uniqueVisitors: z.number().int().min(0),
  repeatVisitorRate: z.number().min(0).max(100),
  pulseScore: z.number().min(0),
  updatedAt: z.string().min(1),
})

export const teaserReportSchema = z.object({
  reportId: z.string().min(1),
  businessId: z.string().min(1),
  schemaVersion: z.literal('v1'),
  periodType: z.enum(['weekly', 'monthly']),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  generatedAt: z.string().min(1),
  summary: reportSummarySchema,
  upgradeMessage: z.string().min(1),
})

// ============================================================================
// API Query Param Schemas
// ============================================================================

export const reportListQuerySchema = z.object({
  cursor: z.string().optional(),
  period: z.enum(['weekly', 'monthly']).optional(),
})

export const reportIdParamsSchema = z.object({
  reportId: z.string().min(1),
})
