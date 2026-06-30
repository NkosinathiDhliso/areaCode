/**
 * Per-staff redemption leaderboard for the business portal.
 *
 * Why this exists:
 *   Staff motivation is the #1 lever for loyalty-app adoption at the till.
 *   Showing a ranked list visible to *both* the owner and the staff member
 *   themselves creates the social proof / mild competition that converts
 *   passive staff into active app pitchers.
 *
 * Inputs:
 *   - REDEMPTION# rows in appData (have staffId, userId, redeemedAt, businessId)
 *   - CHECKIN# rows via UserIndex (used to compute the "return visit" credit)
 *
 * Period semantics:
 *   - We compute over a fixed window ('week' = last 7 full days, 'month' = 30,
 *     'all' = since business creation). Previous-period delta uses the
 *     immediately preceding equal-length window.
 *
 * Cost guardrail:
 *   - Cached for 5 minutes per (businessId, period). Owners refreshing won't
 *     re-scan. Worst-case scan is bounded by REDEMPTION# entries for the
 *     business, not all redemptions globally.
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { getStaffByBusinessId } from '../auth/dynamodb-repository.js'
import { getCheckInsByUser } from '../check-in/dynamodb-repository.js'

export type LeaderboardPeriod = 'week' | 'month' | 'all'

export interface StaffLeaderboardEntry {
  staffId: string
  staffName: string
  redemptions: number
  prevRedemptions: number
  delta: number
  attributedReturnVisits: number
  uniqueConsumersServed: number
}

export interface LeaderboardPayload {
  period: LeaderboardPeriod
  entries: StaffLeaderboardEntry[]
  generatedAt: string
}

interface CacheEntry {
  payload: LeaderboardPayload
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000

const cache = new Map<string, CacheEntry>()

function periodWindow(period: LeaderboardPeriod, now = Date.now()) {
  const day = 86_400_000
  if (period === 'week') {
    return {
      currentStart: new Date(now - 7 * day).toISOString(),
      previousStart: new Date(now - 14 * day).toISOString(),
      previousEnd: new Date(now - 7 * day).toISOString(),
    }
  }
  if (period === 'month') {
    return {
      currentStart: new Date(now - 30 * day).toISOString(),
      previousStart: new Date(now - 60 * day).toISOString(),
      previousEnd: new Date(now - 30 * day).toISOString(),
    }
  }
  return {
    currentStart: '1970-01-01T00:00:00Z',
    previousStart: '1970-01-01T00:00:00Z',
    previousEnd: '1970-01-01T00:00:00Z',
  }
}

interface RedemptionRow {
  staffId?: string
  staffName?: string
  userId?: string
  businessId?: string
  redeemedAt?: string
}

/**
 * Pull all redemptions for a business since a cutoff. Filters in-server
 * because there's no GSI on businessId for REDEMPTION# rows. With low
 * volume this is fine; if scans grow too costly we add a GSI later.
 */
async function listRedemptionsForBusiness(businessId: string, sinceIso: string): Promise<RedemptionRow[]> {
  const out: RedemptionRow[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.appData,
        FilterExpression: 'begins_with(pk, :prefix) AND businessId = :biz AND redeemedAt >= :since',
        ExpressionAttributeValues: {
          ':prefix': 'REDEMPTION#',
          ':biz': businessId,
          ':since': sinceIso,
        },
        ProjectionExpression: 'staffId, staffName, userId, businessId, redeemedAt',
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      out.push({
        staffId: item['staffId'] as string | undefined,
        staffName: item['staffName'] as string | undefined,
        userId: item['userId'] as string | undefined,
        businessId: item['businessId'] as string | undefined,
        redeemedAt: item['redeemedAt'] as string | undefined,
      })
    }
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)
  return out
}

/**
 * Pull guest claims tied to nodes owned by `businessId` since `sinceIso`.
 * Guest claims (Churn-defences spec, Req 6) count toward staff
 * `redemptions` and `uniqueConsumersServed` but NOT
 * `attributedReturnVisits` (no userId at issue time to track returns).
 *
 * Token-based: each row is uniquely identified by its token. Once a
 * token is redeemed by a real user, we dedup by userId; otherwise the
 * userId field is left undefined.
 */
async function listGuestClaimsForBusiness(businessNodeIds: Set<string>, sinceIso: string): Promise<RedemptionRow[]> {
  if (businessNodeIds.size === 0) return []
  const { listGuestClaimsSince } = await import('../rewards/guest-claim.js')
  const all = await listGuestClaimsSince(sinceIso, 'issuedAt')
  return all
    .filter((c) => businessNodeIds.has(c.nodeId))
    .map((c) => ({
      staffId: c.staffId,
      staffName: c.staffName,
      userId: c.redeemedByUserId,
      redeemedAt: c.issuedAt,
    }))
}

/**
 * For a redemption to count as an "attributed return visit", the consumer
 * must have at least one further check-in at any node owned by the
 * business within 30 days of the redemption.
 *
 * This is the metric that translates staff effort into business ROI.
 */
