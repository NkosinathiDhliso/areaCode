// DynamoDB-backed Admin Repository (replaces Prisma)
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { ScanCommandInput } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import {
  getUserById as getDynamoUser,
  getBusinessById as getDynamoBusiness,
  updateUser,
  updateBusiness,
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
    }),
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
  // Tier-permanence guard (churn-defences spec, Requirement 3).
  // Reject any attempt to demote a user below the tier implied by their
  // accumulated visit count. Promotions and equal moves are allowed.
  const { getTier, TIER_LEVELS } = await import('@area-code/shared/constants/tier-levels')
  const user = await getDynamoUser(userId)
  if (!user) throw new Error('User not found')

  const tierRank = (t: string) => TIER_LEVELS.findIndex((lvl) => lvl.tier === t)
  const minAllowedTier = getTier(user.totalCheckIns ?? 0)
  if (tierRank(tier) < tierRank(minAllowedTier)) {
    throw new Error(
      `tier_downgrade_not_allowed: cannot demote user with ${user.totalCheckIns} check-ins from ${minAllowedTier} to ${tier}`,
    )
  }

  return updateUser(userId, { tier })
}

export async function resetAbuseFlags(entityId: string) {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'entityId = :eid AND reviewed = :rev AND begins_with(pk, :prefix)',
      ExpressionAttributeValues: { ':eid': entityId, ':rev': false, ':prefix': 'ABUSE#' },
    }),
  )
  let count = 0
  for (const item of result.Items || []) {
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: item['pk'] as string, sk: item['sk'] as string },
        UpdateExpression: 'SET reviewed = :rev',
        ExpressionAttributeValues: { ':rev': true },
      }),
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
    }),
  )
  const nodes = (nodesResult.Items || []).map((n) => ({
    id: n['nodeId'],
    name: n['name'],
    slug: n['slug'],
    claimStatus: n['claimStatus'],
  }))

  const staffAccounts = await getStaffByBusinessId(businessId)

  return { ...biz, id: biz.businessId, nodes, staffAccounts: staffAccounts.filter((s: any) => s.isActive !== false) }
}

export async function extendBusinessTrial(businessId: string, days: number) {
  const biz = await getDynamoBusiness(businessId)
  if (!biz) return null

  const trialEndsAt = biz.trialEndsAt as string | undefined
  const base = trialEndsAt && new Date(trialEndsAt) > new Date() ? new Date(trialEndsAt) : new Date()
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
    }),
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
    }),
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
    }),
  )
  return { ...item, status }
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

export async function createAuditLog(data: {
  adminId: string
  adminRole: string
  action: string
  entityType: string
  entityId: string
  beforeState?: unknown
  afterState?: unknown
  note?: string
}) {
  const logId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `AUDIT#${logId}`,
    sk: `AUDIT#${now}`,
    gsi1pk: `AUDIT_LOGS`,
    gsi1sk: now,
    logId,
    ...data,
    beforeState: data.beforeState ?? null,
    afterState: data.afterState ?? null,
    createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: logId, ...data, createdAt: now }
}

// ─── Admin Messages ─────────────────────────────────────────────────────────

export async function sendAdminMessage(adminId: string, targetUserId: string, message: string) {
  const msgId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `ADMIN_MSG#${msgId}`,
    sk: `USER#${targetUserId}`,
    gsi1pk: `USER_MESSAGES#${targetUserId}`,
    gsi1sk: now,
    msgId,
    adminId,
    targetUserId,
    message,
    createdAt: now,
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
    }),
  )
  return result.Items || []
}

export async function getUsersNeedingReconsent(currentVersion: string) {
  // Scan all users and check consent
  const usersResult = await documentClient.send(new ScanCommand({ TableName: TableNames.users }))
  const needReconsent = []
  for (const u of (usersResult.Items || []).slice(0, 200)) {
    const uid = u['userId'] as string
    const consent = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'consentVersion = :ver',
        ExpressionAttributeValues: { ':pk': `CONSENT#${uid}`, ':ver': currentVersion },
        Limit: 1,
      }),
    )
    if (!consent.Items?.length) {
      needReconsent.push({ id: uid, username: u['username'], email: u['email'] })
    }
    if (needReconsent.length >= 100) break
  }
  return needReconsent
}

// ─── Consumer Search ────────────────────────────────────────────────────────

