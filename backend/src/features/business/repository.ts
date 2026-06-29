// DynamoDB-backed Business Repository (replaces Prisma)
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { randomBytes } from 'node:crypto'
import {
  getBusinessById as getBusinessDynamo,
  getBusinessByCognitoSub,
  updateBusiness,
  getStaffByBusinessId,
} from '../auth/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'
import {
  boostFloorRowSchema,
  boosterCheckoutMarkerRowSchema,
  boosterPurchaseRowSchema,
  floorChangeAuditRowSchema,
  type BoostDuration,
  type BoostFloorRow,
  type BoosterCheckoutMarkerRow,
  type BoosterPurchaseRow,
  type FloorChangeAuditRow,
} from './types.js'

const BOOST_DURATIONS: readonly BoostDuration[] = ['2hr', '6hr', '24hr'] as const

export async function findBusinessById(id: string) {
  return getBusinessDynamo(id)
}

export async function findBusinessByCognitoSub(sub: string) {
  // The `businesses` table only has the `OwnerIndex` GSI (see infra TF).
  // Delegate to the Scan-based lookup in the auth repository to avoid
  // querying a non-existent `CognitoIndex` GSI (which throws and surfaces
  // as 401 Unauthorized through requireAuth → verifyToken).
  return getBusinessByCognitoSub(sub)
}

export async function updateBusinessTier(id: string, tier: string, trialEndsAt?: string | null) {
  const data: Record<string, unknown> = { tier }
  if (trialEndsAt !== undefined) data['trialEndsAt'] = trialEndsAt
  return updateBusiness(id, data as any)
}

export async function setPaymentGrace(id: string, until: string | null) {
  return updateBusiness(id, { paymentGraceUntil: until } as any)
}

/**
 * Business ids whose payment grace window has lapsed - `paymentGraceUntil` is
 * a past ISO timestamp at `nowIso`. Absent or null grace never matches: a
 * successful payment clears it to NULL (`setPaymentGrace(id, null)`), and the
 * `<` string comparison excludes the NULL type. Paginated Scan; projects only
 * the id the lapsed-payment sweep needs (business/service.ts).
 */
export async function listBusinessesWithLapsedGrace(nowIso: string): Promise<string[]> {
  const ids: string[] = []
  let cursor: Record<string, unknown> | undefined
  do {
    const params: Record<string, unknown> = {
      TableName: TableNames.businesses,
      FilterExpression: 'attribute_exists(paymentGraceUntil) AND paymentGraceUntil < :now',
      ExpressionAttributeValues: { ':now': nowIso },
      ProjectionExpression: 'businessId',
    }
    if (cursor) params['ExclusiveStartKey'] = cursor
    const result = await documentClient.send(new ScanCommand(params as any))
    for (const item of result.Items ?? []) {
      const id = item['businessId']
      if (typeof id === 'string') ids.push(id)
    }
    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)
  return ids
}

export async function deactivateBusiness(id: string) {
  return updateBusiness(id, { tier: 'free', isActive: false } as any)
}

export async function setYocoCustomerId(id: string, yocoId: string) {
  return updateBusiness(id, { yocoCustomerId: yocoId } as any)
}

// Staff management
export async function countStaffForBusiness(businessId: string) {
  const staff = await getStaffByBusinessId(businessId)
  return staff.filter((s: any) => s.isActive !== false).length
}

export async function createStaffInvite(
  businessId: string,
  phone?: string,
  email?: string,
  role: 'manager' | 'staff' = 'staff',
) {
  const inviteToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const inviteId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `STAFF_INVITE#${inviteToken}`,
    sk: `STAFF_INVITE#${inviteToken}`,
    gsi1pk: `BIZ_INVITES#${businessId}`,
    gsi1sk: now,
    id: inviteId,
    businessId,
    inviteToken,
    invitedPhone: phone ?? null,
    invitedEmail: email ?? null,
    role,
    accepted: false,
    expiresAt,
    createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return item
}

export async function listStaffInvites(businessId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `BIZ_INVITES#${businessId}` },
      ScanIndexForward: false,
    }),
  )
  return result.Items ?? []
}

export async function listStaffAccounts(businessId: string) {
  const staff = await getStaffByBusinessId(businessId)
  return staff.filter((s: any) => s.isActive !== false)
}

