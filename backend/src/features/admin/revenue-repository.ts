/**
 * Revenue Repository — DynamoDB queries for revenue aggregation.
 * All queries use GSI1 with partition key REVENUE#<YYYY-MM>, never table scan.
 */
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

export interface PaymentRecord {
  paymentId: string
  businessId: string
  amount: number
  type: 'subscription' | 'boost'
  planTier: string
  nodeId: string | null
  status: 'succeeded' | 'failed' | 'refunded' | 'pending'
  paymentProvider: string
  currency: string
  description: string
  createdAt: string
}

/**
 * Query payment records for a given YYYY-MM partition using GSI1.
 * Optionally filter by date range within the month.
 */
export async function queryRevenueByMonth(
  month: string,
  startDate?: string,
  endDate?: string,
): Promise<PaymentRecord[]> {
  const records: PaymentRecord[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const params: Record<string, unknown> = {
      TableName: TableNames.appData,
      IndexName: 'gsi1',
      KeyConditionExpression:
        startDate && endDate
          ? 'gsi1pk = :pk AND gsi1sk BETWEEN :start AND :end'
          : 'gsi1pk = :pk',
      ExpressionAttributeValues:
        startDate && endDate
          ? { ':pk': `REVENUE#${month}`, ':start': startDate, ':end': `${endDate}\uffff` }
          : { ':pk': `REVENUE#${month}` },
      ExclusiveStartKey: exclusiveStartKey,
    }

    const result = await documentClient.send(new QueryCommand(params as never))
    const items = (result.Items ?? []) as unknown as PaymentRecord[]
    records.push(...items)
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)

  return records
}

/**
 * Get all months between two dates in YYYY-MM format (SAST timezone).
 */
export function getMonthsBetween(startDate: string, endDate: string): string[] {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const months: string[] = []

  // Convert to SAST for month boundaries
  const sastOffset = 2 * 60 * 60 * 1000
  const startSAST = new Date(start.getTime() + sastOffset)
  const endSAST = new Date(end.getTime() + sastOffset)

  let current = new Date(Date.UTC(startSAST.getUTCFullYear(), startSAST.getUTCMonth(), 1))
  const endMonth = new Date(Date.UTC(endSAST.getUTCFullYear(), endSAST.getUTCMonth(), 1))

  while (current <= endMonth) {
    const year = current.getUTCFullYear()
    const month = String(current.getUTCMonth() + 1).padStart(2, '0')
    months.push(`${year}-${month}`)
    current = new Date(Date.UTC(year, current.getUTCMonth() + 1, 1))
  }

  return months
}

/**
 * Query payment records for a business using the primary key pattern.
 * pk=PAYMENT#<businessId>, sorted by sk (timestamp#paymentId) descending.
 */
export async function queryBusinessPayments(
  businessId: string,
  limit: number,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<{ items: PaymentRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `PAYMENT#${businessId}` },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  )

  return {
    items: (result.Items ?? []) as unknown as PaymentRecord[],
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
  }
}
