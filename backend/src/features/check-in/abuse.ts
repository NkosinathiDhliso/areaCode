import { PutCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { kvIncr } from '../../shared/kv/dynamodb-kv.js'
import { getUserById } from '../auth/dynamodb-repository.js'

interface AbuseCheckResult {
  flags: Array<{ type: string; evidence: Record<string, unknown> }>
}

/**
 * Abuse detection checks run after proximity validation, before DB insert.
 * These checks never block a check-in; they record abuse_flags records
 * asynchronously for admin review. Reward-drain detection lives at the mint
 * site in the Reward_Evaluator, not here (a check-in is not a claim).
 */
export async function runAbuseChecks(
  userId: string,
  nodeId: string,
  fingerprintHash: string | undefined,
  _ip: string,
): Promise<AbuseCheckResult> {
  const flags: AbuseCheckResult['flags'] = []

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

  // Persist flags asynchronously (these checks never block a check-in)
  if (flags.length > 0) {
    void persistFlags(userId, nodeId, flags)
  }

  return { flags }
}

async function persistFlags(
  userId: string,
  _nodeId: string,
  flags: Array<{ type: string; evidence: Record<string, unknown> }>,
) {
  try {
    for (const f of flags) {
      // Check-in-side flags (device_velocity, new_account_velocity) are advisory.
      await writeAbuseFlag(userId, { type: f.type, evidence: f.evidence, priority: 'normal' })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[abuse] Failed to persist flags: ${msg}\n`)
  }
}

/**
 * Write a single abuse flag row to the admin abuse queue (the existing
 * `ABUSE_QUEUE` GSI shape). One home for the flag-row layout so every abuse
 * producer (check-in velocity checks here, the mint-site Reward_Drain in the
 * Reward_Evaluator) writes an identically-shaped row. `priority` orders the
 * queue via `gsi1sk` (`high` surfaces before `normal` under the descending
 * scan the admin queue uses).
 */
export async function writeAbuseFlag(
  entityId: string,
  flag: { type: string; evidence: Record<string, unknown>; priority?: 'normal' | 'high' },
): Promise<void> {
  const flagId = generateId()
  const now = new Date().toISOString()
  const priority = flag.priority ?? 'normal'
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `ABUSE#${flagId}`,
        sk: `USER#${entityId}`,
        // GSI1 keys for admin abuse queue ordering
        gsi1pk: 'ABUSE_QUEUE',
        gsi1sk: `${priority}#${now}`,
        flagId,
        type: flag.type,
        entityId,
        entityType: 'user',
        evidenceJson: flag.evidence,
        autoActioned: false,
        reviewed: false,
        priority,
        createdAt: now,
      },
    }),
  )
}
