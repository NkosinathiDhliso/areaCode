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
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { AppError } from '../../shared/errors/AppError.js'
import type { User, BusinessAccount, StaffAccount } from './types.js'

// ────────────────────────────────────────────────────────────────────────────
// Uniqueness locks.
//
// The users table is keyed only by `userId`, so it cannot natively enforce that
// an email or Cognito sub is used by at most one row. We enforce it with
// sentinel "lock" items written in the SAME transaction as the user row:
//
//   { userId: "EMAIL#<email>", lockType: "email", linkedUserId: <uuid> }
//   { userId: "SUB#<sub>",     lockType: "sub",   linkedUserId: <uuid> }
//
// Each is created with `attribute_not_exists(userId)`, so a duplicate email or
// sub makes the whole transaction fail atomically — duplicate accounts become
// structurally impossible instead of being merely guarded in application code.
//
// The lock items carry no `email` / `cognitoSub` attribute, so they never
// appear in EmailIndex / CognitoIndex and are invisible to the normal lookups.
// ────────────────────────────────────────────────────────────────────────────

const emailLockKey = (email: string) => `EMAIL#${email.toLowerCase().trim()}`
const subLockKey = (cognitoSub: string) => `SUB#${cognitoSub}`

// ────────────────────────────────────────────────────────────────────────────
// People-search index attributes.
//
// Backs the UsernameSearchIndex / DisplayNameSearchIndex GSIs (see
// infra .../main.tf). For each searchable field we store the lowercased value
// (the GSI range key, queried with begins_with for prefix search) and a
// single-character bucket = its first character (the GSI hash key, so writes
// and reads spread across ~36 partitions instead of one hot key). Empty fields
// yield no attributes, keeping the row out of that sparse index.
// ────────────────────────────────────────────────────────────────────────────
export function deriveSearchAttributes(fields: {
  username?: string | null
  displayName?: string | null
}): Record<string, string> {
  const out: Record<string, string> = {}
  const u = fields.username?.trim().toLowerCase()
  if (u) {
    out['usernameLower'] = u
    out['usernameChar'] = u[0]!
  }
  const d = fields.displayName?.trim().toLowerCase()
  if (d) {
    out['displayNameLower'] = d
    out['displayNameChar'] = d[0]!
  }
  return out
}

/** Search-index attribute names, grouped by field, for update-time REMOVE. */
const SEARCH_ATTRS_BY_FIELD: Record<'username' | 'displayName', string[]> = {
  username: ['usernameLower', 'usernameChar'],
  displayName: ['displayNameLower', 'displayNameChar'],
}

function isTransactionConflict(err: unknown): boolean {
  const name = (err as { name?: string }).name
  return name === 'TransactionCanceledException' || name === 'ConditionalCheckFailedException'
}

// ============================================================================
// USER OPERATIONS  (table PK = userId, no SK)
// ============================================================================

export async function getUserById(userId: string): Promise<User | null> {
  const result = await documentClient.send(new GetCommand({ TableName: TableNames.users, Key: { userId } }))
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
    }),
  )
  return result.Items?.[0] ? mapUser(result.Items[0]) : null
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  // Paginated scan for phone lookup (no PhoneIndex GSI)
  let lastKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.users,
        FilterExpression: 'phone = :phone',
        ExpressionAttributeValues: { ':phone': phone },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    if (result.Items?.[0]) return mapUser(result.Items[0])
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)
  return null
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.users,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    }),
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
    privacyLevel: (data as Record<string, unknown>).privacyLevel || 'friends_only',
    isDisabled: false,
    onboardingComplete: false,
    createdAt: now,
    updatedAt: now,
    // People-search index attributes (sparse GSIs).
    ...deriveSearchAttributes({ username: data.username, displayName: data.displayName }),
  }

  // Build a single atomic transaction: the user row plus an email lock and a
  // sub lock. If either lock already exists the whole write is cancelled and we
  // surface a clean 409 instead of silently creating a duplicate account.
  const transactItems: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
    {
      Put: {
        TableName: TableNames.users,
        Item: item,
        ConditionExpression: 'attribute_not_exists(userId)',
      },
    },
  ]

  if (data.email) {
    transactItems.push({
      Put: {
        TableName: TableNames.users,
        Item: { userId: emailLockKey(data.email), lockType: 'email', linkedUserId: userId, createdAt: now },
        ConditionExpression: 'attribute_not_exists(userId)',
      },
    })
  }

  if (data.cognitoSub) {
    transactItems.push({
      Put: {
        TableName: TableNames.users,
        Item: { userId: subLockKey(data.cognitoSub), lockType: 'sub', linkedUserId: userId, createdAt: now },
        ConditionExpression: 'attribute_not_exists(userId)',
      },
    })
  }

  try {
    await documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }))
  } catch (err) {
    if (isTransactionConflict(err)) {
      throw AppError.conflict('This email is already registered. Sign in instead.')
    }
    throw err
  }

  return mapUser(item)
}

