import { redis } from '../../shared/redis/client.js'
import { prisma } from '../../shared/db/prisma.js'
import { AppError } from '../../shared/errors/AppError.js'

interface AbuseCheckResult {
  blocked: boolean
  flags: Array<{ type: string; evidence: Record<string, unknown> }>
}

/**
 * Abuse detection checks run after proximity validation, before DB insert.
 * Flags with auto-action return 429. Flags without auto-action allow check-in
 * and create abuse_flags records asynchronously.
 */
export async function runAbuseChecks(
  userId: string,
  nodeId: string,
  fingerprintHash: string | undefined,
  ip: string,
): Promise<AbuseCheckResult> {
  const flags: AbuseCheckResult['flags'] = []
  let blocked = false

  // 1. Device fingerprint velocity: >3 check-ins at different nodes in 30 min
  if (fingerprintHash) {
    const fpKey = `abuse:fp:${fingerprintHash}`
    await redis.sadd(fpKey, nodeId)
    await redis.expire(fpKey, 1800) // 30 min
    const nodeCount = await redis.scard(fpKey)
    if (nodeCount > 3) {
      flags.push({
        type: 'device_velocity',
        evidence: { fingerprintHash, nodeCount, windowMinutes: 30 },
      })
    }
  }

  // 2. New account velocity: <24h old, >3 check-ins → rate-limit to 1/hour
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  })
  if (user) {
    const ageMs = Date.now() - user.createdAt.getTime()
    if (ageMs < 24 * 60 * 60 * 1000) {
      const newAcctKey = `abuse:new_acct:${userId}`
      const count = await redis.incr(newAcctKey)
      if (count === 1) await redis.expire(newAcctKey, 3600)
      if (count > 3) {
        flags.push({
          type: 'new_account_velocity',
          evidence: { userId, accountAgeHours: Math.round(ageMs / 3600000), checkInCount: count },
        })
      }
    }
  }

  // 3. Reward slot draining: same device >2 rewards at same node in 24h
  if (fingerprintHash) {
    const drainKey = `abuse:drain:${fingerprintHash}:${nodeId}`
    const drainCount = await redis.incr(drainKey)
    if (drainCount === 1) await redis.expire(drainKey, 86400)
    if (drainCount > 2) {
      blocked = true
      flags.push({
        type: 'reward_drain',
        evidence: { fingerprintHash, nodeId, claimCount: drainCount },
      })
    }
  }

  // Persist flags asynchronously (don't block check-in for non-blocking flags)
  if (flags.length > 0) {
    void persistFlags(userId, nodeId, flags)
  }

  if (blocked) {
    throw AppError.tooManyRequests('Check-in temporarily unavailable')
  }

  return { blocked, flags }
}

async function persistFlags(
  userId: string,
  _nodeId: string,
  flags: Array<{ type: string; evidence: Record<string, unknown> }>,
) {
  try {
    await prisma.abuseFlag.createMany({
      data: flags.map((f) => ({
        type: f.type,
        entityId: userId,
        entityType: 'user' as const,
        evidenceJson: JSON.parse(JSON.stringify(f.evidence)) as object,
        autoActioned: f.type === 'reward_drain',
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[abuse] Failed to persist flags: ${msg}`)
  }
}
