import type { AnonymizedCheckIn, CrowdCompositionResult } from '../types.js'

// ============================================================================
// Crowd Composition Analyzer
// ============================================================================

/**
 * Analyze crowd composition from anonymized check-in data.
 *
 * Computes:
 * - Tier percentages (percentage of total check-ins per tier)
 * - Unique visitor count per tier (using visitorToken)
 * - Total unique visitors across all tiers
 *
 * Uses only anonymized data — visitorToken, not userId.
 */
export function analyzeCrowdComposition(checkIns: AnonymizedCheckIn[]): CrowdCompositionResult {
  if (checkIns.length === 0) {
    return {
      tierPercentages: {},
      tierUniqueCounts: {},
      totalUniqueVisitors: 0,
    }
  }

  // Count check-ins per tier
  const tierCounts: Record<string, number> = {}
  // Track unique visitors per tier
  const tierVisitors: Record<string, Set<string>> = {}
  // Track all unique visitors
  const allVisitors = new Set<string>()

  for (const checkIn of checkIns) {
    const { tier, visitorToken } = checkIn

    // Count check-ins per tier
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1

    // Track unique visitors per tier
    if (!tierVisitors[tier]) {
      tierVisitors[tier] = new Set()
    }
    tierVisitors[tier].add(visitorToken)

    // Track all unique visitors
    allVisitors.add(visitorToken)
  }

  // Compute tier percentages (percentage of total check-ins)
  const total = checkIns.length
  const tierPercentages: Record<string, number> = {}
  for (const [tier, count] of Object.entries(tierCounts)) {
    tierPercentages[tier] = Math.round((count / total) * 100 * 100) / 100
  }

  // Compute unique visitor counts per tier
  const tierUniqueCounts: Record<string, number> = {}
  for (const [tier, visitors] of Object.entries(tierVisitors)) {
    tierUniqueCounts[tier] = visitors.size
  }

  return {
    tierPercentages,
    tierUniqueCounts,
    totalUniqueVisitors: allVisitors.size,
  }
}
