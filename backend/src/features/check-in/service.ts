import { createHmac } from 'node:crypto'

import type { FoundVia } from '@area-code/shared/constants/attribution'
import { getTierLabel } from '@area-code/shared/constants/tier-levels'
import { PutCommand } from '@aws-sdk/lib-dynamodb'

import { AWS_REGION, DEV_MODE, qrHmacSecret } from '../../shared/config/env.js'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvIncr, kvTtl } from '../../shared/kv/dynamodb-kv.js'
import { pushVenueUrl } from '../../shared/links/venue-arrival.js'
import { canEmitIdentity, canEmitToFriends, sanitizeForBusiness } from '../../shared/privacy/privacy-guard.js'
import { digestsEqual } from '../../shared/security/hmac.js'
import {
  emitPulseUpdate,
  emitPresenceUpdate,
  emitToast,
  emitBusinessCheckin,
  emitBusinessCheckinDetail,
  emitFriendToast,
  emitTierChanged,
} from '../../shared/socket/events.js'
import { epochSecondsFromMs } from '../../shared/time/epoch.js'
import { sastDateString, secondsUntilNextSastMidnight } from '../../shared/time/sast.js'
import { getUserById } from '../auth/repository.js'
import { computePulse, dailyCheckInKvKey, pulseKvKey, pulseStateFor, PULSE_TTL_SECONDS } from '../nodes/pulse.js'
import { createOrRefreshPresence, getLivePresenceCount, recordPresenceSample } from '../presence/repository.js'
import { expiryWindowSeconds } from '../presence/window.js'
import { getMutualFollowIds, getFollowingIds } from '../social/repository.js'

import { runAbuseChecks } from './abuse.js'
import { checkInCooldownKey, cooldownKindFor, cooldownSecondsFor } from './cooldown.js'
import { getUserCheckInCountAtNode, incrementLeaderboard } from './dynamodb-repository.js'
import { resolveFoundVia, type VenueOpenRow } from './found-via.js'
import { decideProximity, haversineMetres, type ProximityConfig, type ProximityMode } from './proximity.js'
import { isWithinReplayWindow, replayPresenceStartMs } from './replay.js'
import * as repo from './repository.js'
import type { CheckInInput, CheckInResponse } from './types.js'
import { deleteVenueOpen, readVenueOpen } from './venue-open.js'

const PROXIMITY_RADIUS = 500 // metres; legacy flat radius and the adaptive upper bound

// ── Accuracy-aware proximity rollout (see ./proximity.ts) ───────────────────
// Read per request so the mode can be flipped via Lambda env without a redeploy:
// 'legacy' (default, unchanged) -> 'shadow' (log divergence only) -> 'adaptive'
// (enforce). Missing or invalid env values keep the safe default.
function readProximityMode(): ProximityMode {
  const m = process.env['CHECKIN_PROXIMITY_MODE']
  return m === 'adaptive' || m === 'shadow' ? m : 'legacy'
}