export async function searchConsumers(query: string) {
  const result = await documentClient.send(new ScanCommand({ TableName: TableNames.users }))
  const allUsers = result.Items || []
  const filtered = query
    ? allUsers.filter((u) => {
        const q = query.toLowerCase()
        const uname = ((u['username'] as string) || '').toLowerCase()
        const email = ((u['email'] as string) || '').toLowerCase()
        const dname = ((u['displayName'] as string) || '').toLowerCase()
        return uname.includes(q) || email.includes(q) || dname.includes(q)
      })
    : allUsers
  const sliced = filtered.slice(0, 50)

  // Compute additional fields for each user
  const enriched = []
  for (const u of sliced) {
    const userId = u['userId'] as string

    // streakCount and isDisabled from user record
    const streakCount = (u['streakCount'] as number) ?? 0
    const isDisabled = (u['isDisabled'] as boolean) ?? false

    // abuseFlags: count unreviewed abuse flags for this user
    let abuseFlags = 0
    try {
      const flagsResult = await documentClient.send(
        new ScanCommand({
          TableName: TableNames.appData,
          FilterExpression: 'begins_with(pk, :prefix) AND entityId = :eid AND reviewed = :rev',
          ExpressionAttributeValues: { ':prefix': 'ABUSE#', ':eid': userId, ':rev': false },
          Select: 'COUNT',
        }),
      )
      abuseFlags = flagsResult.Count ?? 0
    } catch {
      // Non-critical
    }

    enriched.push({
      ...u,
      id: userId,
      streakCount,
      abuseFlags,
      isDisabled,
    })
  }
  return enriched
}

// ─── Business Search ────────────────────────────────────────────────────────

export async function searchBusinesses(query: string) {
  const result = await documentClient.send(new ScanCommand({ TableName: TableNames.businesses }))
  const allBiz = result.Items || []
  const filtered = query
    ? allBiz.filter((b) => {
        const q = query.toLowerCase()
        const name = ((b['businessName'] as string) || '').toLowerCase()
        const email = ((b['email'] as string) || '').toLowerCase()
        return name.includes(q) || email.includes(q)
      })
    : allBiz
  const sliced = filtered.slice(0, 50)

  // Compute additional fields for each business — all enrichments run in parallel
  const enriched = await Promise.all(
    sliced.map(async (b) => {
      const businessId = b['businessId'] as string

      const [staffCount, nodeCount, activeRewardCount] = await Promise.all([
        getStaffByBusinessId(businessId)
          .then((r) => r.filter((s: any) => s.isActive !== false).length)
          .catch(() => 0),
        documentClient
          .send(
            new QueryCommand({
              TableName: TableNames.nodes,
              IndexName: 'BusinessIndex',
              KeyConditionExpression: 'businessId = :bid',
              ExpressionAttributeValues: { ':bid': businessId },
              Select: 'COUNT',
            }),
          )
          .then((r) => r.Count ?? 0)
          .catch(() => 0),
        documentClient
          .send(
            new ScanCommand({
              TableName: TableNames.rewards,
              FilterExpression: 'businessId = :bid AND isActive = :active',
              ExpressionAttributeValues: { ':bid': businessId, ':active': true },
              Select: 'COUNT',
            }),
          )
          .then((r) => r.Count ?? 0)
          .catch(() => 0),
      ])

      return { ...b, id: businessId, staffCount, nodeCount, activeRewardCount }
    }),
  )
  return enriched
}

// ─── Consent List ───────────────────────────────────────────────────────────

export async function listConsents() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix)',
      ExpressionAttributeValues: { ':prefix': 'CONSENT#' },
    }),
  )
  return (result.Items || []).slice(0, 100).map((item) => {
    const pk = (item['pk'] as string) ?? ''
    // Extract userId from pk format CONSENT#{userId}
    const userId = pk.startsWith('CONSENT#') ? pk.slice('CONSENT#'.length) : pk
    // Use consentId or sk as the unique id, falling back to pk+sk combo
    const id = (item['consentId'] as string) ?? `${pk}:${item['sk'] ?? ''}`
    return {
      ...item,
      id,
      userId,
    }
  })
}

// ─── Erasure Queue ──────────────────────────────────────────────────────────

