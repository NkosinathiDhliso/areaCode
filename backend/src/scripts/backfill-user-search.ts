/**
 * Backfill people-search index attributes for users created before the
 * UsernameSearchIndex / DisplayNameSearchIndex GSIs existed (see
 * dynamodb-repository.ts `deriveSearchAttributes` and infra .../main.tf).
 *
 * New/updated accounts get `usernameLower` / `usernameChar` /
 * `displayNameLower` / `displayNameChar` written on the row so they appear in
 * the sparse search GSIs. Rows that predate that change carry none of these
 * attributes and are therefore invisible to `/v1/users/search` until re-saved.
 * This one-off script computes and writes them from the existing username /
 * displayName fields.
 *
 * It is:
 *   - Idempotent — re-running recomputes the same attributes; a row already in
 *     sync is written with identical values (or skipped when nothing derives).
 *   - Non-destructive — it only SETs the derived attributes (or REMOVEs them
 *     when a field is empty); it never touches identity, follows, or check-ins.
 *   - Sparse-safe — identity lock rows (EMAIL#/SUB#) and rows with neither a
 *     username nor a display name are skipped.
 *
 * Usage (from backend/):
 *   npm run backfill:user-search
 *   npm run backfill:user-search -- --dry-run
 *
 * Requires the same AWS credentials + USERS_TABLE env the Lambda uses.
 */
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { deriveSearchAttributes } from '../features/auth/dynamodb-repository.js'

const DRY_RUN = process.argv.includes('--dry-run')

function isLockRow(userId: unknown): boolean {
  return typeof userId === 'string' && (userId.startsWith('EMAIL#') || userId.startsWith('SUB#'))
}

const ALL_SEARCH_ATTRS = ['usernameLower', 'usernameChar', 'displayNameLower', 'displayNameChar']

interface Stats {
  scanned: number
  realUsers: number
  indexed: number
  cleared: number
  skipped: number
}

async function processRow(item: Record<string, unknown>, stats: Stats): Promise<void> {
  const userId = item['userId'] as string
  const derived = deriveSearchAttributes({
    username: item['username'] as string | undefined,
    displayName: item['displayName'] as string | undefined,
  })
  const derivedKeys = Object.keys(derived)

  // Nothing to index and nothing already present → leave the row untouched.
  const hasStale = ALL_SEARCH_ATTRS.some((a) => item[a] !== undefined)
  if (derivedKeys.length === 0 && !hasStale) {
    stats.skipped += 1
    return
  }

  if (DRY_RUN) {
    if (derivedKeys.length > 0) stats.indexed += 1
    else stats.cleared += 1
    return
  }

  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  const setPairs: string[] = []
  for (const attr of derivedKeys) {
    names[`#${attr}`] = attr
    values[`:${attr}`] = derived[attr]
    setPairs.push(`#${attr} = :${attr}`)
  }
  // Remove any index attribute that should no longer exist (field now empty).
  const removeAttrs = ALL_SEARCH_ATTRS.filter((a) => !(a in derived))
  for (const attr of removeAttrs) names[`#${attr}`] = attr

  let expr = ''
  if (setPairs.length > 0) expr += `SET ${setPairs.join(', ')}`
  if (removeAttrs.length > 0) expr += `${expr ? ' ' : ''}REMOVE ${removeAttrs.map((a) => `#${a}`).join(', ')}`
  if (!expr) {
    stats.skipped += 1
    return
  }

  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.users,
      Key: { userId },
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
    }),
  )

  if (derivedKeys.length > 0) stats.indexed += 1
  else stats.cleared += 1
}

async function run(): Promise<void> {
  console.log(`Backfilling user search index on ${TableNames.users}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…`)

  const stats: Stats = { scanned: 0, realUsers: 0, indexed: 0, cleared: 0, skipped: 0 }

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
      if (isLockRow(item['userId'])) continue
      stats.realUsers += 1
      await processRow(item, stats)
    }

    lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  console.log('\n─── Backfill summary ───')
  console.log(`  rows scanned:   ${stats.scanned}`)
  console.log(`  real user rows: ${stats.realUsers}`)
  console.log(`  indexed:        ${stats.indexed}`)
  console.log(`  cleared:        ${stats.cleared}`)
  console.log(`  skipped:        ${stats.skipped}`)
  if (DRY_RUN) console.log('\n(DRY RUN — no items were written.)')
}

run().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
