/**
 * Pulse KV key and value handling — one home for the shape every pulse read and
 * write agrees on (`pulse:{cityKey}:{nodeId}` in the app-data KV, written by the
 * check-in service and the pulse-decay worker).
 *
 * Read paths that share it: `getNodeDetail`, `getNodePublic` (so the public
 * venue model and the Share_Preview can never disagree with the detail read),
 * the city payload assembly and trending.
 */

/** KV key for a venue's pulse score. */
export function pulseKvKey(cityKey: string, nodeId: string): string {
  return `pulse:${cityKey}:${nodeId}`
}

/**
 * Pulse score from a raw KV value. An absent or unparsable value means the
 * venue genuinely has no pulse yet, which is zero — never a decayed or
 * substituted number (`honest-presence.md`).
 */
export function parsePulseScore(raw: string | null | undefined): number {
  if (!raw) return 0
  const score = parseFloat(raw)
  return Number.isFinite(score) ? score : 0
}

/**
 * KV key for a venue's check-in count for the current SAST day. The other input
 * to the pulse formula, incremented by the check-in service and expiring at the
 * next 00:00 SAST so the number can never describe a day that is over.
 */
export function dailyCheckInKvKey(nodeId: string): string {
  return `checkin:today:${nodeId}`
}

/**
 * The pulse score for a venue: its check-ins today, weighted, plus the people
 * actually there right now, weighted.
 *
 * One home, called by both sides of the honest signal — check-in (an arrival
 * raises it) and check-out (a departure lowers it). Two copies of this formula
 * would let the beam rise on a different arithmetic from the one it falls on.
 */
export function computePulse(dailyCheckInCount: number, livePresenceCount: number): number {
  return dailyCheckInCount * 5 + livePresenceCount * 2
}

/** Pulse_State bands, in descending order. */
const STATE_THRESHOLDS = [
  { min: 61, state: 'popping' as const },
  { min: 31, state: 'buzzing' as const },
  { min: 11, state: 'active' as const },
  { min: 1, state: 'quiet' as const },
  { min: 0, state: 'dormant' as const },
]

/** The Pulse_State a score reads as. Shared by the check-in and check-out emits. */
export function pulseStateFor(score: number): (typeof STATE_THRESHOLDS)[number]['state'] {
  for (const threshold of STATE_THRESHOLDS) {
    if (score >= threshold.min) return threshold.state
  }
  return 'dormant'
}

/** TTL for a stored pulse row: a day, after which a silent venue is honestly cold. */
export const PULSE_TTL_SECONDS = 86400

/**
 * The day's check-in count from a raw KV value.
 *
 * `kvIncr` stores a DynamoDB number, so the value arrives as a number at runtime
 * even though the KV read is typed as a string. An absent or unparsable value
 * means no check-ins today, which is zero — never a substituted number.
 */
export function parseDailyCheckInCount(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return 0
  const count = Number(raw)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}