export async function getErasureQueue() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'ERASURE#', ':pending': 'pending' },
    }),
  )
  const items = (result.Items || []).slice(0, 100)
  const enriched = []
  for (const item of items) {
    const uid = item['userId'] as string
    const user = uid ? await getDynamoUser(uid) : null
    enriched.push({
      userId: uid,
      username: user?.username ?? 'Unknown',
      requestedAt: (item['requestedAt'] ?? item['createdAt'] ?? '') as string,
      deletesAt: (item['deletesAt'] ?? item['expiresAt'] ?? '') as string,
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
    }),
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
    }),
  )
  if (!result.Items?.[0]) return null
  const item = result.Items[0]
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: item['pk'] as string, sk: item['sk'] as string },
      UpdateExpression: 'SET reviewed = :rev',
      ExpressionAttributeValues: { ':rev': true },
    }),
  )
  return { ...item, reviewed: true }
}

// ─── Dashboard Metrics ──────────────────────────────────────────────────────

// Simple KV cache for dashboard metrics (60s TTL)
let metricsCache: { data: Record<string, unknown>; expiresAt: number } | null = null

// Paginated COUNT: loops over LastEvaluatedKey, summing per-page Count until the
// scan is exhausted, so the total reflects the whole table/filter rather than a
// single Scan page. See data-integrity-ops-hardening (H5).
// Exported for unit testing of the multi-page summation (H5, task 1.2).
export async function countAll(params: ScanCommandInput): Promise<number> {
  let total = 0
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({ ...params, Select: 'COUNT', ExclusiveStartKey: exclusiveStartKey }),
    )
    total += result.Count ?? 0
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)
  return total
}

export async function getDashboardMetrics() {
  if (metricsCache && metricsCache.expiresAt > Date.now()) {
    return metricsCache.data
  }

  const today = new Date().toISOString().slice(0, 10)

  const [
    totalConsumers,
    totalBusinesses,
    totalCheckInsAllTime,
    totalCheckInsToday,
    activeRewards,
    pendingReports,
    pendingErasures,
    unreviewedAbuseFlags,
  ] = await Promise.all([
    // Count consumers
    countAll({ TableName: TableNames.users }),
    // Count businesses
    countAll({ TableName: TableNames.businesses }),
    // Count all check-ins
    countAll({ TableName: TableNames.checkins }),
    // Count today's check-ins
    countAll({
      TableName: TableNames.checkins,
      FilterExpression: 'begins_with(checkedInAt, :today)',
      ExpressionAttributeValues: { ':today': today },
    }),
    // Count active rewards
    countAll({
      TableName: TableNames.rewards,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
    }),
    // Count pending reports
    countAll({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'REPORT#', ':pending': 'pending' },
    }),
    // Count pending erasures
    countAll({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'ERASURE#', ':pending': 'pending' },
    }),
    // Count unreviewed abuse flags
    countAll({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND reviewed = :rev',
      ExpressionAttributeValues: { ':prefix': 'ABUSE#', ':rev': false },
    }),
  ])

  const data = {
    totalConsumers,
    totalBusinesses,
    totalCheckInsAllTime,
    totalCheckInsToday,
    activeRewards,
    pendingReports,
    pendingErasures,
    unreviewedAbuseFlags,
  }

  metricsCache = { data, expiresAt: Date.now() + 60_000 }
  return data
}

// ─── Archetype Management ────────────────────────────────────────────────────

export async function getArchetypes() {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ARCHETYPES' },
      ScanIndexForward: false,
    }),
  )
  return (result.Items || []).map((item) => ({
    id: item['archetypeId'] as string,
    name: item['name'] as string,
    iconId: item['iconId'] as string,
    description: item['description'] as string,
    dimensionThresholds: item['dimensionThresholds'] as Record<string, number>,
    priority: item['priority'] as number,
    isActive: item['isActive'] as boolean,
  }))
}

