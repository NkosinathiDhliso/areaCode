import type { RecommendationResult, ReportSections } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of recommendations to generate */
const MAX_RECOMMENDATIONS = 5

/** Peak-hours threshold: top window must exceed this multiplier of average hourly count */
const PEAK_HOURS_MULTIPLIER = 2

/** Retention alert threshold: repeat rate drop in percentage points */
const RETENTION_DROP_THRESHOLD = 10

/** Benchmark significance threshold: percentage above/below average */
const BENCHMARK_SIGNIFICANCE_THRESHOLD = 20

// ============================================================================
// Day names for formatting
// ============================================================================

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

// ============================================================================
// Recommendations Engine
// ============================================================================

/**
 * Generate actionable recommendations based on computed report sections.
 *
 * Produces 1–5 recommendations, each a single sentence with at least one
 * specific number from the report. Recommendation types:
 *
 * - peak_hours: when top window count > 2× average hourly count
 * - music: when crowd archetype differs from tier composition
 * - retention: when repeat rate drops > 10 percentage points
 * - benchmark: when venue is significantly above/below average
 * - general: fallback with check-in and visitor counts
 */
export function generateRecommendations(report: ReportSections): RecommendationResult {
  const recommendations: RecommendationResult['recommendations'] = []

  // 1. Peak-hours recommendation
  const peakRec = generatePeakHoursRecommendation(report)
  if (peakRec) recommendations.push(peakRec)

  // 2. Music recommendation
  const musicRec = generateMusicRecommendation(report)
  if (musicRec && recommendations.length < MAX_RECOMMENDATIONS) recommendations.push(musicRec)

  // 3. Retention alert
  const retentionRec = generateRetentionRecommendation(report)
  if (retentionRec && recommendations.length < MAX_RECOMMENDATIONS) recommendations.push(retentionRec)

  // 4. Benchmark recommendation
  const benchmarkRec = generateBenchmarkRecommendation(report)
  if (benchmarkRec && recommendations.length < MAX_RECOMMENDATIONS) recommendations.push(benchmarkRec)

  // 5. General recommendation (always available as fallback)
  if (recommendations.length < MAX_RECOMMENDATIONS) {
    const generalRec = generateGeneralRecommendation(report)
    recommendations.push(generalRec)
  }

  // Ensure at least 1 recommendation
  if (recommendations.length === 0) {
    recommendations.push(generateGeneralRecommendation(report))
  }

  return { recommendations: recommendations.slice(0, MAX_RECOMMENDATIONS) }
}

// ============================================================================
// Individual Recommendation Generators
// ============================================================================

function generatePeakHoursRecommendation(report: ReportSections): RecommendationResult['recommendations'][0] | null {
  const { peakHours } = report

  // Suppress the staffing recommendation when peak-hours data is insufficient:
  // a confident staffing claim from thin data would over-claim (honest-presence).
  if (peakHours.hasInsufficientData) return null

  if (peakHours.topWindows.length === 0) return null

  // Compute average hourly count
  const hourlyValues = Object.values(peakHours.hourlyDistribution)
  const totalHourlyCount = hourlyValues.reduce((sum, c) => sum + c, 0)
  const averageHourlyCount = totalHourlyCount / 24

  const topWindow = peakHours.topWindows[0]!

  // Only generate when top window count > 2× average hourly count
  if (averageHourlyCount === 0 || topWindow.count <= PEAK_HOURS_MULTIPLIER * averageHourlyCount) {
    return null
  }

  const multiplier = Math.round((topWindow.count / averageHourlyCount) * 10) / 10
  const peakDay = peakHours.peakDay

  return {
    type: 'peak_hours',
    text: `Your venue peaks ${peakDay} ${formatHour(topWindow.startHour)}-${formatHour(topWindow.endHour)} with ${multiplier}x the average traffic — ensure full staffing.`,
  }
}

