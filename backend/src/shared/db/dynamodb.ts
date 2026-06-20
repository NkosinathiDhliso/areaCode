import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const client = new DynamoDBClient({
  region: process.env['AWS_REGION'] || 'us-east-1',
})

export const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
})

// Table names from environment. Production Lambda always sets these via Terraform.
// Fallbacks point to dev tables — never prod — so local runs and tests are safe.
export const TableNames = {
  users: process.env['USERS_TABLE'] || 'area-code-dev-users',
  nodes: process.env['NODES_TABLE'] || 'area-code-dev-nodes',
  checkins: process.env['CHECKINS_TABLE'] || 'area-code-dev-checkins',
  rewards: process.env['REWARDS_TABLE'] || 'area-code-dev-rewards',
  businesses: process.env['BUSINESSES_TABLE'] || 'area-code-dev-businesses',
  appData: process.env['APP_DATA_TABLE'] || 'area-code-dev-app-data',
  musicSchedules: process.env['MUSIC_SCHEDULES_TABLE'] || 'area-code-dev-music-schedules',
  presence: process.env['PRESENCE_TABLE'] || 'area-code-dev-presence',
} as const

export { client }
