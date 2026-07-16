import { randomUUID } from 'node:crypto'

import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb'

import { requireEnv } from '../../shared/config/env.js'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { sendReportReadyEmail, sendDigestEmail } from '../../shared/email/ses.js'
import { getBusinessById } from '../auth/dynamodb-repository.js'
import { getEffectiveTier } from '../business/service.js'
import { getCheckInsByUser } from '../check-in/dynamodb-repository.js'
import { getRedemptionsByRewardId, getRewardsByNodeId } from '../rewards/dynamodb-repository.js'
import { listGuestClaimsSince } from '../rewards/guest-claim.js'

import { analyzeBenchmarks } from './analyzers/benchmarks.js'
import { analyzeCrowdComposition } from './analyzers/crowd-composition.js'
import { analyzeJourney } from './analyzers/journey.js'
import { analyzeMusicProfile } from './analyzers/music-profile.js'
import { analyzePeakHours } from './analyzers/peak-hours.js'
import { generateRecommendations } from './analyzers/recommendations.js'
import { analyzeRepeatVisitors } from './analyzers/repeat-visitors.js'
import { analyzeTrends } from './analyzers/trends.js'
import { anonymizeCheckIns, hashVisitorToken, type RawCheckIn } from './anonymize.js'
import { buildDigestCopy, computeDigest, digestWeekFor, type DigestSources } from './digest.js'
import { scanForPii } from './pii-scanner.js'
import {
  storeReport,
  storeReportTokens,
  storeBusinessMetrics,
  getPreviousReport,
  persistDigest,
  getLatestDigest,
  markDigestEmailSent,
} from './repository.js'
import { getNodeShareCountsForWeek } from './share-repository.js'
import type { GenerateReportMessage, Report, ReportMetrics, MusicPrefs, DigestRow } from './types.js'

// ============================================================================
// Constants
// ============================================================================

// Anonymization salt for hashing PII in venue reports. Required in prod (a
// known/default salt would defeat the anonymisation, a POPIA risk); a dev-only
// salt is used outside production so the test suite and local runs are stable.
const ANONYMIZATION_SALT = requireEnv('AREA_CODE_ANONYMIZATION_SALT', 'dev-anonymization-salt')

// ============================================================================
// SQS Event Types
// ============================================================================

interface SQSEvent {
  Records: Array<{
    body: string
    messageId: string
    receiptHandle: string
  }>
}

// ============================================================================
// Data Loading Helpers
// ============================================================================

/**
 * Get all node IDs and names for a business.
 */
async function getBusinessNodes(businessId: string): Promise<Array<{ nodeId: string; nodeName: string }>> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :businessId',
      ExpressionAttributeValues: { ':businessId': businessId },
    }),
  )

  return (result.Items || []).map((item) => ({
    nodeId: item['nodeId'] as string,
    nodeName: (item['name'] as string) ?? 'Unknown',
  }))
}

/**
 * Load all check-ins for a node within the reporting period.
 * Paginates through all results using the NodeIndex GSI.
 */
async function loadCheckInsForNode(nodeId: string, periodStart: string, periodEnd: string): Promise<RawCheckIn[]> {
  const checkIns: RawCheckIn[] = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.checkins,
        IndexName: 'NodeIndex',
        KeyConditionExpression: 'nodeId = :nodeId',
        FilterExpression: 'checkedInAt BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':nodeId': nodeId,
          ':start': periodStart,
          ':end': periodEnd,
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )

    for (const item of result.Items || []) {
      checkIns.push({
        userId: item['userId'] as string,
        nodeId: item['nodeId'] as string,
        tier: (item['tier'] as string) ?? 'local',
        checkedInAt: item['checkedInAt'] as string,
        displayName: item['displayName'] as string | undefined,
        phone: item['phone'] as string | undefined,
        email: item['email'] as string | undefined,
        avatarUrl: item['avatarUrl'] as string | undefined,
      })
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  return checkIns
}

/**
 * Load user tiers and music preferences via BatchGetItem.
 * Returns a map of userId -> { tier, musicPrefs }.
 */
