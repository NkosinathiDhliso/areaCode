import { z } from 'zod'

// ============================================================================
// Check-out request / response
// ============================================================================

/**
 * Request body for `POST /v1/check-out`.
 *
 * Carries only the venue `nodeId` (length 1–128). No phone number, identity,
 * or coordinate fields are accepted — check-out is authenticated by the
 * existing consumer JWT (Cognito sub) and never depends on SMS/phone-OTP.
 * (Requirements 2.4, 2.7, 10.1)
 */
export const checkOutBodySchema = z.object({
  nodeId: z.string().min(1).max(128),
})

export type CheckOutInput = z.infer<typeof checkOutBodySchema>

/**
 * Success response for a check-out.
 *
 * `presenceState` is `checked_out` when an active presence was ended, or
 * `no_active_presence` when the request was a successful no-op (never checked
 * in, already checked out, or already expired). `dwellSeconds` is whole seconds
 * of dwell when a record was ended, and `null` on a no-op. (Requirements 1.4, 3.1)
 */
export interface CheckOutResponse {
  nodeId: string
  presenceState: 'checked_out' | 'no_active_presence'
  dwellSeconds: number | null
}

// ============================================================================
// Shared presence types
// ============================================================================

/**
 * Lifecycle state of a Presence_Record. The consumer-device `offline` condition
 * is a client/transport state and is intentionally not part of this type.
 */
export type PresenceState = 'present' | 'checked_out' | 'expired'

/**
 * How a Presence_Record ended, recorded on the dwell row. `null` while the
 * record is still `present`.
 */
export type DwellTermination = 'checkout_terminated' | 'expiry_terminated'

/**
 * Durable Presence_Record — one row per `(userId, nodeId)` in the
 * `area-code-{env}-presence` table (`PAY_PER_REQUEST`).
 *
 * No latitude/longitude is ever stored: proximity is evaluated for check-in
 * verification then discarded. `userId` is the Cognito-backed consumer id;
 * no phone, email, displayName, or avatarUrl lives here. (Requirements 9.5, 10.1, 10.2)
 */
export interface PresenceRecord {
  /** Cognito-backed consumer id (no phone, no email). PK. */
  userId: string
  /** Venue id. SK. */
  nodeId: string
  presenceState: PresenceState
  /** Epoch seconds, server time, set on first check-in. */
  checkedInAt: number
  /** Epoch seconds = checkedInAt + Expiry_Window at last check-in. GSI range key. */
  expiresAt: number
  /** Epoch seconds; check-out time, or `expiresAt` on expiry. Set when the record ends. */
  endedAt?: number
  /** Non-negative integer; set exactly once when the record ends. */
  dwellSeconds?: number
  /** How the record ended; `null` while still present. */
  dwellTermination?: DwellTermination | null
  /** Epoch seconds = expiresAt + GRACE; physical cleanup only, NOT authoritative. */
  ttl: number
}

/**
 * Anonymised dwell aggregate row written to the `app-data` table on every
 * record end. Contains no `userId`, identity, or coordinate fields — the
 * at-most-once guarantee lives on the Presence_Record conditional transition,
 * so the row needs no consumer reference. (Requirements 9.4, 9.5, 10.3)
 */
export interface DwellRow {
  nodeId: string
  /** Non-negative integer number of seconds. */
  durationSeconds: number
  termination: DwellTermination
  /** SAST 18:00–23:59 = peak. */
  timeBand: 'peak' | 'off_peak'
  /** Epoch seconds. */
  endedAt: number
  /** Optional retention horizon for raw rows. */
  ttl?: number
}

/**
 * Realtime `node:presence_update` event payload broadcast over the existing
 * WebSocket transport whenever a check-in, check-out, or expiry changes a
 * venue's Live_Presence_Count.
 *
 * Carries only `nodeId`, the new `livePresenceCount`, and the `cause` — no
 * consumer identity, so count changes cannot be attributed to an individual.
 * (Requirements 7.4, 10.4)
 */
export interface NodePresenceUpdatePayload {
  nodeId: string
  livePresenceCount: number
  cause: 'check_in' | 'check_out' | 'expiry'
}
