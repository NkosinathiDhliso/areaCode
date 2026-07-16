// DynamoDB-backed Business Repository (replaces Prisma)
import { randomBytes } from 'node:crypto'

import type { AudienceAnalytics, BusinessMusicAudience, LiveStats, MusicGenre } from '@area-code/shared/types'
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'

import { requireEnv } from '../../shared/config/env.js'
import { documentClient, TableNames, isConditionalCheckFailedError } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { kvGet } from '../../shared/kv/dynamodb-kv.js'
import {
  getBusinessById as getBusinessDynamo,
  getBusinessByCognitoSub,
  updateBusiness,
  getStaffByBusinessId,
} from '../auth/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'
import { analyzeCrowdComposition } from '../reports/analyzers/crowd-composition.js'
import { analyzeMusicProfile } from '../reports/analyzers/music-profile.js'
import { analyzePeakHours } from '../reports/analyzers/peak-hours.js'
import { anonymizeCheckIns, type RawCheckIn } from '../reports/anonymize.js'
import type { MusicPrefs } from '../reports/types.js'

import { listRedemptionsForBusiness } from './staff-leaderboard.js'
import {
  boostFloorRowSchema,
  boosterCheckoutMarkerRowSchema,
  boosterPurchaseRowSchema,
  floorChangeAuditRowSchema,
  subscriptionPaymentRowSchema,
  subCheckoutMarkerRowSchema,
  type BoostDuration,
  type BoostFloorRow,
  type BoosterCheckoutMarkerRow,
  type BoosterPurchaseRow,
  type FloorChangeAuditRow,
  type PaidInterval,
  type SubscriptionPaymentRow,
  type SubCheckoutMarkerRow,
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

// Admin comp write (cross-portal-lifecycle-alignment R1). A comp is a paid
// window whose "payment" is Area Code goodwill: it writes Paid_Until directly so
// the Tier_Resolver (getEffectiveTier) honours it with no resolver branch and no
// new attribute (the Comp_Window IS Paid_Until). `paidInterval` stays null (no
// interval was bought, so the pre-lapse renewal reminder skips it); trial and
// grace are cleared so no stale window lingers. For starter, `paidUntil` is null
// so the business reads as starter. Mirrors `activateSubscriptionOnBusiness` so
// the businesses table keeps a single write home (dry-reuse-no-duplication).
export async function setBusinessCompWindow(
  businessId: string,
  tier: 'starter' | 'growth' | 'pro',
  paidUntil: string | null,
) {
  return updateBusiness(businessId, {
    tier,
    paidUntil,
    paidInterval: null,
    trialEndsAt: null,
    paymentGraceUntil: null,
  })
}

export async function setPaymentGrace(id: string, until: string | null) {
  return updateBusiness(id, { paymentGraceUntil: until } as any)
}

// Weekly Attribution Digest opt-out (weekly-attribution-digest R4.5). Persists
// the `digestEmailOptOut` flag on the Business_Row through the single shared
// `updateBusiness` write path (dry-reuse-no-duplication) so the report
// generator's `business?.digestEmailOptOut` read is backed from the next
// weekly run. Returns the updated account (or null when the id is unknown).
export async function setDigestEmailOptOut(id: string, optOut: boolean) {
  return updateBusiness(id, { digestEmailOptOut: optOut })
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

// Businesses currently INSIDE the renewal grace window (cross-portal-lifecycle
// -alignment R2.2): `paymentGraceUntil` present and still in the future at
// `nowIso`. This is the inverse of `listBusinessesWithLapsedGrace` (which finds
// grace that has already passed for demotion). Projection only (id, name, tier,
// grace expiry), sorted soonest-expiry-first so the admin Grace_List leads with
// who lapses next. Paginated Scan, mirroring the sibling grace query.
export async function listBusinessesInGraceProjection(
  nowIso: string,
): Promise<Array<{ businessId: string; businessName: string; tier: string; paymentGraceUntil: string }>> {
  const rows: Array<{ businessId: string; businessName: string; tier: string; paymentGraceUntil: string }> = []
  let cursor: Record<string, unknown> | undefined
  do {
    const params: Record<string, unknown> = {
      TableName: TableNames.businesses,
      FilterExpression: 'attribute_exists(paymentGraceUntil) AND paymentGraceUntil > :now',
      ExpressionAttributeValues: { ':now': nowIso },
      ProjectionExpression: 'businessId, businessName, tier, paymentGraceUntil',
    }
    if (cursor) params['ExclusiveStartKey'] = cursor
    const result = await documentClient.send(new ScanCommand(params as any))
    for (const item of result.Items ?? []) {
      const businessId = item['businessId']
      const paymentGraceUntil = item['paymentGraceUntil']
      if (typeof businessId === 'string' && typeof paymentGraceUntil === 'string') {
        rows.push({
          businessId,
          businessName: (item['businessName'] as string) ?? '',
          tier: (item['tier'] as string) ?? 'free',
          paymentGraceUntil,
        })
      }
    }
    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)
  rows.sort((a, b) => a.paymentGraceUntil.localeCompare(b.paymentGraceUntil))
  return rows
}

export async function deactivateBusiness(id: string) {
  return updateBusiness(id, { tier: 'free', isActive: false } as any)
}

// Staff management
export async function countStaffForBusiness(businessId: string) {
  const staff = await getStaffByBusinessId(businessId)
  return staff.filter((s: any) => s.isActive !== false).length
}

export async function createStaffInvite(businessId: string, email: string, role: 'manager' | 'staff' = 'staff') {
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
    invitedEmail: email,
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

// Delete a pending invite. Conditioned on the invite belonging to this business
// and not yet accepted, so one business cannot revoke another's invite and an
// already-accepted invite (a live staff account) cannot be silently dropped.
// Returns { count: 0 } when nothing matched so the caller can surface notFound.
export async function deleteStaffInvite(businessId: string, token: string) {
  try {
    await documentClient.send(
      new DeleteCommand({
        TableName: TableNames.appData,
        Key: { pk: `STAFF_INVITE#${token}`, sk: `STAFF_INVITE#${token}` },
        ConditionExpression: 'businessId = :bid AND accepted = :false',
        ExpressionAttributeValues: { ':bid': businessId, ':false': false },
      }),
    )
  } catch (err) {
    if (isConditionalCheckFailedError(err)) return { count: 0 }
    throw err
  }
  return { count: 1 }
}

export async function removeStaffAccount(id: string, businessId: string) {
  // Soft-delete both rows that represent a staff member: the profile row
  // (STAFF#{id} / PROFILE#{id}, read by getStaffById) and the business-list
  // row (BIZ_STAFF#{businessId} / STAFF#{id}, read by getStaffByBusinessId).
  // The previous key (STAFF#{id} / BIZ#{businessId}) matched neither, so
  // removal silently deactivated nothing. Conditioned on the profile row
  // existing so the caller's notFound guard is real.
  try {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TableNames.appData,
              Key: { pk: `STAFF#${id}`, sk: `PROFILE#${id}` },
              UpdateExpression: 'SET isActive = :inactive',
              ConditionExpression: 'attribute_exists(pk)',
              ExpressionAttributeValues: { ':inactive': false },
            },
          },
          {
            Update: {
              TableName: TableNames.appData,
              Key: { pk: `BIZ_STAFF#${businessId}`, sk: `STAFF#${id}` },
              UpdateExpression: 'SET isActive = :inactive',
              ExpressionAttributeValues: { ':inactive': false },
            },
          },
        ],
      }),
    )
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException') {
      return { count: 0 }
    }
    throw err
  }
  return { count: 1 }
}

