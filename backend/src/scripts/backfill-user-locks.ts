/**
 * Backfill email/sub uniqueness locks for users created before the
 * transactional-lock change (see dynamodb-repository.ts).
 *
 * New accounts get `EMAIL#<email>` and `SUB#<sub>` lock items written
 * atomically with the user row, making duplicate emails/subs impossible.
 * Rows that predate that change have no locks, so this one-off script creates
 * them so the guarantee covers the whole table.
 *
 * It is:
 *   - Idempotent — locks are written with `attribute_not_exists`, so re-running
 *     skips rows that already have a lock.
 *   - Non-destructive — it only ADDS lock items; it never edits or deletes user
 *     rows.
 *   - Diagnostic — if two real users share an email (or sub), the second lock
 *     write is refused and the conflict is logged so an operator can merge the
 *     duplicate accounts by hand. The first row to claim the email keeps it.
 *
 * Usage (from backend/):
 *   npm run backfill:user-locks            # apply
 *   npm run backfill:user-locks -- --dry-run
 *
 * Requires the same AWS credentials + USERS_TABLE env the Lambda uses.
 */
import { ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../shared/db/dynamodb.js'

const DRY_RUN = process.argv.includes('--dry-run')

const emailLockKey = (email: string) => `EMAIL#${email.toLowerCase().trim()}`
const subLockKey = (sub: string) => `SUB#${sub}`

function isLockRow(userId: unknown): boolean {
  return typeof userId === 'string' && (userId.startsWith('EMAIL#') || userId.startsWith('SUB#'))
}

interface Stats {
  scanned: number
  realUsers: number
  emailLocksCreated: number
  subLocksCreated: number
  emailConflicts: Array<{ email: string; existingLinkedUserId: string; conflictingUserId: string }>
  subConflicts: Array<{ sub: string; existingLinkedUserId: string; conflictingUserId: string }>
}

/**
 * Write one lock item. Returns 'created' on success, 'exists' if a lock was
 * already there (idempotent re-run or a duplicate), or 'error' on anything else.
 */
async function writeLock(
  lockKey: string,
  lockType: 'email' | 'sub',
  linkedUserId: string,
): Promise<'created' | 'exists' | 'error'> {
  if (DRY_RUN) return 'created'
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.users,
        Item: { userId: lockKey, lockType, linkedUserId, createdAt: new Date().toISOString(), backfilled: true },
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    )
    return 'created'
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return 'exists'
    console.error(`  ✗ failed to write ${lockKey}:`, (err as Error).message)
    return 'error'
  }
}

/**
 * Read the linkedUserId an existing lock points at, so a reported conflict
 * names both the winner and the loser. Best-effort.
 */
async function existingLockOwner(lockKey: string): Promise<string> {
  if (DRY_RUN) return '(unknown in dry-run)'
  try {
    const res = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.users,
        FilterExpression: 'userId = :k',
        ExpressionAttributeValues: { ':k': lockKey },
        Limit: 1,
      }),
    )
    return (res.Items?.[0]?.['linkedUserId'] as string) ?? '(unknown)'
  } catch {
    return '(unknown)'
  }
}

/**
 * Claim the email + sub locks for a single real user row, recording any
 * conflicts (another row already owns that email/sub) into `stats`.
 */
async function processUserRow(item: Record<string, unknown>, stats: Stats): Promise<void> {
  const userId = item['userId'] as string

  const email = item['email'] as string | undefined
  if (email) {
    const result = await writeLock(emailLockKey(email), 'email', userId)
    if (result === 'created') {
      stats.emailLocksCreated += 1
    } else if (result === 'exists') {
      const owner = await existingLockOwner(emailLockKey(email))
      if (owner !== userId) {
        stats.emailConflicts.push({ email, existingLinkedUserId: owner, conflictingUserId: userId })
      }
    }
  }

  const sub = item['cognitoSub'] as string | undefined
  if (sub) {
    const result = await writeLock(subLockKey(sub), 'sub', userId)
    if (result === 'created') {
      stats.subLocksCreated += 1
    } else if (result === 'exists') {
      const owner = await existingLockOwner(subLockKey(sub))
      if (owner !== userId) {
        stats.subConflicts.push({ sub, existingLinkedUserId: owner, conflictingUserId: userId })
      }
    }
  }
}

async function run(): Promise<void> {
  console.log(`Backfilling user locks on ${TableNames.users}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…`)

  const stats: Stats = {
    scanned: 0,
    realUsers: 0,
    emailLocksCreated: 0,
    subLocksCreated: 0,
    emailConflicts: [],
    subConflicts: [],
  }

  let lastKey: Record<string, unknown> | undefined
  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.users,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )

    for (const item of page.Items ?? []) {
      stats.scanned += 1
      if (isLockRow(item['userId'])) continue // skip existing lock sentinels
      stats.realUsers += 1
      await processUserRow(item, stats)
    }

    lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  console.log('\n─── Backfill summary ───')
  console.log(`  rows scanned:        ${stats.scanned}`)
  console.log(`  real user rows:      ${stats.realUsers}`)
  console.log(`  email locks created: ${stats.emailLocksCreated}`)
  console.log(`  sub locks created:   ${stats.subLocksCreated}`)

  if (stats.emailConflicts.length > 0) {
    console.warn(`\n⚠  ${stats.emailConflicts.length} DUPLICATE EMAIL(S) — manual merge needed:`)
    for (const c of stats.emailConflicts) {
      console.warn(`   email=${c.email}  kept=${c.existingLinkedUserId}  duplicate=${c.conflictingUserId}`)
    }
  }
  if (stats.subConflicts.length > 0) {
    console.warn(`\n⚠  ${stats.subConflicts.length} DUPLICATE SUB(S) — manual merge needed:`)
    for (const c of stats.subConflicts) {
      console.warn(`   sub=${c.sub}  kept=${c.existingLinkedUserId}  duplicate=${c.conflictingUserId}`)
    }
  }
  if (stats.emailConflicts.length === 0 && stats.subConflicts.length === 0) {
    console.log('\n✓ No duplicate emails or subs found.')
  }

  if (DRY_RUN) console.log('\n(DRY RUN — no items were written.)')
}

run().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
