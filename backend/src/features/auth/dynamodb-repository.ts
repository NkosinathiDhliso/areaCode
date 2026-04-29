// DynamoDB Repository for Auth Feature (Replaces Prisma)
// Keys match actual table schemas:
//   users      → PK: userId  (no SK)     GSIs: EmailIndex, CognitoIndex
//   businesses → PK: businessId (no SK)  GSI: OwnerIndex
//   app-data   → PK: pk, SK: sk          GSI: GSI1(gsi1pk, gsi1sk)
import {
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import type { User, BusinessAccount, StaffAccount } from './types.js'

// ============================================================================
// USER OPERATIONS  (table PK = userId, no SK)
// ============================================================================

export async function getUserById(userId: string): Promise<User | null> {
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.users, Key: { userId } })
  )
  return result.Item ? mapUser(result.Item) : null
}

export async function getUserByCognitoSub(cognitoSub: string): Promise<User | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.users,
      IndexName: 'CognitoIndex',
      KeyConditionExpression: 'cognitoSub = :sub',
      ExpressionAttributeValues: { ':sub': cognitoSub },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? mapUser(result.Items[0]) : null
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  // No PhoneIndex GSI — scan is fine for auth lookups at current scale
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.users,
      FilterExpression: 'phone = :phone',
      ExpressionAttributeValues: { ':phone': phone },
    })
  )
  return result.Items?.[0] ? mapUser(result.Items[0]) : null
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.users,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? mapUser(result.Items[0]) : null
}

export async function createUser(data: Omit<User, 'userId' | 'createdAt'>): Promise<User> {
  const userId = generateId()
  const now = new Date().toISOString()
  
  const item: Record<string, unknown> = {
    userId,
    ...data,
    id: userId,
    tier: data.tier || 'local',
    totalCheckIns: data.totalCheckIns || 0,
    streakCount: data.streakCount || 0,
    createdAt: now,
    updatedAt: now,
  }

  await documentClient.send(
    new PutCommand({ TableName: TableNames.users, Item: item })
  )

  return mapUser(item)
}

export async function updateUser(
  userId: string,
  data: Partial<Omit<User, 'userId' | 'createdAt'>>
): Promise<User | null> {
  const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined)
  if (keys.length === 0) return getUserById(userId)

  const updateExpression = keys
    .map((key) => `#${key} = :${key}`)
    .join(', ')
  
  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
  }
  keys.forEach((key) => { expressionAttributeNames[`#${key}`] = key })
  
  const expressionAttributeValues: Record<string, unknown> = {
    ':updatedAt': new Date().toISOString(),
  }
  keys.forEach((key) => { expressionAttributeValues[`:${key}`] = data[key as keyof typeof data] })

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.users,
      Key: { userId },
      UpdateExpression: `SET ${updateExpression}, #updatedAt = :updatedAt`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  )

  return result.Attributes ? mapUser(result.Attributes) : null
}

function mapUser(item: Record<string, unknown>): User {
  return {
    ...item,
    id: (item['userId'] as string) ?? (item['id'] as string),
    userId: (item['userId'] as string) ?? (item['id'] as string),
  } as User
}

// ============================================================================
// BUSINESS ACCOUNT OPERATIONS  (table PK = businessId, no SK)
// ============================================================================

export async function getBusinessById(businessId: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.businesses, Key: { businessId } })
  )
  return result.Item ? mapBiz(result.Item) : null
}

export async function getBusinessByCognitoSub(cognitoSub: string): Promise<BusinessAccount | null> {
  // No CognitoIndex on businesses — scan is acceptable at current scale
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.businesses,
      FilterExpression: 'cognitoSub = :sub',
      ExpressionAttributeValues: { ':sub': cognitoSub },
    })
  )
  return result.Items?.[0] ? mapBiz(result.Items[0]) : null
}

export async function getBusinessByEmail(email: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.businesses,
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    })
  )
  return result.Items?.[0] ? mapBiz(result.Items[0]) : null
}

export async function getBusinessByOwnerId(ownerId: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.businesses,
      IndexName: 'OwnerIndex',
      KeyConditionExpression: 'ownerId = :ownerId',
      ExpressionAttributeValues: { ':ownerId': ownerId },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? mapBiz(result.Items[0]) : null
}