export async function createArchetype(data: {
  id: string
  name: string
  iconId: string
  description: string
  dimensionThresholds: Record<string, number>
  priority: number
  isActive: boolean
}) {
  const item = {
    pk: `ARCHETYPE#${data.id}`,
    sk: `ARCHETYPE#${data.id}`,
    gsi1pk: 'ARCHETYPES',
    gsi1sk: String(data.priority).padStart(5, '0'),
    archetypeId: data.id,
    name: data.name,
    iconId: data.iconId,
    description: data.description,
    dimensionThresholds: data.dimensionThresholds,
    priority: data.priority,
    isActive: data.isActive,
    createdAt: new Date().toISOString(),
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return data
}

export async function updateArchetypeRecord(archetypeId: string, data: Record<string, unknown>) {
  const key = { pk: `ARCHETYPE#${archetypeId}`, sk: `ARCHETYPE#${archetypeId}` }

  const updateParts: string[] = []
  const exprNames: Record<string, string> = {}
  const exprValues: Record<string, unknown> = {}
  let idx = 0
  for (const [k, v] of Object.entries(data)) {
    if (k === 'id') continue
    const nameKey = `#f${idx}`
    const valKey = `:v${idx}`
    exprNames[nameKey] = k
    exprValues[valKey] = v
    updateParts.push(`${nameKey} = ${valKey}`)
    idx++
  }
  if (data['priority'] !== undefined) {
    exprNames['#gsi1sk'] = 'gsi1sk'
    exprValues[':gsi1sk'] = String(data['priority']).padStart(5, '0')
    updateParts.push('#gsi1sk = :gsi1sk')
  }

  if (updateParts.length === 0) return null

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: key,
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }),
  )
  const item = result.Attributes
  if (!item) return null
  return {
    id: item['archetypeId'] as string,
    name: item['name'] as string,
    iconId: item['iconId'] as string,
    description: item['description'] as string,
    dimensionThresholds: item['dimensionThresholds'] as Record<string, number>,
    priority: item['priority'] as number,
    isActive: item['isActive'] as boolean,
  }
}

// ─── Genre Weight Management ────────────────────────────────────────────────

export async function getGenreWeights() {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: 'GENRE_WEIGHTS', sk: 'MATRIX' },
    }),
  )
  if (!result.Item) return null
  return result.Item['matrix'] as Array<{ genre: string; weights: Record<string, number> }>
}

export async function updateGenreWeightsRecord(matrix: Array<{ genre: string; weights: Record<string, number> }>) {
  const item = {
    pk: 'GENRE_WEIGHTS',
    sk: 'MATRIX',
    matrix,
    updatedAt: new Date().toISOString(),
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return matrix
}

// ─── Audit Logs ─────────────────────────────────────────────────────────────

export async function getAuditLogs(filters: {
  cursor?: string
  adminId?: string
  action?: string
  startDate?: string
  endDate?: string
}) {
  // Query audit logs from GSI1 (AUDIT_LOGS)
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    IndexName: 'GSI1',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: { ':pk': 'AUDIT_LOGS' } as Record<string, unknown>,
    ScanIndexForward: false,
    Limit: 50,
  }

  // Add date range to key condition if provided
  if (filters.startDate && filters.endDate) {
    ;(params as any).KeyConditionExpression += ' AND gsi1sk BETWEEN :start AND :end'
    ;(params as any).ExpressionAttributeValues[':start'] = filters.startDate
    ;(params as any).ExpressionAttributeValues[':end'] = filters.endDate + 'T23:59:59.999Z'
  } else if (filters.startDate) {
    ;(params as any).KeyConditionExpression += ' AND gsi1sk >= :start'
    ;(params as any).ExpressionAttributeValues[':start'] = filters.startDate
  } else if (filters.endDate) {
    ;(params as any).KeyConditionExpression += ' AND gsi1sk <= :end'
    ;(params as any).ExpressionAttributeValues[':end'] = filters.endDate + 'T23:59:59.999Z'
  }

  // Build filter expressions for adminId and action
  const filterParts: string[] = []
  if (filters.adminId) {
    filterParts.push('adminId = :adminId')
    ;(params as any).ExpressionAttributeValues[':adminId'] = filters.adminId
  }
  if (filters.action) {
    filterParts.push('#action = :actionFilter')
    ;(params as any).ExpressionAttributeNames = { ...(params as any).ExpressionAttributeNames, '#action': 'action' }
    ;(params as any).ExpressionAttributeValues[':actionFilter'] = filters.action
  }
  if (filterParts.length > 0) {
    ;(params as any).FilterExpression = filterParts.join(' AND ')
  }

  if (filters.cursor) {
    ;(params as any).ExclusiveStartKey = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString())
  }

  const result = await documentClient.send(new QueryCommand(params as any))
  const items = (result.Items || []).map((i) => ({
    id: i['logId'] ?? i['pk'],
    adminId: i['adminId'],
    adminRole: i['adminRole'],
    action: i['action'],
    entityType: i['entityType'],
    entityId: i['entityId'],
    beforeState: i['beforeState'] ?? null,
    afterState: i['afterState'] ?? null,
    createdAt: i['createdAt'],
  }))

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
    : null

  return { items, nextCursor }
}
