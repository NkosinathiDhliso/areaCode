import { randomUUID } from 'node:crypto'
import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { AWS_REGION, requireEnv } from '../../shared/config/env.js'
import { anonymizeCheckIns, hashVisitorToken, type RawCheckIn } from './anonymize.js'
import { analyzePeakHours } from './analyzers/peak-hours.js'
import { analyzeCrowdComposition } from './analyzers/crowd-composition.js'
import { analyzeMusicProfile } from './analyzers/music-profile.js'
import { analyzeRepeatVisitors } from './analyzers/repeat-visitors.js'
import { analyzeTrends } from './analyzers/trends.js'
import { analyzeBenchmarks } from './analyzers/benchmarks.js'
import { analyzeJourney } from './analyzers/journey.js'
import { generateRecommendations } from './analyzers/recommendations.js'
import { scanForPii } from './pii-scanner.js'
import { storeReport, storeReportTokens, storeBusinessMetrics, getPreviousReport } from './repository.js'
import type { GenerateReportMessage, Report, ReportMetrics, MusicPrefs } from './types.js'

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
 * Queue email notification via SQS push-sender.
 */
async function queueEmailNotification(businessId: string, reportId: string, periodType: string): Promise<void> {
  // Terraform sets AREA_CODE_SQS_PUSH_QUEUE_URL. Unset means push notifications
  // are not configured for this environment, so there is nothing to queue.
  const queueUrl = process.env['AREA_CODE_SQS_PUSH_QUEUE_URL']
  if (!queueUrl) return

  try {
    const sqsClient = new SQSClient({ region: AWS_REGION })
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          type: 'report_ready',
          businessId,
          reportId,
          periodType,
        }),
      }),
    )
  } catch (error) {
    console.warn('[generator] Email notification queue failed:', error)
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
      // Don't throw to SQS — log and skip
      console.error(`[generator] Error processing record ${record.messageId}:`, error)
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
    await queueEmailNotification(businessId, reportId, periodType)
  } catch (err) {
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
