// Pure presence reducer — the executable specification of the honest-presence
// state machine. The DynamoDB repository (repository.ts) is a thin adapter that
// maps each operation here to the corresponding conditional UpdateItem; this
// module is what the correctness properties are pinned against.
//
// Feature: presence-integrity
//
// A Presence_Record is keyed by (userId, nodeId) so a consumer holds at most one
// record per venue. Its lifecycle is:
//
//     absent ──check_in──▶ present ──check_out──▶ checked_out
//                            │  ▲
//                            │  └──check_in (refresh, only moves expiresAt)
//                            └──expire (when expiresAt <= now)──▶ expired
//
// A venue's Live_Presence_Count is the running sum of `countDelta` over any
// sequence of operations. The reducer guarantees:
//   - countDelta is +1 only when an absent / checked_out / expired record
//     becomes present (i.e. when no `present` record currently exists, so any
//     prior +1 has already been removed by a check_out / expire).
//   - countDelta is -1 only on a present -> checked_out or present -> expired
//     transition.
//   - a re-check_in of an already-`present` record yields countDelta 0 and only
//     moves expiresAt (the consumer counts at most once per venue).
//   - dwellRecorded is true exactly once per record end (the second of two
//     concurrent ends, or an end after an expiry, is a no-op).
//   - the count can never be driven below 0 by these deltas, because a -1 is
//     only ever produced by ending a `present` record that contributed a +1.

/**
 * Lifecycle state of a Presence_Record. `absent` is the reducer's representation
 * of "no record exists for this (userId, nodeId)"; the persisted states are
 * `present`, `checked_out`, and `expired`.
 */
export type PresenceState = 'present' | 'checked_out' | 'expired' | 'absent'

/**
 * How a Presence_Record's dwell was terminated. `null` while the record has not
 * yet ended.
 */
export type DwellTermination = 'checkout_terminated' | 'expiry_terminated' | null

/**
 * The pure Presence_Record value the reducer operates on. Carries no identity
 * and no coordinates (POPIA): location is evaluated at check-in time and
 * discarded before a record is ever constructed.
 */
export interface PresenceRecord {
  state: PresenceState
  /** Epoch seconds of the check-in that opened the current presence. */
  checkedInAt: number
  /** Epoch seconds at which an un-checked-out presence expires (= checkedInAt + window). */
  expiresAt: number
  /** Epoch seconds the record ended (checkout time, or expiresAt on expiry); null while live/absent. */
  endedAt: number | null
  /** Whole-second dwell, set exactly once when the record ends; null until then. */
  dwellSeconds: number | null
  /** Termination flag, set together with dwellSeconds when the record ends. */
  dwellTermination: DwellTermination
}

/**
 * An operation applied to a Presence_Record.
 * - `check_in` covers both `presence` and `reward` check-ins (identical presence
 *   semantics, Requirement 4.3). `window` is the applicable Expiry_Window in
 *   seconds (peak/off-peak, see window.ts).
 * - `check_out` is the manual "I'm leaving" action.
 * - `expire` is the serverless sweep transition.
 */
export type PresenceOp =
  | { kind: 'check_in'; now: number; window: number }
  | { kind: 'check_out'; now: number }
  | { kind: 'expire'; now: number }

/**
 * Result of applying one operation.
 * - `record` is the next Presence_Record value (unchanged on a no-op).
 * - `countDelta` is the change to the venue's Live_Presence_Count (+1, 0, or -1).
 * - `dwellRecorded` is true iff this operation ended the record and recorded its
 *   dwell (exactly once per record end).
 */
export interface ApplyOpResult {
  record: PresenceRecord
  countDelta: 1 | 0 | -1
  dwellRecorded: boolean
}

/**
 * The canonical "no record exists yet" value for a (userId, nodeId) key.
 */
export function absentRecord(): PresenceRecord {
  return {
    state: 'absent',
    checkedInAt: 0,
    expiresAt: 0,
    endedAt: null,
    dwellSeconds: null,
    dwellTermination: null,
  }
}

/** A live `present` record is one in state `present` whose expiresAt is still in the future. */
function _isLivePresent(record: PresenceRecord, now: number): boolean {
  return record.state === 'present' && record.expiresAt > now
}

/**
 * Apply a single presence operation to a record, returning the next record, the
 * Live_Presence_Count delta, and whether dwell was recorded.
 *
 * This function is total and deterministic: every (record, op) pair has a
 * defined result, and operations that cannot legally fire (ending an already
 * ended record, expiring a not-yet-due record) are successful no-ops.
 */
export function applyOp(record: PresenceRecord, op: PresenceOp): ApplyOpResult {
  switch (op.kind) {
    case 'check_in': {
      const expiresAt = op.now + op.window

      // Requirement 4.2 / 5.5: a consumer who already holds a `present` record
      // re-checking in only refreshes expiresAt and does NOT increment again.
      // Keyed on STATE, not liveness: a stale-but-unswept `present` record still
      // holds its original +1, so reopening it must not add a second.
      if (record.state === 'present') {
        return {
          record: { ...record, expiresAt },
          countDelta: 0,
          dwellRecorded: false,
        }
      }

      // Requirement 4.1: absent / checked_out / expired -> a new presence opens.
      // The prior +1 (if any) was already removed by the check_out/expire, so
      // this is the unique +1 for the new presence. checkedInAt is reset to now
      // and any prior dwell is cleared, keeping the invariant expiresAt =
      // checkedInAt + window for the fresh presence.
      return {
        record: {
          state: 'present',
          checkedInAt: op.now,
          expiresAt,
          endedAt: null,
          dwellSeconds: null,
          dwellTermination: null,
        },
        countDelta: 1,
        dwellRecorded: false,
      }
    }

    case 'check_out': {
      // Requirement 1.2 / 3.1 / 3.2 / 3.3: only a `present` record can be ended.
      // Any other state (absent / checked_out / expired) is a successful no-op,
      // so duplicate or stray check-outs never double-decrement or re-record
      // dwell. State guard => at-most-once end.
      if (record.state !== 'present') {
        return { record, countDelta: 0, dwellRecorded: false }
      }

      // Requirement 9.1 / 9.3: whole-second, non-negative dwell since check-in.
      const dwellSeconds = Math.max(0, Math.floor(op.now - record.checkedInAt))

      return {
        record: {
          ...record,
          state: 'checked_out',
          endedAt: op.now,
          dwellSeconds,
          dwellTermination: 'checkout_terminated',
        },
        countDelta: -1,
        dwellRecorded: true,
      }
    }

    case 'expire': {
      // Requirement 5.1 / 5.6: expire transitions a `present` record only once it
      // is due (expiresAt <= now). A not-yet-due `present` record, or a record
      // already checked_out / expired / absent, is a successful no-op — so the
      // sweep never re-transitions an ended record and never races a manual
      // check-out into a double decrement.
      if (record.state !== 'present' || record.expiresAt > op.now) {
        return { record, countDelta: 0, dwellRecorded: false }
      }

      // Requirement 5.2 / 9.2: dwell is bounded by the Expiry_Window because it
      // is measured to expiresAt (= checkedInAt + window), not wall-clock now.
      const dwellSeconds = Math.max(0, record.expiresAt - record.checkedInAt)

      return {
        record: {
          ...record,
          state: 'expired',
          endedAt: record.expiresAt,
          dwellSeconds,
          dwellTermination: 'expiry_terminated',
        },
        countDelta: -1,
        dwellRecorded: true,
      }
    }
  }
}
