// DynamoDB-backed key-value store replacing Redis
// Uses app-data table with TTL for automatic expiration
import { GetCommand, PutCommand, DeleteCommand, UpdateCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../db/dynamodb.js'

/**
 * Get a value by key. Returns null if expired or not found.
 */
export async function kvGet(key: string): Promise<string | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `KV#${key}`, sk: 'VALUE' },
    }),
  )
  if (!result.Item) return null
  // Check if expired (TTL may not have cleaned it up yet)
  if (result.Item['ttl'] && result.Item['ttl'] < Math.floor(Date.now() / 1000)) {
    return null
  }
  return (result.Item['value'] as string) ?? null
}

// DynamoDB BatchGetItem accepts at most 100 keys per request.
const BATCH_GET_LIMIT = 100
// Bound the UnprocessedKeys retry loop so a persistently throttled batch fails
// loudly rather than spinning forever (no-fallbacks-no-legacy: surface, don't hang).
const BATCH_GET_MAX_RETRIES = 5

/**
 * Get many values by key in one pass. Returns a Map of key -> value containing
 * only keys that exist and are unexpired; a missing key is genuinely absent
 * (callers treat it as null), never a swallowed error (honest-presence).
 *
 * Keys are chunked at the DynamoDB BatchGetItem 100-key hard limit. Any
 * UnprocessedKeys DynamoDB declines to return (throttling) are retried with
 * backoff until drained, so no key is silently dropped
 * (no-fallbacks-no-legacy). Expired-but-unswept rows are filtered exactly as
 * `kvGet` does.
 */
export async function kvBatchGet(keys: string[]): Promise<Map<string, string>> {
  const values = new Map<string, string>()
  if (keys.length === 0) return values

  // Deduplicate: BatchGetItem rejects a request containing duplicate keys.
  const uniqueKeys = [...new Set(keys)]
  const nowSeconds = Math.floor(Date.now() / 1000)

  for (let i = 0; i < uniqueKeys.length; i += BATCH_GET_LIMIT) {
    const chunk = uniqueKeys.slice(i, i + BATCH_GET_LIMIT)
    let requestKeys: Record<string, unknown>[] = chunk.map((key) => ({ pk: `KV#${key}`, sk: 'VALUE' }))

    for (let attempt = 0; requestKeys.length > 0; attempt++) {
      if (attempt > BATCH_GET_MAX_RETRIES) {
        throw new Error(`kvBatchGet: ${requestKeys.length} keys still unprocessed after ${attempt} attempts`)
      }
      const result = await documentClient.send(
        new BatchGetCommand({ RequestItems: { [TableNames.appData]: { Keys: requestKeys } } }),
      )

      for (const item of result.Responses?.[TableNames.appData] ?? []) {
        const ttl = item['ttl'] as number | undefined
        if (ttl && ttl < nowSeconds) continue // expired but not yet swept
        const value = item['value'] as string | undefined
        if (value == null) continue
        const key = (item['pk'] as string).slice('KV#'.length)
        values.set(key, value)
      }

      const unprocessed = (result.UnprocessedKeys?.[TableNames.appData]?.Keys ?? []) as Record<string, unknown>[]
      requestKeys = unprocessed
      if (unprocessed.length > 0) {
        // Exponential backoff before retrying the throttled subset.
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt))
      }
    }
  }

  return values
}

/**
 * Set a value with optional TTL in seconds.
 */
export async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const item: Record<string, unknown> = {
    pk: `KV#${key}`,
    sk: 'VALUE',
    value,
    updatedAt: new Date().toISOString(),
  }
  if (ttlSeconds) {
    item['ttl'] = Math.floor(Date.now() / 1000) + ttlSeconds
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
}

/**
 * Delete a key.
 */
export async function kvDel(key: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `KV#${key}`, sk: 'VALUE' },
    }),
  )
}

/**
 * Increment a numeric value atomically. Creates with value 1 if not exists.
 * Returns the new value.
 */
export async function kvIncr(key: string, ttlSeconds?: number): Promise<number> {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    Key: { pk: `KV#${key}`, sk: 'VALUE' },
    UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :inc',
    ExpressionAttributeNames: { '#val': 'value' },
    ExpressionAttributeValues: { ':zero': 0, ':inc': 1 } as Record<string, unknown>,
    ReturnValues: 'ALL_NEW',
  }

  if (ttlSeconds) {
    params['UpdateExpression'] = 'SET #val = if_not_exists(#val, :zero) + :inc, #ttl = if_not_exists(#ttl, :ttl)'
    ;(params['ExpressionAttributeNames'] as Record<string, string>)['#ttl'] = 'ttl'
    ;(params['ExpressionAttributeValues'] as Record<string, unknown>)[':ttl'] =
      Math.floor(Date.now() / 1000) + ttlSeconds
  }

  const result = await documentClient.send(new UpdateCommand(params as any))
  return (result.Attributes?.['value'] as number) ?? 1
}

/**
 * Atomically increment a numeric value by an arbitrary amount. Creates with
 * value `amount` if the key does not exist. Returns the new value.
 *
 * This is the bulk counterpart to `kvIncr` (which only ever adds 1). It is used
 * by the win-back campaign quota counter, which must consume the whole batch of
 * dispatched recipients in a single atomic update so concurrent sends cannot
 * both slip under the monthly cap. The TTL is seeded only on first creation, so
 * the counter expires automatically with no cleanup job.
 */
export async function kvIncrBy(key: string, amount: number, ttlSeconds?: number): Promise<number> {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    Key: { pk: `KV#${key}`, sk: 'VALUE' },
    UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :inc',
    ExpressionAttributeNames: { '#val': 'value' },
    ExpressionAttributeValues: { ':zero': 0, ':inc': amount } as Record<string, unknown>,
    ReturnValues: 'ALL_NEW',
  }

  if (ttlSeconds) {
    params['UpdateExpression'] = 'SET #val = if_not_exists(#val, :zero) + :inc, #ttl = if_not_exists(#ttl, :ttl)'
    ;(params['ExpressionAttributeNames'] as Record<string, string>)['#ttl'] = 'ttl'
    ;(params['ExpressionAttributeValues'] as Record<string, unknown>)[':ttl'] =
      Math.floor(Date.now() / 1000) + ttlSeconds
  }

  const result = await documentClient.send(new UpdateCommand(params as any))
  return (result.Attributes?.['value'] as number) ?? amount
}

/**
 * Get remaining TTL in seconds. Returns -1 if no TTL, -2 if key doesn't exist.
 */
export async function kvTtl(key: string): Promise<number> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `KV#${key}`, sk: 'VALUE' },
    }),
  )
  if (!result.Item) return -2
  const ttl = result.Item['ttl'] as number | undefined
  if (!ttl) return -1
  const remaining = ttl - Math.floor(Date.now() / 1000)
  return remaining > 0 ? remaining : -2
}
