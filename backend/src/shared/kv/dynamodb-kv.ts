// Key-value store: Redis-first (ElastiCache), DynamoDB fallback.
// Keeps the existing kvGet/kvSet/kvDel/kvIncr/kvTtl API stable so callers
// (rate-limiting, session caches, sms feedback, etc.) don't need to change.
//
// When REDIS_URL is set (prod), Redis handles everything in <1ms with proper
// atomic INCR + EXPIRE for rate-limiters. When unset (local/test), DDB is used
// so behaviour is preserved.
import { GetCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../db/dynamodb.js'
import { getRedis } from '../db/redis.js'

const PREFIX = 'ac:kv:'

export async function kvGet(key: string): Promise<string | null> {
  const r = getRedis()
  if (r) return r.get(PREFIX + key)

  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `KV#${key}`, sk: 'VALUE' },
    }),
  )
  if (!result.Item) return null
  if (result.Item['ttl'] && (result.Item['ttl'] as number) < Math.floor(Date.now() / 1000)) {
    return null
  }
  return (result.Item['value'] as string) ?? null
}

export async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const r = getRedis()
  if (r) {
    if (ttlSeconds) await r.set(PREFIX + key, value, 'EX', ttlSeconds)
    else await r.set(PREFIX + key, value)
    return
  }

  const item: Record<string, unknown> = {
    pk: `KV#${key}`,
    sk: 'VALUE',
    value,
    updatedAt: new Date().toISOString(),
  }
  if (ttlSeconds) item['ttl'] = Math.floor(Date.now() / 1000) + ttlSeconds
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
}

export async function kvDel(key: string): Promise<void> {
  const r = getRedis()
  if (r) {
    await r.del(PREFIX + key)
    return
  }
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `KV#${key}`, sk: 'VALUE' },
    }),
  )
}

/**
 * Atomic increment. Returns new value. Sets TTL only on first creation so
 * rate-limit windows roll cleanly.
 */
export async function kvIncr(key: string, ttlSeconds?: number): Promise<number> {
  const r = getRedis()
  if (r) {
    const full = PREFIX + key
    const pipeline = r.multi()
    pipeline.incr(full)
    if (ttlSeconds) {
      // Only set TTL if not already set (preserves rolling window).
      pipeline.expire(full, ttlSeconds, 'NX')
    }
    const results = await pipeline.exec()
    return Number(results?.[0]?.[1] ?? 1)
  }

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

export async function kvTtl(key: string): Promise<number> {
  const r = getRedis()
  if (r) return r.ttl(PREFIX + key)

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