// Webhook events (Yoco idempotency)
type WebhookEventStatus = 'processing' | 'processed' | 'failed'
export type WebhookClaimResult = 'claimed' | 'processed' | 'processing'

const WEBHOOK_TTL_SECONDS = 30 * 24 * 60 * 60

function webhookKey(eventId: string) {
  const key = `WEBHOOK#${eventId}`
  return { pk: key, sk: key }
}

async function getWebhookEventStatus(eventId: string): Promise<WebhookEventStatus | 'legacy_processed' | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: webhookKey(eventId),
      ConsistentRead: true,
      ProjectionExpression: 'pk, #status',
      ExpressionAttributeNames: { '#status': 'status' },
    }),
  )
  if (!result.Item) return null
  const status = result.Item['status']
  if (status === 'processing' || status === 'processed' || status === 'failed') return status

  // Rows written by the former write-once idempotency path have no status.
  // Their presence proves the event already completed, so never process it again.
  return 'legacy_processed'
}

export async function claimWebhookEvent(eventId: string, eventType: string): Promise<WebhookClaimResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const now = new Date().toISOString()
    try {
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.appData,
          Key: webhookKey(eventId),
          UpdateExpression:
            'SET eventId = :eventId, eventType = :eventType, #status = :processing, ' +
            'createdAt = if_not_exists(createdAt, :now), updatedAt = :now, #ttl = :ttl ' +
            'REMOVE processedAt, failedAt, failureMessage',
          ConditionExpression: 'attribute_not_exists(pk) OR #status = :failed',
          ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':eventId': eventId,
            ':eventType': eventType,
            ':processing': 'processing',
            ':failed': 'failed',
            ':now': now,
            ':ttl': Math.floor(Date.now() / 1000) + WEBHOOK_TTL_SECONDS,
          },
        }),
      )
      return 'claimed'
    } catch (err) {
      if (!isConditionalCheckFailedError(err)) throw err
    }

    const status = await getWebhookEventStatus(eventId)
    if (status === 'processed' || status === 'legacy_processed') return 'processed'
    if (status !== 'failed') return 'processing'
  }
  return 'processing'
}