export async function removeStaffAccount(id: string, businessId: string) {
  // Update staff in app_data
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: `STAFF#${id}`, sk: `BIZ#${businessId}` },
      UpdateExpression: 'SET isActive = :inactive',
      ExpressionAttributeValues: { ':inactive': false },
    }),
  )
  return { count: 1 }
}

// Webhook events (Yoco idempotency)
export async function findWebhookEvent(eventId: string) {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `WEBHOOK#${eventId}`, sk: `WEBHOOK#${eventId}` },
    }),
  )
  return result.Item ?? null
}

export async function createWebhookEvent(eventId: string, eventType: string) {
  const item = {
    pk: `WEBHOOK#${eventId}`,
    sk: `WEBHOOK#${eventId}`,
    eventId,
    eventType,
    createdAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return item
}

// QR token helpers
export async function getNodeForBusiness(nodeId: string, businessId: string) {
  const result = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
  const node = result.Item
  if (!node || node['businessId'] !== businessId) return null
  return { ...node, id: node['nodeId'] ?? nodeId }
}

// Deactivate all rewards for a business
export async function deactivateBusinessRewards(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)
  let count = 0
  for (const nid of nodeIds) {
    const rewards = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.rewards,
        FilterExpression: 'nodeId = :nid AND isActive = :active',
        ExpressionAttributeValues: { ':nid': nid, ':active': true },
      }),
    )
    for (const r of rewards.Items || []) {
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.rewards,
          Key: { rewardId: r['rewardId'] },
          UpdateExpression: 'SET isActive = :inactive',
          ExpressionAttributeValues: { ':inactive': false },
        }),
      )
      count++
    }
  }
  return { count }
}

// ─── Live Stats ─────────────────────────────────────────────────────────────

export async function getLiveStats(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)

  let checkInsToday = 0
  let totalCheckIns = 0
  for (const nid of nodeIds) {
    const { checkIns: todayCIs } = await getCheckInsByNode(nid, { hours: 24 })
    checkInsToday += todayCIs.length
    const { checkIns: allCIs } = await getCheckInsByNode(nid, {})
    totalCheckIns += allCIs.length
  }

  return { checkInsToday, rewardsClaimed: 0, pulseScore: 0, totalCheckIns }
}

// ─── Business Nodes ─────────────────────────────────────────────────────────

export async function getNodesForBusiness(businessId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  return (result.Items || []).map((n) => ({ ...n, id: n['nodeId'] ?? n['id'] }))
}

// ─── Audience Analytics ─────────────────────────────────────────────────────

export async function getAudienceAnalytics(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)

  const uniqueUserIds = new Set<string>()
  for (const nid of nodeIds) {
    const { checkIns } = await getCheckInsByNode(nid, {})
    checkIns.forEach((ci) => uniqueUserIds.add(ci.userId))
  }

  return {
    tierDistribution: {},
    repeatVsNew: { repeat: 0, new: uniqueUserIds.size },
    totalUniqueVisitors: uniqueUserIds.size,
    peakHours: [],
  }
}

// ─── Music Audience ─────────────────────────────────────────────────────────

export async function getMusicAudience(_businessId: string) {
  return {
    totalWithMusicPrefs: 0,
    genreDistribution: {},
    archetypeBreakdown: {},
    peakArchetypeByTime: [],
  }
}

// ─── Recent Redemptions ─────────────────────────────────────────────────────

export async function getRecentRedemptions(businessId: string) {
  // Simplified , scan redemptions from appData
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND attribute_exists(redeemedAt)',
      ExpressionAttributeValues: { ':prefix': 'REDEMPTION#' },
    }),
  )
  return (result.Items || []).slice(0, 20)
}

// ─── Check-In Details ────────────────────────────────────────────────────────

