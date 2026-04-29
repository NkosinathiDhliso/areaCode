// DynamoDB-backed Admin Repository (replaces Prisma)
import {
  GetCommand, PutCommand, QueryCommand,
  ScanCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import {
  getUserById as getDynamoUser,
  getBusinessById as getDynamoBusiness,
  updateUser, updateBusiness,
  getStaffByBusinessId,
} from '../auth/dynamodb-repository.js'
import { getCheckInsByUser } from '../check-in/dynamodb-repository.js'
import { getNodeById } from '../nodes/dynamodb-repository.js'
import { getActivePushTokens, getNotificationPreferences } from '../notifications/repository.js'

// ─── Consumer Management ────────────────────────────────────────────────────

export async function getUserById(userId: string) {
  const user = await getDynamoUser(userId)
  if (!user) return null

  // Fetch consent records
  const consentResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `CONSENT#${userId}` },
      ScanIndexForward: false,
      Limit: 5,
    })
  )

  const pushTokens = await getActivePushTokens(userId)
  const notificationPrefs = await getNotificationPreferences(userId)

  return {
    ...user,
    id: user.userId,
    consentRecords: consentResult.Items || [],
    pushTokens,
    notificationPrefs,
  }
}

export async function getUserCheckInHistory(userId: string, take = 50) {
  const { checkIns } = await getCheckInsByUser(userId, { limit: take })
  const enriched = []
  for (const ci of checkIns) {
    const node = await getNodeById(ci.nodeId)
    enriched.push({
      ...ci,
      node: node ? { name: node.name, slug: node.slug } : null,
    })
  }
  return enriched
}

export async function updateUserTier(userId: string, tier: string) {
  return updateUser(userId, { tier })
}

export async function resetAbuseFlags(entityId: string) {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'entityId = :eid AND reviewed = :rev AND begins_with(pk, :prefix)',
      ExpressionAttributeValues: { ':eid': entityId, ':rev': false, ':prefix': 'ABUSE#' },
    })
  )
  let count = 0
  for (const item of result.Items || []) {
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: item['pk'] as string, sk: item['sk'] as string },
        UpdateExpression: 'SET reviewed = :rev',
        ExpressionAttributeValues: { ':rev': true },
      })
    )
    count++
  }
  return { count }
}

// ─── Business Management ────────────────────────────────────────────────────

export async function getBusinessById(businessId: string) {
  const biz = await getDynamoBusiness(businessId)
  if (!biz) return null

  // Get nodes for business
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    })
  )
  const nodes = (nodesResult.Items || []).map((n) => ({
    id: n['nodeId'] ?? n['id'], name: n['name'], slug: n['slug'], claimStatus: n['claimStatus'],
  }))

  const staffAccounts = await getStaffByBusinessId(businessId)

  return { ...biz, id: biz.businessId, nodes, staffAccounts: staffAccounts.filter((s: any) => s.isActive !== false) }
}

export async function extendBusinessTrial(businessId: string, days: number) {
  const biz = await getDynamoBusiness(businessId)
  if (!biz) return null

  const trialEndsAt = biz.trialEndsAt as string | undefined
  const base = trialEndsAt && new Date(trialEndsAt) > new Date()
    ? new Date(trialEndsAt)
    : new Date()
  const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

  return updateBusiness(businessId, { trialEndsAt: newEnd } as any)
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getReportQueue() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'REPORT#', ':pending': 'pending' },
    })
  )
  const reports = (result.Items || []).slice(0, 50)
  const enriched = []
  for (const r of reports) {
    const node = r['nodeId'] ? await getNodeById(r['nodeId'] as string) : null
    enriched.push({
      ...r,
      id: r['reportId'] ?? r['pk'],
      node: node ? { id: node.nodeId, name: node.name, slug: node.slug } : null,
    })
  }
  return enriched
}

export async function updateReportStatus(reportId: string, status: string) {
  // Need to find the report's sk first
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `REPORT#${reportId}` },
      Limit: 1,
    })
  )
  if (!result.Items?.[0]) return null
  const item = result.Items[0]
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: item['pk'] as string, sk: item['sk'] as string },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
    })
  )
  return { ...item, status }
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

export async function createAuditLog(data: {
  adminId: string; adminRole: string; action: string;
  entityType: string; entityId: string;
  beforeState?: unknown; afterState?: unknown; note?: string;
}) {
  const logId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `AUDIT#${logId}`,
    sk: `AUDIT#${now}`,
    gsi1pk: `AUDIT_LOGS`,
    gsi1sk: now,
    logId, ...data,
    beforeState: data.beforeState ?? null,
    afterState: data.afterState ?? null,
    createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: logId, ...data, createdAt: now }
}

// ─── Impersonation ──────────────────────────────────────────────────────────