export async function markWebhookEventProcessed(eventId: string): Promise<void> {
  const now = new Date().toISOString()
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: webhookKey(eventId),
      UpdateExpression:
        'SET #status = :processed, processedAt = :now, updatedAt = :now, #ttl = :ttl ' +
        'REMOVE failedAt, failureMessage',
      ConditionExpression: '#status = :processing',
      ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':processing': 'processing',
        ':processed': 'processed',
        ':now': now,
        ':ttl': Math.floor(Date.now() / 1000) + WEBHOOK_TTL_SECONDS,
      },
    }),
  )
}

export async function markWebhookEventFailed(eventId: string, failureMessage: string): Promise<void> {
  const now = new Date().toISOString()
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: webhookKey(eventId),
      UpdateExpression:
        'SET #status = :failed, failedAt = :now, updatedAt = :now, failureMessage = :failureMessage, #ttl = :ttl',
      ConditionExpression: '#status = :processing',
      ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':processing': 'processing',
        ':failed': 'failed',
        ':now': now,
        ':failureMessage': failureMessage,
        ':ttl': Math.floor(Date.now() / 1000) + WEBHOOK_TTL_SECONDS,
      },
    }),
  )
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
  const nodeIds = (nodesResult.Items || []).map((n) => n['nodeId'] as string)
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

/**
 * SAST is UTC+2. Start of the current SAST calendar day expressed as a UTC ISO
 * string, used to count "same-day" redemptions. Mirrors the SAST day-boundary
 * arithmetic used by streaks / pulse-decay (00:00 SAST = 22:00 UTC prev day).
 */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
function startOfSastDayIso(now: number = Date.now()): string {
  const sastDayStr = new Date(now + SAST_OFFSET_MS).toISOString().slice(0, 10)
  return new Date(new Date(`${sastDayStr}T00:00:00Z`).getTime() - SAST_OFFSET_MS).toISOString()
}

export async function getLiveStats(businessId: string): Promise<LiveStats> {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodes = (nodesResult.Items || []).map((n) => ({
    nodeId: n['nodeId'] as string,
    cityId: n['cityId'] as string | undefined,
  }))

  let checkInsToday = 0
  let totalCheckIns = 0
  // Headline pulseScore is the MAX per-node decaying pulse (the business's
  // most-alive venue), never a sum: a sum would break the 0-N scale the
  // consumer map uses for a single node (Req 1.2). Genuine absence of every
  // node's pulse row stays `null` -- never a fabricated 0 (Req 1.4).
  let maxPulse: number | null = null
  for (const { nodeId, cityId } of nodes) {
    const { checkIns: todayCIs } = await getCheckInsByNode(nodeId, { hours: 24 })
    checkInsToday += todayCIs.length
    const { checkIns: allCIs } = await getCheckInsByNode(nodeId, {})
    totalCheckIns += allCIs.length

    // Reuse the same pulse KV read path the consumer map / pulse-decay worker
    // use (`pulse:{cityId}:{nodeId}`). No silent catch: a KV failure must
    // surface, not degrade into a fake 0 (no-fallbacks-no-legacy).
    if (cityId) {
      const scoreStr = await kvGet(`pulse:${cityId}:${nodeId}`)
      if (scoreStr !== null) {
        const score = parseFloat(scoreStr)
        if (!Number.isNaN(score)) {
          maxPulse = maxPulse === null ? score : Math.max(maxPulse, score)
        }
      }
    }
  }

  // rewardsClaimed: real count of REDEMPTION# rows for this business redeemed
  // on the current SAST day. Reuses the single redemption read path
  // (`listRedemptionsForBusiness`) rather than a second REDEMPTION# scan.
  const redemptions = await listRedemptionsForBusiness(businessId, startOfSastDayIso())
  const rewardsClaimed = redemptions.length

  return { checkInsToday, rewardsClaimed, pulseScore: maxPulse, totalCheckIns }
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
  return (result.Items || []).map((n) => ({ ...n, id: n['nodeId'] }))
}

// ─── Audience Analytics ─────────────────────────────────────────────────────

// Same anonymization salt the report pipeline uses (generator.ts). Dashboard
// visitor tokens are ephemeral — never persisted, never returned to a client —
// but deriving them through the one shared salt keeps token generation in a
// single home (dry-reuse-no-duplication) and requireEnv crashes prod if the
// var is unset rather than masking it with a default (no-fallbacks-no-legacy).
const AUDIENCE_ANONYMIZATION_SALT = requireEnv('AREA_CODE_ANONYMIZATION_SALT', 'dev-anonymization-salt')

/**
 * Load user tiers via BatchGetItem, mirroring the report generator's
 * `loadUserData` projection (dry-reuse-no-duplication). Returns userId -> tier.
 * BatchGetItem caps at 100 keys per request. Reads that back a metric must
 * surface failure rather than degrade to a silent default (no-fallbacks): the
 * only default here is the base `local` tier for a genuinely tier-less user
 * row, matching the generator's `?? 'local'`.
 */
