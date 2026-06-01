import { createHmac } from 'node:crypto'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvIncr, kvTtl } from '../../shared/kv/dynamodb-kv.js'
import {
  emitPulseUpdate,
  emitToast,
  emitBusinessCheckin,
  emitBusinessCheckinDetail,
  emitFriendToast,
  emitTierChanged,
} from '../../shared/socket/events.js'
import { getMutualFollowIds, getFollowingIds } from '../social/repository.js'
import { getUserById } from '../auth/repository.js'
import { canEmitIdentity, sanitizeForBusiness } from '../../shared/privacy/privacy-guard.js'
import { runAbuseChecks } from './abuse.js'
import * as repo from './repository.js'
import { getUserCheckInCountAtNode } from './dynamodb-repository.js'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import type { CheckInInput, CheckInResponse } from './types.js'

const DEV_MODE = process.env['AREA_CODE_ENV'] === 'dev' && !process.env['AREA_CODE_FORCE_LIVE']

const REWARD_COOLDOWN = 14400 // 4 hours
const PRESENCE_COOLDOWN = 3600 // 1 hour
const PROXIMITY_RADIUS = 500 // metres (generous to accommodate poor GPS on low-end devices)

// ─── QR Token Validation ────────────────────────────────────────────────────

function validateQrToken(nodeId: string, token: string): boolean {
  const secret = process.env['AREA_CODE_QR_HMAC_SECRET'] ?? ''
  for (let offset = 0; offset <= 1; offset++) {
    const ts = Math.floor(Date.now() / (15 * 60 * 1000)) - offset
    const expected = createHmac('sha256', secret).update(`${nodeId}${ts}`).digest('hex').slice(0, 32)
    if (token === expected) return true
  }
  return false
}

// ─── Pulse Score ────────────────────────────────────────────────────────────

const STATE_THRESHOLDS = [
  { min: 61, state: 'popping' as const },
  { min: 31, state: 'buzzing' as const },
  { min: 11, state: 'active' as const },
  { min: 1, state: 'quiet' as const },
  { min: 0, state: 'dormant' as const },
]

