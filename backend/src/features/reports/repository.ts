import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { reportTokensSchema, type Report, type ReportMetrics } from './types.js'

// ============================================================================
// Constants
// ============================================================================

/** TTL: 365 days in seconds */
const REPORT_TTL_SECONDS = 365 * 24 * 60 * 60

/** Page size for listing reports */
const LIST_PAGE_SIZE = 10

// ============================================================================
// Store Report
// ============================================================================

/**
 * Store a generated report in the app-data table.
 *
 * Key structure:
 *   pk: REPORT#<businessId>
 *   sk: <periodType>#<periodStart>
 *   gsi1pk: REPORTS#<businessId>
 *   gsi1sk: <generatedAt> (ISO 8601)
 */
export async function storeReport(report: Report): Promise<void> {
  const ttlEpoch = Math.floor(new Date(report.generatedAt).getTime() / 1000) + REPORT_TTL_SECONDS

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `REPORT#${report.businessId}`,
        sk: `${report.periodType}#${report.periodStart}`,
        gsi1pk: `REPORTS#${report.businessId}`,
        gsi1sk: report.generatedAt,
        ttl: ttlEpoch,
        data: JSON.stringify(report),
        // Denormalized fields for list view
        reportId: report.reportId,
        schemaVersion: report.schemaVersion,
        periodType: report.periodType,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        generatedAt: report.generatedAt,
        totalCheckIns: report.summary.totalCheckIns,
      },
    }),
  )
}

// ============================================================================
// Store Report Visitor Tokens (companion row)
// ============================================================================

/**
 * Persist a period's hashed visitor token set in a companion row so the next
 * period can intersect against it to compute the repeat-visitor rate.
 *
 * Key structure (parallel to the report row so tokens and report are always
 * found together for a given period):
 *   pk: REPORT_TOKENS#<businessId>
 *   sk: <periodType>#<periodStart>
 *
 * Tokens are one-way hashes (no PII) and this row is never returned to clients.
 * A TTL auto-expires the row (DynamoDB TTL) matching the report retention.
 */
export async function storeReportTokens(
  businessId: string,
  periodType: string,
  periodStart: string,
  tokens: string[],
): Promise<void> {
  const ttlEpoch = Math.floor(Date.now() / 1000) + REPORT_TTL_SECONDS

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `REPORT_TOKENS#${businessId}`,
        sk: `${periodType}#${periodStart}`,
        ttl: ttlEpoch,
        businessId,
        periodType,
        periodStart,
        tokens,
      },
    }),
  )
}

// ============================================================================
// Store Business Metrics (benchmark cache)
// ============================================================================

/**
 * Persist the business's latest period metrics so the benchmark analyzer can
 * compare comparable venues against each other. `loadCategoryVenueMetrics`
 * reads this exact shape.
 *
 * Key structure (single latest-wins row per business):
 *   pk: BIZ_METRICS#<businessId>
 *   sk: LATEST
 *
 * Contains no PII (aggregate counts and scores only) and is never returned to
 * clients directly — only aggregated into anonymized benchmark comparisons.
 */
export async function storeBusinessMetrics(businessId: string, metrics: ReportMetrics): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `BIZ_METRICS#${businessId}`,
        sk: 'LATEST',
        totalCheckIns: metrics.totalCheckIns,
        uniqueVisitors: metrics.uniqueVisitors,
        repeatVisitorRate: metrics.repeatVisitorRate,
        pulseScore: metrics.pulseScore,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
}

// ============================================================================
// Get Report
// ============================================================================

/**
 * Retrieve a single report by businessId and reportId.
 * Queries GSI1 to find the report by reportId, then parses the stored JSON.
 */
export async function getReport(businessId: string, reportId: string): Promise<Report | null> {
  // Query GSI1 to find the report — reportId is stored as a denormalized field
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :gsi1pk',
      FilterExpression: 'reportId = :reportId',
      ExpressionAttributeValues: {
        ':gsi1pk': `REPORTS#${businessId}`,
        ':reportId': reportId,
      },
      Limit: 1,
    }),
  )

  const item = result.Items?.[0]
  if (!item) return null

  try {
    return JSON.parse(item['data'] as string) as Report
  } catch {
    return null
  }
}

