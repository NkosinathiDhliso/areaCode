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

// Table names from environment
export const TableNames = {
  users: process.env['USERS_TABLE'] || 'area-code-prod-users',
  nodes: process.env['NODES_TABLE'] || 'area-code-prod-nodes',
  checkins: process.env['CHECKINS_TABLE'] || 'area-code-prod-checkins',
  rewards: process.env['REWARDS_TABLE'] || 'area-code-prod-rewards',
  businesses: process.env['BUSINESSES_TABLE'] || 'area-code-prod-businesses',
  appData: process.env['APP_DATA_TABLE'] || 'area-code-prod-app-data',
} as const

export { client }