function getNodeState(score: number) {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant' as const
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
    const within = await repo.checkProximity(input.nodeId, input.lat, input.lng, PROXIMITY_RADIUS)
    if (!within) {
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
  const cooldownKey =
    input.type === 'reward'
      ? `checkin:cooldown:reward:${userId}:${input.nodeId}`
      : `checkin:cooldown:presence:${userId}:${input.nodeId}`
  const cooldownTtl = input.type === 'reward' ? REWARD_COOLDOWN : PRESENCE_COOLDOWN

  const existing = await kvGet(cooldownKey)
  if (existing) {
    const ttl = await kvTtl(cooldownKey)
    const cooldownUntil = new Date(Date.now() + (ttl > 0 ? ttl : cooldownTtl) * 1000).toISOString()
    throw AppError.tooManyRequests('Check-in cooldown active', cooldownUntil)
  }

  // 4. Insert check-in (no lat/lng persisted) + increment totalCheckIns + recalculate tier
  const checkIn = await repo.insertCheckIn({
    userId,
    nodeId: input.nodeId,
    type: input.type,
  })

  // Capture tier before incrementing for change detection
  const userBeforeIncrement = await getUserById(userId)
  const oldTier = userBeforeIncrement?.tier ?? 'local'

  const incrementResult = await repo.incrementTotalCheckIns(userId)
  const newTier = incrementResult.tier
  await repo.updateStreak(userId)

  // 4b. Advance threshold-lock progress on every active reward at this venue
  // (Churn-defences spec, Requirement 1). Failures here are logged but not
  // fatal — the check-in is the source of truth, locks self-heal on next visit.
  try {
    const { processCheckInRewardLocks } = await import('../rewards/threshold-lock.js')
    await processCheckInRewardLocks(userId, input.nodeId)
  } catch (err) {
    console.warn(`[check-in] threshold-lock advance failed: ${String(err)}`)
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
      emitTierChanged(userId, {
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
        title: 'Tier Upgrade!',
        body: `Congratulations! You've reached ${newTier} tier.`,
        data: { oldTier, newTier, benefits: TIER_BENEFITS[newTier] ?? [] },
        skipPreferenceCheck: true,
      })
    } catch {
      // Tier notification failure is non-critical
    }
  }

  // 5. Set cooldown
  await kvSet(cooldownKey, '1', cooldownTtl)

  // 6. Update DynamoDB counters and pulse score
  const cityId = node.city?.id ?? ''
  const citySlug = node.city?.slug ?? ''

  const dailyCount = await kvIncr(`checkin:today:${input.nodeId}`, 86400)
  // Approximate unique users via a simple counter (DynamoDB has no SADD)
  const uniqueUsers = dailyCount // simplified approximation
  const pulseScore = dailyCount * 5 + uniqueUsers * 2

  if (cityId) {
    // Store pulse score in KV for quick lookup
    await kvSet(`pulse:${cityId}:${input.nodeId}`, String(pulseScore), 86400)
    // Increment leaderboard counter
    await kvIncr(`leaderboard:${cityId}:${userId}`, 0) // no TTL
  }

  // 7. Emit socket events (best-effort; never fail the check-in over fan-out)
  try {
    if (citySlug) {
      emitPulseUpdate(citySlug, {
        nodeId: input.nodeId,
        pulseScore,
        checkInCount: dailyCount,
        state: getNodeState(pulseScore),
      })

      // Always emit anonymous city toast , no identity fields
      emitToast(citySlug, {
        type: 'checkin',
        message: `${node.name} is heating up , ${dailyCount} check-ins`,
        nodeId: input.nodeId,
        nodeLat: node.lat,
        nodeLng: node.lng,
      })

      // Emit personalised friend toasts to each mutual follow's user room
      // Only emit if the user's privacy allows identity sharing
      try {
        const canEmit = await canEmitIdentity(userId)
        if (canEmit) {
          const followingIds = await getFollowingIds(userId)
          const friendIds = await getMutualFollowIds(userId, followingIds)
          if (friendIds.size > 0) {
            const user = await getUserById(userId)
            const displayName = user?.displayName ?? 'Someone'
            const friendPayload: {
              type: 'checkin'
              message: string
              nodeId: string
              avatarUrl?: string
            } = {
              type: 'checkin',
              message: `${displayName} just checked in at ${node.name}`,
              nodeId: input.nodeId,
            }
            if (user?.avatarUrl) {
              friendPayload.avatarUrl = user.avatarUrl
            }
            for (const friendId of friendIds) {
              emitFriendToast(friendId, friendPayload)
            }
          }
        }
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
      }
      if (canShowIdentity && user?.displayName) {
        businessPayload['displayName'] = user.displayName
      }

      // Sanitize payload to ensure only privacy-safe fields are emitted
      const sanitizedPayload = sanitizeForBusiness(businessPayload)

      emitBusinessCheckin(
        node.businessId,
        sanitizedPayload as {
          nodeId: string
          nodeName: string
          checkInCount: number
          timestamp: string
          consumerDisplayName?: string
        },
      )

      emitBusinessCheckinDetail(node.businessId, {
        nodeId: input.nodeId,
        nodeName: node.name,
        displayName: canShowIdentity ? (user?.displayName ?? undefined) : undefined,
        tier,
        visitCount,
        timestamp: new Date().toISOString(),
      })

      // Write business check-in cache record to app-data table for later querying
      const dateStr = new Date().toISOString().slice(0, 10)
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
        const sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' })
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: sqsUrl,
            MessageBody: JSON.stringify({
              userId,
              nodeId: input.nodeId,
              checkInId: checkIn.checkInId,
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
