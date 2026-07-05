// Streak date math + the pure "is this streak at risk today?" decision.
//
// Feature: churn-defences (streak-at-risk reminder)
//
// One home for the SAST day-boundary used by streaks. `updateStreak`
// (repository.ts) and the streak-reminder worker both derive their day strings
// from here so a streak that a check-in keeps alive and a reminder that warns
// before it breaks can never disagree on where "today" begins.
//
// Framework-free and deterministic (callers pass the reference time), so the
// risk rule is property-testable.

/**
 * The SAST (UTC+2) calendar date (`yyyy-mm-dd`) for an ISO timestamp. South
 * Africa observes no DST, so a fixed +2h offset is exact year-round.
 */
export function toSASTDate(dateStr: string): string {
  const date = new Date(dateStr)
  const sast = new Date(date.getTime() + 2 * 60 * 60 * 1000)
  return sast.toISOString().slice(0, 10)
}

/**
 * The SAST calendar date `dayOffset` days from the reference epoch-ms (0 =
 * today SAST, 1 = tomorrow, -1 = yesterday).
 */
export function sastDateForOffset(nowMs: number, dayOffset: number): string {
  const sast = new Date(nowMs + 2 * 60 * 60 * 1000)
  sast.setUTCDate(sast.getUTCDate() + dayOffset)
  return sast.toISOString().slice(0, 10)
}

export interface StreakRiskInput {
  /** The user's current stored streak length. */
  streakCount: number
  /** SAST date of the user's most recent check-in, or null if they have none. */
  lastCheckInSastDate: string | null
  /** SAST date for "today". */
  todaySastDate: string
  /** SAST date for "yesterday". */
  yesterdaySastDate: string
}

/**
 * True iff the user holds an active streak that will break tonight unless they
 * check in today.
 *
 * - `streakCount < 1` or no check-in history → not at risk (nothing to lose).
 * - last check-in was TODAY → already safe, do not remind.
 * - last check-in was YESTERDAY → at risk today (the reminder case).
 * - last check-in was before yesterday → the streak has already broken; do not
 *   nag about a streak the user no longer has.
 */
export function isStreakAtRisk(input: StreakRiskInput): boolean {
  const { streakCount, lastCheckInSastDate, todaySastDate, yesterdaySastDate } = input
  if (streakCount < 1) return false
  if (!lastCheckInSastDate) return false
  if (lastCheckInSastDate === todaySastDate) return false
  return lastCheckInSastDate === yesterdaySastDate
}
