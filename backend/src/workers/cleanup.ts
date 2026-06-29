// DynamoDB-backed cleanup worker (replaces Prisma)
import { ScanCommand, DeleteCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { deleteUser } from '../features/auth/dynamodb-repository.js'

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

export async function handler() {
  console.log('[cleanup] Starting cleanup worker')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // ─── Process erasure requests older than 30 days ──────────────────────
  const erasureResult = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending AND requestedAt < :cutoff',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'ERASURE#', ':pending': 'pending', ':cutoff': thirtyDaysAgo },
    }),
  )

  let erasedCount = 0
  for (const req of erasureResult.Items || []) {
    const userId = req['userId'] as string
    try {
      // Delete user from users table
      if (userId) await deleteUser(userId)

      // Delete related app_data items (follows, tokens, prefs, etc.)
      const userItems = await documentClient.send(
        new ScanCommand({
          TableName: TableNames.appData,
          FilterExpression: 'contains(pk, :uid) OR contains(sk, :uid)',
          ExpressionAttributeValues: { ':uid': userId },
        }),
      )
      for (const item of userItems.Items || []) {
        await documentClient.send(
          new DeleteCommand({
            TableName: TableNames.appData,
            Key: { pk: item['pk'] as string, sk: item['sk'] as string },
          }),
        )
      }

      // Mark erasure as completed
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

  // ─── Lapsed-payment enforcement ─────────────────────────────────────────
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
    lapsedPaymentsProcessed,
  }
}