async function loadUserTiers(userIds: string[]): Promise<Map<string, string>> {
  const tierByUser = new Map<string, string>()
  const batchSize = 100
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize)
    const result = await documentClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TableNames.users]: {
            Keys: batch.map((userId) => ({ userId })),
            ProjectionExpression: 'userId, tier',
          },
        },
      }),
    )
    const items = result.Responses?.[TableNames.users] ?? []
    for (const item of items) {
      const userId = item['userId'] as string
      tierByUser.set(userId, (item['tier'] as string) ?? 'local')
    }
  }
  return tierByUser
}

/**
 * Format a peak-hours analyzer window as the "HH:00-HH:00" range string the
 * Audience panel renders. `endHour` is the last full hour in the window, so the
 * label's end is exclusive: hours 18,19,20 -> "18:00-21:00".
 */
function formatPeakWindow(window: { startHour: number; endHour: number }): string {
  const pad = (h: number) => String(h).padStart(2, '0')
  return `${pad(window.startHour)}:00-${pad((window.endHour + 1) % 24)}:00`
}

/**
 * Load every check-in for a node, paginating past the per-page limit. The
 * dashboard repeat/new definition (Req 2.1) needs the whole distinct-user
 * history, not a single 50-row page.
 */
async function loadAllCheckInsForNode(nodeId: string): Promise<Array<{ userId: string; checkedInAt: string }>> {
  const all: Array<{ userId: string; checkedInAt: string }> = []
  let cursor: string | undefined
  do {
    const { checkIns, nextCursor } = await getCheckInsByNode(nodeId, { limit: 100, cursor })
    for (const ci of checkIns) {
      all.push({ userId: ci.userId, checkedInAt: ci.checkedInAt })
    }
    cursor = nextCursor
  } while (cursor)
  return all
}

export async function getAudienceAnalytics(businessId: string): Promise<AudienceAnalytics> {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodes = (nodesResult.Items || []).map((n) => ({
    nodeId: n['nodeId'] as string,
  }))

  // Load the full check-in history for every business node.
  const rawCheckIns: Array<{ userId: string; nodeId: string; checkedInAt: string }> = []
  for (const { nodeId } of nodes) {
    const nodeCheckIns = await loadAllCheckInsForNode(nodeId)
    for (const ci of nodeCheckIns) {
      rawCheckIns.push({ userId: ci.userId, nodeId, checkedInAt: ci.checkedInAt })
    }
  }

  // repeatVsNew — dashboard definition (Req 2.1): a distinct user with more than
  // one check-in is "repeat"; a distinct user with exactly one is "new".
  // Computed directly from the loaded history by grouping distinct users, NOT
  // via the report's cross-period token intersection (analyzeRepeatVisitors),
  // which answers a different question and depends on per-period token salting.
  const checkInsByUser = new Map<string, number>()
  for (const ci of rawCheckIns) {
    checkInsByUser.set(ci.userId, (checkInsByUser.get(ci.userId) ?? 0) + 1)
  }
  const totalUniqueVisitors = checkInsByUser.size
  let repeat = 0
  let newVisitors = 0
  for (const count of checkInsByUser.values()) {
    if (count > 1) repeat += 1
    else newVisitors += 1
  }

  // Enrich with tier (BatchGet users, mirror generator loadUserData) so the
  // reused analyzers see each visitor's real tier.
  const tierByUser = await loadUserTiers([...checkInsByUser.keys()])
  const enriched: RawCheckIn[] = rawCheckIns.map((ci) => ({
    userId: ci.userId,
    nodeId: ci.nodeId,
    tier: tierByUser.get(ci.userId) ?? 'local',
    checkedInAt: ci.checkedInAt,
  }))

  // Reuse the report analyzers for tierDistribution and peakHours
  // (dry-reuse-no-duplication, Req 2.4). anonymizeCheckIns also performs the
  // SAST hour/day conversion the peak-hours analyzer expects.
  const anonymized = anonymizeCheckIns(enriched, AUDIENCE_ANONYMIZATION_SALT)
  const crowd = analyzeCrowdComposition(anonymized)
  const peaks = analyzePeakHours(anonymized)

  // Below the display threshold each group is null (Req 2.5) so the Audience
  // panel renders its honest "not enough data yet" state instead of zeroed or
  // partial numbers. tierDistribution/peakHours key off the analyzers'
  // hasInsufficientData flags; repeatVsNew reuses the crowd-composition
  // visitor-count gate so all three groups appear/disappear together.
  return {
    totalUniqueVisitors,
    repeatVsNew: crowd.hasInsufficientData ? null : { repeat, new: newVisitors },
    tierDistribution: crowd.hasInsufficientData ? null : crowd.tierPercentages,
    peakHours: peaks.hasInsufficientData ? null : peaks.topWindows.map(formatPeakWindow),
  }
}

// ─── Music Audience ─────────────────────────────────────────────────────────

/**
 * Load user music preferences via BatchGetItem, mirroring the report
 * generator's `loadUserData` music-prefs projection (dry-reuse-no-duplication).
 * Returns userId -> MusicPrefs only for users who have declared genres; a user
 * with no genres has no music preference to aggregate and is omitted. The `?? 50`
 * dimension defaults match the generator so both pipelines see identical prefs.
 */
