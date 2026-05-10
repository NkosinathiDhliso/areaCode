// Report generator — Lambda handler and report assembly logic
import { randomUUID } from 'node:crypto'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { anonymizeCheckIns } from './anonymize.js'
import { analyzePeakHours } from './analyzers/peak-hours.js'
import { analyzeCrowdComposition } from './analyzers/crowd-composition.js'
import { analyzeMusicProfile } from './analyzers/music-profile.js'
import { analyzeRepeatVisitors } from './analyzers/repeat-visitors.js'
import { analyzeTrends } from './analyzers/trends.js'
import { analyzeBenchmarks } from './analyzers/benchmarks.js'
import { analyzeJourney } from './analyzers/journey.js'
import { generateRecommendations } from './analyzers/recommendations.js'
import { scanForPii } from './pii-scanner.js'
import { storeReport, getPreviousReport } from './repository.js'
import {
  getBusinessNodes,
  loadCheckInsForNode,
  loadUserData,
  loadCategoryVenueMetrics,
  loadAllVenueVisitorMap,
} from './data-loaders.js'
import type { GenerateReportMessage, Report, ReportMetrics, MusicPrefs } from './types.js'
import type { RawCheckIn } from './anonymize.js'

const ANONYMIZATION_SALT = process.env['AREA_CODE_ANONYMIZATION_SALT'] ?? 'default-salt'

interface SQSEvent {
  Records: Array<{ body: string; messageId: string; receiptHandle: string }>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computePulseState(totalCheckIns: number): string {
  if (totalCheckIns >= 200) return 'buzzing'
  if (totalCheckIns >= 100) return 'active'
  if (totalCheckIns >= 30) return 'warming'
  if (totalCheckIns >= 1) return 'quiet'
  return 'dormant'
}

function computePulseScore(totalCheckIns: number, uniqueVisitors: number): number {
  const volumeScore = Math.min(totalCheckIns / 200, 1) * 60
  const diversityScore = Math.min(uniqueVisitors / 100, 1) * 40
  return Math.round(volumeScore + diversityScore)
}

async function sendWebSocketNotification(businessId: string, reportId: string): Promise<void> {
  try {
    const { broadcastToRoom } = await import('../../shared/websocket/broadcast.js')
    await broadcastToRoom(`business:${businessId}`, {
      type: 'report:ready',
      payload: { reportId, businessId },
    })
  } catch (error) {
    console.warn('[generator] WebSocket notification failed:', error)
  }
}

async function queueEmailNotification(businessId: string, reportId: string, periodType: string): Promise<void> {
  const queueUrl = process.env['AREA_CODE_PUSH_SENDER_QUEUE_URL']
  if (!queueUrl) return

  try {
    const sqsClient = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' })
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ type: 'report_ready', businessId, reportId, periodType }),
      }),
    )
  } catch (error) {
    console.warn('[generator] Email notification queue failed:', error)
  }
}

// ─── Lambda Handler ─────────────────────────────────────────────────────────

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await processRecord(record.body)
    } catch (error) {
      console.error(`[generator] Error processing record ${record.messageId}:`, error)
    }
  }
}

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

  // 2. Load check-ins for all nodes
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

  for (const ci of allRawCheckIns) {
    const userData = userDataMap.get(ci.userId)
    if (userData) ci.tier = userData.tier
  }

  // 4. Anonymize check-ins
  const anonymizedCheckIns = anonymizeCheckIns(allRawCheckIns, periodStart, ANONYMIZATION_SALT)

  // 5. Run analyzer modules
  const peakHours = analyzePeakHours(anonymizedCheckIns)
  const crowdComposition = analyzeCrowdComposition(anonymizedCheckIns)

  const visitorTokens = [...new Set(anonymizedCheckIns.map((ci) => ci.visitorToken))]
  const musicPrefsMap = new Map<string, MusicPrefs>()
  const userIdToToken = new Map<string, string>()
  for (let i = 0; i < allRawCheckIns.length; i++) {
    userIdToToken.set(allRawCheckIns[i]!.userId, anonymizedCheckIns[i]!.visitorToken)
  }
  for (const [userId, userData] of userDataMap) {
    if (userData.musicPrefs) {
      const token = userIdToToken.get(userId)
      if (token) musicPrefsMap.set(token, userData.musicPrefs)
    }
  }

  const musicProfile = analyzeMusicProfile(visitorTokens, musicPrefsMap)

  const previousReport = await getPreviousReport(businessId, periodType, periodStart.split('T')[0]!)
  const currentVisitorTokens = new Set(visitorTokens)
  const previousVisitorTokens = new Set<string>()
  const repeatVisitors = analyzeRepeatVisitors(currentVisitorTokens, previousVisitorTokens)

  const currentMetrics: ReportMetrics = {
    totalCheckIns: allRawCheckIns.length,
    uniqueVisitors: crowdComposition.totalUniqueVisitors,
    repeatVisitorRate: repeatVisitors.repeatRate,
    pulseScore: computePulseScore(allRawCheckIns.length, crowdComposition.totalUniqueVisitors),
  }

  const previousMetrics: ReportMetrics | null = previousReport
    ? {
        totalCheckIns: previousReport.summary.totalCheckIns,
        uniqueVisitors: previousReport.crowdComposition.totalUniqueVisitors,
        repeatVisitorRate: previousReport.repeatVisitors.repeatRate,
        pulseScore: 0,
      }
    : null

  const trends = analyzeTrends(currentMetrics, previousMetrics)
  const categoryVenueMetrics = await loadCategoryVenueMetrics(businessId, nodes)
  const benchmarks = analyzeBenchmarks(currentMetrics, categoryVenueMetrics)

  const businessNodeIds = new Set(nodes.map((n) => n.nodeId))
  const firstNode = nodes[0]!

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

  const allVenueVisitorMap = await loadAllVenueVisitorMap(businessNodeIds, periodStart, periodEnd, cityId, ANONYMIZATION_SALT)
  const journeyInsights = analyzeJourney(currentVisitorTokens, allVenueVisitorMap)

  const recommendations = generateRecommendations({
    peakHours,
    crowdComposition,
    musicProfile: musicProfile.hasInsufficientData ? null : musicProfile,
    repeatVisitors,
    trends,
    benchmarks: benchmarks.hasInsufficientData ? null : benchmarks,
    journeyInsights: journeyInsights.hasInsufficientData ? null : journeyInsights,
  })

  // 6. Assemble report
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

  // 7. PII scan
  const reportJson = JSON.stringify(report)
  const piiResult = scanForPii(reportJson)
  if (!piiResult.clean) {
    console.error(`[generator] PII detected in report for business ${businessId}:`, piiResult.violations)
    return { skipped: 'pii' }
  }

  // 8. Store and notify
  await storeReport(report)
  console.log(`[generator] Report stored: reportId=${reportId}, business=${businessId}`)

  try { await sendWebSocketNotification(businessId, reportId) } catch (err) { console.warn(`[generator] WebSocket notification failed:`, err) }
  try { await queueEmailNotification(businessId, reportId, periodType) } catch (err) { console.warn(`[generator] Email notification failed:`, err) }

  console.log(`[generator] Report generation complete for business ${businessId}`)
  return { reportId }
}