/**
 * Atomically link a Cognito sub onto an existing (orphaned) user row and claim
 * the sub lock in one transaction. Used when a federated (Google) sign-in lands
 * on an email that already has a row with no linked sub — we adopt that row
 * rather than create a duplicate. Returns the updated row, or null if the row
 * vanished. Throws a 409 if the sub is already claimed by another row.
 */
export async function linkCognitoSub(userId: string, cognitoSub: string): Promise<User | null> {
  const now = new Date().toISOString()
  try {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TableNames.users,
              Key: { userId },
              UpdateExpression: 'SET cognitoSub = :sub, updatedAt = :now',
              // Only adopt a row that has no sub yet (or already points at us) —
              // never steal a row that belongs to a different identity.
              ConditionExpression: 'attribute_not_exists(cognitoSub) OR cognitoSub = :sub',
              ExpressionAttributeValues: { ':sub': cognitoSub, ':now': now },
            },
          },
          {
            Put: {
              TableName: TableNames.users,
              Item: { userId: subLockKey(cognitoSub), lockType: 'sub', linkedUserId: userId, createdAt: now },
              ConditionExpression: 'attribute_not_exists(userId)',
            },
          },
        ],
      }),
    )
  } catch (err) {
    if (isTransactionConflict(err)) {
      throw AppError.conflict('This account is already linked to another sign-in method.')
    }
    throw err
  }
  return getUserById(userId)
}

/**
 * Migrate an existing user row from a stale Cognito sub onto a new one, moving
 * the sub lock with it. Used by the consumer v1->v2 pool migration: a row
 * created under the old (decommissioned) pool still carries its old sub, so a
 * sign-in under the new pool arrives with a different sub for the same verified
 * email. Within a single live pool an email maps to exactly one sub, so the
 * mismatch is provably a stale sub, not a rival identity, so we re-point the
 * row instead of stranding the account behind a 409.
 *
 * The row update and the new sub lock are written atomically. The stale sub
 * lock (absent on rows that predate the lock model) is dropped best-effort
 * afterwards; a missing lock is not an error. Throws 409 if the row already
 * moved on or the new sub is already locked by a different row.
 */
export async function relinkCognitoSub(userId: string, oldSub: string, newSub: string): Promise<User | null> {
  const now = new Date().toISOString()
  try {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TableNames.users,
              Key: { userId },
              UpdateExpression: 'SET cognitoSub = :new, updatedAt = :now',
              // Only migrate a row that still holds exactly the stale sub we read.
              ConditionExpression: 'cognitoSub = :old',
              ExpressionAttributeValues: { ':new': newSub, ':old': oldSub, ':now': now },
            },
          },
          {
            Put: {
              TableName: TableNames.users,
              Item: { userId: subLockKey(newSub), lockType: 'sub', linkedUserId: userId, createdAt: now },
              ConditionExpression: 'attribute_not_exists(userId)',
            },
          },
        ],
      }),
    )
  } catch (err) {
    if (isTransactionConflict(err)) {
      throw AppError.conflict('This account is already linked to another sign-in method.')
    }
    throw err
  }

  // Drop the stale sub lock if it exists and still points at this row. Rows that
  // predate the lock model carry no such item, so a missing lock is expected.
  try {
    await documentClient.send(
      new DeleteCommand({
        TableName: TableNames.users,
        Key: { userId: subLockKey(oldSub) },
        ConditionExpression: 'attribute_exists(userId) AND linkedUserId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
      }),
    )
  } catch (err) {
    if (!isTransactionConflict(err)) throw err
  }

  return getUserById(userId)
}

export async function updateUser(
  userId: string,
  data: Partial<Omit<User, 'userId' | 'createdAt'>>,
): Promise<User | null> {
  const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined)
  if (keys.length === 0) return getUserById(userId)

  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
  }
  keys.forEach((key) => {
    expressionAttributeNames[`#${key}`] = key
  })

  const expressionAttributeValues: Record<string, unknown> = {
    ':updatedAt': new Date().toISOString(),
  }
  keys.forEach((key) => {
    expressionAttributeValues[`:${key}`] = data[key as keyof typeof data]
  })

  const setPairs = keys.map((key) => `#${key} = :${key}`)

  // Keep the people-search index in sync. When a searchable field changes, set
  // its derived attributes; when it is cleared, REMOVE them so the row drops
  // out of that sparse index rather than lingering under a stale prefix.
  const removeAttrs: string[] = []
  const syncSearchField = (field: 'username' | 'displayName') => {
    if (data[field] === undefined) return
    const derived = deriveSearchAttributes({ [field]: data[field] } as { username?: string; displayName?: string })
    const derivedKeys = Object.keys(derived)
    if (derivedKeys.length > 0) {
      for (const attr of derivedKeys) {
        expressionAttributeNames[`#${attr}`] = attr
        expressionAttributeValues[`:${attr}`] = derived[attr]
        setPairs.push(`#${attr} = :${attr}`)
      }
    } else {
      // Field present but empty → remove its index attributes.
      for (const attr of SEARCH_ATTRS_BY_FIELD[field]) {
        expressionAttributeNames[`#${attr}`] = attr
        removeAttrs.push(`#${attr}`)
      }
    }
  }
  syncSearchField('username')
  syncSearchField('displayName')

  let updateExpression = `SET ${setPairs.join(', ')}, #updatedAt = :updatedAt`
  if (removeAttrs.length > 0) {
    updateExpression += ` REMOVE ${removeAttrs.join(', ')}`
  }

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.users,
      Key: { userId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }),
  )

  return result.Attributes ? mapUser(result.Attributes) : null
}