async function loadUserData(userIds: string[]): Promise<Map<string, { tier: string; musicPrefs: MusicPrefs | null }>> {
  const userDataMap = new Map<string, { tier: string; musicPrefs: MusicPrefs | null }>()

  if (userIds.length === 0) return userDataMap

  // BatchGetItem supports max 100 keys per request
  const batchSize = 100
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize)
    const keys = batch.map((userId) => ({ userId }))

    try {
      const result = await documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [TableNames.users]: {
              Keys: keys,
              ProjectionExpression:
                'userId, tier, musicGenres, energy, cultural_rootedness, sophistication, edge, spirituality',
            },
          },
        }),
      )

      const items = result.Responses?.[TableNames.users] || []
      for (const item of items) {
        const userId = item['userId'] as string
        const tier = (item['tier'] as string) ?? 'local'

        let musicPrefs: MusicPrefs | null = null
        const genres = item['musicGenres'] as string[] | undefined
        if (genres && genres.length > 0) {
          musicPrefs = {
            energy: (item['energy'] as number) ?? 50,
            cultural_rootedness: (item['cultural_rootedness'] as number) ?? 50,
            sophistication: (item['sophistication'] as number) ?? 50,
            edge: (item['edge'] as number) ?? 50,
            spirituality: (item['spirituality'] as number) ?? 50,
            genres,
          }
        }

        userDataMap.set(userId, { tier, musicPrefs })
      }
    } catch (error) {
      console.error('[generator] Error loading user data batch:', error)
    }
  }

  return userDataMap
}

/**
 * Load category venue metrics for benchmarks.
 * Queries nodes by city using LocationIndex GSI, then loads cached metrics.
 */
async function loadCategoryVenueMetrics(
  businessId: string,
  nodes: Array<{ nodeId: string; nodeName: string }>,
): Promise<ReportMetrics[]> {
  if (nodes.length === 0) return []

  // Get the first node's city to find comparable venues
  const firstNodeResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      KeyConditionExpression: 'nodeId = :nodeId',
      ExpressionAttributeValues: { ':nodeId': nodes[0]!.nodeId },
      Limit: 1,
    }),
  )

  const firstNode = firstNodeResult.Items?.[0]
  if (!firstNode) return []

  const cityId = firstNode['cityId'] as string | undefined
  const category = firstNode['category'] as string | undefined
  if (!cityId) return []

  // Query nodes in the same city
  const cityNodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'LocationIndex',
      KeyConditionExpression: 'cityId = :cityId',
      ExpressionAttributeValues: { ':cityId': cityId },
    }),
  )

  const cityNodes = cityNodesResult.Items || []

  // Filter to same category and different businesses
  const comparableNodes = cityNodes.filter((n) => {
    const nodeBusinessId = n['businessId'] as string | undefined
    const nodeCategory = n['category'] as string | undefined
    return nodeBusinessId && nodeBusinessId !== businessId && (!category || nodeCategory === category)
  })

  // Load cached metrics for comparable businesses from app-data
  const metrics: ReportMetrics[] = []
  const seenBusinesses = new Set<string>()

  for (const node of comparableNodes) {
    const nodeBusinessId = node['businessId'] as string
    if (seenBusinesses.has(nodeBusinessId)) continue
    seenBusinesses.add(nodeBusinessId)

    try {
      const metricsResult = await documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `BIZ_METRICS#${nodeBusinessId}`,
            ':prefix': 'LATEST',
          },
          Limit: 1,
        }),
      )

      const metricsItem = metricsResult.Items?.[0]
      if (metricsItem) {
        metrics.push({
          totalCheckIns: (metricsItem['totalCheckIns'] as number) ?? 0,
          uniqueVisitors: (metricsItem['uniqueVisitors'] as number) ?? 0,
          repeatVisitorRate: (metricsItem['repeatVisitorRate'] as number) ?? 0,
          pulseScore: (metricsItem['pulseScore'] as number) ?? 0,
        })
      }
    } catch {
      // Skip this business's metrics on error
    }
  }

  return metrics
}

/**
 * Load all venue visitor maps for journey analysis.
 * Returns a map of nodeId -> { name, visitors } for all nodes in the same city.
 */
