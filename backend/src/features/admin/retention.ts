/**
 * Cohort retention analytics.
 *
 * Source data:
 *   - Users table (createdAt = signup timestamp)
 *   - CheckIns table, GSI UserIndex (userId hash, checkedInAt range)
 *
 * Strategy:
 *   1. Scan users table once with a projection on (userId, createdAt) only.
 *   2. Bucket users into ISO-week cohorts based on createdAt.
 *   3. For each user, query their first 90 days of check-ins via UserIndex.
 *   4. Compute Day-1 / Day-7 / Day-30 / Day-90 retention per cohort.
 *
 * Caveats / cost guard rails:
 *   - We cap to the most recent N cohorts (default 12 weeks) so a single
 *     run is bounded. Older cohorts come from a daily worker, not on-demand.
 *   - Results cache for 30 minutes. Admins refreshing every minute won't
 *     re-scan the whole table.
 *   - We project only the columns we need on every Scan.
 *   - For each user we Query (not Scan) the GSI by userId — that's O(checkins
 *     for that user), not O(table).
 */

import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

export type RetentionWindow = 'd1' | 'd7' | 'd30' | 'd90'

export interface CohortRow {
  cohortWeekStart: string // ISO date, Monday
  signups: number
  d1: number
  d7: number
  d30: number
  d90: number
  d1Pct: number
  d7Pct: number
  d30Pct: number
  d90Pct: number
}

export interface VenueLeak {
  nodeId: string
  nodeName: string
  signupsAttributed: number
  d7ReturnCount: number
  d7ReturnPct: number
}

export interface RetentionPayload {
  cohorts: CohortRow[]
  topLeakingVenues: VenueLeak[]
  generatedAt: string
  cacheMinutes: number
}

const CACHE_TTL_MS = 30 * 60 * 1000

let cache: { payload: RetentionPayload; expiresAt: number } | null = null

interface UserSlim {
  userId: string
  createdAt: string
  firstCheckInNodeId?: string
}

/** Monday of the ISO week containing `d`, as YYYY-MM-DD. */
function isoWeekMonday(d: Date): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = dt.getUTCDay() || 7 // Sunday = 7
  if (day !== 1) dt.setUTCDate(dt.getUTCDate() - (day - 1))
  return dt.toISOString().slice(0, 10)
}

function dayDiff(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

/**
 * Get the (userId, createdAt) for users that signed up in the last `weeks`
 * weeks. Capped to 5,000 to bound cost on the hot path. The daily worker
 * (not yet implemented) is the right place to compute deeper history.
 */
async function listRecentUsers(weeks: number, hardCap = 5_000): Promise<UserSlim[]> {
  const sinceIso = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString()
  const out: UserSlim[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.users,
        FilterExpression: 'createdAt >= :since',
        ExpressionAttributeValues: { ':since': sinceIso },
        ProjectionExpression: 'userId, createdAt',
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      out.push({
        userId: item['userId'] as string,
        createdAt: item['createdAt'] as string,
      })
      if (out.length >= hardCap) return out
    }
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)

  return out
}

interface CheckInSlim {
  checkedInAt: string
  nodeId: string
}

async function getUserCheckIns(userId: string): Promise<CheckInSlim[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId },
      ProjectionExpression: 'checkedInAt, nodeId',
    }),
  )
  return (result.Items ?? []).map((i) => ({
    checkedInAt: i['checkedInAt'] as string,
    nodeId: i['nodeId'] as string,
  }))
}

interface CohortBuckets {
  d1: number
  d7: number
  d30: number
  d90: number
}

