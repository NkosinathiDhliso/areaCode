// Check-out service for Presence Integrity.
//
// Feature: presence-integrity
//
// Ends the authenticated consumer's open Presence_Record at a venue ("I'm
// leaving") so the live map stops counting them as present and the signal stays
// honest. Mirrors the check-in service's structure, DEV_MODE posture, and
// AppError usage.
//
// The atomicity guarantees (at-most-once end, count never below 0, dwell
// recorded once) live on the Presence_Record's conditional transition inside
// `endPresenceByCheckOut`, which ALSO performs the guarded counter decrement on a
// successful end — this service never decrements the counter itself.
//
// Per founder decision (Requirement 13.2), manual check-out grants NO tangible
// reward in this release: this service exposes no reward coupling whatsoever.
import { DEV_MODE } from '../../shared/config/env.js'
import { AppError } from '../../shared/errors/AppError.js'
import { canEmitToFriends } from '../../shared/privacy/privacy-guard.js'
import { emitPresenceUpdate, emitFriendCheckout } from '../../shared/socket/events.js'
import { getUserById } from '../auth/repository.js'
import { getNodeWithCity } from '../check-in/repository.js'
import { writeDwellRow } from '../presence/dwell-sink.js'
import { endPresenceByCheckOut, getLivePresenceCount, recordPresenceSample } from '../presence/repository.js'
import { getMutualFollowIds, getFollowingIds } from '../social/repository.js'

import type { CheckOutInput, CheckOutResponse } from './types.js'

/**
 * Process a consumer check-out (`POST /v1/check-out`).
 *
 * Pipeline (preHandler ordering — JWT verify, rate limit, body validation — is
 * applied at the route level, mirroring check-in):
 *  1. Load user; if disabled → `403 account_disabled`, no state change (Req 2.3).
 *  2. Attempt the conditional end transition on the Presence_Record keyed by
 *     `(userId, nodeId)`. `endPresenceByCheckOut` only fires on a live `present`
 *     record and decrements the venue counter itself on success.
 *     - Won the transition (record non-null) → write the anonymised dwell row
 *       (`checkout_terminated`) and return `{ checked_out, dwellSeconds }`
 *       (Requirements 1.2, 1.3, 1.4, 9.1).
 *     - No live presence (record null) → successful no-op:
 *       `{ no_active_presence, dwellSeconds: null }`, no counter change, no dwell
 *       row (Requirements 3.1, 3.3).
 */
export async function processCheckOut(userId: string, input: CheckOutInput): Promise<CheckOutResponse> {
  // DEV_MODE no-op, consistent with the check-in service's dev-mock posture.
  if (DEV_MODE) {
    return { nodeId: input.nodeId, presenceState: 'no_active_presence', dwellSeconds: null }
  }

  // 1. Account status gate — reject disabled accounts before any state change.
  const userRecord = await getUserById(userId)
  if (userRecord?.isDisabled === true) {
    throw AppError.forbidden('account_disabled')
  }

  // 2. Conditional end transition. The repository decrements the venue counter
  //    itself on a successful end — do NOT decrement again here.
  const now = Math.floor(Date.now() / 1000)
  const record = await endPresenceByCheckOut({ userId, nodeId: input.nodeId, now })

  if (record === null) {
    // No live presence to end (never checked in, already checked out, already
    // expired, or expired-but-unswept). Successful no-op.
    return { nodeId: input.nodeId, presenceState: 'no_active_presence', dwellSeconds: null }
  }

  // Won the conditional end → record the dwell exactly once and report it.
  await writeDwellRow({
    nodeId: input.nodeId,
    durationSeconds: record.dwellSeconds!,
    termination: 'checkout_terminated',
    endedAt: record.endedAt!,
  })

  // Best-effort honest live-count broadcast (Requirements 7.2, 7.5, 7.6). The
  // count just changed (a present record was ended), so recompute the
  // AUTHORITATIVE read-model count and emit `node:presence_update` with cause
  // 'check_out'. Mirrors the check-in service's Socket.io emit convention
  // (emitPulseUpdate). Wrapped so a fan-out failure is logged and never rolls
  // back the committed check-out — the counter was already decremented inside
  // endPresenceByCheckOut. We load the node only to resolve the city room slug.
  try {
    const node = await getNodeWithCity(input.nodeId)
    const citySlug = node?.city?.slug ?? ''
    if (citySlug) {
      const livePresenceCount = await getLivePresenceCount(input.nodeId, now)
      // Record the observation; a departure makes the count fall, which is the
      // only honest basis for a "winding down" trend (honest-presence rule 5).
      const momentum = await recordPresenceSample(input.nodeId, livePresenceCount, now)
      await emitPresenceUpdate(citySlug, {
        nodeId: input.nodeId,
        livePresenceCount,
        cause: 'check_out',
        momentum,
      })
    }
  } catch (err) {
    console.warn(`[check-out] presence update emit failed: ${String(err)}`)
  }

  // Best-effort emit `friend:checkout` to mutual friends so their client can
  // call `removeFriendPresence(nodeId, userId)` and keep taste-match honest
  // (Requirements 3.4, 3.5).
  try {
    const canEmit = await canEmitToFriends(userId)
    if (canEmit) {
      const followingIds = await getFollowingIds(userId)
      const friendIds = await getMutualFollowIds(userId, followingIds)
      await Promise.allSettled(
        [...friendIds].map((friendId) => emitFriendCheckout(friendId, { userId, nodeId: input.nodeId })),
      )
    }
  } catch (err) {
    console.warn(`[check-out] friend:checkout emit failed: ${String(err)}`)
  }

  return { nodeId: input.nodeId, presenceState: 'checked_out', dwellSeconds: record.dwellSeconds! }
}