function readRadiusEnv(key: string, fallback: number): number {
  const v = Number(process.env[key])
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

function readProximityConfig(): ProximityConfig {
  return {
    maxRadiusM: readRadiusEnv('CHECKIN_MAX_RADIUS_M', PROXIMITY_RADIUS),
    baseRadiusM: readRadiusEnv('CHECKIN_BASE_RADIUS_M', 150),
    minRadiusM: readRadiusEnv('CHECKIN_MIN_RADIUS_M', 150),
    accuracySlopCapM: readRadiusEnv('CHECKIN_ACCURACY_SLOP_CAP_M', 250),
  }
}

// ─── QR Token Validation ────────────────────────────────────────────────────

function validateQrToken(nodeId: string, token: string): boolean {
  const secret = qrHmacSecret()
  for (let offset = 0; offset <= 1; offset++) {
    const ts = Math.floor(Date.now() / (15 * 60 * 1000)) - offset
    const expected = createHmac('sha256', secret).update(`${nodeId}${ts}`).digest('hex').slice(0, 32)
    if (digestsEqual(token, expected)) return true
  }
  return false
}

// ─── Found_Via ──────────────────────────────────────────────────────────────

/**
 * Read the Venue_Open row for the stamp, treating a KV failure as no row.
 *
 * Attribution is a measurement laid over the check-in, never a precondition for
 * it: a consumer standing at the door must not be refused because the
 * attribution read is unavailable. The failure is logged at error level (it is a
 * real fault, not an expected branch) and the stamp falls to `walk_in`, which
 * under-claims rather than inventing demand.
 */
async function readOpenRowForStamp(userId: string, nodeId: string): Promise<VenueOpenRow | null> {
  try {
    return await readVenueOpen(userId, nodeId)
  } catch (err) {
    console.error(`[check-in] Venue_Open read failed for node ${nodeId}; stamping walk_in:`, err)
    return null
  }
}

/**
 * Personalised friend fan-out for one check-in: a live toast to every mutual
 * follow, plus a "come join us" push for the ones who are not currently in the
 * app. Runs only when the checked-in user's privacy allows identity sharing.
 *
 * Lives apart from `processCheckIn` because it is the one place that knows the
 * friend fan-out shape, and because the caller treats it as best-effort: it
 * wraps the call and swallows failures so fan-out never fails a check-in.
 */
async function emitFriendCheckInFanout(
  userId: string,
  nodeId: string,
  nodeName: string,
  nodeSlug: string | null | undefined,
): Promise<void> {
  const canEmit = await canEmitToFriends(userId)
  if (!canEmit) return

  const followingIds = await getFollowingIds(userId)
  const friendIds = await getMutualFollowIds(userId, followingIds)
  if (friendIds.size === 0) return

  const user = await getUserById(userId)
  const displayName = user?.displayName ?? 'Someone'
  const friendPayload: {
    type: 'checkin'
    message: string
    userId: string
    nodeId: string
    avatarUrl?: string
  } = {
    type: 'checkin',
    message: `${displayName} just checked in at ${nodeName}`,
    userId,
    nodeId,
  }
  if (user?.avatarUrl) {
    friendPayload.avatarUrl = user.avatarUrl
  }

  // Live in-app toast for friends with an open socket.
  await Promise.allSettled([...friendIds].map((friendId) => emitFriendToast(friendId, friendPayload)))

  // "Come join us" push for friends who are NOT currently in the app.
  // `sendNotification` is socket-primary / push-fallback and persists to the
  // notification center, so an offline friend still gets the nudge. In Lambda
  // there is no in-process socket, so it reliably falls through to push tokens.
  //
  // The `followedUserCheckin` switch (off by default) gates this. We check it up
  // front and skip the send entirely for opted-out friends, rather than letting
  // `sendNotification` write a preference-blocked history row for every friend
  // check-in — that would clutter the notification center on a high-frequency
  // event.
  const { sendNotification, getPreferences } = await import('../notifications/service.js')
  // Fan out in parallel so a long friend list adds one round-trip of latency to
  // the check-in path, not one per friend. allSettled keeps per-friend
  // isolation: one failure never blocks the rest.
  await Promise.allSettled(
    [...friendIds].map(async (friendId) => {
      const prefs = await getPreferences(friendId)
      if ((prefs as { followedUserCheckin?: boolean }).followedUserCheckin !== true) return
      await sendNotification({
        userId: friendId,
        type: 'friend_checkin',
        title: `${displayName} just checked in`,
        body: `${displayName} is at ${nodeName} right now.`,
        // Click-through lands on the venue card with `src=push`, so the arrival
        // records a `push` Venue_Open (R2.1). Without the `url` the service
        // worker would drop them on `/`. A node with no slug cannot be
        // deep-linked, so the key is omitted rather than pointed at a venue that
        // will not resolve.
        data: { nodeId, userId, ...pushVenueUrl(nodeSlug) },
        skipPreferenceCheck: true,
      })
    }),
  )
}

// ─── Main Check-In Pipeline ─────────────────────────────────────────────────

export async function processCheckIn(userId: string, input: CheckInInput): Promise<CheckInResponse> {
  if (DEV_MODE) {
    const cooldownUntil = new Date(Date.now() + 14400 * 1000).toISOString()
    return { success: true, cooldownUntil }
  }

  // 0. Check if user account is disabled
  const userRecord = await getUserById(userId)
  if (userRecord?.isDisabled === true) {
    throw AppError.forbidden('account_disabled')
  }

  // 1. Get node
  const node = await repo.getNodeWithCity(input.nodeId)
  if (!node) throw AppError.notFound('Node not found')

  // 1b. Replay support for the offline check-in outbox (R5). A queued check-in
  // carries its original capture time. Accept it only inside the Replay_Window;
  // presence still starts at delivery time (never backdated — honest-presence),
  // because the insert and presence writes below all use server `now`. A double
  // delivery of the same queued attempt is made a no-op by an idempotency claim
  // on (userId, nodeId, capturedAt), returning the original success (R5.7). This
  // runs before the cooldown check so a duplicate returns success, not a 429.
  const cooldownTtlForType = cooldownSecondsFor(cooldownKindFor(input.type))
  if (input.capturedAt) {
    if (!isWithinReplayWindow(input.capturedAt, Date.now())) {
      throw new AppError(422, 'checkin_replay_expired', 'This check-in is too old to submit')
    }
    const claimed = await repo.claimReplayCheckIn(userId, input.nodeId, input.capturedAt)
    if (!claimed) {
      return { success: true, cooldownUntil: new Date(Date.now() + cooldownTtlForType * 1000).toISOString() }
    }
  }

  // 2. Proximity or QR validation
  if (input.qrToken) {
    if (!node.qrCheckinEnabled) {
      throw AppError.badRequest('QR check-in not enabled for this node')
    }
    if (!validateQrToken(input.nodeId, input.qrToken)) {
      throw AppError.unauthorized('Invalid or expired QR token')
    }
  } else {
    if (input.lat === undefined || input.lng === undefined) {
      throw new AppError(422, 'accuracy_insufficient', 'Location required for GPS check-in')
    }
    // Distance to the already-fetched node (no extra DynamoDB read).
    const distanceM = haversineMetres(input.lat, input.lng, node.lat, node.lng)
    const mode = readProximityMode()
    const decision = decideProximity({
      distanceM,
      accuracyM: input.accuracy,
      mode,
      config: readProximityConfig(),
    })

    // Shadow mode keeps the legacy outcome but records where the accuracy-aware
    // rule would differ, so the impact can be measured on live traffic before it
    // is enforced. This never changes the user-visible result.
    if (mode === 'shadow' && decision.adaptiveAccepted !== decision.legacyAccepted) {
      console.warn(
        '[checkin.proximity.shadow]',
        JSON.stringify({
          nodeId: input.nodeId,
          distanceM: Math.round(distanceM),
          accuracyM: input.accuracy ?? null,
          adaptiveRadiusM: decision.adaptiveRadiusM,
          legacyAccepted: decision.legacyAccepted,
          adaptiveAccepted: decision.adaptiveAccepted,
        }),
      )
    }

    if (!decision.accepted) {
      // Client uses error='accuracy_insufficient' to offer the QR-at-venue fallback
      // instead of showing a hard failure toast.
      throw new AppError(422, 'accuracy_insufficient', 'You are too far from this venue')
    }
  }

  // 2b. Abuse checks (after proximity, before DB insert)
  await runAbuseChecks(
    userId,
    input.nodeId,
    input.fingerprintHash,
    '', // IP extracted at handler level in production
  )

  // 3. Cooldown check
  const cooldownKind = cooldownKindFor(input.type)
  const cooldownKey = checkInCooldownKey(cooldownKind, userId, input.nodeId)
  const cooldownTtl = cooldownSecondsFor(cooldownKind)

  const existing = await kvGet(cooldownKey)
  if (existing) {
    const ttl = await kvTtl(cooldownKey)
    const cooldownUntil = new Date(Date.now() + (ttl > 0 ? ttl : cooldownTtl) * 1000).toISOString()
    throw AppError.tooManyRequests('Check-in cooldown active', cooldownUntil)
  }

  // 3b. Resolve Found_Via (proof-of-demand R3.1, R3.2). Read after proximity and
  // cooldown have passed, so a row is only ever consumed by a check-in that is
  // actually going to be written. The check-in instant is `capturedAt` for an
  // offline replay and now for a live check-in, so a queued check-in is judged
  // against the moment it happened, not the moment it was drained.
  //
  // Server-derived only (R3.5): the value comes from the KV row and the
  // Away_Gate. `input` is never consulted for it — the body schema has no
  // `foundVia` field, so Zod strips any a client sends.
  const checkInInstantIso = input.capturedAt ?? new Date().toISOString()
  const openRow = await readOpenRowForStamp(userId, input.nodeId)
  const foundVia = resolveFoundVia(openRow, checkInInstantIso)

  // 4. Insert check-in (no lat/lng persisted) + increment totalCheckIns + recalculate tier
  const checkIn = await repo.insertCheckIn({
    userId,
    nodeId: input.nodeId,
    type: input.type,
    foundVia,
  })

  // 4a. Consume the row (R3.3). One open earns credit once, so the next
  // check-in at this venue starts from nothing and is a Walk_In unless the
  // consumer looked again. Best effort: the row's TTL removes it anyway, and a
  // delete failure must not fail a check-in that is already written.
  if (openRow) {
    try {
      await deleteVenueOpen(userId, input.nodeId)
    } catch (err) {
      console.warn(`[check-in] Venue_Open delete failed for node ${input.nodeId}: ${String(err)}`)
    }
  }

  // Capture tier before incrementing for change detection
  const userBeforeIncrement = await getUserById(userId)
  const oldTier = userBeforeIncrement?.tier ?? 'local'

  const incrementResult = await repo.incrementTotalCheckIns(userId)
  const newTier = incrementResult.tier
  const streakValue = await repo.updateStreak(userId)

  // The venue's lifetime total, maintained on the node row so the owner's live
  // panel reads one number instead of scanning the venue's whole history
  // (R15.1). Logged and continued on failure: the check-in row is already
  // written and is the source of truth the backfill script can re-derive from.
  try {
    await repo.incrementNodeCheckInTotal(input.nodeId)
  } catch (err) {
    console.warn(`[check-in] node total increment failed: ${String(err)}`)
  }

  // 4b. Advance threshold-lock progress on every active reward at this venue
  // (Churn-defences spec, Requirement 1). Only a Qualifying_Visit (type='reward')
  // advances a lock, so lock progress matches the displayed progress and
  // mint-time qualification (Loyalty-repeat-redemption spec, Requirement 3.3).
  // Failures here are logged but not fatal — the check-in is the source of
  // truth, locks self-heal on next visit.
  try {
    const { processCheckInRewardLocks } = await import('../rewards/threshold-lock.js')
    await processCheckInRewardLocks(userId, input.nodeId, input.type)
  } catch (err) {
    console.warn(`[check-in] threshold-lock advance failed: ${String(err)}`)
  }

  // Tracks whether this check-in newly opened presence (count changed) so we
  // only broadcast node:presence_update when the honest count actually moved
  // (Requirement 7.2). The same timestamp is used for the refresh and the one
  // authoritative count read that drives pulse and presence updates.
  let presenceOpened = false
  const presenceNowSeconds = epochSecondsFromMs(replayPresenceStartMs(Date.now(), input.capturedAt ?? null))

  // 4c. Open or refresh the consumer's Presence_Record for this venue so the
  // honest live-presence count reflects that they are here now (Requirement 4).
  // Applies to BOTH type='presence' and type='reward' (Requirement 4.3). The
  // repository increments the venue counter itself only on a new/reopened
  // presence ({ opened: true }) — a consumer counts at most once per venue
  // (Requirements 4.1, 4.2). Wrapped in try/catch: a presence-write failure is
  // logged and still returns a successful check-in; the orphan is reconciled by
  // the expiry sweep rather than leaving a permanent over-count (Requirement 4.5).
  try {
    // Presence starts at DELIVERY time, never at a replay's capturedAt
    // (honest-presence, R5.3). `replayPresenceStartMs` is the seam that enforces
    // this: it returns `now` and ignores capturedAt (Property 3).
    const { opened } = await createOrRefreshPresence({
      userId,
      nodeId: input.nodeId,
      now: presenceNowSeconds,
      windowSeconds: expiryWindowSeconds(presenceNowSeconds),
    })
    presenceOpened = opened
  } catch (err) {
    console.warn(`[check-in] presence open/refresh failed: ${String(err)}`)
  }

  let livePresenceCount: number | undefined
  try {
    livePresenceCount = await getLivePresenceCount(input.nodeId, presenceNowSeconds)
  } catch (err) {
    console.error(
      `[check-in] authoritative presence read failed for node ${input.nodeId}; ` +
        'skipping pulse refresh and pulse/presence emission:',
      err,
    )
  }

  // Detect tier change and notify
  if (oldTier !== newTier) {
    const TIER_BENEFITS: Record<string, string[]> = {
      local: ['Access to basic rewards'],
      regular: ['Priority reward access', 'Profile badge'],
      fixture: ['Exclusive rewards', 'Leaderboard boost'],
      institution: ['VIP rewards', 'Early access to new venues'],
      legend: ['All benefits unlocked', 'Legend badge', 'Exclusive events'],
    }
    try {
      await emitTierChanged(userId, {
        oldTier,
        newTier,
        benefits: TIER_BENEFITS[newTier] ?? [],
      })
      // Persist to the notification center + deliver via push when the user
      // has no live socket. `sendNotification` writes history (so the upgrade
      // is visible later in the notification center) and skips preference
      // checks for this system-critical milestone event.
      const { sendNotification } = await import('../notifications/service.js')
      await sendNotification({
        userId,
        type: 'tier_change',
        title: 'Tier Upgrade',
        body: `You've reached ${getTierLabel(newTier)} tier.`,
        data: { oldTier, newTier, benefits: TIER_BENEFITS[newTier] ?? [] },
        skipPreferenceCheck: true,
      })
    } catch {
      // Tier notification failure is non-critical
    }
  }

  // Shareable milestones (R11.5). Best-effort and idempotent: first check-in at
  // this venue (recorded once per node via conditional put), streak
  // achievements, and tier-ups. Failures never block the check-in.
  try {
    const { recordMilestone, streakMilestoneFor } = await import('../social/milestones.js')
    const nowIso = new Date().toISOString()
    await recordMilestone(userId, {
      type: 'first_checkin',
      qualifier: input.nodeId,
      title: 'First check-in',
      body: `First check-in at ${node.name}`,
      createdAt: nowIso,
    })
    const streakHit = streakMilestoneFor(streakValue)
    if (streakHit) {
      await recordMilestone(userId, {
        type: 'streak',
        qualifier: String(streakHit),
        title: `${streakHit}-day streak`,
        body: `You're on a ${streakHit}-day check-in streak`,
        createdAt: nowIso,
      })
    }
    if (oldTier !== newTier) {
      await recordMilestone(userId, {
        type: 'tier_up',
        qualifier: newTier,
        title: 'Tier up',
        body: `You moved up to ${newTier}`,
        createdAt: nowIso,
      })
    }
  } catch (err) {
    console.warn(`[check-in] milestone generation failed: ${String(err)}`)
  }

  // 5. Set cooldown
  await kvSet(cooldownKey, '1', cooldownTtl)

  // 6. Update DynamoDB counters and pulse score
  const cityId = node.city?.id ?? ''
  const citySlug = node.city?.slug ?? ''

  // "Today" ends at midnight SAST, so the counter does too (R15.2). A fixed 24h
  // TTL would have the 09:00 pulse and the morning toasts citing last night's
  // number. `resetWhenExpired` covers a lagging TTL sweep.
  const dailyCount = await kvIncr(dailyCheckInKvKey(input.nodeId), secondsUntilNextSastMidnight(), {
    resetWhenExpired: true,
  })
  const pulseScore = livePresenceCount === undefined ? undefined : computePulse(dailyCount, livePresenceCount)

  if (cityId) {
    // Refresh pulse only when the authoritative live-presence read succeeded.
    if (pulseScore !== undefined) {
      await kvSet(pulseKvKey(cityId, input.nodeId), String(pulseScore), PULSE_TTL_SECONDS)
    }

    // Increment the canonical current-period Leaderboard_Entry
    // (LEADERBOARD#{cityId} / USER#{userId}) that the Ranks read serves
    // (Requirements 2.1, 2.3). Best-effort per Requirement 2.4: a single atomic
    // ADD, awaited on the live path but wrapped in the same log-and-continue
    // pattern as the other check-in fan-outs so a leaderboard write failure
    // never blocks or fails the check-in response.
    try {
      await incrementLeaderboard(cityId, userId)
    } catch (err) {
      console.warn(`[check-in] leaderboard increment failed: ${String(err)}`)
    }
  }

  // 7. Emit socket events (best-effort; never fail the check-in over fan-out)
  try {
    if (citySlug) {
      if (pulseScore !== undefined) {
        await emitPulseUpdate(citySlug, {
          nodeId: input.nodeId,
          pulseScore,
          checkInCount: dailyCount,
          state: pulseStateFor(pulseScore),
        })
      }

      // Best-effort honest live-count broadcast (Requirements 7.2, 7.5, 7.6).
      // Only emit when this check-in newly opened presence and the shared
      // authoritative read succeeded. The same count drives the pulse formula.
      if (presenceOpened && livePresenceCount !== undefined) {
        // Record the observation and derive honest momentum from the trailing
        // count series (filling up / winding down). Rising here reflects a real
        // arrival; the label only claims a trend once the series supports it.
        const momentum = await recordPresenceSample(input.nodeId, livePresenceCount, presenceNowSeconds)
        await emitPresenceUpdate(citySlug, {
          nodeId: input.nodeId,
          livePresenceCount,
          cause: 'check_in',
          momentum,
        })
      }

      // Always emit anonymous city toast , no identity fields
      await emitToast(citySlug, {
        type: 'checkin',
        message: `${node.name} is heating up , ${dailyCount} check-ins`,
        nodeId: input.nodeId,
        nodeLat: node.lat,
        nodeLng: node.lng,
      })

      // Emit personalised friend toasts to each mutual follow's user room
      // Only emit if the user's privacy allows identity sharing
      try {
        await emitFriendCheckInFanout(userId, input.nodeId, node.name, node.slug)
      } catch {
        // Friend toast failures are non-critical , don't affect check-in response
      }
    }
  } catch (err) {
    console.warn(`[check-in] city socket emit failed: ${String(err)}`)
  }

  // 7b. Emit to business room if node is owned by a business
  // Business owners see aggregate data; strip username/avatarUrl for non-public users
  if (node.businessId) {
    try {
      const canShowIdentity = await canEmitIdentity(userId)
      const user = await getUserById(userId)
      const tier = user?.tier ?? 'local'
      const visitCount = await getUserCheckInCountAtNode(userId, input.nodeId)

      const businessPayload: Record<string, unknown> = {
        nodeId: input.nodeId,
        nodeName: node.name,
        checkInCount: dailyCount,
        tier,
        visitCount,
        timestamp: new Date().toISOString(),
        type: input.type,
        // The live panel splits "found you here" from "already in the room" from
        // this field (R3.6, R4.3). An enum, so it adds no identity to a payload
        // the privacy guard has already narrowed (R11.2).
        foundVia,
      }
      if (canShowIdentity && user?.displayName) {
        businessPayload['displayName'] = user.displayName
      }

      // Sanitize payload to ensure only privacy-safe fields are emitted
      const sanitizedPayload = sanitizeForBusiness(businessPayload)

      await emitBusinessCheckin(
        node.businessId,
        sanitizedPayload as {
          nodeId: string
          nodeName: string
          checkInCount: number
          timestamp: string
          foundVia: FoundVia
          consumerDisplayName?: string
        },
      )

      await emitBusinessCheckinDetail(node.businessId, {
        nodeId: input.nodeId,
        nodeName: node.name,
        displayName: canShowIdentity ? (user?.displayName ?? undefined) : undefined,
        tier,
        visitCount,
        timestamp: new Date().toISOString(),
        foundVia,
      })

      // Write business check-in cache record to app-data table for later querying.
      // Partitioned by the SAST calendar date (R15.8): an owner's "today" ends at
      // midnight in Johannesburg, so a 23:30 check-in belongs to the night it
      // happened on, not to tomorrow. Pre-deploy UTC-keyed rows are picked up by
      // the reader's dual read; they are never rewritten.
      const dateStr = sastDateString()
      const ts = Date.now()
      const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30-day TTL
      try {
        await documentClient.send(
          new PutCommand({
            TableName: TableNames.appData,
            Item: {
              pk: `BIZ_CHECKIN#${node.businessId}#${dateStr}`,
              sk: `CHECKIN#${ts}#${checkIn.checkInId}`,
              displayName: canShowIdentity ? (user?.displayName ?? null) : null,
              tier,
              visitCount,
              nodeId: input.nodeId,
              nodeName: node.name,
              timestamp: new Date().toISOString(),
              // Stored so the check-ins panel shows the same source badge on a
              // row loaded from history as it does on a live socket row
              // (R4.4). An enum, so the cached row gains no identity (R11.2).
              foundVia,
              ttl,
            },
          }),
        )
      } catch {
        // Cache write failure is non-critical
      }
    } catch (err) {
      console.warn(`[check-in] business fan-out failed: ${String(err)}`)
    }
  }

  // 8. Publish to SQS reward queue (best-effort)
  if (input.type === 'reward') {
    try {
      const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs')
      const sqsUrl = process.env['AREA_CODE_REWARD_QUEUE_URL']
      if (sqsUrl) {
        const sqs = new SQSClient({ region: AWS_REGION })
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: sqsUrl,
            MessageBody: JSON.stringify({
              userId,
              nodeId: input.nodeId,
              checkInId: checkIn.checkInId,
              // Thread the device fingerprint (when the check-in carried one)
              // so the mint-site Reward_Drain flag can record it as evidence
              // (loyalty-repeat-redemption R4.1). Omission never disables the
              // user-keyed drain check (R4.4).
              ...(input.fingerprintHash ? { fingerprintHash: input.fingerprintHash } : {}),
            }),
          }),
        )
      } else {
        // SQS not configured , skip reward evaluation silently in dev
      }
    } catch (err) {
      // Reward evaluation is async; user can retry by checking in again later.
      // Don't fail the check-in itself.
      console.warn(`[check-in] SQS reward enqueue failed: ${String(err)}`)
    }
  }

  const cooldownUntil = new Date(Date.now() + cooldownTtl * 1000).toISOString()
  return { success: true, cooldownUntil }
}