async function loadAllVenueVisitorMap(
  businessNodeIds: Set<string>,
  periodStart: string,
  periodEnd: string,
  cityId: string | undefined,
): Promise<Map<string, { name: string; visitors: Set<string> }>> {
  const venueMap = new Map<string, { name: string; visitors: Set<string> }>()

  if (!cityId) return venueMap

  // Get all nodes in the city
  const cityNodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'LocationIndex',
      KeyConditionExpression: 'cityId = :cityId',
      ExpressionAttributeValues: { ':cityId': cityId },
    }),
  )

  const otherNodes = (cityNodesResult.Items || []).filter((n) => {
    const nodeId = n['nodeId'] as string
    return !businessNodeIds.has(nodeId)
  })

  // For each other node, load check-ins and build visitor set
  for (const node of otherNodes) {
    const nodeId = node['nodeId'] as string
    const nodeName = (node['name'] as string) ?? 'Unknown'

    try {
      const checkIns = await loadCheckInsForNode(nodeId, periodStart, periodEnd)
      if (checkIns.length === 0) continue

      const visitors = new Set<string>()
      for (const ci of checkIns) {
        // Hash the visitor token the same way as the business's check-ins so
        // journey overlap matches the same user across venues (period-stable).
        visitors.add(hashVisitorToken(ci.userId, ANONYMIZATION_SALT))
      }

      venueMap.set(nodeId, { name: nodeName, visitors })
    } catch {
      // Skip this node on error
    }
  }

  return venueMap
}

/**
 * Determine the pulse state based on total check-ins.
 */
function computePulseState(totalCheckIns: number): string {
  if (totalCheckIns >= 200) return 'buzzing'
  if (totalCheckIns >= 100) return 'active'
  if (totalCheckIns >= 30) return 'warming'
  if (totalCheckIns >= 1) return 'quiet'
  return 'dormant'
}

// ============================================================================
// Notification Helpers
// ============================================================================

/**
 * Send WebSocket notification that a new report is available.
 */
async function sendWebSocketNotification(businessId: string, reportId: string): Promise<void> {
  try {
    const { broadcastToRoom } = await import('../../shared/websocket/broadcast.js')
    await broadcastToRoom(`business:${businessId}`, {
      type: 'report:ready',
      payload: { reportId, businessId },
    })
  } catch (error) {
    // WebSocket delivery failure is non-fatal — log and continue
    console.warn('[generator] WebSocket notification failed:', error)
  }
}

/**
 * Send a report-ready email via the shared SES module (R9.1). Replaces the
 * enqueue to the consumer-less `push-sender` SQS queue: SES is the existing
 * delivered channel for transactional business email. Resolves the business's
 * email + name from the businesses table, then hands off to the shared sender.
 */
async function sendEmailNotification(businessId: string, reportId: string, periodType: string): Promise<void> {
  const business = await getBusinessById(businessId)
  if (!business?.email) {
    // No destination address on the row — nothing to deliver to. Log so a
    // misconfigured business surfaces, rather than silently doing nothing.
    console.warn(`[generator] No email on business ${businessId}; skipping report-ready email`)
    return
  }
  await sendReportReadyEmail(business.email, business.businessName ?? 'there', reportId, periodType)
}

// ============================================================================
// Digest Path (Weekly Attribution Digest)
// ============================================================================
//
// Runs alongside the full weekly report for every weekly generation message.
// It is deliberately NOT gated by the full-report `no_check_ins` early return:
// a zero-visits week is a designed honest Digest state (R1.1), so the digest is
// computed and persisted even when the week is quiet. Per-business failures are
// logged and skipped by the caller (R3.3), never aborting the SQS record or the
// full-report work for this or any other business.

/** Page size when paginating a visitor's check-in history for first-timer detection. */
const EARLIEST_CHECKIN_PAGE_SIZE = 100

/**
 * The earliest recorded check-in (ISO 8601) per visitor at ANY of the business's
 * nodes, over all time, keyed by userId. Bounded by the week's unique-visitor
 * count (one read pass per visitor); acceptable at current scale and noted in the
 * design for a GSI revisit at scale. A visitor absent from the map has no recorded
 * check-in at the business's nodes and is treated as a first-timer by computeDigest.
 */
async function loadEarliestCheckInByUser(
  businessNodeIds: Set<string>,
  userIds: string[],
): Promise<Record<string, string>> {
  const earliest: Record<string, string> = {}

  for (const userId of userIds) {
    let cursor: string | undefined
    let min: string | undefined

    do {
      const page = await getCheckInsByUser(userId, { limit: EARLIEST_CHECKIN_PAGE_SIZE, cursor })
      for (const checkIn of page.checkIns) {
        if (!businessNodeIds.has(checkIn.nodeId)) continue
        // ISO 8601 timestamps compare correctly lexicographically.
        if (min === undefined || checkIn.checkedInAt < min) min = checkIn.checkedInAt
      }
      cursor = page.nextCursor
    } while (cursor)

    if (min !== undefined) earliest[userId] = min
  }

  return earliest
}