export async function getCheckInDetails(businessId: string, date?: string, cursor?: string) {
  const targetDate = date ?? new Date().toISOString().slice(0, 10)
  // Query BIZ_CHECKIN cache from app-data table
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `BIZ_CHECKIN#${businessId}#${targetDate}` } as Record<string, string>,
    ScanIndexForward: false,
    Limit: 50,
  }
  if (cursor) {
    ;(params as any).ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString())
  }
  const result = await documentClient.send(new QueryCommand(params as any))
  const items = (result.Items || []).map((i) => ({
    displayName: i['displayName'] as string,
    tier: i['tier'] as string,
    visitCount: (i['visitCount'] as number) ?? 1,
    timestamp: (i['timestamp'] as string) ?? (i['sk'] as string),
  }))
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
    : null
  return { items, nextCursor }
}

// ─── Reward Metrics ─────────────────────────────────────────────────────────

export async function getRewardMetrics(rewardId: string, businessId: string) {
  // Get the reward from rewards table
  const rewardResult = await documentClient.send(new GetCommand({ TableName: TableNames.rewards, Key: { rewardId } }))
  const reward = rewardResult.Item
  if (!reward) return { claimRate: 0, timeToClaimMinutes: 0, redemptionRate: 0 }

  const totalSlots = (reward['totalSlots'] as number) ?? 0
  const claimedCount = (reward['claimedCount'] as number) ?? 0
  const redeemedCount = (reward['redeemedCount'] as number) ?? 0
  const firstClaimedAt = reward['firstClaimedAt'] as string | undefined
  const createdAt = reward['createdAt'] as string

  const claimRate = totalSlots > 0 ? claimedCount / totalSlots : 0
  const redemptionRate = claimedCount > 0 ? redeemedCount / claimedCount : 0
  const timeToClaimMinutes =
    firstClaimedAt && createdAt
      ? Math.round((new Date(firstClaimedAt).getTime() - new Date(createdAt).getTime()) / 60000)
      : 0

  return { claimRate, timeToClaimMinutes, redemptionRate }
}

export async function getRewardsSummary(businessId: string) {
  const rewards = await getRewardsForBusiness(businessId)
  const now = Date.now()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const items = rewards
    .filter((r) => (r as Record<string, unknown>)['isActive'] !== false)
    .map((r) => {
      const rec = r as Record<string, unknown>
      const totalSlots = (rec['totalSlots'] as number) ?? 0
      const claimedCount = (rec['claimedCount'] as number) ?? 0
      const redeemedCount = (rec['redeemedCount'] as number) ?? 0
      const firstClaimedAt = rec['firstClaimedAt'] as string | undefined
      const createdAt = rec['createdAt'] as string

      const claimRate = totalSlots > 0 ? claimedCount / totalSlots : 0
      const redemptionRate = claimedCount > 0 ? redeemedCount / claimedCount : 0
      const timeToClaimMinutes =
        firstClaimedAt && createdAt
          ? Math.round((new Date(firstClaimedAt).getTime() - new Date(createdAt).getTime()) / 60000)
          : 0

      const isOlderThan7Days = createdAt && now - new Date(createdAt).getTime() > sevenDaysMs
      const isLowPerformance = isOlderThan7Days && claimedCount === 0

      return {
        rewardId: rec['id'] as string,
        title: (rec['title'] as string) ?? '',
        claimRate,
        timeToClaimMinutes,
        redemptionRate,
        isLowPerformance: !!isLowPerformance,
      }
    })
    .sort((a, b) => b.claimRate - a.claimRate)

  return { items }
}

// ─── Business Rewards ───────────────────────────────────────────────────────

export async function getRewardsForBusiness(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)
  const allRewards = []
  for (const nid of nodeIds) {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.rewards,
        FilterExpression: 'nodeId = :nid',
        ExpressionAttributeValues: { ':nid': nid },
      }),
    )
    allRewards.push(...(result.Items || []).map((r) => ({ ...r, id: r['rewardId'] ?? r['id'] })))
  }
  return allRewards
}

// ─── Booster Purchase audit & idempotency marker ────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` Flow 2.
//
// Two-step idempotency choreography for `payment.succeeded` webhooks with
// `metadata.type === 'boost'`:
//
//   1. PutItem the `BOOST_CHECKOUT#<yocoCheckoutId>` marker row with
//      `attribute_not_exists(pk)` so a second delivery for the same Yoco
//      checkout id (even with a fresh Yoco `eventId`) is detected as a
//      duplicate (R2.3, R2.6).
//   2. PutItem the `BOOST#<businessId>` audit row with
//      `attribute_not_exists(pk)` so an extremely rare collision on
//      (paidAt-millisecond, yocoCheckoutId) for two different events still
//      can't silently overwrite an existing row (R1.4).
//
// On any non-conditional failure of step 2 (R1.5), best-effort `DeleteItem`
// the marker so a Yoco retry can re-attempt cleanly (R2.4). If the
// compensating delete itself fails, we log and re-throw the *original*
// error anyway — the next Yoco retry will land on the existing marker and
// be treated as a duplicate.

