// DynamoDB-backed cleanup worker (replaces Prisma)
import {
  ScanCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  BatchWriteCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb'

import { deleteUser, getUserById } from '../features/auth/dynamodb-repository.js'
import { deleteCheckInsByUser } from '../features/check-in/dynamodb-repository.js'
import { deleteGoingRowsForUser } from '../features/nodes/going-repository.js'
import { deleteUserByUsername } from '../shared/cognito/client.js'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { deleteConnectionsByUser } from '../shared/websocket/broadcast.js'

/**
 * Cleanup worker , processes right-to-erasure queue + housekeeping.
 * Runs daily via EventBridge.
 * DynamoDB TTL handles most expiration automatically; this worker
 * processes explicit erasure requests and cleans orphaned data.
 */

// ─── Booster 7-year POPIA retention ─────────────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/` requirements 8.1–8.6.
//
// `BoosterPurchase`, `Idempotency_Marker` (BOOST_CHECKOUT#…), and
// `Floor_Change_Audit_Row` rows MUST NOT carry a DynamoDB `ttl` attribute
// (R1.7 / R5.4 / R8.2). Their 7-year POPIA retention is enforced here, by
// the existing daily `cleanup` worker, rather than by TTL — DynamoDB TTL
// targets short-lived data and clock skew or attribute-name drift could
// risk premature deletion of legally-required financial records.
//
// The boundary is strict greater-than: a row whose
// `(now - reference_timestamp) === RETENTION_YEARS_MS` is NOT yet expired
// (R8.3 / R8.6). The `7 * 365.25` factor absorbs leap years across the
// 7-year horizon.
export const RETENTION_YEARS_MS = 7 * 365.25 * 24 * 60 * 60 * 1000

// ─── 12-month retention (owner-facing history rows) ─────────────────────────
//
// weekly-attribution-digest R3.2 and proof-of-demand R7.2. Two row types share
// this horizon, so they share one constant: `Digest_Row` (pk
// `DIGEST#<businessId>`) and the closed-window Boost_Scoreboard cache row (pk
// `KV#boost:score:<boostPk>:<boostSk>`). Neither carries a DynamoDB `ttl`,
// consistent with the audited booster rows, so retention is enforced here by
// the daily worker. `365.25` absorbs leap years; the boundary is strict
// greater-than (below).
export const RETENTION_TWELVE_MONTHS_MS = 365.25 * 24 * 60 * 60 * 1000

// Per-invocation, per-row-type delete budget. Paginated batches are 25 items
// (DynamoDB `BatchWriteItem` hard limit), so 1000 deletes ≈ 40 batches per
// row type per run. The first deletions will not run for at least 7 years
// from launch; the budget is sized so a backlog after that point is drained
// over a small number of daily runs.
const RETENTION_MAX_DELETES_PER_RUN_PER_TYPE = 1000
const RETENTION_BATCH_SIZE = 25

function parseIsoToMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Pure predicate — true iff a `BoosterPurchase` row is older than the
 * 7-year retention horizon at `nowMs`. Strict greater-than (R8.3): a row
 * exactly at the boundary is NOT expired. Missing or malformed `paidAt`
 * yields false so unknown timestamps are never deleted.
 */
export function isBoosterPurchaseExpired(row: { paidAt?: unknown }, nowMs: number): boolean {
  const ms = parseIsoToMs(row.paidAt)
  if (ms === null) return false
  return nowMs - ms > RETENTION_YEARS_MS
}

/**
 * Pure predicate — true iff a `Floor_Change_Audit_Row` is older than the
 * 7-year retention horizon at `nowMs`. Strict greater-than (R8.3).
 */
export function isFloorChangeAuditExpired(row: { changedAt?: unknown }, nowMs: number): boolean {
  const ms = parseIsoToMs(row.changedAt)
  if (ms === null) return false
  return nowMs - ms > RETENTION_YEARS_MS
}

/**
 * Pure predicate — true iff a `Idempotency_Marker` row (BOOST_CHECKOUT#…)
 * is older than the 7-year retention horizon at `nowMs`. Strict
 * greater-than (R8.6).
 */
export function isIdempotencyMarkerExpired(row: { createdAt?: unknown }, nowMs: number): boolean {
  const ms = parseIsoToMs(row.createdAt)
  if (ms === null) return false
  return nowMs - ms > RETENTION_YEARS_MS
}

/**
 * Pure predicate — true iff a `Digest_Row` is older than the 12-month
 * retention horizon at `nowMs` (R3.2). Strict greater-than: a row exactly
 * at the boundary is NOT expired. Missing or malformed `createdAt` yields
 * false so unknown timestamps are never deleted.
 */
export function isDigestRowExpired(row: { createdAt?: unknown }, nowMs: number): boolean {
  const ms = parseIsoToMs(row.createdAt)
  if (ms === null) return false
  return nowMs - ms > RETENTION_TWELVE_MONTHS_MS
}

/**
 * Pure predicate — true iff a closed-window Boost_Scoreboard cache row is
 * older than the 12-month horizon at `nowMs` (R7.2). `kvSet` stamps
 * `updatedAt` and no `ttl`, so `updatedAt` is the write instant and the only
 * reference available. Strict greater-than; malformed values yield false.
 */
export function isBoostScoreboardCacheExpired(row: { updatedAt?: unknown }, nowMs: number): boolean {
  const ms = parseIsoToMs(row.updatedAt)
  if (ms === null) return false
  return nowMs - ms > RETENTION_TWELVE_MONTHS_MS
}

async function batchDeleteKeys(keys: Array<{ pk: string; sk: string }>): Promise<void> {
  for (let i = 0; i < keys.length; i += RETENTION_BATCH_SIZE) {
    const slice = keys.slice(i, i + RETENTION_BATCH_SIZE)
    if (slice.length === 0) continue
    await documentClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TableNames.appData]: slice.map((key) => ({ DeleteRequest: { Key: key } })),
        },
      }),
    )
  }
}