/**
 * Count confirmed redemptions at the business's nodes whose `redeemedAt` falls
 * inside the Digest_Week window `[windowStartMs, windowEndMs)`. Joins the rewards
 * read (rewards by node) to the redemption read (redemptions by reward), reusing
 * the rewards feature repository rather than forking a query.
 */
async function countRedemptionsInWindow(
  nodeIds: string[],
  windowStartMs: number,
  windowEndMs: number,
): Promise<number> {
  let count = 0

  for (const nodeId of nodeIds) {
    const rewards = await getRewardsByNodeId(nodeId)
    for (const reward of rewards) {
      const redemptions = await getRedemptionsByRewardId(reward.rewardId)
      for (const redemption of redemptions) {
        if (!redemption.redeemedAt) continue
        const redeemedMs = new Date(redemption.redeemedAt).getTime()
        if (redeemedMs >= windowStartMs && redeemedMs < windowEndMs) count++
      }
    }
  }

  return count
}

/**
 * First-Get counts for the business's nodes over the Digest_Week window:
 * - firstGetIssued: tokens with `issuedAt` in the window (R1.4).
 * - firstGetConversions: tokens with `redeemedAt` in the window, regardless of
 *   when the token was issued (R1.4).
 *
 * Reuses the existing guest-claim scan (`listGuestClaimsSince`) for both, once
 * per timestamp field, then filters to the business's nodes and the window.
 */
async function loadFirstGetCounts(
  businessNodeIds: Set<string>,
  windowStartUtc: string,
  windowStartMs: number,
  windowEndMs: number,
): Promise<{ firstGetIssued: number; firstGetConversions: number }> {
  const inWindow = (iso: string | undefined): boolean => {
    if (!iso) return false
    const ms = new Date(iso).getTime()
    return ms >= windowStartMs && ms < windowEndMs
  }

  const issuedRows = await listGuestClaimsSince(windowStartUtc, 'issuedAt')
  let firstGetIssued = 0
  for (const row of issuedRows) {
    if (businessNodeIds.has(row.nodeId) && inWindow(row.issuedAt)) firstGetIssued++
  }

  const redeemedRows = await listGuestClaimsSince(windowStartUtc, 'redeemedAt')
  let firstGetConversions = 0
  for (const row of redeemedRows) {
    if (businessNodeIds.has(row.nodeId) && inWindow(row.redeemedAt)) firstGetConversions++
  }

  return { firstGetIssued, firstGetConversions }
}

/**
 * Compute, PII-scan, and persist the Digest_Row for one business over the
 * just-closed Digest_Week, then attempt the Digest_Email only when the row is
 * newly written (retry suppression, R3.1).
 *
 * The Digest_Week is derived with `digestWeekFor(periodEnd)`. The dispatcher's
 * `periodEnd` is the just-closed Sunday 23:59:59.999 SAST, an instant strictly
 * inside the closed week — using it (rather than `periodStart`, which lands
 * exactly on the Monday 00:00 boundary that `digestWeekFor` attributes to the
 * PRIOR week) yields the correct, stable weekStart across a delayed or re-run
 * pass (idempotency key stability).
 *
 * `windowCheckIns` is the check-in set already loaded for the report period,
 * reused here (DRY): the report period and the Digest_Week cover the same
 * seven-day SAST window.
 */
/**
 * Best-effort flip of the Digest_Row `emailSent` flag after a confirmed send
 * (R7.3, decision docs/decisions/digest-email-sent-field.md). A failure is
 * logged and swallowed: the row is already persisted and the email already
 * sent, so the flip must never throw, roll back, or resend. Kept separate from
 * the idempotence conditional put in persistDigest so Property 4 is unaffected.
 */
async function flipDigestEmailSent(businessId: string, weekStart: string): Promise<void> {
  try {
    await markDigestEmailSent(businessId, weekStart)
  } catch (flipErr) {
    console.error(
      `[generator] Failed to flip emailSent for business ${businessId} week ${weekStart} (email was sent):`,
      flipErr,
    )
  }
}

