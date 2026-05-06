/**
 * Block/Unblock repository using the app-data single-table design.
 *
 * Block records:
 *   pk: BLOCK#{blockerId}
 *   sk: BLOCKED#{blockedId}
 *   gsi1pk: BLOCKED_BY#{blockedId}
 *   gsi1sk: BLOCKER#{blockerId}
 */

import { PutCommand, DeleteCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `BLOCK#${blockerId}`,
        sk: `BLOCKED#${blockedId}`,
        gsi1pk: `BLOCKED_BY#${blockedId}`,
        gsi1sk: `BLOCKER#${blockerId}`,
        blockerId,
        blockedId,
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  )
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `BLOCK#${blockerId}`, sk: `BLOCKED#${blockedId}` },
    }),
  )
}

export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `BLOCK#${blockerId}`, sk: `BLOCKED#${blockedId}` },
    }),
  )
  return !!result.Item
}

export async function getBlockedUsers(blockerId: string): Promise<Array<{ blockedId: string; createdAt: string }>> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `BLOCK#${blockerId}` },
    }),
  )
  return (result.Items || []).map((item) => ({
    blockedId: item['blockedId'] as string,
    createdAt: item['createdAt'] as string,
  }))
}

export async function getBlockedByUsers(blockedId: string): Promise<Array<{ blockerId: string; createdAt: string }>> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `BLOCKED_BY#${blockedId}` },
    }),
  )
  return (result.Items || []).map((item) => ({
    blockerId: item['blockerId'] as string,
    createdAt: item['createdAt'] as string,
  }))
}