export async function createImpersonationLog(data: {
  adminId: string; targetUserId: string;
  targetAccountType: string; note: string;
}) {
  const logId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `IMPERSONATION#${logId}`,
    sk: `IMPERSONATION#${now}`,
    logId, ...data, createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: logId, ...data, createdAt: now }
}

// ─── Admin Messages ─────────────────────────────────────────────────────────

export async function sendAdminMessage(
  adminId: string,
  targetUserId: string,
  message: string,
) {
  const msgId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `ADMIN_MSG#${msgId}`,
    sk: `USER#${targetUserId}`,
    gsi1pk: `USER_MESSAGES#${targetUserId}`,
    gsi1sk: now,
    msgId, adminId, targetUserId, message, createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: msgId, adminId, targetUserId, message, createdAt: now }
}

// ─── Consent Audit ──────────────────────────────────────────────────────────

export async function getUserConsentHistory(userId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `CONSENT#${userId}` },
      ScanIndexForward: false,
    })
  )
  return result.Items || []
}

export async function getUsersNeedingReconsent(currentVersion: string) {
  // Scan all users and check consent
  const usersResult = await documentClient.send(
    new ScanCommand({ TableName: TableNames.users })
  )
  const needReconsent = []
  for (const u of (usersResult.Items || []).slice(0, 200)) {
    const uid = (u['userId'] ?? u['id']) as string
    const consent = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'consentVersion = :ver',
        ExpressionAttributeValues: { ':pk': `CONSENT#${uid}`, ':ver': currentVersion },
        Limit: 1,
      })
    )
    if (!consent.Items?.length) {
      needReconsent.push({ id: uid, username: u['username'], phone: u['phone'] })
    }
    if (needReconsent.length >= 100) break
  }
  return needReconsent
}

// ─── Consumer Search ────────────────────────────────────────────────────────

export async function searchConsumers(query: string) {
  const result = await documentClient.send(
    new ScanCommand({ TableName: TableNames.users })
  )
  if (!query) {
    return (result.Items || []).slice(0, 50).map((u) => ({ ...u, id: u['userId'] ?? u['id'] }))
  }
  const q = query.toLowerCase()
  return (result.Items || [])
    .filter((u) => {
      const uname = ((u['username'] as string) || '').toLowerCase()
      const phone = ((u['phone'] as string) || '')
      const dname = ((u['displayName'] as string) || '').toLowerCase()
      return uname.includes(q) || phone.includes(query) || dname.includes(q)
    })
    .slice(0, 50)
    .map((u) => ({ ...u, id: u['userId'] ?? u['id'] }))
}

// ─── Business Search ────────────────────────────────────────────────────────

export async function searchBusinesses(query: string) {
  const result = await documentClient.send(
    new ScanCommand({ TableName: TableNames.businesses })
  )
  if (!query) {
    return (result.Items || []).slice(0, 50).map((b) => ({ ...b, id: b['businessId'] ?? b['id'] }))
  }
  const q = query.toLowerCase()
  return (result.Items || [])
    .filter((b) => {
      const name = ((b['businessName'] as string) || '').toLowerCase()
      const email = ((b['email'] as string) || '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
    .slice(0, 50)
    .map((b) => ({ ...b, id: b['businessId'] ?? b['id'] }))
}

// ─── Consent List ───────────────────────────────────────────────────────────

export async function listConsents() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix)',
      ExpressionAttributeValues: { ':prefix': 'CONSENT#' },
    })
  )
  return (result.Items || []).slice(0, 100)
}

// ─── Erasure Queue ──────────────────────────────────────────────────────────

export async function getErasureQueue() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'ERASURE#', ':pending': 'pending' },
    })
  )
  const items = (result.Items || []).slice(0, 100)
  const enriched = []
  for (const item of items) {
    const uid = item['userId'] as string
    const user = uid ? await getDynamoUser(uid) : null
    enriched.push({
      ...item,
      id: item['requestId'] ?? item['pk'],
      user: user ? { id: user.userId, username: user.username, displayName: user.displayName, phone: user.phone } : null,
    })
  }
  return enriched
}

// ─── Abuse Flags ────────────────────────────────────────────────────────────

export async function getUnreviewedAbuseFlags() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND reviewed = :rev',
      ExpressionAttributeValues: { ':prefix': 'ABUSE#', ':rev': false },
    })
  )
  return (result.Items || []).slice(0, 100).map((i) => ({ ...i, id: i['flagId'] ?? i['pk'] }))
}

export async function reviewAbuseFlag(flagId: string) {
  // Find the flag
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `ABUSE#${flagId}` },
      Limit: 1,
    })
  )
  if (!result.Items?.[0]) return null
  const item = result.Items[0]
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: item['pk'] as string, sk: item['sk'] as string },
      UpdateExpression: 'SET reviewed = :rev',
      ExpressionAttributeValues: { ':rev': true },
    })
  )
  return { ...item, reviewed: true }
}
