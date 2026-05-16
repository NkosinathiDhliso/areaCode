import { kvGet, kvSet, kvIncr } from '../../shared/kv/dynamodb-kv.js'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { getUserById } from '../auth/dynamodb-repository.js'
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
    const nodeCount = await kvIncr(`${fpKey}:${nodeId}`, 1800)
    // Approximate: count distinct node keys for this fingerprint
    if (nodeCount > 3) {
      flags.push({
        type: 'device_velocity',
        evidence: { fingerprintHash, nodeCount, windowMinutes: 30 },
      })
    }
  }

  // 2. New account velocity: <24h old, >3 check-ins → rate-limit to 1/hour
  const user = await getUserById(userId)
  if (user) {
    const createdAt = (user as any).createdAt as string | undefined
    const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity
    if (ageMs < 24 * 60 * 60 * 1000) {
      const count = await kvIncr(`abuse:new_acct:${userId}`, 3600)
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
    const drainCount = await kvIncr(`abuse:drain:${fingerprintHash}:${nodeId}`, 86400)
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
    for (const f of flags) {
      const flagId = generateId()
      const now = new Date().toISOString()
      // Priority: reward_drain is high, others are normal
      const priority = f.type === 'reward_drain' ? 'high' : 'normal'
      await documentClient.send(
        new PutCommand({
          TableName: TableNames.appData,
          Item: {
            pk: `ABUSE#${flagId}`,
            sk: `USER#${userId}`,
            // GSI1 keys for admin abuse queue ordering
            gsi1pk: 'ABUSE_QUEUE',
            gsi1sk: `${priority}#${now}`,
            flagId,
            type: f.type,
            entityId: userId,
            entityType: 'user',
            evidenceJson: f.evidence,
            autoActioned: f.type === 'reward_drain',
            reviewed: false,
            priority,
            createdAt: now,
          },
        }),
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[abuse] Failed to persist flags: ${msg}\n`)
  }
}