export async function createBusiness(
  data: Omit<BusinessAccount, 'businessId' | 'createdAt'>
): Promise<BusinessAccount> {
  const businessId = generateId()
  const now = new Date().toISOString()

  const item: Record<string, unknown> = {
    businessId,
    ...data,
    id: businessId,
    tier: data.tier || 'free',
    isActive: data.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  }

  await documentClient.send(
    new PutCommand({ TableName: TableNames.businesses, Item: item })
  )

  return mapBiz(item)
}

export async function updateBusiness(
  businessId: string,
  data: Partial<Omit<BusinessAccount, 'businessId' | 'createdAt'>>
): Promise<BusinessAccount | null> {
  const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined)
  if (keys.length === 0) return getBusinessById(businessId)

  const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' }
  const expressionAttributeValues: Record<string, unknown> = { ':updatedAt': new Date().toISOString() }
  keys.forEach((key) => {
    expressionAttributeNames[`#${key}`] = key
    expressionAttributeValues[`:${key}`] = data[key as keyof typeof data]
  })

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.businesses,
      Key: { businessId },
      UpdateExpression: `SET ${keys.map((k) => `#${k} = :${k}`).join(', ')}, #updatedAt = :updatedAt`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  )

  return result.Attributes ? mapBiz(result.Attributes) : null
}

function mapBiz(item: Record<string, unknown>): BusinessAccount {
  return {
    ...item,
    id: (item['businessId'] as string) ?? (item['id'] as string),
    businessId: (item['businessId'] as string) ?? (item['id'] as string),
  } as BusinessAccount
}

// ============================================================================
// STAFF ACCOUNT OPERATIONS  (app-data table, PK: pk, SK: sk)
// ============================================================================

export async function getStaffById(staffId: string): Promise<StaffAccount | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `STAFF#${staffId}`, sk: `PROFILE#${staffId}` },
    })
  )
  return result.Item ? mapStaff(result.Item) : null
}

export async function getStaffByCognitoSub(cognitoSub: string): Promise<StaffAccount | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `COGNITO#${cognitoSub}` },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? mapStaff(result.Items[0]) : null
}

export async function getStaffByPhone(phone: string): Promise<StaffAccount | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `STAFF_PHONE#${phone}` },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? mapStaff(result.Items[0]) : null
}

export async function createStaff(
  data: Omit<StaffAccount, 'staffId' | 'createdAt'>
): Promise<StaffAccount> {
  const staffId = generateId()
  const now = new Date().toISOString()

  const staff: StaffAccount = {
    ...data,
    staffId,
    id: staffId,
    createdAt: now,
    isActive: data.isActive ?? true,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `STAFF#${staffId}`,
        sk: `PROFILE#${staffId}`,
        gsi1pk: data.cognitoSub ? `COGNITO#${data.cognitoSub}` : `STAFF_PHONE#${data.phone}`,
        gsi1sk: `BUSINESS#${data.businessId}`,
        ...staff,
      },
    })
  )

  // Write phone→staff lookup entry
  if (data.phone) {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: {
          pk: `STAFF_PHONE#${data.phone}`,
          sk: `STAFF#${staffId}`,
          gsi1pk: `STAFF_PHONE#${data.phone}`,
          gsi1sk: `STAFF#${staffId}`,
          staffId,
          businessId: data.businessId,
          phone: data.phone,
        },
      })
    )
  }

  // Write business→staff lookup entry for getStaffByBusinessId
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `BIZ_STAFF#${data.businessId}`,
        sk: `STAFF#${staffId}`,
        gsi1pk: `BIZ_STAFF#${data.businessId}`,
        gsi1sk: now,
        staffId,
        businessId: data.businessId,
        isActive: staff.isActive,
        role: (data as any).role ?? 'staff',
      },
    })
  )

  return staff
}

export async function getStaffByBusinessId(businessId: string): Promise<StaffAccount[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `BIZ_STAFF#${businessId}` },
    })
  )
  return (result.Items || []).map((i) => mapStaff(i))
}

export async function deleteUser(userId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({ TableName: TableNames.users, Key: { userId } })
  )
}

function mapStaff(item: Record<string, unknown>): StaffAccount {
  return {
    ...item,
    id: (item['staffId'] as string) ?? (item['id'] as string),
    staffId: (item['staffId'] as string) ?? (item['id'] as string),
  } as StaffAccount
}
