import type { JourneyResult } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

/** Minimum unique visitors required for meaningful journey analysis */
const MIN_VISITORS_FOR_JOURNEY = 10

/** Maximum number of top overlapping venues to return */
const MAX_TOP_VENUES = 5

/** Maximum number of partnership suggestions */
const MAX_PARTNERSHIPS = 2

// ============================================================================
// Journey Analyzer
// ============================================================================

/**
 * Analyze cross-venue journey patterns by computing visitor overlap
 * between the target venue and all other venues.
 *
 * Computes:
 * - Top 5 overlapping venues sorted by shared unique visitor count (descending)
 * - Overlap percentage = overlapCount / venueVisitorTokens.size × 100
 * - Up to 2 partnership suggestions from highest-overlap venues
 * - Insufficient data flag when fewer than 10 unique visitors
 *
 * Uses only anonymized data — references other venues by name only.
 */
export function analyzeJourney(
  venueVisitorTokens: Set<string>,
  allVenueVisitorMap: Map<string, { name: string; visitors: Set<string> }>,
): JourneyResult {
  // Insufficient data when fewer than 10 unique visitors
  if (venueVisitorTokens.size < MIN_VISITORS_FOR_JOURNEY) {
    return {
      topOverlapVenues: [],
      partnershipSuggestions: [],
      hasInsufficientData: true,
    }
  }

  // Compute overlap with each other venue
  const overlaps: Array<{
    venueName: string
    overlapCount: number
    overlapPercentage: number
  }> = []

  for (const [, venueData] of allVenueVisitorMap) {
    let overlapCount = 0
    for (const token of venueData.visitors) {
      if (venueVisitorTokens.has(token)) {
        overlapCount++
      }
    }

    if (overlapCount > 0) {
      const overlapPercentage = (overlapCount / venueVisitorTokens.size) * 100
      overlaps.push({
        venueName: venueData.name,
        overlapCount,
        overlapPercentage,
      })
    }
  }

  // Sort by overlap count descending, take top 5
  overlaps.sort((a, b) => b.overlapCount - a.overlapCount)
  const topOverlapVenues = overlaps.slice(0, MAX_TOP_VENUES)

  // Generate up to 2 partnership suggestions from highest-overlap venues
  const partnershipSuggestions: string[] = []
  for (const venue of topOverlapVenues) {
    if (partnershipSuggestions.length >= MAX_PARTNERSHIPS) break
    partnershipSuggestions.push(
      `Consider partnering with ${venue.venueName} — ${Math.round(venue.overlapPercentage)}% of your visitors also go there.`,
    )
  }

  return {
    topOverlapVenues,
    partnershipSuggestions,
    hasInsufficientData: false,
  }
}