async function runDigestPath(
  businessId: string,
  nodes: Array<{ nodeId: string; nodeName: string }>,
  windowCheckIns: RawCheckIn[],
  periodEnd: string,
): Promise<void> {
  const week = digestWeekFor(periodEnd)
  const windowStartMs = new Date(week.windowStartUtc).getTime()
  const windowEndMs = new Date(week.windowEndUtc).getTime()

  const nodeIds = nodes.map((node) => node.nodeId)
  const businessNodeIds = new Set(nodeIds)
  const uniqueUserIds = [...new Set(windowCheckIns.map((checkIn) => checkIn.userId))]

  const earliestCheckInByUser = await loadEarliestCheckInByUser(businessNodeIds, uniqueUserIds)
  const redemptions = await countRedemptionsInWindow(nodeIds, windowStartMs, windowEndMs)
  const { firstGetIssued, firstGetConversions } = await loadFirstGetCounts(
    businessNodeIds,
    week.windowStartUtc,
    windowStartMs,
    windowEndMs,
  )
  const shares = await getNodeShareCountsForWeek(nodeIds, week.weekStartIso)

  const sources: DigestSources = {
    windowCheckIns,
    earliestCheckInByUser,
    redemptions,
    firstGetIssued,
    firstGetConversions,
    shares,
  }

  // Prior-week metrics for deltas are read BEFORE the conditional put, so
  // getLatestDigest returns the immediately-prior Digest_Row and never this
  // week's row (design: deltas from the prior Digest_Row only).
  const priorRow = await getLatestDigest(businessId)

  // TIER RESOLVER SEAM (R5.4). This is the single call site that resolves the
  // effective tier for the digest close and the tierAtBuild snapshot. It uses
  // the existing getEffectiveTier as-is — the canonical resolver today, which
  // collapses a lapsed paid tier to starter, so a lapsed business gets the
  // starter close. Swap ONLY this call for the unified tier resolver once
  // billing-revenue-integrity task 5 has merged; nothing else changes.
  const business = await getBusinessById(businessId)
  const tier = getEffectiveTier(
    (business ?? {}) as {
      tier?: string
      trialEndsAt?: string | null
      paidUntil?: string | null
      paymentGraceUntil?: string | null
    },
  )

  const digest = computeDigest(week, sources, ANONYMIZATION_SALT, priorRow?.metrics ?? null)

  const row: DigestRow = {
    businessId,
    weekStart: week.weekStartIso,
    metrics: digest.metrics,
    ...(digest.deltas ? { deltas: digest.deltas } : {}),
    suppressed: digest.suppressed,
    tierAtBuild: tier,
    // Persisted false; flipped to true by markDigestEmailSent only after a
    // confirmed Digest_Email send below (R7.3, decision
    // docs/decisions/digest-email-sent-field.md). The flip is a separate
    // best-effort update, so this conditional put stays the single idempotence
    // gate (Property 4).
    emailSent: false,
    createdAt: new Date().toISOString(),
  }

  // persistDigest PII-scans the payload then conditional-puts (R1.6, R3.1).
  const result = await persistDigest(row)

  if (result === 'duplicate') {
    // Replay of the same week: the Digest_Row already exists → no-op, and NO
    // Digest_Email (retry suppression, R3.1).
    console.log(
      `[generator] Digest already exists for business ${businessId} week ${week.weekStartIso}; email suppressed`,
    )
    return
  }

  // result === 'written': send the Digest_Email exactly once (R4.2). It renders
  // from the shared copy strings built here (buildDigestCopy — one source of
  // truth with the dashboard card, R4.3), never re-deriving copy in the email
  // module. The row was persisted above with emailSent:false and is retained
  // regardless of the send outcome. After a confirmed send we flip emailSent to
  // true via a separate best-effort update (markDigestEmailSent, R7.3), so the
  // conditional put above stays the only idempotence write for this week and the
  // invariant (Property 4) holds.
  const copy = buildDigestCopy(digest, tier)

  // Digest_Optout (R4.5): skip the send when the business opted out, keeping the
  // row. Read defensively as an optional flag — task 5.2 owns the full opt-out
  // wiring (business row type + settings PATCH route); this check honours it as
  // soon as the field is present without adding the route here.
  if ((business as { digestEmailOptOut?: boolean } | null)?.digestEmailOptOut) {
    console.log(`[generator] Digest_Optout set for business ${businessId}; Digest_Email suppressed (row retained)`)
    return
  }

  // No destination address on the row — nothing to deliver to (matches
  // sendEmailNotification). Log so a misconfigured business surfaces; the row
  // is already persisted and retained.
  if (!business?.email) {
    console.warn(`[generator] No email on business ${businessId}; skipping Digest_Email (row retained)`)
    return
  }

  try {
    await sendDigestEmail(business.email, business.businessName ?? 'Your venue', digest.metrics.visits, copy)
    console.log(`[generator] Digest_Email sent for business ${businessId} week ${week.weekStartIso}`)

    // Flip emailSent to true so the field carries real signal (R7.3). Best
    // effort: a failed flip is logged and swallowed — the row is already
    // persisted and the email already sent, so it must not throw, roll back, or
    // resend. The idempotence conditional put above is unaffected (Property 4).
    await flipDigestEmailSent(businessId, week.weekStartIso)
  } catch (err) {
    // R4.4: a failed email is logged and never loses the Digest_Row (persisted
    // above), matching the full-report email handling.
    console.error(`[generator] Digest_Email send failed for business ${businessId}:`, err)
  }
}

