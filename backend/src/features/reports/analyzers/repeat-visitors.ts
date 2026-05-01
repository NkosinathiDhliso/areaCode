import type { RepeatVisitorResult } from '../types.js'

// ============================================================================
// Repeat Visitors Analyzer
// ============================================================================

/**
 * Analyze repeat visitor rate from current and previous period visitor sets.
 *
 * Computes:
 * - repeatRate: percentage of current visitors who also visited in the previous period
 * - firstTimeVisitorCount: visitors in current period not seen in previous period
 * - totalUniqueVisitors: total unique visitors in the current period
 *
 * Uses only anonymized data — visitor tokens are hashed, not userIds.
 */
export function analyzeRepeatVisitors(
  currentPeriodVisitors: Set<string>,
  previousPeriodVisitors: Set<string>,
): RepeatVisitorResult {
  const totalUniqueVisitors = currentPeriodVisitors.size

  // Edge case: empty current set → repeatRate = 0
  if (totalUniqueVisitors === 0) {
    return {
      repeatRate: 0,
      firstTimeVisitorCount: 0,
      totalUniqueVisitors: 0,
    }
  }

  // Compute intersection: visitors in both current and previous periods
  let intersectionCount = 0
  for (const visitor of currentPeriodVisitors) {
    if (previousPeriodVisitors.has(visitor)) {
      intersectionCount++
    }
  }

  const repeatRate = (intersectionCount / totalUniqueVisitors) * 100
  const firstTimeVisitorCount = totalUniqueVisitors - intersectionCount

  return {
    repeatRate,
    firstTimeVisitorCount,
    totalUniqueVisitors,
  }
}
