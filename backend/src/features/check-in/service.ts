import { createHmac } from 'node:crypto'
import { AppError } from '../../shared/errors/AppError.js'
import { redis } from '../../shared/redis/client.js'
import {
  checkinCooldownReward, checkinCooldownPresence,
  checkinToday, nodesPulse, uniqueUsersToday, leaderboard,
  userConsent,
} from '../../shared/redis/keys.js'
import { emitPulseUpdate, emitToast, emitBusinessCheckin } from '../../shared/socket/events.js'
import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'
import type { CheckInInput, CheckInResponse } from './types.js'

const DEV_MODE = !isDbAvailable

const REWARD_COOLDOWN = 14400  // 4 hours
const PRESENCE_COOLDOWN = 3600 // 1 hour
const PROXIMITY_RADIUS = 200   // metres

// ─── QR Token Validation ────────────────────────────────────────────────────

function validateQrToken(nodeId: string, token: string): boolean {
  const secret = process.env['AREA_CODE_QR_HMAC_SECRET'] ?? ''
  for (let offset = 0; offset <= 1; offset++) {
    const ts = Math.floor(Date.now() / (15 * 60 * 1000)) - offset
    const expected = createHmac('sha256', secret)
      .update(`${nodeId}${ts}`)
      .digest('hex')
      .slice(0, 32)
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

export async function processCheckIn(
  userId: string,
  input: CheckInInput,
): Promise<CheckInResponse> {
  if (DEV_MODE) {
    const cooldownUntil = new Date(Date.now() + 14400 * 1000).toISOString()
    return { success: true, cooldownUntil }
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
      throw AppError.badRequest('Location required for GPS check-in')
    }
    const within = await repo.checkProximity(
      input.nodeId, input.lat, input.lng, PROXIMITY_RADIUS,
    )
    if (!within) {
      throw AppError.unprocessable('You are too far from this venue')
    }
  }

  // 3. Cooldown check
  const cooldownKey = input.type === 'reward'
    ? checkinCooldownReward(userId, input.nodeId)
    : checkinCooldownPresence(userId, input.nodeId)
  const cooldownTtl = input.type === 'reward' ? REWARD_COOLDOWN : PRESENCE_COOLDOWN

  const existing = await redis.get(cooldownKey)
  if (existing) {
    const ttl = await redis.ttl(cooldownKey)
    const cooldownUntil = new Date(Date.now() + ttl * 1000).toISOString()
    throw AppError.tooManyRequests('Check-in cooldown active', cooldownUntil)
  }

  // 4. Insert check-in (no lat/lng persisted)
  await repo.insertCheckIn({
    userId,
    nodeId: input.nodeId,
    type: input.type,
  })

  // 5. Set cooldown
  await redis.set(cooldownKey, '1', 'EX', cooldownTtl)

  // 6. Update Redis counters and pulse score
  const cityId = node.city?.id ?? ''
  const citySlug = node.city?.slug ?? ''

  await redis.incr(checkinToday(input.nodeId))
  await redis.sadd(uniqueUsersToday(input.nodeId), userId)

  // Recalculate pulse score
  const dailyCount = parseInt(await redis.get(checkinToday(input.nodeId)) ?? '0', 10)
  const uniqueUsers = await redis.scard(uniqueUsersToday(input.nodeId))
  const pulseScore = (dailyCount * 5) + (uniqueUsers * 2)

  if (cityId) {
    await redis.zadd(nodesPulse(cityId), pulseScore, input.nodeId)
    // Increment leaderboard
    await redis.zincrby(leaderboard(cityId), 1, userId)
  }

  // 7. Emit socket events
  if (citySlug) {
    emitPulseUpdate(citySlug, {
      nodeId: input.nodeId,
      pulseScore,
      checkInCount: dailyCount,
      state: getNodeState(pulseScore),
    })

    // Emit toast if user consents to broadcast
    const broadcast = await shouldBroadcast(userId)
    if (broadcast) {
      emitToast(citySlug, {
        type: 'checkin',
        message: `Someone just checked in to ${node.name}`,
        nodeId: input.nodeId,
        nodeLat: node.lat,
        nodeLng: node.lng,
      })
    }
  }

  // 7b. Emit to business room if node is owned by a business
  if (node.businessId) {
    emitBusinessCheckin(node.businessId, {
      nodeId: input.nodeId,
      nodeName: node.name,
      checkInCount: dailyCount,
      timestamp: new Date().toISOString(),
    })
  }

  // 8. Publish to SQS reward queue (placeholder — in production uses SQS)
  if (input.type === 'reward') {
    console.log(`[check-in] Queuing reward evaluation: user=${userId} node=${input.nodeId}`)
  }

  const cooldownUntil = new Date(Date.now() + cooldownTtl * 1000).toISOString()
  return { success: true, cooldownUntil }
}

// ─── Consent Check (used by check-in to decide toast emission) ──────────────

export async function shouldBroadcast(userId: string): Promise<boolean> {
  const cached = await redis.get(userConsent(userId))
  if (cached) {
    const consent = JSON.parse(cached) as { broadcastLocation: boolean }
    return consent.broadcastLocation
  }
  return true // Default to broadcasting
}
