import type { MusicGenre } from '../types'

/**
 * Selects the top genre from a CrowdVibeSnapshot's genreCounts for fallback display
 * when no live signal exists.
 *
 * - Returns the genre with the highest count
 * - Uses alphabetical tiebreak when multiple genres share the highest count
 * - Returns null if genreCounts is empty or all counts are zero
 *
 * Requirements: 11.1
 * Property 14: Fallback Genre Selection
 */
export function selectFallbackGenre(
  genreCounts: Partial<Record<MusicGenre, number>>,
): MusicGenre | null {
  const entries = Object.entries(genreCounts) as [MusicGenre, number][]

  if (entries.length === 0) return null

  // Filter out zero or negative counts
  const validEntries = entries.filter(([, count]) => count > 0)

  if (validEntries.length === 0) return null

  // Find the maximum count
  let maxCount = 0
  for (const [, count] of validEntries) {
    if (count > maxCount) {
      maxCount = count
    }
  }

  // Collect all genres with the max count
  const topGenres: MusicGenre[] = []
  for (const [genre, count] of validEntries) {
    if (count === maxCount) {
      topGenres.push(genre)
    }
  }

  // Alphabetical tiebreak for deterministic selection
  topGenres.sort()

  return topGenres[0]
}
