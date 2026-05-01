import type { ReportMetrics, TrendDelta, TrendResult } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

/** Threshold for "flat" direction: ±1% */
const FLAT_THRESHOLD = 1

/** Metrics to compute trends for */
const TREND_METRICS = [
  'totalCheckIns',
  'uniqueVisitors',
  'repeatVisitorRate',
  'pulseScore',
] as const

// ============================================================================
// Trends Analyzer
// ============================================================================

/**
 * Analyze trends by comparing current metrics to previous period metrics.
 *
 * Computes:
 * - Percentage change for each metric: (current − previous) / previous × 100
 * - Direction label: "up" when > 1%, "down" when < -1%, "flat" when ±1%
 * - hasPriorData: false when previousMetrics is null
 *
 * Division by zero handling:
 * - If previous = 0 and current > 0 → direction = "up", percentChange = 100
 * - If previous = 0 and current = 0 → direction = "flat", percentChange = 0
 */
export function analyzeTrends(
  currentMetrics: ReportMetrics,
  previousMetrics: ReportMetrics | null,
): TrendResult {
  // No prior data available
  if (previousMetrics === null) {
    const metrics: Record<string, TrendDelta> = {}
    for (const key of TREND_METRICS) {
      metrics[key] = {
        current: currentMetrics[key],
        previous: 0,
        percentChange: 0,
        direction: 'flat',
      }
    }
    return {
      metrics,
      hasPriorData: false,
    }
  }

  const metrics: Record<string, TrendDelta> = {}

  for (const key of TREND_METRICS) {
    const current = currentMetrics[key]
    const previous = previousMetrics[key]

    metrics[key] = computeTrendDelta(current, previous)
  }

  return {
    metrics,
    hasPriorData: true,
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute a single trend delta between current and previous values.
 */
function computeTrendDelta(current: number, previous: number): TrendDelta {
  let percentChange: number
  let direction: 'up' | 'down' | 'flat'

  if (previous === 0) {
    // Division by zero handling
    if (current > 0) {
      percentChange = 100
      direction = 'up'
    } else {
      percentChange = 0
      direction = 'flat'
    }
  } else {
    percentChange = ((current - previous) / previous) * 100

    if (percentChange > FLAT_THRESHOLD) {
      direction = 'up'
    } else if (percentChange < -FLAT_THRESHOLD) {
      direction = 'down'
    } else {
      direction = 'flat'
    }
  }

  return {
    current,
    previous,
    percentChange,
    direction,
  }
}
