// DynamoDB Repository for Auth (Replaces Prisma)
import {
  getUserById,
  getUserByCognitoSub,
  getUserByPhone,
  createUser as createUserDb,
  updateUser,
  getBusinessById,
  getBusinessByCognitoSub,
  getBusinessByEmail,
  getBusinessByOwnerId,
  createBusiness as createBusinessDb,
  getStaffById,
  getStaffByCognitoSub,
  getStaffByPhone,
  createStaff as createStaffDb,
} from './dynamodb-repository.js'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { QueryCommand, PutCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { generateId } from '../../shared/db/entities.js'

// Re-export DynamoDB functions with same names as Prisma
export { getUserByCognitoSub, getUserById }

// ─── User Profile ───────────────────────────────────────────────────────────

export async function updateUserProfile(
  userId: string,
  data: Partial<{ displayName: string; avatarUrl: string | null; cityId: string }>,
) {
  return updateUser(userId, data)
}

export async function getUserCheckInHistory(
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  // Query check-ins by userId from GSI
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      ...(cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString()) } : {}),
      ScanIndexForward: false,
      Limit: limit + 1,
    })
  )

  const items = result.Items || []
  const hasMore = items.length > limit
  const sliced = hasMore ? items.slice(0, limit) : items

  // Fetch node details for each check-in
  const enriched = await Promise.all(
    sliced.map(async (checkIn) => {
      const nodeResult = await documentClient.send(
        new GetCommand({
          TableName: TableNames.nodes,
          Key: { nodeId: checkIn.nodeId },
        })
      )
      return {
        ...checkIn,
        node: nodeResult.Item ? {
          name: nodeResult.Item.name,
          slug: nodeResult.Item.slug,
          category: nodeResult.Item.category,
        } : null,
      }
    })
  )

  const nextCursor = hasMore && result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : null

  return { items: enriched, nextCursor, hasMore }
}

// ─── Consent ────────────────────────────────────────────────────────────────

export async function insertConsentRecord(
  userId: string,
  consentVersion: string,
  analyticsOptIn: boolean,
) {
  const consentId = generateId()
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `USER#${userId}`,
        sk: `CONSENT#${consentId}`,
        consentVersion,
        analyticsOptIn,
        consentedAt: new Date().toISOString(),
      },
    })
  )
  return { userId, consentVersion, analyticsOptIn }
}

export async function getLatestConsent(userId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'CONSENT#',
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  )
  return result.Items?.[0] || null
}

// ─── Auth Lookups ───────────────────────────────────────────────────────────

export { getUserByPhone as findUserByPhone }
export { getBusinessByEmail as findBusinessByEmail }

export async function findBusinessByPhone(phone: string) {
  if (!phone) return null
  // No PhoneIndex GSI — scan at current scale
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.businesses,
      FilterExpression: 'phone = :phone',
      ExpressionAttributeValues: { ':phone': phone },
    })
  )
  return result.Items?.[0] || null
}

export { getStaffByPhone as findStaffByPhone }

export async function createUser(data: {
  phone: string; username: string; displayName: string;
  cityId: string; cognitoSub: string;
}) {
  return createUserDb({
    ...data,
    musicGenres: [],
  })
}

export async function createBusinessAccount(data: {
  email: string; businessName: string;
  registrationNumber?: string; cognitoSub: string;
  phone?: string;
}) {
  return createBusinessDb(data)
}

export async function findStaffInviteByToken(token: string) {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `INVITE#${token}`, sk: `INVITE#${token}` },
    })
  )
  return result.Item || null
}

export async function acceptStaffInvite(inviteId: string) {
  // Update invite status
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `INVITE#${inviteId}`,
        sk: `INVITE#${inviteId}`,
        accepted: true,
        acceptedAt: new Date().toISOString(),
      },
    })
  )
  return { id: inviteId, accepted: true }
}

export async function createStaffAccount(data: {
  businessId: string; name: string; phone: string; cognitoSub: string;
}) {
  return createStaffDb({ ...data, isActive: true })
}

export async function getCityBySlug(slug: string) {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `CITY#${slug}`, sk: `CITY#${slug}` },
    })
  )
  return result.Item || null
}

export async function softDeleteCheckInHistory(userId: string) {
  // In DynamoDB, we don't actually delete - we mark for TTL or soft delete
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    })
  )
  
  // Mark each check-in for deletion (set TTL to 1 day from now)
  const oneDayFromNow = Math.floor(Date.now() / 1000) + 86400
  const items = result.Items || []
  
  await Promise.all(
    items.map((item) =>
      documentClient.send(
        new PutCommand({
          TableName: TableNames.checkins,
          Item: {
            ...item,
            deleted: true,
            ttl: oneDayFromNow,
          },
        })
      )
    )
  )
  
  return { count: items.length }
}

// ─── Account Deletion (POPIA erasure) ───────────────────────────────────────

export async function createErasureRequest(userId: string) {
  const requestId = generateId()
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `ERASURE#${userId}`,
        sk: `REQUEST#${requestId}`,
        userId,
        status: 'pending',
        requestedAt: new Date().toISOString(),
      },
    })
  )
  return { id: requestId, userId, status: 'pending' }
}

export async function hasActiveErasureRequest(userId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `ERASURE#${userId}` },
    })
  )
  return result.Items?.some((item) => item.status === 'pending') || false
}