async function loadUserMusicPrefs(userIds: string[]): Promise<Map<string, MusicPrefs>> {
  const prefsByUser = new Map<string, MusicPrefs>()
  const batchSize = 100
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize)
    const result = await documentClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TableNames.users]: {
            Keys: batch.map((userId) => ({ userId })),
            ProjectionExpression:
              'userId, musicGenres, energy, cultural_rootedness, sophistication, edge, spirituality',
          },
        },
      }),
    )
    const items = result.Responses?.[TableNames.users] ?? []
    for (const item of items) {
      const userId = item['userId'] as string
      const genres = item['musicGenres'] as string[] | undefined
      if (genres && genres.length > 0) {
        prefsByUser.set(userId, {
          energy: (item['energy'] as number) ?? 50,
          cultural_rootedness: (item['cultural_rootedness'] as number) ?? 50,
          sophistication: (item['sophistication'] as number) ?? 50,
          edge: (item['edge'] as number) ?? 50,
          spirituality: (item['spirituality'] as number) ?? 50,
          genres,
        })
      }
    }
  }
  return prefsByUser
}

export async function getMusicAudience(businessId: string): Promise<BusinessMusicAudience> {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodes = (nodesResult.Items || []).map((n) => ({ nodeId: n['nodeId'] as string }))

  // Gather the period's visitors across every business node (same read path as
  // getAudienceAnalytics). tier is irrelevant to the music profiler, so a base
  // value keeps the RawCheckIn shape valid without an extra tier BatchGet.
  const rawCheckIns: RawCheckIn[] = []
  for (const { nodeId } of nodes) {
    const nodeCheckIns = await loadAllCheckInsForNode(nodeId)
    for (const ci of nodeCheckIns) {
      rawCheckIns.push({ userId: ci.userId, nodeId, tier: 'local', checkedInAt: ci.checkedInAt })
    }
  }

  // Derive anonymized visitor tokens through the one shared salt so token
  // generation stays consistent with getAudienceAnalytics (dry-reuse).
  const anonymized = anonymizeCheckIns(rawCheckIns, AUDIENCE_ANONYMIZATION_SALT)
  const visitorTokens = [...new Set(anonymized.map((ci) => ci.visitorToken))]

  // Load each distinct visitor's music prefs and key them by the anonymized
  // token, exactly as the generator does before calling analyzeMusicProfile.
  const uniqueUserIds = [...new Set(rawCheckIns.map((ci) => ci.userId))]
  const prefsByUser = await loadUserMusicPrefs(uniqueUserIds)
  const musicPrefsMap = new Map<string, MusicPrefs>()
  for (let i = 0; i < rawCheckIns.length; i++) {
    const prefs = prefsByUser.get(rawCheckIns[i]!.userId)
    if (prefs) musicPrefsMap.set(anonymized[i]!.visitorToken, prefs)
  }
  const totalWithMusicPrefs = musicPrefsMap.size

  // Reuse the report's music-profile analyzer for genre/archetype aggregation
  // (dry-reuse-no-duplication, Req 3.2). It already gates on the minimum
  // visitors-with-prefs (5) and returns hasInsufficientData (Req 3.3).
  const profile = analyzeMusicProfile(visitorTokens, musicPrefsMap)

  // Below the analyzer's min-data gate: honest insufficient-data state (Req 3.3)
  // so MusicInsightsSection shows its "not enough music data" state instead of a
  // stubbed permanent empty. Never a fabricated non-empty distribution.
  if (profile.hasInsufficientData) {
    return {
      hasInsufficientData: true,
      totalWithMusicPrefs,
      genreDistribution: {},
      archetypeBreakdown: {},
      peakArchetypeByTime: [],
    }
  }

  // Map analyzer output to the wire shape (Req 3.1). genreDistribution and
  // archetypeBreakdown are whole-number percentages, matching how
  // MusicInsightsSection renders them ("{count}%"). Genre percentages are the
  // share of visitors-with-prefs who list each genre; dimension averages are
  // already on a 0-100 scale (generator defaults each dimension to 50).
  const genreDistribution: Partial<Record<MusicGenre, number>> = {}
  for (const { genre, visitorCount } of profile.topGenres) {
    genreDistribution[genre as MusicGenre] = Math.round((visitorCount / totalWithMusicPrefs) * 100)
  }

  const archetypeBreakdown: Record<string, number> = {}
  for (const [dimension, avgScore] of Object.entries(profile.archetypeDimensions)) {
    archetypeBreakdown[dimension] = Math.round(avgScore)
  }

  return {
    hasInsufficientData: false,
    totalWithMusicPrefs,
    genreDistribution,
    archetypeBreakdown,
    // analyzeMusicProfile produces no per-time-segment archetypes and this task
    // reuses that analyzer rather than reimplementing a second aggregation, so
    // peakArchetypeByTime stays empty rather than fabricated.
    peakArchetypeByTime: [],
  }
}

// ─── Recent Redemptions ─────────────────────────────────────────────────────

