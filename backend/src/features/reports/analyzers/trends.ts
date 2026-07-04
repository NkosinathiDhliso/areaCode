import type { ReportMetrics, TrendDelta, TrendResult } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

/** Threshold for "flat" direction: ±1% */
const FLAT_THRESHOLD = 1

/** Metrics to compute trends for */
const TREND_METRICS = ['totalCheckIns', 'uniqueVisitors', 'repeatVisitorRate', 'pulseScore'] as const

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
 *
 * Per-metric "no prior data" (H4): a metric key listed in `unavailablePriorMetrics`
 * has a genuinely unknown previous value (distinct from a known 0). Its delta is
 * marked `hasPriorData: false` with a flat, zero-change value so the UI never
 * renders a fabricated +100% up delta from a substituted or 0 baseline.
 */
export function analyzeTrends(
  currentMetrics: ReportMetrics,
  previousMetrics: ReportMetrics | null,
  unavailablePriorMetrics: ReadonlySet<string> = new Set(),
): TrendResult {
  // No prior data available at all
  if (previousMetrics === null) {
    const metrics: Record<string, TrendDelta> = {}
    for (const key of TREND_METRICS) {
      metrics[key] = noPriorDataDelta(currentMetrics[key])
    }
    return {
      metrics,
      hasPriorData: false,
    }
  }

  const metrics: Record<string, TrendDelta> = {}

  for (const key of TREND_METRICS) {
    if (unavailablePriorMetrics.has(key)) {
      // Prior value for this specific metric is genuinely unknown.
      metrics[key] = noPriorDataDelta(currentMetrics[key])
      continue
    }
    metrics[key] = computeTrendDelta(currentMetrics[key], previousMetrics[key])
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
 * Build a delta for a metric with no prior baseline. Flat, zero-change, and
 * explicitly marked so the UI omits it rather than rendering +100% from 0.
 */
function noPriorDataDelta(current: number): TrendDelta {
  return {
    current,
    previous: 0,
    percentChange: 0,
    direction: 'flat',
    hasPriorData: false,
  }
}

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
    hasPriorData: true,
  }
}