function isConditionalCheckFailedError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException'
}

export async function putBoosterPurchaseWithMarker(args: {
  purchase: BoosterPurchaseRow
  marker: BoosterCheckoutMarkerRow
}): Promise<{ result: 'written' | 'duplicate' }> {
  const { purchase, marker } = args

  // Step 1: write the idempotency marker first. R2.2 / R2.3.
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: marker,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    )
  } catch (err) {
    if (isConditionalCheckFailedError(err)) {
      // Marker already exists → same yocoCheckoutId already persisted. R2.3 / R2.6.
      return { result: 'duplicate' }
    }
    throw err
  }

  // Step 2: write the BoosterPurchase audit row. R1.4.
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: purchase,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    )
    return { result: 'written' }
  } catch (err) {
    if (isConditionalCheckFailedError(err)) {
      // (pk, sk) collision — but the marker we just wrote is now the source
      // of truth for this yocoCheckoutId. Treat as duplicate. R1.6.
      return { result: 'duplicate' }
    }

    // Non-conditional failure of the purchase write. Best-effort compensating
    // delete of the marker so a Yoco retry can re-attempt cleanly. R1.5 / R2.4.
    try {
      await documentClient.send(
        new DeleteCommand({
          TableName: TableNames.appData,
          Key: { pk: marker.pk, sk: marker.sk },
        }),
      )
    } catch (deleteErr) {
      // Compensating delete failed — log and re-throw the *original* error
      // anyway. The next Yoco retry will see the orphaned marker and treat
      // the event as a duplicate, which is safe because no purchase row was
      // ever written.
      console.warn(
        `[business] putBoosterPurchaseWithMarker: compensating marker delete failed for marker.pk=${marker.pk}: ${String(deleteErr)}`,
      )
    }
    throw err
  }
}

// ─── BoostFloor reads ───────────────────────────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` Data Models.
//
// `BoostFloor_Row` lives at `pk='BOOST_FLOOR'`, `sk=<duration>` (one of
// `'2hr' | '6hr' | '24hr'`). Reads are point-lookups (R3.1) or a small
// `BatchGetItem` for the editor surface (R4.2) — never a Scan or Query.
//
// We Zod-parse every read result so a malformed row in DynamoDB does not
// crash callers. A parse failure is logged via `console.warn` and treated
// as missing (`null` for `getBoostFloor`, omitted for `listBoostFloors`)
// so the service-layer `BOOST_FLOOR_DEFAULTS` fallback path takes over.

export async function getBoostFloor(duration: BoostDuration): Promise<BoostFloorRow | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: 'BOOST_FLOOR', sk: duration },
    }),
  )
  if (!result.Item) return null

  const parsed = boostFloorRowSchema.safeParse(result.Item)
  if (!parsed.success) {
    console.warn(`[business] getBoostFloor: malformed BoostFloor_Row for duration=${duration}: ${parsed.error.message}`)
    return null
  }
  return parsed.data
}

export async function listBoostFloors(): Promise<BoostFloorRow[]> {
  const result = await documentClient.send(
    new BatchGetCommand({
      RequestItems: {
        [TableNames.appData]: {
          Keys: BOOST_DURATIONS.map((duration) => ({ pk: 'BOOST_FLOOR', sk: duration })),
        },
      },
    }),
  )

  const items = result.Responses?.[TableNames.appData] ?? []
  const rows: BoostFloorRow[] = []
  for (const item of items) {
    const parsed = boostFloorRowSchema.safeParse(item)
    if (!parsed.success) {
      console.warn(
        `[business] listBoostFloors: skipping malformed BoostFloor_Row sk=${String(item['sk'])}: ${parsed.error.message}`,
      )
      continue
    }
    rows.push(parsed.data)
  }
  return rows
}

