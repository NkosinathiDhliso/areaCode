import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import {
  normalizeRedemptionCode,
  redemptionCodeAliasItem,
  redemptionCodeAliasKey,
} from '../features/rewards/redemption-alias.js'
import { REPEAT_WINDOW_MS, type RepeatPolicy } from '../features/rewards/repeat-policy.js'
import { documentClient, isConditionalCheckFailedError, TableNames } from '../shared/db/dynamodb.js'
import { generateId } from '../shared/db/entities.js'

export interface CreateWorkerRedemptionInput {
  rewardId: string
  userId: string
  redemptionCode: string
  codeExpiresAt: string
  businessId?: string
  nodeId?: string
  nodeName?: string
  rewardTitle?: string
  repeatPolicy?: RepeatPolicy
}

export async function createRedemption(data: CreateWorkerRedemptionInput) {
  const redemptionId = generateId()
  const now = new Date().toISOString()
  const redemptionKey = `REDEMPTION#${redemptionId}`
  const item: Record<string, unknown> = {
    pk: redemptionKey,
    sk: redemptionKey,
    gsi1pk: `USER_REDEMPTIONS#${data.userId}`,
    gsi1sk: now,
    redemptionId,
    rewardId: data.rewardId,
    userId: data.userId,
    redemptionCode: data.redemptionCode,
    codeExpiresAt: data.codeExpiresAt,
    redeemedAt: null,
    createdAt: now,
  }
  if (data.businessId) item['businessId'] = data.businessId
  if (data.nodeId) item['nodeId'] = data.nodeId
  if (data.nodeName) item['nodeName'] = data.nodeName
  if (data.rewardTitle) item['rewardTitle'] = data.rewardTitle

  // The guard condition mirrors decideMint. The transaction is the atomic mint gate
  // for the claim guard, canonical redemption row, and code alias.
  const claimKey = `REWARD_CLAIM#${data.rewardId}#${data.userId}`
  const policy: RepeatPolicy = data.repeatPolicy ?? 'once'
  const epochIso = new Date(0).toISOString()
  const cutoffIso = new Date(Date.parse(now) - REPEAT_WINDOW_MS).toISOString()
  const guardCondition =
    policy === 'per_visit'
      ? 'attribute_not_exists(pk) ' +
        'OR (attribute_not_exists(redeemedAt) AND codeExpiresAt < :now) ' +
        'OR (attribute_exists(redeemedAt) AND redeemedAt <= :cutoff)'
      : 'attribute_not_exists(pk) OR (attribute_not_exists(redeemedAt) AND codeExpiresAt < :now)'

  // This strongly consistent read preserves the existing audit count. The
  // transaction below remains authoritative for mint eligibility.
  const guardBefore = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: claimKey, sk: claimKey },
      ProjectionExpression: 'redemptionCount',
      ConsistentRead: true,
    }),
  )
  const previousCount =
    typeof guardBefore.Item?.['redemptionCount'] === 'number' ? guardBefore.Item['redemptionCount'] : 0

  try {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TableNames.appData,
              Key: { pk: claimKey, sk: claimKey },
              UpdateExpression:
                'SET rewardId = :rewardId, userId = :userId, redemptionId = :rid, codeExpiresAt = :exp, ' +
                'createdAt = :now, ' +
                'lastRedeemedAt = if_not_exists(redeemedAt, if_not_exists(lastRedeemedAt, :epoch)), ' +
                'redemptionCount = if_not_exists(redemptionCount, :zero) + :one REMOVE redeemedAt',
              ConditionExpression: guardCondition,
              ExpressionAttributeValues: {
                ':rewardId': data.rewardId,
                ':userId': data.userId,
                ':rid': redemptionId,
                ':exp': data.codeExpiresAt,
                ':now': now,
                ':epoch': epochIso,
                ':zero': 0,
                ':one': 1,
                ...(policy === 'per_visit' ? { ':cutoff': cutoffIso } : {}),
              },
            },
          },
          {
            Put: {
              TableName: TableNames.appData,
              Item: item,
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: TableNames.appData,
              Item: redemptionCodeAliasItem(data.redemptionCode, redemptionId, now),
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }),
    )
  } catch (err) {
    const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons
    if (reasons?.[0]?.Code === 'ConditionalCheckFailed') {
      const guardError = new Error('Claim guard rejected redemption mint')
      guardError.name = 'ConditionalCheckFailedException'
      throw guardError
    }
    if (reasons?.[2]?.Code === 'ConditionalCheckFailed') {
      const collisionError = new Error(`Redemption code collision for ${normalizeRedemptionCode(data.redemptionCode)}`)
      collisionError.name = 'RedemptionCodeCollisionError'
      ;(collisionError as Error & { cause?: unknown }).cause = err
      throw collisionError
    }
    throw err
  }

  const redemptionCount = previousCount + 1
  return { id: redemptionId, ...data, createdAt: now, redemptionCount }
}

/**
 * Compensate a mint after a slot-cap failure. The canonical row and alias are
 * deleted atomically, then the matching claim guard is expired in place so its
 * redemption history survives. A newer guard cycle is never overwritten.
 */
export async function deleteRedemption(redemptionId: string, rewardId: string, userId: string, redemptionCode: string) {
  const redemptionKey = `REDEMPTION#${redemptionId}`
  const aliasKey = redemptionCodeAliasKey(redemptionCode)
  await documentClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TableNames.appData,
            Key: { pk: redemptionKey, sk: redemptionKey },
          },
        },
        {
          Delete: {
            TableName: TableNames.appData,
            Key: { pk: aliasKey, sk: aliasKey },
            ConditionExpression: 'redemptionId = :rid',
            ExpressionAttributeValues: { ':rid': redemptionId },
          },
        },
      ],
    }),
  )

  const claimKey = `REWARD_CLAIM#${rewardId}#${userId}`
  const now = new Date().toISOString()
  await documentClient
    .send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: claimKey, sk: claimKey },
        UpdateExpression: 'SET codeExpiresAt = :now, redemptionCount = if_not_exists(redemptionCount, :one) - :one',
        ConditionExpression: 'redemptionId = :rid',
        ExpressionAttributeValues: { ':now': now, ':rid': redemptionId, ':one': 1 },
      }),
    )
    .catch((err) => {
      if (isConditionalCheckFailedError(err)) return
      throw err
    })
}