export async function getRecentRedemptions(businessId: string) {
  return listRedemptionsForBusiness(businessId, '1970-01-01T00:00:00.000Z', 20)
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

export async function getRewardMetrics(rewardId: string, _businessId: string) {
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
  const nodeIds = (nodesResult.Items || []).map((n) => n['nodeId'] as string)
  const allRewards = []
  for (const nid of nodeIds) {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.rewards,
        FilterExpression: 'nodeId = :nid',
        ExpressionAttributeValues: { ':nid': nid },
      }),
    )
    allRewards.push(...(result.Items || []).map((r) => ({ ...r, id: r['rewardId'] })))
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

// ─── Subscription payment write (marker-first choreography) ──────────────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md` Flow 1.
//
// Mirrors `putBoosterPurchaseWithMarker` exactly so the codebase keeps one
// idempotency idiom (R2.2). Two conditional puts:
//
//   1. PutItem the `SUB_CHECKOUT#<yocoCheckoutId>` marker with
//      `attribute_not_exists(pk)` so a redelivered checkout id (even with a
//      fresh Yoco `eventId`) is detected as a duplicate and never activates a
//      second window (R2.4).
//   2. PutItem the `SUB#<businessId>` audit row with `attribute_not_exists(pk)`
//      so a rare collision on (paidAt-millisecond, yocoCheckoutId) for two
//      different events still can't silently overwrite an existing row.
//
// On any non-conditional failure of step 2, best-effort `DeleteItem` the marker
// so a Yoco retry can re-attempt cleanly. If the compensating delete itself
// fails, we log and re-throw the *original* error anyway — the next Yoco retry
// will land on the existing marker and be treated as a duplicate, which is safe
// because no purchase row was ever written.

export async function putSubscriptionPaymentWithMarker(args: {
  purchase: SubscriptionPaymentRow
  marker: SubCheckoutMarkerRow
}): Promise<{ result: 'written' | 'duplicate' }> {
  const { purchase, marker } = args

  // Step 1: write the idempotency marker first. R2.4.
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
      // Marker already exists → same yocoCheckoutId already persisted. R2.4.
      return { result: 'duplicate' }
    }
    throw err
  }

  // Step 2: write the Subscription_Payment_Row audit row.
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
      // of truth for this yocoCheckoutId. Treat as duplicate.
      return { result: 'duplicate' }
    }

    // Non-conditional failure of the purchase write. Best-effort compensating
    // delete of the marker so a Yoco retry can re-attempt cleanly.
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
        `[business] putSubscriptionPaymentWithMarker: compensating marker delete failed for marker.pk=${marker.pk}: ${String(deleteErr)}`,
      )
    }
    throw err
  }
}

// ─── Subscription payment reads ─────────────────────────────────────────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md` access-pattern table:
//
// - Business history (R7.5): `Query` `pk='SUB#<businessId>'` with
//   `ScanIndexForward=false` so the natural sort-order (by `paidAt` embedded in
//   `sk`) yields newest-first.
// - Admin date-range across all businesses (R8.1): `Query` GSI1 with
//   `gsi1pk='SUB_BY_TIME'` and `gsi1sk BETWEEN :from AND :to`, newest-first to
//   match the admin boost report pagination semantics.
//
// All reads Zod-parse with `safeParse`; on parse failure we log and skip the
// offending row so one malformed row cannot bring down a whole page, consistent
// with the BoosterPurchase query helpers. Cursors reuse the shared
// `decodeCursor` (throws `MalformedCursorError` for the handler to map to 400).