// ============================================================================
// Lambda Handler
// ============================================================================

/**
 * Report generator worker Lambda handler.
 * Triggered by SQS with one message per business.
 *
 * For each SQS record:
 * 1. Parse GenerateReportMessage
 * 2. Load check-ins for all business nodes
 * 3. Anonymize check-ins
 * 4. Run all analyzer modules
 * 5. Assemble Report object
 * 6. Run PII scanner
 * 7. Store report
 * 8. Send notifications
 */
export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await processRecord(record.body)
    } catch (error) {
      console.error(`[generator] Error processing record ${record.messageId}:`, error)
      throw error
    }
  }
}

/**
 * Generate a report on demand (synchronously, without SQS).
 * Used by the `POST /v1/business/me/reports/generate` endpoint so businesses
 * can trigger report generation directly from the dashboard.
 */
export async function generateReportNow(
  businessId: string,
  periodType: 'weekly' | 'monthly',
  periodStart: string,
  periodEnd: string,
): Promise<{ reportId: string } | { skipped: 'no_nodes' | 'no_check_ins' | 'pii' }> {
  return generateReportInternal({ businessId, periodType, periodStart, periodEnd })
}

async function processRecord(body: string): Promise<void> {
  const message: GenerateReportMessage = JSON.parse(body)
  await generateReportInternal(message)
}

