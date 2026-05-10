import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb'
import { computeBaseline, computeUplift } from './boost-roi-computation'

export { computeBaseline, computeUplift } from './boost-roi-computation'

export interface BoostROIResult {
  boostId: string
  nodeId: string
  startDate: string
  endDate: string
  durationHours: number
  checkInsDuringBoost: number
  baseline: number
  upliftPercent: number | null
  insufficientData: boolean
  costCents: number
}

/**
 * Computes baseline check-in count for the same time window across prior 4 weeks.
 * Returns null if fewer than 2 weeks of data exist.
 */
// computeBaseline and computeUplift are imported from boost-roi-computation.ts

export interface BoostRecord {
  id: string
  nodeId: string
  businessId: string
  startedAt: string
  endedAt: string
  durationHours: number
  costCents: number
}

export async function getBoostROI(businessId: string, nodeId?: string): Promise<BoostROIResult[]> {
  // Query completed boosts for this business
  const boostResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `BOOST#${businessId}`,
        ':skPrefix': nodeId ? `${nodeId}#` : '',
      },
    }),
  )

  const boosts: BoostRecord[] = (boostResult.Items ?? []).map((item) => ({
    id: item['sk'] as string,
    nodeId: item['nodeId'] as string,
    businessId: item['businessId'] as string,
    startedAt: item['startedAt'] as string,
    endedAt: item['endedAt'] as string,
    durationHours: item['durationHours'] as number,
    costCents: item['costCents'] as number,
  }))

  const results: BoostROIResult[] = []

  for (const boost of boosts) {
    if (!boost.endedAt) continue // Skip active boosts

    const boostStart = new Date(boost.startedAt)
    const boostEnd = new Date(boost.endedAt)

    // Get check-ins during boost window
    const boostCheckIns = await getCheckInCount(boost.nodeId, boostStart, boostEnd)

    // Get historical check-in counts for same window in prior 4 weeks
    const historicalCounts = await getHistoricalCheckInCounts(
      boost.nodeId,
      boostStart,
      boostEnd,
      4,
    )

    const baseline = computeBaseline(historicalCounts)
    const upliftPercent = computeUplift(boostCheckIns, baseline)

    results.push({
      boostId: boost.id,
      nodeId: boost.nodeId,
      startDate: boost.startedAt,
      endDate: boost.endedAt,
      durationHours: boost.durationHours,
      checkInsDuringBoost: boostCheckIns,
      baseline: baseline ?? 0,
      upliftPercent,
      insufficientData: baseline === null,
      costCents: boost.costCents,
    })
  }

  return results
}

async function getCheckInCount(nodeId: string, start: Date, end: Date): Promise<number> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `CHECKIN#${nodeId}`,
        ':start': start.toISOString(),
        ':end': end.toISOString(),
      },
      Select: 'COUNT',
    }),
  )
  return result.Count ?? 0
}

async function getHistoricalCheckInCounts(
  nodeId: string,
  boostStart: Date,
  boostEnd: Date,
  weeksBack: number,
): Promise<number[]> {
  const counts: number[] = []
  const windowMs = boostEnd.getTime() - boostStart.getTime()

  for (let week = 1; week <= weeksBack; week++) {
    const historicalStart = new Date(boostStart.getTime() - week * 7 * 24 * 60 * 60 * 1000)
    const historicalEnd = new Date(historicalStart.getTime() + windowMs)
    const count = await getCheckInCount(nodeId, historicalStart, historicalEnd)
    // Only include weeks where data exists (node was active)
    counts.push(count)
  }

  // Filter to only weeks where the node existed (has any check-in data)
  // We consider a week valid if it has at least 0 check-ins (node existed)
  return counts
}
