import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

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

export { client }