async function generateReportInternal(
  message: GenerateReportMessage,
): Promise<{ reportId: string } | { skipped: 'no_nodes' | 'no_check_ins' | 'pii' }> {
  const { businessId, periodType, periodStart, periodEnd } = message

  console.log(`[generator] Processing report for business=${businessId}, period=${periodType}, start=${periodStart}`)

  // 1. Load business nodes
  const nodes = await getBusinessNodes(businessId)
  if (nodes.length === 0) {
    console.log(`[generator] No nodes for business ${businessId}, skipping`)
    return { skipped: 'no_nodes' }
  }

  // 2. Load check-ins for all nodes in the period
  const allRawCheckIns: RawCheckIn[] = []
  for (const node of nodes) {
    const nodeCheckIns = await loadCheckInsForNode(node.nodeId, periodStart, periodEnd)
    allRawCheckIns.push(...nodeCheckIns)
  }

  // Digest path (weekly only): runs BEFORE the full-report `no_check_ins` early
  // return so a quiet week still produces an honest Digest_Row (R1.1). A
  // per-business failure here is logged and skipped, never aborting the full
  // report for this business or the SQS record for others (R3.3).
  if (periodType === 'weekly') {
    try {
      await runDigestPath(businessId, nodes, allRawCheckIns, periodEnd)
    } catch (err) {
      console.error(`[generator] Digest path failed for business ${businessId}:`, err)
    }
  }

  if (allRawCheckIns.length === 0) {
    console.log(`[generator] No check-ins for business ${businessId} in period, skipping`)
    return { skipped: 'no_check_ins' }
  }

  // 3. Load user tiers and music prefs
  const uniqueUserIds = [...new Set(allRawCheckIns.map((ci) => ci.userId))]
  const userDataMap = await loadUserData(uniqueUserIds)

  // Enrich raw check-ins with user tier data
  for (const ci of allRawCheckIns) {
    const userData = userDataMap.get(ci.userId)
    if (userData) {
      ci.tier = userData.tier
    }
  }

  // 4. Anonymize check-ins
  const anonymizedCheckIns = anonymizeCheckIns(allRawCheckIns, ANONYMIZATION_SALT)

  // 5. Run analyzer modules
  const peakHours = analyzePeakHours(anonymizedCheckIns)
  const crowdComposition = analyzeCrowdComposition(anonymizedCheckIns)

  // Music profile: build music prefs map keyed by visitor token
  const visitorTokens = [...new Set(anonymizedCheckIns.map((ci) => ci.visitorToken))]
  const musicPrefsMap = new Map<string, MusicPrefs>()

  // Map userId -> visitorToken for music prefs lookup
  const userIdToToken = new Map<string, string>()
  for (let i = 0; i < allRawCheckIns.length; i++) {
    const raw = allRawCheckIns[i]!
    const anon = anonymizedCheckIns[i]!
    userIdToToken.set(raw.userId, anon.visitorToken)
  }

  for (const [userId, userData] of userDataMap) {
    if (userData.musicPrefs) {
      const token = userIdToToken.get(userId)
      if (token) {
        musicPrefsMap.set(token, userData.musicPrefs)
      }
    }
  }

  const musicProfile = analyzeMusicProfile(visitorTokens, musicPrefsMap)

  // Repeat visitors: load previous period report + its persisted visitor tokens.
  // Task 5.1 persists and exposes the tokens (previousReportData.visitorTokens);
  // wiring them into the repeat-visitor analyzer is task 5.2.
  const previousReportData = await getPreviousReport(businessId, periodType, periodStart.split('T')[0]!)
  const previousReport = previousReportData?.report ?? null
  const currentVisitorTokens = new Set(visitorTokens)

  // Prior-period hashed tokens persisted by task 5.1 (period-stable salt), so
  // the analyzer can intersect periods for a real repeat rate. When no prior
  // tokens exist (no prior report, or none stored), the set stays empty and the
  // analyzer marks the rate unavailable (hasPriorData: false) instead of
  // reporting a fabricated 0%.
  const previousVisitorTokens = new Set(previousReportData?.visitorTokens ?? [])

  const repeatVisitors = analyzeRepeatVisitors(currentVisitorTokens, previousVisitorTokens)

  // Current metrics for trends
  const currentMetrics: ReportMetrics = {
    totalCheckIns: allRawCheckIns.length,
    uniqueVisitors: crowdComposition.totalUniqueVisitors,
    repeatVisitorRate: repeatVisitors.repeatRate,
    pulseScore: computePulseScore(allRawCheckIns.length, crowdComposition.totalUniqueVisitors),
  }

  // Previous metrics from stored report. The prior pulse score is read from the
  // persisted `summary.pulseScore` (H4 fix — never a hardcoded 0). Reports
  // generated before pulse persistence lack that field; in that case the prior
  // pulse baseline is genuinely unknown, so the pulseScore trend is marked "no
  // prior data" (below) rather than fabricating a +100% up delta from a 0/
  // substituted baseline (Requirement 5.3).
  const previousPulseScore = previousReport?.summary.pulseScore
  const pulseScorePriorUnavailable = previousReport !== null && typeof previousPulseScore !== 'number'
  const previousMetrics: ReportMetrics | null = previousReport
    ? {
        totalCheckIns: previousReport.summary.totalCheckIns,
        uniqueVisitors: previousReport.crowdComposition.totalUniqueVisitors,
        repeatVisitorRate: previousReport.repeatVisitors.repeatRate,
        // Ignored for the trend when the prior pulse is unavailable (marked
        // below); a real prior value flows through when present.
        pulseScore: previousPulseScore ?? 0,
      }
    : null

  // Collect every metric whose prior baseline is genuinely unknown so its trend
  // is marked "no prior data" (flat, no +100% from a 0/substituted baseline) and
  // the Dashboard_UI omits the row. pulseScore (H4) when the prior report predates
  // pulse persistence; repeatVisitorRate (H3, Requirement 4.5) when there are no
  // prior-period visitor tokens to intersect, so the 0% is not a real computed value.
  const unavailablePriorMetrics = new Set<string>()
  if (pulseScorePriorUnavailable) unavailablePriorMetrics.add('pulseScore')
  if (!repeatVisitors.hasPriorData) unavailablePriorMetrics.add('repeatVisitorRate')
  const trends = analyzeTrends(currentMetrics, previousMetrics, unavailablePriorMetrics)

  // Benchmarks
  const categoryVenueMetrics = await loadCategoryVenueMetrics(businessId, nodes)
  const benchmarks = analyzeBenchmarks(currentMetrics, categoryVenueMetrics)

  // Journey analysis
  const businessNodeIds = new Set(nodes.map((n) => n.nodeId))
  const firstNode = nodes[0]!

  // Get city for journey analysis
  let cityId: string | undefined
  try {
    const nodeResult = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.nodes,
        KeyConditionExpression: 'nodeId = :nodeId',
        ExpressionAttributeValues: { ':nodeId': firstNode.nodeId },
        Limit: 1,
      }),
    )
    cityId = nodeResult.Items?.[0]?.['cityId'] as string | undefined
  } catch {
    // Skip journey if we can't determine city
  }

  const allVenueVisitorMap = await loadAllVenueVisitorMap(businessNodeIds, periodStart, periodEnd, cityId)

  const journeyInsights = analyzeJourney(currentVisitorTokens, allVenueVisitorMap)

  // Recommendations
  const recommendations = generateRecommendations({
    peakHours,
    crowdComposition,
    musicProfile: musicProfile.hasInsufficientData ? null : musicProfile,
    repeatVisitors,
    trends,
    benchmarks: benchmarks.hasInsufficientData ? null : benchmarks,
    journeyInsights: journeyInsights.hasInsufficientData ? null : journeyInsights,
  })

  // 6. Assemble full Report object
  const reportId = randomUUID()
  const generatedAt = new Date().toISOString()

  const topGenre = musicProfile.hasInsufficientData ? null : (musicProfile.topGenres[0]?.genre ?? null)

  const headlineRecommendation = recommendations.recommendations[0]?.text ?? 'No recommendations available.'

  const report: Report = {
    reportId,
    businessId,
    schemaVersion: 'v1',
    periodType,
    periodStart,
    periodEnd,
    generatedAt,
    nodes,
    summary: {
      totalCheckIns: allRawCheckIns.length,
      pulseState: computePulseState(allRawCheckIns.length),
      topGenre,
      headlineRecommendation,
      // Persist the same pulse score used for the trend comparison so the next
      // period reads a real previous value (Requirements 5.1, 5.2).
      pulseScore: currentMetrics.pulseScore,
    },
    peakHours,
    crowdComposition,
    musicProfile: musicProfile.hasInsufficientData ? null : musicProfile,
    repeatVisitors,
    trends,
    benchmarks: benchmarks.hasInsufficientData ? null : benchmarks,
    journeyInsights: journeyInsights.hasInsufficientData ? null : journeyInsights,
    recommendations,
  }

  // 7. Run PII scanner on serialized JSON
  const reportJson = JSON.stringify(report)
  const piiResult = scanForPii(reportJson)

  if (!piiResult.clean) {
    console.error(`[generator] PII detected in report for business ${businessId}:`, piiResult.violations)
    return { skipped: 'pii' }
  }

  // 8. Store report + its period-stable hashed visitor tokens (companion row,
  //    server-side only, TTL) so the next period can intersect for repeat rate.
  await storeReport(report)
  await storeReportTokens(businessId, periodType, periodStart, visitorTokens)
  // Cache this period's metrics so the benchmark analyzer can compare this
  // venue against comparable venues (read by loadCategoryVenueMetrics).
  await storeBusinessMetrics(businessId, currentMetrics)
  console.log(`[generator] Report stored: reportId=${reportId}, business=${businessId}`)

  // 9. Send notifications (non-blocking — failures should not abort generation)
  try {
    await sendWebSocketNotification(businessId, reportId)
  } catch (err) {
    console.warn(`[generator] WebSocket notification failed:`, err)
  }
  try {
    await sendEmailNotification(businessId, reportId, periodType)
  } catch (err) {
    // R9.3: delivery failure is logged and never aborts report persistence
    // (the report is already stored above at step 8).
    console.warn(`[generator] Email notification failed:`, err)
  }

  console.log(`[generator] Report generation complete for business ${businessId}`)
  return { reportId }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute a simple pulse score based on check-in volume and unique visitors.
 */
function computePulseScore(totalCheckIns: number, uniqueVisitors: number): number {
  // Simple scoring: weighted combination of volume and diversity
  const volumeScore = Math.min(totalCheckIns / 200, 1) * 60
  const diversityScore = Math.min(uniqueVisitors / 100, 1) * 40
  return Math.round(volumeScore + diversityScore)
}
