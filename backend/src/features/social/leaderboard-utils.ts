/**
 * Pure utility functions for leaderboard derivation.
 * Exported for property-based testing.
 */

export interface CheckInRecord {
  nodeId: string
  checkedInAt: string
}

export interface TopVenueResult {
  topVenueId: string
  topVenueName?: string
}

/**
 * Derives the top venue for a user from their check-in history within a leaderboard period.
 *
 * Rules:
 * - The venue with the most check-ins wins.
 * - Tie-breaking: among venues with the same count, the one with the most recent `checkedInAt` wins.
 * - Returns null if the check-in array is empty.
 *
 * This is the Property 8 (Venue Streak Derivation) target:
 * "For any user's check-in history within a leaderboard period, the topVenueId shown
 *  in their rank entry SHALL be the venue where they checked in the most times during
 *  that period. In the case of a tie, the most recently visited venue wins."
 *
 * @param checkIns - The user's check-ins within the leaderboard period
 * @param venueNames - Optional map of nodeId -> venue name for populating topVenueName
 * @returns The top venue result, or null if no check-ins
 */
export function deriveTopVenue(checkIns: CheckInRecord[], venueNames?: Record<string, string>): TopVenueResult | null {
  if (checkIns.length === 0) return null

  // Count check-ins per venue and track most recent visit per venue
  const countByVenue = new Map<string, number>()
  const latestByVenue = new Map<string, string>()

  for (const ci of checkIns) {
    const count = (countByVenue.get(ci.nodeId) ?? 0) + 1
    countByVenue.set(ci.nodeId, count)

    const current = latestByVenue.get(ci.nodeId)
    if (!current || ci.checkedInAt > current) {
      latestByVenue.set(ci.nodeId, ci.checkedInAt)
    }
  }

  // Find the venue with the highest count; tie-break by most recent visit
  let bestVenueId: string | null = null
  let bestCount = 0
  let bestLatest = ''

  for (const [venueId, count] of countByVenue) {
    const latest = latestByVenue.get(venueId)!
    if (count > bestCount || (count === bestCount && latest > bestLatest)) {
      bestVenueId = venueId
      bestCount = count
      bestLatest = latest
    }
  }

  if (!bestVenueId) return null

  const result: TopVenueResult = { topVenueId: bestVenueId }
  if (venueNames && venueNames[bestVenueId]) {
    result.topVenueName = venueNames[bestVenueId]
  }
  return result
}
