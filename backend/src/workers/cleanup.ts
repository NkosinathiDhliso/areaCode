// DynamoDB-backed cleanup worker (replaces Prisma)
import { ScanCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'

import { deleteUser, getUserById } from '../features/auth/dynamodb-repository.js'
import { deleteCheckInsByUser } from '../features/check-in/dynamodb-repository.js'
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
    const result = await documentClient.send(new ScanCommand(params as any))
    const items = (result.Items ?? []) as Array<Record<string, unknown>>

    const expiredKeys: Array<{ pk: string; sk: string }> = []
    for (const item of items) {
      if (deleted + expiredKeys.length >= RETENTION_MAX_DELETES_PER_RUN_PER_TYPE) break
      if (predicate(item, nowMs)) {
        const pk = item['pk']
        const sk = item['sk']
        if (typeof pk === 'string' && typeof sk === 'string') {
          expiredKeys.push({ pk, sk })
        }
      }
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

    const page = await documentClient.send(new QueryCommand(params as any))
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
    const erasureResult = await documentClient.send(new ScanCommand(erasureParams as any))
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
      if (userId) {
        // Rows the user owns (partition key IS the user).
        const ownedPartitions = [
          `USER#${userId}`, // consent (sk CONSENT#{id})
          `FOLLOW#${userId}`, // outgoing follow edges
          `BLOCK#${userId}`, // outgoing block edges
          `NOTIF#${userId}`, // in-app notifications
          `NOTIF_PREFS#${userId}`, // notification preferences
          `USER_TOKEN#${userId}`, // web-push device tokens
          `MILESTONE#${userId}`, // milestones / achievements
          `COPTOUT#${userId}`, // campaign opt-outs
        ]
        // Rows owned by other entities that persist this user's id, anchored
        // via the GSI1 partition that embeds the user (reverse edges + admin
        // messages). Keeps the coverage the old contains(sk) scan had, still
        // anchored (no full-table scan).
        const referencingGsi1Partitions = [
          `FOLLOWERS#${userId}`, // others following this user
          `BLOCKED_BY#${userId}`, // others who blocked this user
          `USER_MESSAGES#${userId}`, // admin messages addressed to this user
        ]

        let appDataDeleted = 0
        for (const partition of ownedPartitions) {
          appDataDeleted += await deleteAppDataPartition(partition)
        }
        for (const partition of referencingGsi1Partitions) {
          appDataDeleted += await deleteAppDataPartition(partition, { index: 'GSI1' })
        }
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
    lapseGraced,
    lapsedPaymentsProcessed,
  }
}