function tallyMember(
  signupAt: string,
  checkIns: CheckInSlim[],
  buckets: CohortBuckets,
  venueStats: Map<string, { signups: number; d7Returns: number }>,
): void {
  if (checkIns.length === 0) return
  const sortedAt = checkIns.map((c) => c.checkedInAt).sort()
  const first = sortedAt[0]!
  const ageDays = dayDiff(signupAt, first)

  if (ageDays <= 1) buckets.d1++
  if (ageDays <= 7) buckets.d7++
  if (ageDays <= 30) buckets.d30++
  if (ageDays <= 90) buckets.d90++

  const earliestCheckIn = checkIns.reduce((acc, c) => (c.checkedInAt < acc.checkedInAt ? c : acc))
  const v = venueStats.get(earliestCheckIn.nodeId) ?? { signups: 0, d7Returns: 0 }
  v.signups++
  if (ageDays <= 7 && checkIns.length > 1) v.d7Returns++
  venueStats.set(earliestCheckIn.nodeId, v)
}

async function processCohort(
  weekStart: string,
  members: UserSlim[],
  venueStats: Map<string, { signups: number; d7Returns: number }>,
): Promise<CohortRow> {
  const buckets: CohortBuckets = { d1: 0, d7: 0, d30: 0, d90: 0 }

  // Process users in batches of 25 so we don't hammer DynamoDB.
  const batchSize = 25
  for (let i = 0; i < members.length; i += batchSize) {
    const slice = members.slice(i, i + batchSize)
    const results = await Promise.all(slice.map((m) => getUserCheckIns(m.userId)))
    slice.forEach((m, j) => tallyMember(m.createdAt, results[j]!, buckets, venueStats))
  }

  const signups = members.length
  return {
    cohortWeekStart: weekStart,
    signups,
    ...buckets,
    d1Pct: signups ? buckets.d1 / signups : 0,
    d7Pct: signups ? buckets.d7 / signups : 0,
    d30Pct: signups ? buckets.d30 / signups : 0,
    d90Pct: signups ? buckets.d90 / signups : 0,
  }
}

export async function computeRetention(weeks = 12): Promise<RetentionPayload> {
  if (cache && cache.expiresAt > Date.now()) return cache.payload

  const users = await listRecentUsers(weeks)

  // Group users into cohorts keyed by ISO week start.
  const cohortBuckets = new Map<string, UserSlim[]>()
  for (const u of users) {
    const key = isoWeekMonday(new Date(u.createdAt))
    const arr = cohortBuckets.get(key) ?? []
    arr.push(u)
    cohortBuckets.set(key, arr)
  }

  // Per-venue leak tally (signups attributed = user's first ever check-in is
  // at this node, regardless of cohort).
  const venueStats = new Map<string, { signups: number; d7Returns: number }>()

  const cohorts: CohortRow[] = []
  for (const [weekStart, members] of cohortBuckets) {
    const cohortRow = await processCohort(weekStart, members, venueStats)
    cohorts.push(cohortRow)
  }

  cohorts.sort((a, b) => (a.cohortWeekStart < b.cohortWeekStart ? 1 : -1))

  // Build top-leak list: venues with >= 5 attributed signups, sorted by
  // worst Day-7 return rate. Threshold avoids noise from venues with 1–2 signups.
  const venueLeaks: VenueLeak[] = []
  for (const [nodeId, stats] of venueStats) {
    if (stats.signups < 5) continue
    venueLeaks.push({
      nodeId,
      nodeName: '', // Filled in by service layer to keep this file repo-light
      signupsAttributed: stats.signups,
      d7ReturnCount: stats.d7Returns,
      d7ReturnPct: stats.d7Returns / stats.signups,
    })
  }
  venueLeaks.sort((a, b) => a.d7ReturnPct - b.d7ReturnPct)
  const topLeakingVenues = venueLeaks.slice(0, 10)

  const payload: RetentionPayload = {
    cohorts,
    topLeakingVenues,
    generatedAt: new Date().toISOString(),
    cacheMinutes: CACHE_TTL_MS / 60_000,
  }

  cache = { payload, expiresAt: Date.now() + CACHE_TTL_MS }
  return payload
}

export function clearRetentionCache(): void {
  cache = null
}
