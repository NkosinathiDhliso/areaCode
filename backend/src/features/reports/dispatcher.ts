import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { AWS_REGION } from '../../shared/config/env.js'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

// ============================================================================
// Constants
// ============================================================================

/** SAST is UTC+2 */
const SAST_OFFSET_HOURS = 2

// ============================================================================
// Types
// ============================================================================

interface DispatchEvent {
  periodType: 'weekly' | 'monthly'
}

interface Business {
  businessId: string
}

// ============================================================================
// Period Computation (SAST Calendar Boundaries)
// ============================================================================

/**
 * Compute the reporting period start and end based on SAST calendar boundaries.
 *
 * Weekly: previous Monday 00:00 SAST to Sunday 23:59:59.999 SAST
 * Monthly: 1st of previous month 00:00 SAST to last day 23:59:59.999 SAST
 *
 * Returns ISO 8601 strings in UTC.
 */
export function computePeriodBoundaries(
  periodType: 'weekly' | 'monthly',
  now: Date = new Date(),
): { periodStart: string; periodEnd: string } {
  if (periodType === 'weekly') {
    return computeWeeklyBoundaries(now)
  }
  return computeMonthlyBoundaries(now)
}

function computeWeeklyBoundaries(now: Date): { periodStart: string; periodEnd: string } {
  // Convert current UTC time to SAST
  const sastNow = new Date(now.getTime() + SAST_OFFSET_HOURS * 60 * 60 * 1000)

  // Find previous Monday in SAST
  // getUTCDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  const dayOfWeek = sastNow.getUTCDay()
  // Days since last Monday: if today is Monday (1), go back 7 days to get *previous* Monday
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  // We want the *previous* week's Monday, so add 7 more days back
  const daysBack = daysSinceMonday + 7

  const prevMonday = new Date(sastNow)
  prevMonday.setUTCDate(prevMonday.getUTCDate() - daysBack)
  prevMonday.setUTCHours(0, 0, 0, 0)

  // Previous Sunday = prevMonday + 6 days, 23:59:59.999 SAST
  const prevSunday = new Date(prevMonday)
  prevSunday.setUTCDate(prevSunday.getUTCDate() + 6)
  prevSunday.setUTCHours(23, 59, 59, 999)

  // Convert back to UTC by subtracting SAST offset
  const periodStartUtc = new Date(prevMonday.getTime() - SAST_OFFSET_HOURS * 60 * 60 * 1000)
  const periodEndUtc = new Date(prevSunday.getTime() - SAST_OFFSET_HOURS * 60 * 60 * 1000)

  return {
    periodStart: periodStartUtc.toISOString(),
    periodEnd: periodEndUtc.toISOString(),
  }
}

function computeMonthlyBoundaries(now: Date): { periodStart: string; periodEnd: string } {
  // Convert current UTC time to SAST
  const sastNow = new Date(now.getTime() + SAST_OFFSET_HOURS * 60 * 60 * 1000)

  // 1st of previous month 00:00 SAST
  const year = sastNow.getUTCFullYear()
  const month = sastNow.getUTCMonth() // 0-indexed

  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year

  const firstOfPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0, 0))

  // Last day of previous month 23:59:59.999 SAST
  // First day of current month minus 1ms gives last moment of previous month
  const firstOfCurrentMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
  const lastOfPrevMonth = new Date(firstOfCurrentMonth.getTime() - 1)
  // Set to 23:59:59.999 of that day
  lastOfPrevMonth.setUTCHours(23, 59, 59, 999)

  // Convert back to UTC by subtracting SAST offset
  const periodStartUtc = new Date(firstOfPrevMonth.getTime() - SAST_OFFSET_HOURS * 60 * 60 * 1000)
  const periodEndUtc = new Date(lastOfPrevMonth.getTime() - SAST_OFFSET_HOURS * 60 * 60 * 1000)

  return {
    periodStart: periodStartUtc.toISOString(),
    periodEnd: periodEndUtc.toISOString(),
  }
}

// ============================================================================
// Business + Activity Queries
// ============================================================================

/**
 * Scan all businesses from the businesses table.
 * Paginates through all results.
 */
async function getAllBusinesses(): Promise<Business[]> {
  const businesses: Business[] = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.businesses,
        ProjectionExpression: 'businessId',
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )

    for (const item of result.Items || []) {
      if (item['businessId']) {
        businesses.push({ businessId: item['businessId'] as string })
      }
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  return businesses
}

/**
 * Get all node IDs for a business using the BusinessIndex GSI on the nodes table.
 */
async function getNodeIdsForBusiness(businessId: string): Promise<string[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :businessId',
      ProjectionExpression: 'nodeId',
      ExpressionAttributeValues: { ':businessId': businessId },
    }),
  )

  return (result.Items || []).map((item) => item['nodeId'] as string).filter(Boolean)
}

/**
 * Check if any node for a business has check-in activity in the given period.
 * Uses the NodeIndex GSI on the checkins table with a timestamp filter.
 * Returns true as soon as any check-in is found (short-circuits).
 */
async function hasActivityInPeriod(nodeIds: string[], periodStart: string, periodEnd: string): Promise<boolean> {
  for (const nodeId of nodeIds) {
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
        Limit: 1,
      }),
    )

    if (result.Items && result.Items.length > 0) {
      return true
    }
  }

  return false
}

// ============================================================================
// SQS Message Sending
// ============================================================================

const sqsClient = new SQSClient({ region: AWS_REGION })

async function sendGenerationMessage(
  queueUrl: string,
  message: {
    businessId: string
    periodType: 'weekly' | 'monthly'
    periodStart: string
    periodEnd: string
  },
): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  )
}

// ============================================================================
// Lambda Handler
// ============================================================================

/**
 * Report dispatcher Lambda handler.
 * Triggered by EventBridge on a weekly/monthly schedule.
 *
 * 1. Compute period boundaries based on SAST calendar
 * 2. Scan all businesses
 * 3. For each business, check if any nodes have check-in activity
 * 4. Send SQS message for qualifying businesses
 */
export async function handler(event: DispatchEvent): Promise<void> {
  const { periodType } = event
  console.log(`[dispatcher] Starting report dispatch for periodType=${periodType}`)

  const queueUrl = process.env['AREA_CODE_REPORT_QUEUE_URL']
  if (!queueUrl) {
    console.error('[dispatcher] AREA_CODE_REPORT_QUEUE_URL not set')
    return
  }

  const { periodStart, periodEnd } = computePeriodBoundaries(periodType)
  console.log(`[dispatcher] Period: ${periodStart} to ${periodEnd}`)

  const businesses = await getAllBusinesses()
  console.log(`[dispatcher] Found ${businesses.length} businesses`)

  let dispatched = 0
  let skipped = 0

  for (const business of businesses) {
    try {
      const nodeIds = await getNodeIdsForBusiness(business.businessId)

      if (nodeIds.length === 0) {
        skipped++
        continue
      }

      const hasActivity = await hasActivityInPeriod(nodeIds, periodStart, periodEnd)

      if (!hasActivity) {
        skipped++
        continue
      }

      await sendGenerationMessage(queueUrl, {
        businessId: business.businessId,
        periodType,
        periodStart,
        periodEnd,
      })

      dispatched++
    } catch (error) {
      console.error(`[dispatcher] Error processing business ${business.businessId}:`, error)
      // Continue with next business
    }
  }

  console.log(`[dispatcher] Complete: dispatched=${dispatched}, skipped=${skipped}`)
}
