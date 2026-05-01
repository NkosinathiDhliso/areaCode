import type { AnonymizedCheckIn, PeakHoursResult } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

const HOURS = Array.from({ length: 24 }, (_, i) => i)

const DAYS_OF_WEEK = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const

// ============================================================================
// Peak Hours Analyzer
// ============================================================================

/**
 * Analyze peak hours from anonymized check-in data.
 *
 * Computes:
 * - Hourly distribution (0–23 SAST)
 * - Daily distribution (Monday–Sunday)
 * - Top 3 contiguous peak hour windows (wrapping around midnight)
 * - Peak day of week (day with highest count)
 *
 * Supports per-node and aggregate computation when multiple nodes exist.
 */
export function analyzePeakHours(checkIns: AnonymizedCheckIn[]): PeakHoursResult {
  // Initialize distributions with zeros
  const hourlyDistribution: Record<number, number> = {}
  for (const h of HOURS) {
    hourlyDistribution[h] = 0
  }

  const dailyDistribution: Record<string, number> = {}
  for (const day of DAYS_OF_WEEK) {
    dailyDistribution[day] = 0
  }

  // Accumulate counts
  for (const checkIn of checkIns) {
    hourlyDistribution[checkIn.hourOfDay] = (hourlyDistribution[checkIn.hourOfDay] ?? 0) + 1
    dailyDistribution[checkIn.dayOfWeek] = (dailyDistribution[checkIn.dayOfWeek] ?? 0) + 1
  }

  // Find top 3 contiguous peak hour windows
  const topWindows = findTopWindows(hourlyDistribution, 3)

  // Find peak day
  const peakDay = findPeakDay(dailyDistribution)

  return {
    hourlyDistribution,
    dailyDistribution,
    topWindows,
    peakDay,
  }
}

// ============================================================================
// Top Windows — Contiguous Hour Windows (wrapping around midnight)
// ============================================================================

/**
 * Find the top N contiguous hour windows by combined check-in count.
 *
 * We try all possible window lengths from 1 to 24 hours, and for each length
 * we find the best starting hour. Then we pick the top N windows overall,
 * preferring longer windows when counts are equal (more useful insight).
 *
 * Windows wrap around midnight (e.g., 22:00–02:00 is a valid 4-hour window).
 */
function findTopWindows(
  hourlyDistribution: Record<number, number>,
  topN: number,
): Array<{ startHour: number; endHour: number; count: number }> {
  if (Object.values(hourlyDistribution).every((c) => c === 0)) {
    return []
  }

  // Try window lengths from 1 to 6 hours (practical peak windows)
  // and find the best window for each length
  const candidates: Array<{ startHour: number; endHour: number; count: number; length: number }> = []

  for (let windowLen = 1; windowLen <= 6; windowLen++) {
    for (let start = 0; start < 24; start++) {
      let count = 0
      for (let offset = 0; offset < windowLen; offset++) {
        const hour = (start + offset) % 24
        count += hourlyDistribution[hour] ?? 0
      }
      const endHour = (start + windowLen - 1) % 24
      candidates.push({ startHour: start, endHour, count, length: windowLen })
    }
  }

  // Sort by count descending, then by length descending (prefer longer windows for same count)
  candidates.sort((a, b) => b.count - a.count || b.length - a.length)

  // Pick top N non-overlapping windows
  const selected: Array<{ startHour: number; endHour: number; count: number }> = []
  const usedHours = new Set<number>()

  for (const candidate of candidates) {
    if (selected.length >= topN) break
    if (candidate.count === 0) break

    // Check if this window overlaps with any already-selected window
    const windowHours: number[] = []
    for (let offset = 0; offset < candidate.length; offset++) {
      windowHours.push((candidate.startHour + offset) % 24)
    }

    const overlaps = windowHours.some((h) => usedHours.has(h))
    if (overlaps) continue

    for (const h of windowHours) {
      usedHours.add(h)
    }

    selected.push({
      startHour: candidate.startHour,
      endHour: candidate.endHour,
      count: candidate.count,
    })
  }

  return selected
}

// ============================================================================
// Peak Day
// ============================================================================

/**
 * Find the day of week with the highest check-in count.
 * Defaults to 'Monday' when all counts are zero.
 */
function findPeakDay(dailyDistribution: Record<string, number>): string {
  let peakDay: string = DAYS_OF_WEEK[0]
  let maxCount = -1

  for (const day of DAYS_OF_WEEK) {
    const count = dailyDistribution[day] ?? 0
    if (count > maxCount) {
      maxCount = count
      peakDay = day
    }
  }

  return peakDay
}
