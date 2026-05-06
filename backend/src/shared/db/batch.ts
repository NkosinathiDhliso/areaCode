// BatchGetItem helpers — eliminates N+1 `for (...) await getById(...)` loops.
// DynamoDB BatchGetItem accepts up to 100 keys per request; we chunk for safety.
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from './dynamodb.js'

const CHUNK = 100

async function batchGet(
  tableName: string,
  keyName: string,
  ids: readonly string[],
): Promise<Record<string, Record<string, unknown>>> {
  const unique = Array.from(new Set(ids)).filter(Boolean)
  if (unique.length === 0) return {}

  const out: Record<string, Record<string, unknown>> = {}

  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK)
    let keys = slice.map((id) => ({ [keyName]: id }))

    // Retry UnprocessedKeys with exponential backoff (up to 3 attempts).
    for (let attempt = 0; attempt < 3 && keys.length > 0; attempt++) {
      const res = await documentClient.send(
        new BatchGetCommand({
          RequestItems: { [tableName]: { Keys: keys } },
        }),
      )

      for (const item of res.Responses?.[tableName] ?? []) {
        const id = (item as Record<string, unknown>)[keyName] as string
        out[id] = item as Record<string, unknown>
      }

      const unprocessed = (res.UnprocessedKeys?.[tableName]?.Keys ?? []) as Array<Record<string, string>>
      keys = unprocessed
      if (keys.length > 0) {
        await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)))
      }
    }
  }

  return out
}

/** Batch-fetch users by userId. Returns map of userId -> raw item. */
export function batchGetUsers(userIds: readonly string[]): Promise<Record<string, Record<string, unknown>>> {
  return batchGet(TableNames.users, 'userId', userIds)
}

/** Batch-fetch nodes by nodeId. Returns map of nodeId -> raw item. */
export function batchGetNodes(nodeIds: readonly string[]): Promise<Record<string, Record<string, unknown>>> {
  return batchGet(TableNames.nodes, 'nodeId', nodeIds)
}

/** Batch-fetch businesses by businessId. */
export function batchGetBusinesses(ids: readonly string[]): Promise<Record<string, Record<string, unknown>>> {
  return batchGet(TableNames.businesses, 'businessId', ids)
}