// ============================================================================
// List Reports
// ============================================================================

/**
 * List reports for a business, sorted by date descending.
 * Uses GSI1 with REPORTS#<businessId> partition key.
 * Returns denormalized summary fields and a cursor for pagination.
 */
export async function listReports(
  businessId: string,
  cursor?: string,
  period?: string,
): Promise<{
  items: Array<{
    reportId: string
    periodType: string
    periodStart: string
    periodEnd: string
    generatedAt: string
    totalCheckIns: number
  }>
  nextCursor?: string
}> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `REPORTS#${businessId}`,
        ...(period ? { ':period': period } : {}),
      },
      ...(period ? { FilterExpression: 'periodType = :period' } : {}),
      ScanIndexForward: false,
      Limit: LIST_PAGE_SIZE,
      ...(cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString()) } : {}),
    }),
  )

  const items = (result.Items || []).map((item) => ({
    reportId: item['reportId'] as string,
    periodType: item['periodType'] as string,
    periodStart: item['periodStart'] as string,
    periodEnd: item['periodEnd'] as string,
    generatedAt: item['generatedAt'] as string,
    totalCheckIns: (item['totalCheckIns'] as number) ?? 0,
  }))

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { items, nextCursor }
}

// ============================================================================
// Get Previous Report
// ============================================================================

/**
 * The previous period's report plus its persisted hashed visitor token set.
 * `visitorTokens` is empty when no tokens were stored for that period.
 */
export interface PreviousReportData {
  report: Report
  visitorTokens: string[]
}

/**
 * Get the previous period's report (and its stored visitor tokens) for trend
 * and repeat-visitor comparison. Computes the previous period's sort key and
 * does a direct GetItem for both the report row and its companion tokens row,
 * keyed identically so they are always consistent for the period.
 */
export async function getPreviousReport(
  businessId: string,
  periodType: string,
  periodStart: string,
): Promise<PreviousReportData | null> {
  const previousPeriodStart = computePreviousPeriodStart(periodType, periodStart)
  if (!previousPeriodStart) return null

  const sk = `${periodType}#${previousPeriodStart}`

  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: {
        pk: `REPORT#${businessId}`,
        sk,
      },
    }),
  )

  const item = result.Item
  if (!item) return null

  let report: Report
  try {
    report = JSON.parse(item['data'] as string) as Report
  } catch {
    return null
  }

  const visitorTokens = await getReportTokens(businessId, sk)
  return { report, visitorTokens }
}

/**
 * Read the hashed visitor token set for a given period's companion row.
 * Returns an empty array when the row is absent or fails validation.
 */
async function getReportTokens(businessId: string, sk: string): Promise<string[]> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: {
        pk: `REPORT_TOKENS#${businessId}`,
        sk,
      },
    }),
  )

  if (!result.Item) return []

  const parsed = reportTokensSchema.safeParse(result.Item)
  return parsed.success ? parsed.data.tokens : []
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute the previous period's start date string.
 *
 * Weekly: subtract 7 days from the given Monday date
 * Monthly: subtract 1 month from the given YYYY-MM or YYYY-MM-DD
 */
function computePreviousPeriodStart(periodType: string, periodStart: string): string | null {
  if (periodType === 'weekly') {
    // periodStart is an ISO date like "2025-01-06"
    const date = new Date(periodStart)
    if (isNaN(date.getTime())) return null
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]!
  }

  if (periodType === 'monthly') {
    // periodStart is like "2025-01" or "2025-01-01"
    const parts = periodStart.split('-')
    const year = parseInt(parts[0]!, 10)
    const month = parseInt(parts[1]!, 10)
    if (isNaN(year) || isNaN(month)) return null

    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    return `${prevYear}-${prevMonth.toString().padStart(2, '0')}`
  }

  return null
}