// ─── Cursor parsing ─────────────────────────────────────────────────────────
//
// Shared sentinel for paginated repository functions. The handler layer
// (task 7.x) `instanceof`-checks this to map the failure to a 400 response.
// Reused by `queryFloorChangeAudit` and the upcoming booster-purchase
// query helpers.

export class MalformedCursorError extends Error {
  override readonly name = 'MalformedCursorError'
  constructor(message = 'Malformed pagination cursor') {
    super(message)
  }
}

function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString()
    const parsed = JSON.parse(decoded)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MalformedCursorError()
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof MalformedCursorError) throw err
    throw new MalformedCursorError()
  }
}

function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  if (!key) return null
  return Buffer.from(JSON.stringify(key)).toString('base64url')
}

// ─── Floor audit write & query ──────────────────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` Flow 3.
//
// Audit-first ordering for floor updates (R5.2): the
// `Floor_Change_Audit_Row` is written *before* the `BoostFloor_Row` is
// updated so no reader can observe a new floor before its audit row is
// durable. If the audit write fails, the floor row is left untouched
// (R5.3) and the error propagates so the handler returns 500.
//
// `BoostFloor_Row` `PutItem` is unconditional — overwrite is the intended
// semantic for an admin update; `updatedAt` / `updatedBy` are already on
// the `next` row passed in by the caller.
//
// `Floor_Change_Audit_Row` `PutItem` is also unconditional: the unique
// `sk` includes a UUID v4 `changeId` so collisions are vanishingly
// unlikely, and a duplicate audit row is preferable to a missing one.

export async function writeFloorAuditThenUpdateFloor(args: {
  audit: FloorChangeAuditRow
  next: BoostFloorRow
}): Promise<void> {
  const { audit, next } = args

  // Step 1: write the audit row first. If this fails, propagate without
  // touching the floor row so the BoostFloor_Row stays unchanged (R5.3).
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: audit,
    }),
  )

  // Step 2: only on audit-write success do we update the floor row.
  // Overwrite semantics — this is an admin-driven update path.
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: next,
    }),
  )
}

export async function queryFloorChangeAudit(
  duration: BoostDuration,
  cursor: string | null,
  limit: number,
): Promise<{ items: FloorChangeAuditRow[]; nextCursor: string | null }> {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `BOOST_FLOOR_AUDIT#${duration}` },
    ScanIndexForward: false, // newest-first (R5.5)
    Limit: limit,
  }
  if (cursor) {
    ;(params as { ExclusiveStartKey?: Record<string, unknown> }).ExclusiveStartKey = decodeCursor(cursor)
  }

  const result = await documentClient.send(new QueryCommand(params as any))
  const items: FloorChangeAuditRow[] = []
  for (const item of result.Items ?? []) {
    const parsed = floorChangeAuditRowSchema.safeParse(item)
    if (!parsed.success) {
      console.warn(
        `[business] queryFloorChangeAudit: skipping malformed Floor_Change_Audit_Row sk=${String(item['sk'])}: ${parsed.error.message}`,
      )
      continue
    }
    items.push(parsed.data)
  }

  return {
    items,
    nextCursor: encodeCursor(result.LastEvaluatedKey as Record<string, unknown> | undefined),
  }
}

// ─── BoosterPurchase reads ──────────────────────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` access-pattern
// table:
//
// - Operator view of own purchases (R6.2): `Query` `pk='BOOST#<businessId>'`
//   with `ScanIndexForward=false` so the natural sort-order (by `paidAt`
//   embedded in `sk`) yields newest-first.
// - Admin date-range across all businesses (R7.2): `Query` GSI1 with
//   `gsi1pk='BOOST_BY_TIME'` and `gsi1sk BETWEEN :from AND :to`. Newest-first
//   to match operator pagination semantics so the admin UI can stream the
//   most-recent matches without waiting for the full page.
// - Admin single-payment lookup (R7.2): the `BOOST_CHECKOUT#<yocoCheckoutId>`
//   marker is a direct point read; the caller follows up with a `GetItem`
//   for the BoosterPurchase row using the marker's stored `boostPk` /
//   `boostSk`. `getBoosterPurchaseByKey` is exported below for that follow-up
//   so the service layer does not need to import `documentClient` directly.
//
// All reads Zod-parse with `safeParse`; on parse failure we log and skip the
// offending row so a single malformed row in DynamoDB cannot bring down a
// whole page, consistent with `queryFloorChangeAudit` (task 2.3).

