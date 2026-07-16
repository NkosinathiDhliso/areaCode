/**
 * Backfill O(1) redemption-code alias rows for redemptions created before the
 * alias index existed.
 *
 * Usage (from backend/):
 *   npm run backfill:redemption-code-aliases -- --dry-run
 *   npm run backfill:redemption-code-aliases
 *
 * Run this against production before deploying code that reads aliases only.
 * Requires AWS credentials and APP_DATA_TABLE for the target environment.
 */
import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'

import {
  normalizeRedemptionCode,
  redemptionCodeAliasItem,
  redemptionCodeAliasKey,
} from '../features/rewards/redemption-alias.js'
import { documentClient, isConditionalCheckFailedError, TableNames } from '../shared/db/dynamodb.js'

const DRY_RUN = process.argv.includes('--dry-run')

interface Stats {
  scanned: number
  candidates: number
  created: number
  existing: number
  malformed: number
}

async function getAlias(code: string): Promise<Record<string, unknown> | null> {
  const key = redemptionCodeAliasKey(code)
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: key, sk: key },
      ConsistentRead: true,
    }),
  )
  return result.Item ?? null
}
function readRedemption(item: Record<string, unknown>) {
  const redemptionId = item['redemptionId']
  const redemptionCode = item['redemptionCode']
  const createdAt = item['createdAt']
  if (
    typeof redemptionId !== 'string' ||
    typeof redemptionCode !== 'string' ||
    normalizeRedemptionCode(redemptionCode).length === 0 ||
    typeof createdAt !== 'string'
  ) {
    return null
  }
  return { redemptionId, redemptionCode, createdAt }
}

async function processRow(item: Record<string, unknown>, stats: Stats): Promise<void> {
  const redemption = readRedemption(item)
  if (!redemption) {
    stats.malformed += 1
    console.error('Malformed redemption row:', item['pk'])
    return
  }

  stats.candidates += 1
  const existing = await getAlias(redemption.redemptionCode)
  if (existing) {
    if (existing['redemptionId'] !== redemption.redemptionId) {
      throw new Error(`Redemption code collision for ${normalizeRedemptionCode(redemption.redemptionCode)}`)
    }
    stats.existing += 1
    return
  }
  if (DRY_RUN) return

  const alias = redemptionCodeAliasItem(redemption.redemptionCode, redemption.redemptionId, redemption.createdAt)
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: alias,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    )
    stats.created += 1
  } catch (err) {
    if (!isConditionalCheckFailedError(err)) throw err
    const winner = await getAlias(redemption.redemptionCode)
    if (winner?.['redemptionId'] !== redemption.redemptionId) throw err
    stats.existing += 1
  }
}
async function run(): Promise<void> {
  console.log(`Backfilling redemption-code aliases in ${TableNames.appData}${DRY_RUN ? ' (DRY RUN)' : ''}`)
  const stats: Stats = { scanned: 0, candidates: 0, created: 0, existing: 0, malformed: 0 }
  let lastKey: Record<string, unknown> | undefined

  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.appData,
        FilterExpression: 'begins_with(pk, :prefix) AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':prefix': 'REDEMPTION#' },
        ProjectionExpression: 'pk, sk, redemptionId, redemptionCode, createdAt',
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    for (const item of page.Items ?? []) {
      stats.scanned += 1
      await processRow(item, stats)
    }
    lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  console.log('Redemption alias backfill summary:', stats)
  if (stats.malformed > 0) {
    throw new Error(`Backfill found ${stats.malformed} malformed redemption row(s)`)
  }
}

run().catch((err) => {
  console.error('Redemption alias backfill failed:', err)
  process.exit(1)
})
