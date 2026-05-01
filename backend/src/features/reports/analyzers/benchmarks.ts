import type { BenchmarkComparison, BenchmarkResult, ReportMetrics } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

/** Minimum number of venues required for meaningful benchmarks */
const MIN_VENUES_FOR_BENCHMARK = 3

/** Metrics to benchmark against category averages */
const BENCHMARK_METRICS = [
  'totalCheckIns',
  'uniqueVisitors',
  'repeatVisitorRate',
  'pulseScore',
] as const

// ============================================================================
// Benchmarks Analyzer
// ============================================================================

/**
 * Analyze competitive benchmarks by comparing a venue's metrics against
 * city+category averages.
 *
 * Computes:
 * - Benchmark average for each metric across all venues in the category
 * - Percentage above/below average for the venue
 * - Insufficient data flag when fewer than 3 venues in the category
 *
 * Division by zero handling:
 * - If benchmarkAverage = 0, percentAboveBelow = 0
 */
export function analyzeBenchmarks(
  venueMetrics: ReportMetrics,
  categoryVenueMetrics: ReportMetrics[],
): BenchmarkResult {
  // Insufficient data when fewer than 3 venues
  if (categoryVenueMetrics.length < MIN_VENUES_FOR_BENCHMARK) {
    return {
      metrics: {},
      hasInsufficientData: true,
    }
  }

  const metrics: Record<string, BenchmarkComparison> = {}

  for (const key of BENCHMARK_METRICS) {
    const venueValue = venueMetrics[key]

    // Compute average across all category venues
    let sum = 0
    for (const vm of categoryVenueMetrics) {
      sum += vm[key]
    }
    const benchmarkAverage = sum / categoryVenueMetrics.length

    // Compute percentage above/below average
    let percentAboveBelow: number
    if (benchmarkAverage === 0) {
      percentAboveBelow = 0
    } else {
      percentAboveBelow = ((venueValue - benchmarkAverage) / benchmarkAverage) * 100
    }

    metrics[key] = {
      venueValue,
      benchmarkAverage,
      percentAboveBelow,
    }
  }

  return {
    metrics,
    hasInsufficientData: false,
  }
}
