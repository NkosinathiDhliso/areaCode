import type { MusicPrefs, MusicProfileResult } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

const ARCHETYPE_DIMENSIONS = ['energy', 'cultural_rootedness', 'sophistication', 'edge', 'spirituality'] as const

/** Minimum number of visitors with music preferences for sufficient data */
const MIN_VISITORS_FOR_DATA = 5

/** Maximum number of top genres to return */
const MAX_TOP_GENRES = 5

// ============================================================================
// Music Profile Analyzer
// ============================================================================

/**
 * Analyze music profile from visitor music preferences.
 *
 * Computes:
 * - Average archetype dimension scores across all visitors with music prefs
 * - Top 5 genres ranked by visitor count
 * - Insufficient data flag when fewer than 5 visitors have music preferences
 *
 * Uses only anonymized data — visitorIds are hashed tokens, not userIds.
 */
export function analyzeMusicProfile(visitorIds: string[], musicPrefsMap: Map<string, MusicPrefs>): MusicProfileResult {
  // Collect visitors that have music preferences
  const visitorsWithPrefs: MusicPrefs[] = []
  for (const visitorId of visitorIds) {
    const prefs = musicPrefsMap.get(visitorId)
    if (prefs) {
      visitorsWithPrefs.push(prefs)
    }
  }

  // Check for insufficient data
  if (visitorsWithPrefs.length < MIN_VISITORS_FOR_DATA) {
    return {
      archetypeDimensions: {},
      topGenres: [],
      hasInsufficientData: true,
    }
  }

  // Aggregate archetype dimensions (average across all visitors with prefs)
  const archetypeDimensions: Record<string, number> = {}
  for (const dim of ARCHETYPE_DIMENSIONS) {
    let sum = 0
    for (const prefs of visitorsWithPrefs) {
      sum += prefs[dim]
    }
    archetypeDimensions[dim] = sum / visitorsWithPrefs.length
  }

  // Count genres by visitor count
  const genreCounts = new Map<string, number>()
  for (const prefs of visitorsWithPrefs) {
    // Use a Set to count each genre once per visitor
    const uniqueGenres = new Set(prefs.genres)
    for (const genre of uniqueGenres) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    }
  }

  // Rank top 5 genres by visitor count (descending)
  const topGenres = Array.from(genreCounts.entries())
    .map(([genre, visitorCount]) => ({ genre, visitorCount }))
    .sort((a, b) => b.visitorCount - a.visitorCount)
    .slice(0, MAX_TOP_GENRES)

  return {
    archetypeDimensions,
    topGenres,
    hasInsufficientData: false,
  }
}