export async function querySubscriptionPaymentsForBusiness(
  businessId: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: SubscriptionPaymentRow[]; nextCursor: string | null }> {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `SUB#${businessId}` },
    ScanIndexForward: false, // newest-first (R7.5)
    Limit: limit,
  }
  if (cursor) {
    ;(params as { ExclusiveStartKey?: Record<string, unknown> }).ExclusiveStartKey = decodeCursor(cursor)
  }

  const result = await documentClient.send(new QueryCommand(params as any))
  const items: SubscriptionPaymentRow[] = []
  for (const item of result.Items ?? []) {
    const parsed = subscriptionPaymentRowSchema.safeParse(item)
    if (!parsed.success) {
      console.warn(
        `[business] querySubscriptionPaymentsForBusiness: skipping malformed Subscription_Payment_Row sk=${String(item['sk'])}: ${parsed.error.message}`,
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

export async function querySubscriptionPaymentsByTimeRange(
  fromIso: string,
  toIso: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: SubscriptionPaymentRow[]; nextCursor: string | null }> {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    IndexName: 'GSI1',
    KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk BETWEEN :from AND :to',
    ExpressionAttributeValues: {
      ':pk': 'SUB_BY_TIME',
      ':from': fromIso,
      ':to': toIso,
    },
    ScanIndexForward: false, // newest-first to match admin boost report semantics (R8.1)
    Limit: limit,
  }
  if (cursor) {
    ;(params as { ExclusiveStartKey?: Record<string, unknown> }).ExclusiveStartKey = decodeCursor(cursor)
  }

  const result = await documentClient.send(new QueryCommand(params as any))
  const items: SubscriptionPaymentRow[] = []
  for (const item of result.Items ?? []) {
    const parsed = subscriptionPaymentRowSchema.safeParse(item)
    if (!parsed.success) {
      console.warn(
        `[business] querySubscriptionPaymentsByTimeRange: skipping malformed Subscription_Payment_Row sk=${String(item['sk'])}: ${parsed.error.message}`,
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

export async function getSubCheckoutMarker(yocoCheckoutId: string): Promise<SubCheckoutMarkerRow | null> {
  const key = `SUB_CHECKOUT#${yocoCheckoutId}`
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: key, sk: key },
    }),
  )
  if (!result.Item) return null

  const parsed = subCheckoutMarkerRowSchema.safeParse(result.Item)
  if (!parsed.success) {
    console.warn(
      `[business] getSubCheckoutMarker: malformed Sub_Checkout_Marker for yocoCheckoutId=${yocoCheckoutId}: ${parsed.error.message}`,
    )
    return null
  }
  return parsed.data
}

// Point read of a Subscription_Payment_Row by its stored key, following a
// `getSubCheckoutMarker` hit. Mirrors `getBoosterPurchaseByKey`: the replay
// reconciliation branch (design Flow 1) reads the existing row's
// `paidUntilProduced` so it can re-assert the Business_Row state with the exact
// window the original payment produced, never a second extension. Exposed here
// so the service layer never imports `documentClient` directly.
export async function getSubscriptionPaymentByKey(
  subPk: string,
  subSk: string,
): Promise<SubscriptionPaymentRow | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: subPk, sk: subSk },
    }),
  )
  if (!result.Item) return null

  const parsed = subscriptionPaymentRowSchema.safeParse(result.Item)
  if (!parsed.success) {
    console.warn(
      `[business] getSubscriptionPaymentByKey: malformed Subscription_Payment_Row pk=${subPk} sk=${subSk}: ${parsed.error.message}`,
    )
    return null
  }
  return parsed.data
}

// ─── Subscription activation on the Business_Row ─────────────────────────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md` Flow 1 step 5.
//
// A single UpdateItem that both grants the paid window and clears the two
// windows that would otherwise demote or double-count the business: the trial
// (`trialEndsAt`) and any renewal grace (`paymentGraceUntil`). Doing it in one
// write means a freshly-paid business can never be read mid-transition (still
// "on trial" or still "in grace") by a concurrent read path.
//
// Delegates to the one business-update path (`updateBusinessTier` and
// `setPaymentGrace` do the same) so the businesses table keeps a single write
// home (dry-reuse-no-duplication). `updateBusiness` filters only `undefined`,
// so the explicit `null`s here are written as DynamoDB NULL — which is exactly
// how the lapse and tier-resolver read paths expect a cleared window.
export async function activateSubscriptionOnBusiness(
  businessId: string,
  args: { tier: string; paidUntil: string; paidInterval: PaidInterval },
) {
  return updateBusiness(businessId, {
    tier: args.tier,
    paidUntil: args.paidUntil,
    paidInterval: args.paidInterval,
    trialEndsAt: null,
    paymentGraceUntil: null,
  })
}

// ─── Lapsed paid-window sweep source ─────────────────────────────────────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md` Flow 3, phase 1.
//
// Businesses whose paid subscription window has lapsed and that have NOT yet
// entered the renewal grace window. Consumed by the daily Lapse_Sweep
// (business/service.ts) to set `paymentGraceUntil = now + 7d` and send one
// renewal email, before the existing `listBusinessesWithLapsedGrace` demotes
// anyone whose grace has itself passed.
//
// Match criteria (R3.1):
//   - a paid tier (growth / pro / payg),
//   - `paidUntil` present and in the past,
//   - no grace window set,
//   - no active trial.
// Grace and trial are matched against both "absent" AND "NULL" because
// `activateSubscriptionOnBusiness` clears them to DynamoDB NULL rather than
// removing the attribute; a NULL fails the `< :now` comparison (type mismatch),
// so it must be caught explicitly with `= :null`.
//
// Paginated Scan, mirroring `listBusinessesWithLapsedGrace`. Returns the fields
// the sweep needs to both set grace and address the renewal email, so the sweep
// avoids a second GetItem per business. Business volume is small and this stays
// PAY_PER_REQUEST, matching the existing scan pattern.
export async function listBusinessesWithLapsedPaidUntil(nowIso: string): Promise<
  Array<{
    businessId: string
    email: string
    businessName: string
    paidUntil: string
    paidInterval: string | null
  }>