/**
 * Delete every app-data row that names this consumer and return the row count
 * for the erasure audit log. Two anchored sets, no full-table scan (R2.4):
 * partitions the user owns, and the GSI1 partitions that embed the user id
 * (reverse edges and admin messages), which keeps the coverage the old
 * `contains(sk)` scan had while staying anchored.
 */
async function deleteAppDataForUser(userId: string): Promise<number> {
  // Rows the user owns (partition key IS the user).
  const ownedPartitions = [
    `USER#${userId}`, // consent (sk CONSENT#{id}); Going mirrors already gone above
    `FOLLOW#${userId}`, // outgoing follow edges
    `BLOCK#${userId}`, // outgoing block edges
    `NOTIF#${userId}`, // in-app notifications
    `NOTIF_PREFS#${userId}`, // notification preferences
    `USER_TOKEN#${userId}`, // web-push device tokens
    `MILESTONE#${userId}`, // milestones / achievements
    `COPTOUT#${userId}`, // campaign opt-outs
  ]
  const referencingGsi1Partitions = [
    `FOLLOWERS#${userId}`, // others following this user
    `BLOCKED_BY#${userId}`, // others who blocked this user
    `USER_MESSAGES#${userId}`, // admin messages addressed to this user
  ]

  let deleted = 0
  for (const partition of ownedPartitions) {
    deleted += await deleteAppDataPartition(partition)
  }
  for (const partition of referencingGsi1Partitions) {
    deleted += await deleteAppDataPartition(partition, { index: 'GSI1' })
  }
  return deleted
}

/**
 * The `{pk, sk}` of a scanned row, or null when either key is absent or not a
 * string. A row we cannot address is a row we must not try to delete.
 */
function retentionKeyOf(item: Record<string, unknown>): { pk: string; sk: string } | null {
  const pk = item['pk']
  const sk = item['sk']
  if (typeof pk !== 'string' || typeof sk !== 'string') return null
  return { pk, sk }
}

/**
 * Generic paged-Scan + batch-delete loop used by all three booster
 * retention sweeps. Scans `appData` with the given filter, evaluates
 * `predicate` against each row at the current `nowMs`, and batch-deletes
 * the keys for which the predicate returns true. Bounded by
 * `RETENTION_MAX_DELETES_PER_RUN_PER_TYPE` so a single invocation cannot
 * monopolise the worker's runtime budget.
 */
