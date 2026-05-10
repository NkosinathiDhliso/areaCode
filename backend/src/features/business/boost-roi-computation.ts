/**
 * Pure computation functions for Boost ROI.
 * Separated from the service layer to enable property-based testing
 * without DynamoDB dependencies.
 */

/**
 * Computes baseline check-in count for the same time window across prior weeks.
 * Returns null if fewer than 2 weeks of data exist.
 */
export function computeBaseline(historicalCounts: number[]): number | null {
  if (historicalCounts.length < 2) return null
  const sum = historicalCounts.reduce((a, b) => a + b, 0)
  return sum / historicalCounts.length
}

/**
 * Computes uplift percentage: ((boost_checkins - baseline) / baseline) * 100
 * Returns null if baseline is zero or insufficient data.
 */
export function computeUplift(boostCheckIns: number, baseline: number | null): number | null {
  if (baseline === null || baseline === 0) return null
  return ((boostCheckIns - baseline) / baseline) * 100
}