> {
  const rows: Array<{
    businessId: string
    email: string
    businessName: string
    paidUntil: string
    paidInterval: string | null
  }> = []
  let cursor: Record<string, unknown> | undefined
  do {
    const params: Record<string, unknown> = {
      TableName: TableNames.businesses,
      FilterExpression:
        '#tier IN (:growth, :pro, :payg) AND ' +
        'attribute_exists(paidUntil) AND paidUntil < :now AND ' +
        '(attribute_not_exists(paymentGraceUntil) OR paymentGraceUntil = :null) AND ' +
        '(attribute_not_exists(trialEndsAt) OR trialEndsAt = :null OR trialEndsAt < :now)',
      ExpressionAttributeNames: { '#tier': 'tier' },
      ExpressionAttributeValues: {
        ':now': nowIso,
        ':growth': 'growth',
        ':pro': 'pro',
        ':payg': 'payg',
        ':null': null,
      },
      ProjectionExpression: 'businessId, email, businessName, paidUntil, paidInterval',
    }
    if (cursor) params['ExclusiveStartKey'] = cursor
    const result = await documentClient.send(new ScanCommand(params as any))
    for (const item of result.Items ?? []) {
      const businessId = item['businessId']
      const email = item['email']
      const businessName = item['businessName']
      const paidUntil = item['paidUntil']
      if (
        typeof businessId === 'string' &&
        typeof email === 'string' &&
        typeof businessName === 'string' &&
        typeof paidUntil === 'string'
      ) {
        rows.push({
          businessId,
          email,
          businessName,
          paidUntil,
          paidInterval: typeof item['paidInterval'] === 'string' ? item['paidInterval'] : null,
        })
      }
    }
    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)
  return rows
}

// ─── Pre-lapse renewal reminder source ───────────────────────────────────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md`: "trial-reminder worker
// gains the renewal-reminder query (paid tier, `paidUntil` within 7 days,
// interval monthly/yearly, one send per window recorded on the row as
// `renewalReminderSentFor = paidUntil`)".
//
// Businesses due a pre-lapse renewal reminder (R3.4). Match criteria:
//   - a paid tier (growth / pro / payg),
//   - `paidInterval` is `monthly` or `yearly` (NO pre-lapse reminder for
//     `daily` / `weekly` — those windows are too short for a 7-day lead),
//   - `paidUntil` present, still in the future, and within `windowEndIso`
//     (i.e. `now < paidUntil <= now + 7d`),
//   - not already reminded for THIS window: `renewalReminderSentFor` is absent
//     or differs from the current `paidUntil`. A renewal extends `paidUntil`,
//     so the new window's value differs and re-arms the reminder — exactly one
//     email per paid window.
//
// Paginated Scan, mirroring `listBusinessesWithLapsedPaidUntil`. Returns the
// fields the sweep needs to address the email and set the dedup marker, so the
// sweep avoids a second GetItem per business. Business volume is small and this
// stays PAY_PER_REQUEST, matching the existing scan pattern.
export async function listBusinessesForRenewalReminder(
  nowIso: string,
  windowEndIso: string,
): Promise<
  Array<{
    businessId: string
    email: string
    businessName: string
    paidUntil: string
    paidInterval: string
  }>
> {
  const rows: Array<{
    businessId: string
    email: string
    businessName: string
    paidUntil: string
    paidInterval: string
  }> = []
  let cursor: Record<string, unknown> | undefined
  do {
    const params: Record<string, unknown> = {
      TableName: TableNames.businesses,
      FilterExpression:
        '#tier IN (:growth, :pro, :payg) AND ' +
        'paidInterval IN (:monthly, :yearly) AND ' +
        'attribute_exists(paidUntil) AND paidUntil > :now AND paidUntil <= :windowEnd AND ' +
        '(attribute_not_exists(renewalReminderSentFor) OR renewalReminderSentFor <> paidUntil)',
      ExpressionAttributeNames: { '#tier': 'tier' },
      ExpressionAttributeValues: {
        ':now': nowIso,
        ':windowEnd': windowEndIso,
        ':growth': 'growth',
        ':pro': 'pro',
        ':payg': 'payg',
        ':monthly': 'monthly',
        ':yearly': 'yearly',
      },
      ProjectionExpression: 'businessId, email, businessName, paidUntil, paidInterval',
    }
    if (cursor) params['ExclusiveStartKey'] = cursor
    const result = await documentClient.send(new ScanCommand(params as any))
    for (const item of result.Items ?? []) {
      const businessId = item['businessId']
      const email = item['email']
      const businessName = item['businessName']
      const paidUntil = item['paidUntil']
      const paidInterval = item['paidInterval']
      if (
        typeof businessId === 'string' &&
        typeof email === 'string' &&
        typeof businessName === 'string' &&
        typeof paidUntil === 'string' &&
        typeof paidInterval === 'string'
      ) {
        rows.push({ businessId, email, businessName, paidUntil, paidInterval })
      }
    }
    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)
  return rows
}

/**
 * Record that a pre-lapse renewal reminder has been sent for the given paid
 * window (billing-revenue-integrity R3.4). Setting `renewalReminderSentFor` to
 * the current `paidUntil` removes the business from the next run's selection
 * until a renewal changes `paidUntil` (which re-arms the reminder).
 */
export async function setRenewalReminderSent(id: string, paidUntil: string) {
  return updateBusiness(id, { renewalReminderSentFor: paidUntil } as any)
}