async function sweepExpiredRows(args: {
  filterExpression: string
  expressionAttributeValues: Record<string, unknown>
  predicate: (row: Record<string, unknown>, nowMs: number) => boolean
  nowMs: number
}): Promise<number> {
  const { filterExpression, expressionAttributeValues, predicate, nowMs } = args
  let deleted = 0
  let cursor: Record<string, unknown> | undefined

  while (deleted < RETENTION_MAX_DELETES_PER_RUN_PER_TYPE) {
    const params: Record<string, unknown> = {
      TableName: TableNames.appData,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    }
    if (cursor) params['ExclusiveStartKey'] = cursor
    const result = await documentClient.send(new ScanCommand(params as ScanCommandInput))
    const items = (result.Items ?? []) as Array<Record<string, unknown>>

    const expiredKeys: Array<{ pk: string; sk: string }> = []
    for (const item of items) {
      if (deleted + expiredKeys.length >= RETENTION_MAX_DELETES_PER_RUN_PER_TYPE) break
      if (!predicate(item, nowMs)) continue
      const key = retentionKeyOf(item)
      if (key) expiredKeys.push(key)
    }

    if (expiredKeys.length > 0) {
      await batchDeleteKeys(expiredKeys)
      deleted += expiredKeys.length
    }

    if (!result.LastEvaluatedKey || deleted >= RETENTION_MAX_DELETES_PER_RUN_PER_TYPE) break
    cursor = result.LastEvaluatedKey as Record<string, unknown>
  }

  return deleted
}

/**
 * Anchored delete of a single app-data partition. Queries the base table by
 * `pk` (or a GSI1 partition by `gsi1pk`), paginates over `LastEvaluatedKey`,
 * and `DeleteItem`s every returned row by its real pk/sk. Replaces the old
 * unanchored `contains(pk, uid) OR contains(sk, uid)` full-table Scan (which
 * also only read its first page): deletion is now complete regardless of table
 * size and needs no table scan (R2.3, R2.4). A GSI projection always carries
 * the base table's pk/sk, so rows found via GSI1 are still deletable by key.
 */
async function deleteAppDataPartition(partitionValue: string, opts?: { index: 'GSI1' }): Promise<number> {
  const keyAttr = opts?.index === 'GSI1' ? 'gsi1pk' : 'pk'
  let deleted = 0
  let cursor: Record<string, unknown> | undefined

  do {
    const params: Record<string, unknown> = {
      TableName: TableNames.appData,
      KeyConditionExpression: `${keyAttr} = :pk`,
      ExpressionAttributeValues: { ':pk': partitionValue },
    }
    if (opts?.index) params['IndexName'] = opts.index
    if (cursor) params['ExclusiveStartKey'] = cursor

    const page = await documentClient.send(new QueryCommand(params as QueryCommandInput))
    for (const item of page.Items || []) {
      const pk = item['pk']
      const sk = item['sk']
      if (typeof pk === 'string' && typeof sk === 'string') {
        await documentClient.send(new DeleteCommand({ TableName: TableNames.appData, Key: { pk, sk } }))
        deleted++
      }
    }
    cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)

  return deleted
}

