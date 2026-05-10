/**
 * Revenue Service — computes revenue metrics for the admin dashboard.
 * All queries use GSI1 with REVENUE#<YYYY-MM> partition key, never table scan.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8
 */
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { queryRevenueByMonth, getMonthsBetween, type PaymentRecord } from './revenue-repository.js'
import { logger } from '../../shared/monitoring/logger.js'

const revenueLogger = logger.child({ service: 'revenue-service' })

export interface BusinessRevenueRow {
  businessId: string
  businessName: string
  planTier: string
  totalPaid: number
  lastPaymentDate: string
}

export interface RevenueMetrics {
  mrr: number
  boostRevenue: number
  subscriptionCounts: Record<string, number>
  trialConversionRate: number
  flexDailyRevenue: number
}

/**
 * Get the current SAST month in YYYY-MM format.
 */
function getCurrentSASTMonth(): string {
  const now = new Date()
  const sastOffset = 2 * 60 * 60 * 1000
  const sast = new Date(now.getTime() + sastOffset)
  const year = sast.getUTCFullYear()
  const month = String(sast.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * MRR = sum of succeeded subscription payments in the current month,
 * normalized to monthly values.
 */
export async function getMRR(): Promise<number> {
  const currentMonth = getCurrentSASTMonth()
  const records = await queryRevenueByMonth(currentMonth)

  return records
    .filter((r) => r.status === 'succeeded' && r.type === 'subscription')
    .reduce((sum, r) => sum + r.amount, 0)
}

/**
 * Boost revenue for a date range = sum of succeeded boost payments.
 */
export async function getBoostRevenue(startDate: string, endDate: string): Promise<number> {
  const months = getMonthsBetween(startDate, endDate)
  let total = 0

  for (const month of months) {
    const records = await queryRevenueByMonth(month, startDate, endDate)
    total += records
      .filter((r) => r.status === 'succeeded' && r.type === 'boost')
      .reduce((sum, r) => sum + r.amount, 0)
  }

  return total
}

/**
 * Active subscription counts grouped by tier.
 * Queries ALL_BUSINESSES index to get current tier for each business.
 */
export async function getSubscriptionCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    starter: 0,
    growth: 0,
    pro: 0,
    flex_daily: 0,
  }

  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': 'ALL_BUSINESSES' },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )

    for (const item of result.Items ?? []) {
      const tier = (item['tier'] as string) ?? 'starter'
      // Normalize legacy 'payg' to 'flex_daily'
      const normalizedTier = tier === 'payg' ? 'flex_daily' : tier
      if (normalizedTier in counts) {
        counts[normalizedTier]!++
      } else {
        counts[normalizedTier] = 1
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)

  return counts
}

/**
 * Trial conversion rate = businesses upgraded from starter within 30 days
 * / total businesses that started on starter tier.
 */
export async function getTrialConversionRate(): Promise<number> {
  let totalStarter = 0
  let convertedWithin30Days = 0

  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': 'ALL_BUSINESSES' },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )

    for (const item of result.Items ?? []) {
      const createdAt = item['createdAt'] as string | undefined
      const tier = (item['tier'] as string) ?? 'starter'
      const upgradedAt = item['upgradedAt'] as string | undefined

      // Count all businesses that started on starter
      totalStarter++

      // Check if upgraded within 30 days
      if (tier !== 'starter' && createdAt && upgradedAt) {
        const created = new Date(createdAt).getTime()
        const upgraded = new Date(upgradedAt).getTime()
        const thirtyDays = 30 * 24 * 60 * 60 * 1000
        if (upgraded - created <= thirtyDays) {
          convertedWithin30Days++
        }
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)

  if (totalStarter === 0) return 0
  return Math.round((convertedWithin30Days / totalStarter) * 10000) / 100
}

/**
 * Flex Daily (PAYG) revenue for a date range.
 */
export async function getFlexDailyRevenue(startDate: string, endDate: string): Promise<number> {
  const months = getMonthsBetween(startDate, endDate)
  let total = 0

  for (const month of months) {
    const records = await queryRevenueByMonth(month, startDate, endDate)
    total += records
      .filter(
        (r) =>
          r.status === 'succeeded' &&
          r.type === 'subscription' &&
          (r.planTier === 'flex_daily' || r.planTier === 'payg'),
      )
      .reduce((sum, r) => sum + r.amount, 0)
  }

  return total
}

/**
 * Per-business revenue breakdown for a date range.
 */
export async function getPerBusinessBreakdown(
  startDate: string,
  endDate: string,
): Promise<BusinessRevenueRow[]> {
  const months = getMonthsBetween(startDate, endDate)
  const businessMap = new Map<string, { totalPaid: number; lastPaymentDate: string; planTier: string }>()

  for (const month of months) {
    const records = await queryRevenueByMonth(month, startDate, endDate)
    for (const record of records) {
      if (record.status !== 'succeeded') continue
      const existing = businessMap.get(record.businessId)
      if (existing) {
        existing.totalPaid += record.amount
        if (record.createdAt > existing.lastPaymentDate) {
          existing.lastPaymentDate = record.createdAt
          existing.planTier = record.planTier
        }
      } else {
        businessMap.set(record.businessId, {
          totalPaid: record.amount,
          lastPaymentDate: record.createdAt,
          planTier: record.planTier,
        })
      }
    }
  }

  // Enrich with business names
  const rows: BusinessRevenueRow[] = []
  for (const [businessId, data] of businessMap) {
    let businessName = businessId
    try {
      const result = await documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          KeyConditionExpression: 'pk = :pk AND sk = :sk',
          ExpressionAttributeValues: { ':pk': `BUSINESS#${businessId}`, ':sk': `PROFILE#${businessId}` },
          Limit: 1,
        }),
      )
      const item = result.Items?.[0]
      if (item?.['businessName']) {
        businessName = item['businessName'] as string
      }
    } catch (err) {
      revenueLogger.warn('Failed to fetch business name for revenue breakdown', { businessId })
    }

    rows.push({
      businessId,
      businessName,
      planTier: data.planTier,
      totalPaid: data.totalPaid,
      lastPaymentDate: data.lastPaymentDate,
    })
  }

  // Sort by totalPaid descending
  rows.sort((a, b) => b.totalPaid - a.totalPaid)
  return rows
}