function mapUser(item: Record<string, unknown>): User {
  return {
    ...item,
    id: item['userId'] as string,
    userId: item['userId'] as string,
  } as User
}

// ============================================================================
// BUSINESS ACCOUNT OPERATIONS  (table PK = businessId, no SK)
// ============================================================================

export async function getBusinessById(businessId: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(new GetCommand({ TableName: TableNames.businesses, Key: { businessId } }))
  return result.Item ? mapBiz(result.Item) : null
}

export async function getBusinessByCognitoSub(cognitoSub: string): Promise<BusinessAccount | null> {
  let lastKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.businesses,
        FilterExpression: 'cognitoSub = :sub',
        ExpressionAttributeValues: { ':sub': cognitoSub },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    if (result.Items?.[0]) return mapBiz(result.Items[0])
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)
  return null
}

export async function getBusinessByEmail(email: string): Promise<BusinessAccount | null> {
  let lastKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.businesses,
        FilterExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': email },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    if (result.Items?.[0]) return mapBiz(result.Items[0])
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)
  return null
}

export async function getBusinessByOwnerId(ownerId: string): Promise<BusinessAccount | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.businesses,
      IndexName: 'OwnerIndex',
      KeyConditionExpression: 'ownerId = :ownerId',
      ExpressionAttributeValues: { ':ownerId': ownerId },
      Limit: 1,
    }),
  )
  return result.Items?.[0] ? mapBiz(result.Items[0]) : null
}

export async function createBusiness(
  data: Omit<BusinessAccount, 'businessId' | 'createdAt'>,
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

  await documentClient.send(new PutCommand({ TableName: TableNames.businesses, Item: item }))

  return mapBiz(item)
}

export async function updateBusiness(
  businessId: string,
  data: Partial<Omit<BusinessAccount, 'businessId' | 'createdAt'>>,
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
    }),
  )

  return result.Attributes ? mapBiz(result.Attributes) : null
}

function mapBiz(item: Record<string, unknown>): BusinessAccount {
  return {
    ...item,
    id: item['businessId'] as string,
    businessId: item['businessId'] as string,
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
    }),
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
    }),
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
    }),
  )
  return result.Items?.[0] ? mapStaff(result.Items[0]) : null
}

export async function createStaff(data: Omit<StaffAccount, 'staffId' | 'createdAt'>): Promise<StaffAccount> {
  if (!data.cognitoSub && !data.phone) {
    throw new Error('createStaff requires cognitoSub or phone')
  }

  const staffId = generateId()
  const now = new Date().toISOString()

  const staff: StaffAccount = {
    ...data,
    staffId,
    id: staffId,
    createdAt: now,
    isActive: data.isActive ?? true,
  }

  const gsi1pk = data.cognitoSub ? `COGNITO#${data.cognitoSub}` : `STAFF_PHONE#${data.phone as string}`

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `STAFF#${staffId}`,
        sk: `PROFILE#${staffId}`,
        gsi1pk,
        gsi1sk: `BUSINESS#${data.businessId}`,
        ...staff,
      },
    }),
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
      }),
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
    }),
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
    }),
  )
  return (result.Items || []).map((i) => mapStaff(i))
}

export async function deleteUser(userId: string): Promise<void> {
  // Release the email/sub uniqueness locks in the same transaction as the row
  // delete, otherwise a deleted user's email could never be claimed again.
  const existing = await getUserById(userId)
  if (!existing) {
    await documentClient.send(new DeleteCommand({ TableName: TableNames.users, Key: { userId } }))
    return
  }

  const transactItems: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
    { Delete: { TableName: TableNames.users, Key: { userId } } },
  ]

  if (existing.email) {
    transactItems.push({ Delete: { TableName: TableNames.users, Key: { userId: emailLockKey(existing.email) } } })
  }
  if (existing.cognitoSub) {
    transactItems.push({ Delete: { TableName: TableNames.users, Key: { userId: subLockKey(existing.cognitoSub) } } })
  }

  await documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }))
}

function mapStaff(item: Record<string, unknown>): StaffAccount {
  return {
    ...item,
    id: item['staffId'] as string,
    staffId: item['staffId'] as string,
  } as StaffAccount
}
