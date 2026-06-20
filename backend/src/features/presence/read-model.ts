// Pure honest read-model count for Presence Integrity.
//
// A venue's Live_Presence_Count is DEFINED as the number of presence records
// that are currently in state `present` AND whose `expiresAt` is still in the
// future relative to `now`. This is the authoritative value: it is correct even
// if the serverless expiry sweep has not yet physically transitioned a stale
// record, because records whose `expiresAt` has passed are excluded here
// (Requirement 6.4). When nobody is live-present the count is exactly 0 — no
// decayed Pulse_Score or historical check-in tally is ever substituted
// (Requirements 7.1, 7.7, 8.3).
//
// This module is the pure, framework-free specification of the count. The
// DynamoDB `NodeIndex` query (`expiresAt > now`, filter `presenceState = 'present'`)
// is a thin adapter that must agree with this function.

/**
 * Lifecycle state of a Presence_Record. Mirrors the reducer's `PState`
 * (`backend/src/features/presence/reducer.ts`), defined here as a local,
 * structurally compatible type so the read model stays usable before/while the
 * reducer is authored in parallel. `absent` represents "no open record".
 */
export type PresenceState = 'present' | 'checked_out' | 'expired' | 'absent'

/**
 * Minimal structural shape the read model needs. The reducer's richer `Record`
 * type (which also carries `checkedInAt`/`dwellSeconds`) is structurally
 * assignable to this, so `livePresenceCount` accepts reducer records directly.
 */
export interface PresenceLike {
  /** Current lifecycle state of the record. */
  state: PresenceState
  /** Epoch seconds (server time) at which a `present` record stops being live. */
  expiresAt: number
}

/**
 * Returns the honest Live_Presence_Count for a venue: the number of records
 * that are `present` AND not yet expired at `now`.
 *
 * Excludes expired-but-unswept records (still physically `present` but with
 * `expiresAt <= now`) so a lagging background sweep never inflates the count.
 * Returns 0 when no record is live-present, with no historical/decayed
 * substitution.
 *
 * @param records - the venue's presence records (any state).
 * @param now - the reference time in epoch seconds.
 * @returns a non-negative integer count of currently-present consumers.
 */
export function livePresenceCount(records: readonly PresenceLike[], now: number): number {
  let count = 0
  for (const record of records) {
    if (record.state === 'present' && record.expiresAt > now) {
      count++
    }
  }
  return count
}