export async function queryBoosterPurchasesForBusiness(
  businessId: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: BoosterPurchaseRow[]; nextCursor: string | null }> {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `BOOST#${businessId}` },
    ScanIndexForward: false, // newest-first (R6.2)
    Limit: limit,
  }
  if (cursor) {
    ;(params as { ExclusiveStartKey?: Record<string, unknown> }).ExclusiveStartKey = decodeCursor(cursor)
  }

  const result = await documentClient.send(new QueryCommand(params as any))
  const items: BoosterPurchaseRow[] = []
  for (const item of result.Items ?? []) {
    const parsed = boosterPurchaseRowSchema.safeParse(item)
    if (!parsed.success) {
      console.warn(
        `[business] queryBoosterPurchasesForBusiness: skipping malformed BoosterPurchase row sk=${String(item['sk'])}: ${parsed.error.message}`,
      )
      continue
    }
    items.push(parsed.data)
  }

  return {
    items,
    nextCursor: encodeCursor(result.LastEvaluatedKey as Record<string, unknown> | undefined),
  }
}

export async function queryBoosterPurchasesByTimeRange(
  fromIso: string,
  toIso: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: BoosterPurchaseRow[]; nextCursor: string | null }> {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    IndexName: 'GSI1',
    KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk BETWEEN :from AND :to',
    ExpressionAttributeValues: {
      ':pk': 'BOOST_BY_TIME',
      ':from': fromIso,
      ':to': toIso,
    },
    ScanIndexForward: false, // newest-first to match operator pagination semantics (R7.2)
    Limit: limit,
  }
  if (cursor) {
    ;(params as { ExclusiveStartKey?: Record<string, unknown> }).ExclusiveStartKey = decodeCursor(cursor)
  }

  const result = await documentClient.send(new QueryCommand(params as any))
  const items: BoosterPurchaseRow[] = []
  for (const item of result.Items ?? []) {
    const parsed = boosterPurchaseRowSchema.safeParse(item)
    if (!parsed.success) {
      console.warn(
        `[business] queryBoosterPurchasesByTimeRange: skipping malformed BoosterPurchase row sk=${String(item['sk'])}: ${parsed.error.message}`,
      )
      continue
    }
    items.push(parsed.data)
  }

  return {
    items,
    nextCursor: encodeCursor(result.LastEvaluatedKey as Record<string, unknown> | undefined),
  }
}

export async function getBoosterCheckoutMarker(yocoCheckoutId: string): Promise<BoosterCheckoutMarkerRow | null> {
  const key = `BOOST_CHECKOUT#${yocoCheckoutId}`
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: key, sk: key },
    }),
  )
  if (!result.Item) return null

  const parsed = boosterCheckoutMarkerRowSchema.safeParse(result.Item)
  if (!parsed.success) {
    console.warn(
      `[business] getBoosterCheckoutMarker: malformed Idempotency_Marker for yocoCheckoutId=${yocoCheckoutId}: ${parsed.error.message}`,
    )
    return null
  }
  return parsed.data
}

// Follow-up `GetItem` companion for `getBoosterCheckoutMarker`. The service
// layer's `getBoosterPurchaseByYocoCheckoutId` (task 6.2) reads the marker,
// then uses its stored `boostPk` / `boostSk` to retrieve the audit row.
// Exposed here so the service layer does not need to import `documentClient`
// directly.
export async function getBoosterPurchaseByKey(boostPk: string, boostSk: string): Promise<BoosterPurchaseRow | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: boostPk, sk: boostSk },
    }),
  )
  if (!result.Item) return null

  const parsed = boosterPurchaseRowSchema.safeParse(result.Item)
  if (!parsed.success) {
    console.warn(
      `[business] getBoosterPurchaseByKey: malformed BoosterPurchase row pk=${boostPk} sk=${boostSk}: ${parsed.error.message}`,
    )
    return null
  }
  return parsed.data
}