async function countReturnVisits(
  redemptions: Array<{ userId: string; redeemedAt: string }>,
  businessNodeIds: Set<string>,
): Promise<Map<string, number>> {
  const byUser = new Map<string, string[]>()
  for (const r of redemptions) {
    const arr = byUser.get(r.userId) ?? []
    arr.push(r.redeemedAt)
    byUser.set(r.userId, arr)
  }

  const returnsPerRedemption = new Map<string, number>()
  for (const [userId, redeemTimes] of byUser) {
    const { checkIns } = await getCheckInsByUser(userId, { limit: 200 })
    for (const ts of redeemTimes) {
      const ms = Date.parse(ts)
      const hasReturn = checkIns.some(
        (c) =>
          businessNodeIds.has(c.nodeId) &&
          Date.parse(c.checkedInAt) > ms &&
          Date.parse(c.checkedInAt) <= ms + 30 * 86_400_000,
      )
      if (hasReturn) returnsPerRedemption.set(`${userId}#${ts}`, 1)
    }
  }
  return returnsPerRedemption
}

/**
 * Get all node IDs owned by a business. We need this to know whether a
 * subsequent check-in counts as a "return" to that staff member's venue
 * (vs. some other unrelated business they happened to visit).
 */
async function getBusinessNodeIds(businessId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.nodes,
        IndexName: 'BusinessIndex',
        FilterExpression: 'businessId = :biz',
        ExpressionAttributeValues: { ':biz': businessId },
        ProjectionExpression: 'nodeId, id',
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      ids.add(item['nodeId'] as string)
    }
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)
  return ids
}

export async function getStaffLeaderboard(businessId: string, period: LeaderboardPeriod): Promise<LeaderboardPayload> {
  const key = `${businessId}:${period}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.payload

  const window = periodWindow(period)
  const since = period === 'all' ? '1970-01-01T00:00:00Z' : window.previousStart
  const all = await listRedemptionsForBusiness(businessId, since)

  // Resolve business node IDs once so we can filter guest claims.
  const businessNodeIds = await getBusinessNodeIds(businessId)
  const guestRows = await listGuestClaimsForBusiness(businessNodeIds, since)
  // Combine; guest rows are flagged so we can exclude them from return-visit
  // attribution.
  const guestKeys = new Set<string>()
  for (const g of guestRows) {
    if (g.userId && g.redeemedAt) guestKeys.add(`${g.userId}#${g.redeemedAt}`)
  }
  const allRows = [...all, ...guestRows]

  const current = allRows.filter((r) => (r.redeemedAt ?? '') >= window.currentStart)
  const previous = allRows.filter(
    (r) => (r.redeemedAt ?? '') >= window.previousStart && (r.redeemedAt ?? '') < window.previousEnd,
  )

  // Roster — include staff with zero redemptions so the leaderboard shows
  // who isn't pulling their weight, not just who is.
  const roster = await getStaffByBusinessId(businessId)
  const byStaffName = new Map<string, string>()
  for (const s of roster) {
    byStaffName.set(s.staffId, s.name)
  }

  const counts = new Map<string, { current: number; prev: number; users: Set<string> }>()
  for (const r of current) {
    if (!r.staffId) continue
    const c = counts.get(r.staffId) ?? { current: 0, prev: 0, users: new Set<string>() }
    c.current++
    if (r.userId) c.users.add(r.userId)
    counts.set(r.staffId, c)
  }
  for (const r of previous) {
    if (!r.staffId) continue
    const c = counts.get(r.staffId) ?? { current: 0, prev: 0, users: new Set<string>() }
    c.prev++
    counts.set(r.staffId, c)
  }
  for (const staffId of byStaffName.keys()) {
    if (!counts.has(staffId)) counts.set(staffId, { current: 0, prev: 0, users: new Set<string>() })
  }

  // Return visit attribution.
  // Guest claims are excluded — we have only a phone number (stored under
  // `userId` for counting purposes), no real userId, so we cannot link to
  // subsequent check-ins.
  const validCurrent = current.flatMap((r) =>
    r.userId && r.redeemedAt && !guestKeys.has(`${r.userId}#${r.redeemedAt}`)
      ? [{ userId: r.userId, redeemedAt: r.redeemedAt, staffId: r.staffId ?? '' }]
      : [],
  )
  const returnFlags = await countReturnVisits(validCurrent, businessNodeIds)
  const returnsPerStaff = new Map<string, number>()
  for (const r of validCurrent) {
    const k = `${r.userId}#${r.redeemedAt}`
    if (returnFlags.has(k)) {
      returnsPerStaff.set(r.staffId, (returnsPerStaff.get(r.staffId) ?? 0) + 1)
    }
  }

  const entries: StaffLeaderboardEntry[] = []
  for (const [staffId, c] of counts) {
    entries.push({
      staffId,
      staffName: byStaffName.get(staffId) ?? '(former staff)',
      redemptions: c.current,
      prevRedemptions: c.prev,
      delta: c.current - c.prev,
      attributedReturnVisits: returnsPerStaff.get(staffId) ?? 0,
      uniqueConsumersServed: c.users.size,
    })
  }

  // Rank: redemptions desc, then return visits desc, then name asc for stability.
  entries.sort((a, b) => {
    if (b.redemptions !== a.redemptions) return b.redemptions - a.redemptions
    if (b.attributedReturnVisits !== a.attributedReturnVisits) {
      return b.attributedReturnVisits - a.attributedReturnVisits
    }
    return a.staffName.localeCompare(b.staffName)
  })

  const payload: LeaderboardPayload = {
    period,
    entries,
    generatedAt: new Date().toISOString(),
  }
  cache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS })
  return payload
}

export function clearLeaderboardCache(): void {
  cache.clear()
}
