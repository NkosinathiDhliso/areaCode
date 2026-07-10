import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import type { QueryCommandInput, ScanCommandInput } from '@aws-sdk/lib-dynamodb'

import { AWS_REGION, requireEnv } from '../config/env.js'

const client = new DynamoDBClient({
  region: AWS_REGION,
})

export const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
})

// Table names from environment. Production Lambda always sets the tables it
// uses via Terraform; `requireEnv` crashes prod if an accessed table's var is
// missing rather than silently reading a dev table. Accessors are lazy (getters)
// so a Lambda only validates the tables it actually touches — importing this
// module never forces every Lambda to set all eight vars.
export const TableNames = {
  get users() {
    return requireEnv('USERS_TABLE', 'area-code-dev-users')
  },
  get nodes() {
    return requireEnv('NODES_TABLE', 'area-code-dev-nodes')
  },
  get checkins() {
    return requireEnv('CHECKINS_TABLE', 'area-code-dev-checkins')
  },
  get rewards() {
    return requireEnv('REWARDS_TABLE', 'area-code-dev-rewards')
  },
  get businesses() {
    return requireEnv('BUSINESSES_TABLE', 'area-code-dev-businesses')
  },
  get appData() {
    return requireEnv('APP_DATA_TABLE', 'area-code-dev-app-data')
  },
  get musicSchedules() {
    return requireEnv('MUSIC_SCHEDULES_TABLE', 'area-code-dev-music-schedules')
  },
  get presence() {
    return requireEnv('PRESENCE_TABLE', 'area-code-dev-presence')
  },
}

/**
 * True when a DynamoDB write failed its ConditionExpression, i.e. the
 * legitimate "already exists / already claimed" signal. Every conditional
 * write shares this one detector so callers can distinguish an expected
 * conflict from a real (transient) failure that must surface.
 */
export function isConditionalCheckFailedError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException'
}

/**
 * Return the first item matching a filtered Query, following pagination.
 *
 * DynamoDB applies `Limit` and the 1MB page cap BEFORE `FilterExpression`, so a
 * `Limit: 1` on a filtered query reads a single item and returns nothing when
 * that item fails the filter — a false miss for data that provably exists. This
 * helper never caps the page at 1: it walks `LastEvaluatedKey` until a filtered
 * match is found or the partition is exhausted. Pass params WITHOUT `Limit: 1`
 * (leave `Limit` unset to use the 1MB page default, or set a page-size `Limit`
 * to bound per-page reads). Returns null when nothing matches.
 */
export async function queryFirstMatch(params: QueryCommandInput): Promise<Record<string, unknown> | null> {
  let exclusiveStartKey = params.ExclusiveStartKey
  do {
    const result = await documentClient.send(new QueryCommand({ ...params, ExclusiveStartKey: exclusiveStartKey }))
    const item = result.Items?.[0]
    if (item) return item
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)
  return null
}

/**
 * Return the first item matching a filtered Scan, following pagination.
 *
 * Same DynamoDB Limit-before-Filter hazard as `queryFirstMatch`: a `Limit: 1`
 * Scan examines one arbitrary row of the table, so a filtered lookup false-
 * misses existing data. This helper walks `LastEvaluatedKey` until a filtered
 * match is found or the whole table is scanned. Returns null when nothing
 * matches.
 */
export async function scanFirstMatch(params: ScanCommandInput): Promise<Record<string, unknown> | null> {
  let exclusiveStartKey = params.ExclusiveStartKey
  do {
    const result = await documentClient.send(new ScanCommand({ ...params, ExclusiveStartKey: exclusiveStartKey }))
    const item = result.Items?.[0]
    if (item) return item
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)
  return null
}

export { client }