export async function handler() {
  console.log('[cleanup] Starting cleanup worker')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // ─── Process erasure requests older than 30 days ──────────────────────
  // Paginate the pending-request scan over LastEvaluatedKey (R2.3), collecting
  // every page's requests before processing — same do/while + ExclusiveStartKey
  // cursor pattern as `sweepExpiredRows` / `deleteAppDataPartition` above. A
  // single Scan page would silently skip pending requests beyond the first page
  // once the queue outgrows one page.
  const erasureRequests: Array<Record<string, unknown>> = []
  let erasureCursor: Record<string, unknown> | undefined
  do {
    const erasureParams: Record<string, unknown> = {
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending AND requestedAt < :cutoff',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'ERASURE#', ':pending': 'pending', ':cutoff': thirtyDaysAgo },
    }
    if (erasureCursor) erasureParams['ExclusiveStartKey'] = erasureCursor
    const erasureResult = await documentClient.send(new ScanCommand(erasureParams as ScanCommandInput))
    for (const req of erasureResult.Items || []) erasureRequests.push(req)
    erasureCursor = erasureResult.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (erasureCursor)

  let erasedCount = 0
  for (const req of erasureRequests) {
    const userId = req['userId'] as string
    try {
      // Resolve the Cognito username/email from the user row. The consumer pool
      // is keyed on email (see auth/service.ts: deleteUserByUsername('consumer',
      // email)), and email is personal data under POPIA, so the Cognito deletion
      // needs this value. The user row is the single source of truth for it, and
      // the deletion order below guarantees the row still exists whenever this
      // value is needed: every other store (checkins, websocket-connections,
      // app-data, Cognito) is cleared BEFORE the users row, so any failure that
      // leaves the request pending still leaves the users row intact for the
      // next run to re-resolve the username. The users row is deleted last, only
      // after Cognito is gone, so no run can orphan the Cognito account.
      const userRow = userId ? await getUserById(userId) : null
      const cognitoUsername = userRow?.email ?? userRow?.username
      console.log(`[cleanup] Erasure ${userId}: cognito username resolved=${Boolean(cognitoUsername)}`)

      // Delete the user's check-in history from the dedicated checkins table.
      // Paginated over the UserIndex GSI so no rows are missed on large
      // histories. A failure here throws and is caught below, leaving the
      // request not-completed for retry (completion gating is task 2.6).
      if (userId) {
        const checkinsDeleted = await deleteCheckInsByUser(userId)
        console.log(`[cleanup] Erasure ${userId}: checkins deleted=${checkinsDeleted}`)
      }

      // Delete the user's websocket-connections rows (keyed by userId via the
      // UserIndex GSI) so no personal data survives in the connections table.
      // Paginated inside the helper over LastEvaluatedKey. A failure here throws
      // and is caught below, leaving the request not-completed for retry
      // (completion gating is task 2.6).
      if (userId) {
        const connectionsDeleted = await deleteConnectionsByUser(userId)
        console.log(`[cleanup] Erasure ${userId}: websocket connections deleted=${connectionsDeleted}`)
      }

      // Delete the user's app-data personal data. Every row lives in a real,
      // anchored partition (one per row type across the feature repositories),
      // so we Query each partition and DeleteItem every row — no unanchored
      // contains() full-table scan (R2.4), paginated over LastEvaluatedKey so
      // no row is missed on large partitions (R2.3). A failure here throws and
      // is caught below, leaving the request not-completed for retry
      // (completion gating is task 2.6).
      //
      // Deliberately NOT touched here:
      //  - ERASURE#{userId} (the request row itself) — its own completion
      //    update runs below (task 2.6); the old contains() scan wrongly
      //    matched and deleted it, then resurrected it via the update.
      //  - REDEMPTION#{id} (gsi1pk USER_REDEMPTIONS#{userId}) — financial
      //    records under retention; keyed by redemptionId, not the user, so
      //    the old scan never matched them either.
      //  - ABUSE#{flagId} (sk USER#{userId}) — moderation/safety records with
      //    no per-user anchor; deleting them would require the very full-table
      //    scan R2.4 removes. Flagged, not silently dropped.
      // Going pairs (proof-of-demand R9.9). Must run BEFORE the `USER#{userId}`
      // partition sweep below: that sweep removes the mirror rows, and the mirror
      // row is the only anchor that names the venue partition the countable row
      // lives in. Deleted the other way round, the venue rows would be orphaned
      // and the owner's Going count would keep including a person who no longer
      // exists.
      //
      // Both rows of each pair go through the Going repository's own transaction,
      // so the count drops by exactly the marks this person made. Query-anchored
      // on `pk USER#{userId}` with `begins_with(sk, 'GOING#')`: no scan.
      if (userId) {
        const goingPairsDeleted = await deleteGoingRowsForUser(userId)
        console.log(`[cleanup] Erasure ${userId}: going pairs deleted=${goingPairsDeleted}`)
      }

      if (userId) {
        const appDataDeleted = await deleteAppDataForUser(userId)
        console.log(`[cleanup] Erasure ${userId}: app-data rows deleted=${appDataDeleted}`)
      }

      // Delete the user's Cognito consumer account. Email is personal data under
      // POPIA, so the account must go too. Reuses the shared helper, which is
      // idempotent on "user not found" (UserNotFoundException swallowed) but
      // rethrows any other fault, so a real failure here throws and is caught
      // below, leaving the request not-completed for retry (completion gating is
      // task 2.6). Only attempt when a username was resolved above.
      if (cognitoUsername) {
        await deleteUserByUsername('consumer', cognitoUsername)
        console.log(`[cleanup] Erasure ${userId}: cognito account deleted`)
      }

      // Delete the users row LAST — after every other store and the Cognito
      // account are cleared. The users row is the single source of truth for
      // the Cognito username, so deleting it last keeps the retry path correct:
      // if any earlier step throws, the request stays pending (see catch below)
      // with the users row intact, and the next run re-resolves the username and
      // retries. Once this delete runs, Cognito is already gone, so no run can
      // ever orphan the Cognito account. deleteUser is idempotent (no-ops on a
      // missing row), so a retry after this point is safe.
      if (userId) await deleteUser(userId)

      // Mark erasure as completed. Reached ONLY after every deletion step
      // (checkins, websocket-connections, app-data, Cognito, users row) has
      // succeeded — any throw above skips this update and hits the catch, so the
      // request stays 'pending' for the next run. All deletion steps are
      // idempotent, so re-running after a partial success does not error.
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.appData,
          Key: { pk: req['pk'] as string, sk: req['sk'] as string },
          UpdateExpression: 'SET #status = :completed, processedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':completed': 'completed', ':now': new Date().toISOString() },
        }),
      )
      erasedCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cleanup] Erasure failed for user ${userId}: ${msg}`)
    }
  }

  // ─── Expired staff invites and old webhooks are handled by DynamoDB TTL ──

  // ─── Threshold-locks: drop any whose reward was deleted ─────────────────
  let orphanedLocks = 0
  try {
    const { cleanupOrphanedLocks } = await import('../features/rewards/threshold-lock.js')
    const result = await cleanupOrphanedLocks()
    orphanedLocks = result.deleted
  } catch (err) {
    console.warn(`[cleanup] threshold-lock sweep failed: ${String(err)}`)
  }

  // ─── 7-year POPIA retention sweeps for booster rows ─────────────────────
  // Three independent paged-Scan + batch-delete loops, one per row type
  // (R8.3, R8.6). All three share the strict greater-than boundary and
  // the `RETENTION_MAX_DELETES_PER_RUN_PER_TYPE` budget. The first
  // deletions will not run for at least 7 years from launch.
  const nowMs = Date.now()

  let boosterPurchasesDeleted = 0
  try {
    boosterPurchasesDeleted = await sweepExpiredRows({
      filterExpression: 'begins_with(pk, :prefix) AND attribute_exists(paidAt)',
      expressionAttributeValues: { ':prefix': 'BOOST#' },
      predicate: (row, now) => isBoosterPurchaseExpired(row as { paidAt?: unknown }, now),
      nowMs,
    })
  } catch (err) {
    console.warn(`[cleanup] booster-purchase retention sweep failed: ${String(err)}`)
  }

  let floorAuditsDeleted = 0
  try {
    floorAuditsDeleted = await sweepExpiredRows({
      filterExpression: 'begins_with(pk, :prefix) AND attribute_exists(changedAt)',
      expressionAttributeValues: { ':prefix': 'BOOST_FLOOR_AUDIT#' },
      predicate: (row, now) => isFloorChangeAuditExpired(row as { changedAt?: unknown }, now),
      nowMs,
    })
  } catch (err) {
    console.warn(`[cleanup] floor-change-audit retention sweep failed: ${String(err)}`)
  }

  let idempotencyMarkersDeleted = 0
  try {
    idempotencyMarkersDeleted = await sweepExpiredRows({
      filterExpression: 'begins_with(pk, :prefix) AND attribute_exists(createdAt)',
      expressionAttributeValues: { ':prefix': 'BOOST_CHECKOUT#' },
      predicate: (row, now) => isIdempotencyMarkerExpired(row as { createdAt?: unknown }, now),
      nowMs,
    })
  } catch (err) {
    console.warn(`[cleanup] idempotency-marker retention sweep failed: ${String(err)}`)
  }

  // ─── 12-month retention sweep for Digest_Rows ───────────────────────────
  // weekly-attribution-digest R3.2. Digest_Rows carry no TTL attribute
  // (consistent with the audited booster rows), so their 12-month retention
  // is enforced here with the same paged-Scan + batch-delete sweep and the
  // shared strict greater-than boundary and per-run delete budget.
  let digestRowsDeleted = 0
  try {
    digestRowsDeleted = await sweepExpiredRows({
      filterExpression: 'begins_with(pk, :prefix) AND attribute_exists(createdAt)',
      expressionAttributeValues: { ':prefix': 'DIGEST#' },
      predicate: (row, now) => isDigestRowExpired(row as { createdAt?: unknown }, now),
      nowMs,
    })
  } catch (err) {
    console.warn(`[cleanup] digest-row retention sweep failed: ${String(err)}`)
  }

  // ─── 12-month retention sweep for closed Boost_Scoreboard cache rows ────
  // proof-of-demand R7.2. A closed window's scoreboard is stored with no TTL
  // and never recomputed, so its expiry is enforced here alongside the boost
  // row it describes. It is derived from check-ins, not a financial record, so
  // 12 months rather than the boost row's 7 years.
  let boostScoreboardCachesDeleted = 0
  try {
    boostScoreboardCachesDeleted = await sweepExpiredRows({
      filterExpression: 'begins_with(pk, :prefix) AND attribute_exists(updatedAt)',
      expressionAttributeValues: { ':prefix': 'KV#boost:score:' },
      predicate: (row, now) => isBoostScoreboardCacheExpired(row as { updatedAt?: unknown }, now),
      nowMs,
    })
  } catch (err) {
    console.warn(`[cleanup] boost-scoreboard-cache retention sweep failed: ${String(err)}`)
  }

  // ─── Lapse_Sweep phase 1: paidUntil lapse → grace + renewal email ────────
  // billing-revenue-integrity R3.1. Businesses whose paid window has lapsed but
  // that have not yet entered the renewal grace window get a 7-day
  // `paymentGraceUntil` and one renewal-reminder email. Runs BEFORE phase 2
  // (`enforceLapsedPayments`) so a business that lapsed today is graced this run
  // and only demoted after the grace window itself lapses (R3.2, R3.3). Its own
  // try/catch so a sweep failure never blocks the demotion phase below.
  let lapseGraced = 0
  try {
    const { startLapseSweep } = await import('../features/business/service.js')
    const result = await startLapseSweep()
    lapseGraced = result.graced
  } catch (err) {
    console.warn(`[cleanup] lapse-sweep (grace) failed: ${String(err)}`)
  }

  // ─── Lapsed-payment enforcement (phase 2) ────────────────────────────────
  // Demote businesses whose 7-day payment grace has lapsed: their nodes go
  // isActive=false and tier→'free' so they drop off the paid-only map.
  let lapsedPaymentsProcessed = 0
  try {
    const { enforceLapsedPayments } = await import('../features/business/service.js')
    const result = await enforceLapsedPayments()
    lapsedPaymentsProcessed = result.processed
  } catch (err) {
    console.warn(`[cleanup] lapsed-payment enforcement failed: ${String(err)}`)
  }

  console.log(
    `[cleanup] Erased: ${erasedCount}, orphaned locks deleted: ${orphanedLocks}, ` +
      `booster purchases deleted: ${boosterPurchasesDeleted}, ` +
      `floor audits deleted: ${floorAuditsDeleted}, ` +
      `idempotency markers deleted: ${idempotencyMarkersDeleted}, ` +
      `digest rows deleted: ${digestRowsDeleted}, ` +
      `boost scoreboard caches deleted: ${boostScoreboardCachesDeleted}, ` +
      `lapse-sweep graced: ${lapseGraced}, ` +
      `lapsed payments processed: ${lapsedPaymentsProcessed}`,
  )
  return {
    erasedCount,
    expiredInvites: 0,
    oldWebhooks: 0,
    orphanedLocks,
    boosterPurchasesDeleted,
    floorAuditsDeleted,
    idempotencyMarkersDeleted,
    digestRowsDeleted,
    boostScoreboardCachesDeleted,
    lapseGraced,
    lapsedPaymentsProcessed,
  }
}
