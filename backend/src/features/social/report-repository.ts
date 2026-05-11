/**
 * Report repository for harassment/stalking reports.
 * Uses the app-data single-table design.
 *
 * Report records:
 *   pk: REPORT#{reportId}
 *   sk: REPORT#{createdAt}
 *   gsi1pk: REPORT_QUEUE
 *   gsi1sk: {priority}#{createdAt}
 *
 * Harassment/stalking reports also create high-priority abuse flags.
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'

export type ReportCategory = 'harassment_report' | 'stalking' | 'spam' | 'inappropriate_content' | 'other'
export type ReportPriority = 'high' | 'normal'

export interface UserReport {
  reportId: string
  reporterId: string
  reportedUserId: string
  category: ReportCategory
  description: string
  priority: ReportPriority
  status: 'pending' | 'reviewed' | 'actioned'
  createdAt: string
}

export const HIGH_PRIORITY_CATEGORIES: Set<ReportCategory> = new Set(['harassment_report', 'stalking'])

/**
 * Determines the priority for a report based on its category.
 * Harassment and stalking reports are always high priority.
 */
export function determineReportPriority(category: ReportCategory): ReportPriority {
  return HIGH_PRIORITY_CATEGORIES.has(category) ? 'high' : 'normal'
}

/**
 * Determines whether a report category should create an abuse flag.
 * Returns the abuse flag metadata if yes, null otherwise.
 */
export function buildAbuseFlagForReport(report: {
  reportId: string
  reporterId: string
  reportedUserId: string
  category: ReportCategory
  description: string
}): { type: string; priority: ReportPriority; entityId: string } | null {
  if (!HIGH_PRIORITY_CATEGORIES.has(report.category)) {
    return null
  }
  return {
    type: 'harassment_report',
    priority: 'high',
    entityId: report.reportedUserId,
  }
}

export async function createReport(data: {
  reporterId: string
  reportedUserId: string
  category: ReportCategory
  description: string
}): Promise<UserReport> {
  const reportId = generateId()
  const now = new Date().toISOString()
  const priority: ReportPriority = HIGH_PRIORITY_CATEGORIES.has(data.category) ? 'high' : 'normal'

  const report: UserReport = {
    reportId,
    reporterId: data.reporterId,
    reportedUserId: data.reportedUserId,
    category: data.category,
    description: data.description,
    priority,
    status: 'pending',
    createdAt: now,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `REPORT#${reportId}`,
        sk: `REPORT#${now}`,
        gsi1pk: 'REPORT_QUEUE',
        gsi1sk: `${priority}#${now}`,
        ...report,
      },
    }),
  )

  // Create high-priority abuse flag for harassment/stalking reports
  if (HIGH_PRIORITY_CATEGORIES.has(data.category)) {
    const flagId = generateId()
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: {
          pk: `ABUSE#${flagId}`,
          sk: `USER#${data.reportedUserId}`,
          gsi1pk: 'ABUSE_QUEUE',
          gsi1sk: `high#${now}`,
          flagId,
          type: 'harassment_report',
          entityId: data.reportedUserId,
          entityType: 'user',
          evidenceJson: {
            reportId,
            reporterId: data.reporterId,
            category: data.category,
            description: data.description,
          },
          autoActioned: false,
          reviewed: false,
          priority: 'high',
          createdAt: now,
        },
      }),
    )
  }

  return report
}

export async function getReportQueue(limit = 50): Promise<UserReport[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'REPORT_QUEUE' },
      ScanIndexForward: false, // newest first, high priority first
      Limit: limit,
    }),
  )
  return (result.Items || []) as UserReport[]
}