function generateMusicRecommendation(report: ReportSections): RecommendationResult['recommendations'][0] | null {
  const { musicProfile, crowdComposition } = report

  if (!musicProfile || musicProfile.hasInsufficientData) return null

  const dims = musicProfile.archetypeDimensions
  if (Object.keys(dims).length === 0) return null

  // Find the dominant dimension
  let maxDim = ''
  let maxVal = -1
  for (const [dim, val] of Object.entries(dims)) {
    if (val > maxVal) {
      maxVal = val
      maxDim = dim
    }
  }

  // Check if there's a mismatch between crowd archetype and tier composition
  // High fixture/institution tier but low sophistication → suggest upscale music
  // High local tier but high energy → suggest more mainstream/accessible
  const tierPcts = crowdComposition.tierPercentages
  const fixturePct = (tierPcts['fixture'] ?? 0) + (tierPcts['institution'] ?? 0) + (tierPcts['legend'] ?? 0)
  const localPct = tierPcts['local'] ?? 0

  const sophistication = dims['sophistication'] ?? 0
  const energy = dims['energy'] ?? 0

  // Mismatch: high loyalty tiers but low sophistication
  if (fixturePct > 40 && sophistication < 50) {
    return {
      type: 'music',
      text: `Your crowd's music profile shows ${Math.round(sophistication)}% sophistication despite ${Math.round(fixturePct)}% loyal visitors — consider adding curated playlists to match their dedication.`,
    }
  }

  // Mismatch: mostly new visitors but high energy
  if (localPct > 60 && energy > 70) {
    return {
      type: 'music',
      text: `Your crowd's music profile shows ${Math.round(energy)}% energy with ${Math.round(localPct)}% first-time visitors — consider high-energy welcome sets to convert them to regulars.`,
    }
  }

  // Generic music insight when top genre is available
  if (musicProfile.topGenres.length > 0) {
    const topGenre = musicProfile.topGenres[0]!
    return {
      type: 'music',
      text: `Your top genre is ${topGenre.genre} with ${topGenre.visitorCount} visitors — consider featuring it more prominently in your playlists.`,
    }
  }

  return null
}

function generateRetentionRecommendation(report: ReportSections): RecommendationResult['recommendations'][0] | null {
  const { trends, repeatVisitors } = report

  if (!trends.hasPriorData) return null

  const repeatTrend = trends.metrics['repeatVisitorRate']
  if (!repeatTrend) return null

  // Check if repeat rate dropped by more than 10 percentage points
  const drop = repeatTrend.previous - repeatTrend.current
  if (drop > RETENTION_DROP_THRESHOLD) {
    return {
      type: 'retention',
      text: `Repeat visitor rate dropped ${Math.round(drop)} points to ${Math.round(repeatVisitors.repeatRate)}% — consider a welcome-back reward.`,
    }
  }

  return null
}

function generateBenchmarkRecommendation(report: ReportSections): RecommendationResult['recommendations'][0] | null {
  const { benchmarks } = report

  if (!benchmarks || benchmarks.hasInsufficientData) return null

  // Find the most significant benchmark deviation
  let bestMetric = ''
  let bestDeviation = 0

  for (const [metric, comparison] of Object.entries(benchmarks.metrics)) {
    const absDeviation = Math.abs(comparison.percentAboveBelow)
    if (absDeviation > bestDeviation) {
      bestDeviation = absDeviation
      bestMetric = metric
    }
  }

  if (bestDeviation < BENCHMARK_SIGNIFICANCE_THRESHOLD) return null

  const comparison = benchmarks.metrics[bestMetric]!
  const direction = comparison.percentAboveBelow > 0 ? 'above' : 'below'
  const metricLabel = formatMetricName(bestMetric)

  return {
    type: 'benchmark',
    text: `Your ${metricLabel} is ${Math.round(Math.abs(comparison.percentAboveBelow))}% ${direction} the city average.`,
  }
}

function generateGeneralRecommendation(report: ReportSections): RecommendationResult['recommendations'][0] {
  const totalCheckIns = Object.values(report.peakHours.hourlyDistribution).reduce((sum, c) => sum + c, 0)
  const uniqueVisitors = report.crowdComposition.totalUniqueVisitors

  return {
    type: 'general',
    text: `You had ${totalCheckIns} check-ins this period with ${uniqueVisitors} unique visitors.`,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`
}

function formatMetricName(key: string): string {
  switch (key) {
    case 'totalCheckIns':
      return 'total check-ins'
    case 'uniqueVisitors':
      return 'unique visitors'
    case 'repeatVisitorRate':
      return 'repeat visitor rate'
    case 'pulseScore':
      return 'pulse score'
    default:
      return key
  }
}
