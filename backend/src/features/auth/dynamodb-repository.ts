// DynamoDB Repository for Auth Feature (Replaces Prisma)
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
// USER OPERATIONS
// ============================================================================

export async function getUserById(userId: string): Promise<User | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.users,
      Key: { pk: `USER#${userId}`, sk: `PROFILE#${userId}` },
    })
  )
  return result.Item ? (result.Item as User) : null
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
  return result.Items?.[0] ? (result.Items[0] as User) : null
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.users,
      FilterExpression: 'phone = :phone',
      ExpressionAttributeValues: { ':phone': phone },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? (result.Items[0] as User) : null
}

export async function createUser(data: Omit<User, 'userId' | 'createdAt'>): Promise<User> {
  const userId = generateId()
  const now = new Date().toISOString()
  
  const user: User = {
    ...data,
    userId,
    createdAt: now,
    updatedAt: now,
    tier: data.tier || 'local',
    totalCheckIns: data.totalCheckIns || 0,
    streakCount: data.streakCount || 0,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.users,
      Item: {
        pk: `USER#${userId}`,
        sk: `PROFILE#${userId}`,
        ...user,
      },
    })
  )

  return user
}

export async function updateUser(
  userId: string,
  data: Partial<Omit<User, 'userId' | 'createdAt'>>
): Promise<User | null> {
  const updateExpression = Object.keys(data)
    .map((key) => `#${key} = :${key}`)
    .join(', ')
  
  const expressionAttributeNames = Object.keys(data).reduce(
    (acc, key) => ({ ...acc, [`#${key}`]: key }),
    {}
  )
  
  const expressionAttributeValues = Object.entries(data).reduce(
    (acc, [key, value]) => ({ ...acc, [`:${key}`]: value }),
    {}
  )

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.users,
      Key: { pk: `USER#${userId}`, sk: `PROFILE#${userId}` },
      UpdateExpression: `SET ${updateExpression}, #updatedAt = :updatedAt`,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    })
  )

  return result.Attributes as User
}

// ============================================================================
// BUSINESS ACCOUNT OPERATIONS
// ============================================================================

export async function getBusinessById(businessId: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.businesses,
      Key: { pk: `BUSINESS#${businessId}`, sk: `PROFILE#${businessId}` },
    })
  )
  return result.Item ? (result.Item as BusinessAccount) : null
}

export async function getBusinessByCognitoSub(cognitoSub: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.businesses,
      FilterExpression: 'cognitoSub = :sub',
      ExpressionAttributeValues: { ':sub': cognitoSub },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? (result.Items[0] as BusinessAccount) : null
}

export async function getBusinessByEmail(email: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.businesses,
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? (result.Items[0] as BusinessAccount) : null
}

export async function createBusiness(
  data: Omit<BusinessAccount, 'businessId' | 'createdAt'>
): Promise<BusinessAccount> {
  const businessId = generateId()
  const now = new Date().toISOString()

  const business: BusinessAccount = {
    ...data,
    businessId,
    createdAt: now,
    updatedAt: now,
    tier: data.tier || 'free',
    isActive: data.isActive ?? true,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.businesses,
      Item: {
        pk: `BUSINESS#${businessId}`,
        sk: `PROFILE#${businessId}`,
        ...business,
      },
    })
  )

  return business
}

export async function updateBusiness(
  businessId: string,
  data: Partial<Omit<BusinessAccount, 'businessId' | 'createdAt'>>
): Promise<BusinessAccount | null> {
  const updateExpression = Object.keys(data)
    .map((key) => `#${key} = :${key}`)
    .join(', ')

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.businesses,
      Key: { pk: `BUSINESS#${businessId}`, sk: `PROFILE#${businessId}` },
      UpdateExpression: `SET ${updateExpression}, #updatedAt = :updatedAt`,
      ExpressionAttributeNames: {
        ...Object.keys(data).reduce((acc, key) => ({ ...acc, [`#${key}`]: key }), {}),
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ...Object.entries(data).reduce((acc, [key, value]) => ({ ...acc, [`:${key}`]: value }), {}),
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    })
  )

  return result.Attributes as BusinessAccount
}

// ============================================================================
// STAFF ACCOUNT OPERATIONS
// ============================================================================

export async function getStaffById(staffId: string): Promise<StaffAccount | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `STAFF#${staffId}`, sk: `PROFILE#${staffId}` },
    })
  )
  return result.Item ? (result.Item as StaffAccount) : null
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
  return result.Items?.[0] ? (result.Items[0] as StaffAccount) : null
}

export async function createStaff(
  data: Omit<StaffAccount, 'staffId' | 'createdAt'>
): Promise<StaffAccount> {
  const staffId = generateId()
  const now = new Date().toISOString()

  const staff: StaffAccount = {
    ...data,
    staffId,
    createdAt: now,
    isActive: data.isActive ?? true,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `STAFF#${staffId}`,
        sk: `PROFILE#${staffId}`,
        gsi1pk: data.cognitoSub ? `COGNITO#${data.cognitoSub}` : undefined,
        gsi1sk: `BUSINESS#${data.businessId}`,
        ...staff,
      },
    })
  )

  return staff
}
