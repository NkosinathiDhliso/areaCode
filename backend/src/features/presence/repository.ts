// Presence repository — the DynamoDB adapter for Presence Integrity.
//
// Feature: presence-integrity
//
// This module is a THIN ADAPTER over the pure presence modules:
//   - reducer.ts     (the state-machine spec the conditional writes implement)
//   - read-model.ts  (livePresenceCount — the authoritative count definition)
//   - window.ts      (expiryWindowSeconds — the Expiry_Window)
//
// Every operation maps to a single DynamoDB conditional `UpdateItem` so the
// atomicity guarantees (at-most-once end, count never below 0, dwell recorded
// once) come from DynamoDB itself, not from application-level locking:
//
//   - create-or-refresh   → conditional open + counter increment, else unconditional refresh
//   - end via check-out   → conditional present->checked_out, then guarded counter decrement
//   - end via expiry       → conditional present->expired,     then guarded counter decrement
//
// The per-venue Live_Presence_Count is cached in an `app-data` KV row purely to
// carry an O(1) value on the realtime event; it is treated as best-effort and is
// reconciled to the authoritative record-derived count on every expiry cycle. The
// read model (and `getLivePresenceCount` here) always computes from records via
// the `NodeIndex` GSI, never trusting the cached counter (Requirement 6.4).
//
// No latitude/longitude is ever read or written here (POPIA): proximity is
// evaluated at check-in time and discarded before any record is constructed.
import type { VenueMomentum } from '@area-code/shared/types'
import { UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { kvGet, kvSet } from '../../shared/kv/dynamodb-kv.js'
import type { PresenceRecord, PresenceState } from '../check-out/types.js'

import { deriveMomentum, pruneSamples, MOMENTUM_WINDOW_SECONDS, type PresenceSample } from './momentum.js'
import { livePresenceCount } from './read-model.js'

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Grace period (seconds) added to `expiresAt` to form the DynamoDB TTL attribute.
 * TTL deletion is best-effort physical cleanup only and is NEVER used for count
 * correctness — the present/expired decision always compares `expiresAt` to now
 * (Requirement 6.2). Kept generous so a record survives well past its expiry for
 * the expiry sweep + reconciliation to process it.
 */
const TTL_GRACE_SECONDS = 24 * 60 * 60 // 24h

/** The `NodeIndex` GSI: hash = nodeId, range = expiresAt. */
const NODE_INDEX = 'NodeIndex'

const PRESENT: PresenceState = 'present'
const CHECKED_OUT: PresenceState = 'checked_out'
const EXPIRED: PresenceState = 'expired'

// ─── Helpers ───────────────────────────────────────────────────────────────

/** True iff a DynamoDB error is a failed conditional write (the expected no-op signal). */
function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException'
}

/** Full KV partition key for a venue's cached Live_Presence_Count counter. */
function counterKey(nodeId: string): string {
  return `KV#presence:count:${nodeId}`
}

/** Map a raw DynamoDB item to a typed Presence_Record. */
function toPresenceRecord(item: Record<string, unknown>): PresenceRecord {
  const record: PresenceRecord = {
    userId: item['userId'] as string,
    nodeId: item['nodeId'] as string,
    presenceState: item['presenceState'] as PresenceState,
    checkedInAt: item['checkedInAt'] as number,
    expiresAt: item['expiresAt'] as number,
    ttl: item['ttl'] as number,
  }
  if (item['endedAt'] !== undefined) record.endedAt = item['endedAt'] as number
  if (item['dwellSeconds'] !== undefined) record.dwellSeconds = item['dwellSeconds'] as number
  if (item['dwellTermination'] !== undefined) {
    record.dwellTermination = item['dwellTermination'] as PresenceRecord['dwellTermination']
  }
  return record
}

// ─── Create-or-refresh (check-in) ────────────────────────────────────────────

/**
 * Open a new Presence_Record or refresh a live one, in a single conditional
 * write (Requirements 4.1, 4.2). Mirrors the reducer's `check_in` op.
 *
 * The conditional update succeeds only when there is NO live `present` record —
 * i.e. the key is absent, already `checked_out`/`expired`, or a stale `present`
 * whose `expiresAt` has passed. In that case a fresh presence is opened
 * (checkedInAt reset to `now`, prior end fields cleared, matching the reducer's
 * fresh record) and the venue counter is incremented by exactly 1.
 *
 * When the condition fails the consumer already holds a live `present` record:
 * a second, unconditional write only refreshes `expiresAt`/`ttl` and the counter
 * is NOT incremented again — a consumer counts at most once per venue.
 *
 * @returns `{ opened }` — `true` when a new/reopened presence was created (and the
 *   counter incremented), `false` on a refresh of an already-live record.
 */
export async function createOrRefreshPresence(params: {
  userId: string
  nodeId: string
  now: number
  windowSeconds: number
}): Promise<{ opened: boolean }> {
  const { userId, nodeId, now, windowSeconds } = params
  const expiresAt = now + windowSeconds
  const ttl = expiresAt + TTL_GRACE_SECONDS

  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.presence,
        Key: { userId, nodeId },
        // Open a fresh presence: reset checkedInAt to now and clear any prior end
        // fields so a reopened record matches the reducer's fresh record exactly.
        UpdateExpression:
          'SET checkedInAt = :now, expiresAt = :expiresAt, presenceState = :present, #ttl = :ttl ' +
          'REMOVE endedAt, dwellSeconds, dwellTermination',
        // New / reopened / stale-unswept => open. Anything else (a live present
        // record) fails the condition and falls through to the refresh below.
        ConditionExpression:
          'attribute_not_exists(userId) OR presenceState IN (:checkedOut, :expired) OR expiresAt <= :now',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':now': now,
          ':expiresAt': expiresAt,
          ':ttl': ttl,
          ':present': PRESENT,
          ':checkedOut': CHECKED_OUT,
          ':expired': EXPIRED,
        },
      }),
    )

    // Condition held → unique opener of this presence. Count once.
    await incrementCounter(nodeId)
    return { opened: true }
  } catch (err) {
    if (!isConditionalCheckFailed(err)) throw err

    // A live `present` record already exists → refresh expiresAt/ttl only, no
    // second increment (Requirement 4.2 / 5.5).
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.presence,
        Key: { userId, nodeId },
        UpdateExpression: 'SET expiresAt = :expiresAt, #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':expiresAt': expiresAt, ':ttl': ttl },
      }),
    )
    return { opened: false }
  }
}

// ─── Conditional end transitions ─────────────────────────────────────────────

/**
 * End a consumer's open presence by manual check-out (Requirements 1.2, 1.3, 3.2).
 * Mirrors the reducer's `check_out` op.
 *
 * The conditional update only fires on a live `present` record
 * (`presenceState = 'present' AND expiresAt > now`), so two concurrent
 * check-outs cannot both win: exactly one transitions the record to
 * `checked_out`, recording `dwellSeconds = now - checkedInAt` flagged
 * `checkout_terminated`, and the loser (or any stray check-out against an
 * absent / already-ended / expired-but-unswept record) gets a
 * `ConditionalCheckFailedException` and is a successful no-op.
 *
 * On success the venue counter is decremented (guarded `> 0`).
 *
 * @returns the ended Presence_Record (with `dwellSeconds`) when this call won the
 *   transition, or `null` when there was no live presence to end (no-op).
 */
export async function endPresenceByCheckOut(params: {
  userId: string
  nodeId: string
  now: number
}): Promise<PresenceRecord | null> {
  const { userId, nodeId, now } = params

  try {
    const result = await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.presence,
        Key: { userId, nodeId },
        ConditionExpression: 'presenceState = :present AND expiresAt > :now',
        UpdateExpression:
          'SET presenceState = :checkedOut, endedAt = :now, ' +
          'dwellSeconds = :now - checkedInAt, dwellTermination = :term',
        ExpressionAttributeValues: {
          ':present': PRESENT,
          ':checkedOut': CHECKED_OUT,
          ':now': now,
          ':term': 'checkout_terminated',
        },
        ReturnValues: 'ALL_NEW',
      }),
    )

    await decrementCounter(nodeId)
    return result.Attributes ? toPresenceRecord(result.Attributes) : null
  } catch (err) {
    if (isConditionalCheckFailed(err)) return null
    throw err
  }
}

/**
 * End a stale presence by expiry (Requirements 5.1, 5.2, 5.6). Mirrors the
 * reducer's `expire` op.
 *
 * The conditional update only fires on a due `present` record
 * (`presenceState = 'present' AND expiresAt <= now`), so the sweep never
 * re-transitions a `checked_out`/`expired` record and never double-decrements if
 * it races a manual check-out on the same record. The recorded dwell is
 * `expiresAt - checkedInAt` (bounded by the Expiry_Window because `endedAt` is
 * set to `expiresAt`, not wall-clock now), flagged `expiry_terminated`.
 *
 * On success the venue counter is decremented (guarded `> 0`).
 *
 * @returns the expired Presence_Record (with `dwellSeconds`) when this call won
 *   the transition, or `null` when there was nothing due to expire (no-op).
 */
export async function endPresenceByExpiry(params: {
  userId: string
  nodeId: string
  now: number
}): Promise<PresenceRecord | null> {
  const { userId, nodeId, now } = params

  try {
    const result = await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.presence,
        Key: { userId, nodeId },
        ConditionExpression: 'presenceState = :present AND expiresAt <= :now',
        UpdateExpression:
          'SET presenceState = :expired, endedAt = expiresAt, ' +
          'dwellSeconds = expiresAt - checkedInAt, dwellTermination = :term',
        ExpressionAttributeValues: {
          ':present': PRESENT,
          ':expired': EXPIRED,
          ':now': now,
          ':term': 'expiry_terminated',
        },
        ReturnValues: 'ALL_NEW',
      }),
    )

    await decrementCounter(nodeId)
    return result.Attributes ? toPresenceRecord(result.Attributes) : null
  } catch (err) {
    if (isConditionalCheckFailed(err)) return null
    throw err
  }
}

// ─── NodeIndex queries ───────────────────────────────────────────────────────

/**
 * Query the `NodeIndex` GSI for a venue's live presence records: `present`
 * records whose `expiresAt` is still in the future. This is the authoritative
 * read-model source — it excludes expired-but-unswept records (Requirement 6.4).
 */
export async function queryLivePresenceRecords(nodeId: string, now: number): Promise<PresenceRecord[]> {
  const items = await queryNodeIndex({
    nodeId,
    rangeOperator: '>',
    now,
  })
  return items.map(toPresenceRecord)
}

/**
 * Query the `NodeIndex` GSI for a venue's records that are DUE to expire:
 * `present` records whose `expiresAt` is at or before `now`. Used by the
 * serverless expiry sweep (Requirement 6.3).
 */
export async function queryDuePresenceRecords(nodeId: string, now: number): Promise<PresenceRecord[]> {
  const items = await queryNodeIndex({
    nodeId,
    rangeOperator: '<=',
    now,
  })
  return items.map(toPresenceRecord)
}

/**
 * Shared `NodeIndex` paginated query, filtered to `present` records. The range
 * operator selects the read-model slice (`expiresAt > now`) versus the due-sweep
 * slice (`expiresAt <= now`).
 */
async function queryNodeIndex(params: {
  nodeId: string
  rangeOperator: '>' | '<='
  now: number
}): Promise<Array<Record<string, unknown>>> {
  const { nodeId, rangeOperator, now } = params
  const items: Array<Record<string, unknown>> = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const result: { Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: Record<string, unknown> } =
      await documentClient.send(
        new QueryCommand({
          TableName: TableNames.presence,
          IndexName: NODE_INDEX,
          KeyConditionExpression: `nodeId = :n AND expiresAt ${rangeOperator} :now`,
          FilterExpression: 'presenceState = :present',
          ExpressionAttributeValues: {
            ':n': nodeId,
            ':now': now,
            ':present': PRESENT,
          },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }),
      )
    if (result.Items) items.push(...result.Items)
    lastKey = result.LastEvaluatedKey
  } while (lastKey)

  return items
}

// ─── Live count (authoritative read model adapter) ───────────────────────────

/**
 * The authoritative Live_Presence_Count for a venue: computed directly from the
 * `NodeIndex` records via the pure `livePresenceCount`, never from the cached
 * counter (Requirements 6.4, 7.1). Returns 0 honestly when no record is
 * live-present.
 */
export async function getLivePresenceCount(nodeId: string, now: number): Promise<number> {
  const records = await queryLivePresenceRecords(nodeId, now)
  return livePresenceCount(
    records.map((r) => ({ state: r.presenceState, expiresAt: r.expiresAt })),
    now,
  )
}

// ─── Cached counter (best-effort O(1) value for the realtime event) ──────────

/**
 * Increment a venue's cached Live_Presence_Count by 1, creating the row at 1 if
 * absent. Stored as a numeric `value` matching the existing KV counter shape.
 * Returns the new value.
 */
export async function incrementCounter(nodeId: string): Promise<number> {
  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: counterKey(nodeId), sk: 'VALUE' },
      UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :one',
      ExpressionAttributeNames: { '#val': 'value' },
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
      ReturnValues: 'ALL_NEW',
    }),
  )
  return (result.Attributes?.['value'] as number) ?? 1
}

/**
 * Guarded decrement of a venue's cached Live_Presence_Count: only decrements when
 * the current value is strictly greater than 0, so the counter can never go
 * below 0 under any interleaving of check-out and expiry (Requirement 3.4). When
 * the value is absent or already 0 the conditional write fails and this is a
 * no-op.
 *
 * @returns the new value after decrement, or `0` when the decrement was skipped
 *   (already at floor / absent).
 */
export async function decrementCounter(nodeId: string): Promise<number> {
  try {
    const result = await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: counterKey(nodeId), sk: 'VALUE' },
        UpdateExpression: 'SET #val = #val - :one',
        ConditionExpression: '#val > :zero',
        ExpressionAttributeNames: { '#val': 'value' },
        ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
        ReturnValues: 'ALL_NEW',
      }),
    )
    return (result.Attributes?.['value'] as number) ?? 0
  } catch (err) {
    if (isConditionalCheckFailed(err)) return 0
    throw err
  }
}

/** Read a venue's cached Live_Presence_Count. Returns 0 when the row is absent. */
export async function getCounter(nodeId: string): Promise<number> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: counterKey(nodeId), sk: 'VALUE' },
    }),
  )
  return (result.Item?.['value'] as number) ?? 0
}

/**
 * Set a venue's cached counter to an exact value (used by reconciliation). Stored
 * as a numeric `value`, clamped to a non-negative integer.
 */
export async function setCounter(nodeId: string, value: number): Promise<void> {
  const safe = Math.max(0, Math.floor(value))
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: counterKey(nodeId), sk: 'VALUE' },
      UpdateExpression: 'SET #val = :v, updatedAt = :ts',
      ExpressionAttributeNames: { '#val': 'value' },
      ExpressionAttributeValues: { ':v': safe, ':ts': new Date().toISOString() },
    }),
  )
}

/**
 * Reconcile the cached counter back to the authoritative count computed from the
 * `NodeIndex` records (`present` AND `expiresAt > now`). Run at the end of every
 * expiry cycle so a lagging sweep or an orphaned check-in (Requirement 4.5) can
 * never leave a permanent over-count (design "two layers, one honest number").
 *
 * @returns the authoritative count the counter was set to.
 */
export async function reconcileCounter(nodeId: string, now: number): Promise<number> {
  const count = await getLivePresenceCount(nodeId, now)
  await setCounter(nodeId, count)
  return count
}

// ─── Momentum sample series (honest "filling up / winding down") ─────────────

/**
 * TTL for the sample series row: the trailing window plus a small grace so a
 * quiet venue's series expires on its own rather than lingering. Once it
 * expires, `getMomentum` honestly reports `steady` (no trend to claim).
 */
const MOMENTUM_SAMPLES_TTL_SECONDS = MOMENTUM_WINDOW_SECONDS + 5 * 60

/** KV key for a venue's rolling Live_Presence_Count sample series. */
function samplesKey(nodeId: string): string {
  return `presence:samples:${nodeId}`
}

/** Read and window a venue's stored samples. A corrupt cache row degrades to []. */
async function readSamples(nodeId: string, now: number): Promise<PresenceSample[]> {
  const raw = await kvGet(samplesKey(nodeId))
  if (!raw) return []
  let parsed: PresenceSample[]
  try {
    parsed = JSON.parse(raw) as PresenceSample[]
  } catch {
    // Cache-shape resilience only (not error masking): a malformed sample row
    // is a stale/garbled cache value, so start the series fresh rather than
    // fail the count broadcast. kvGet infra errors still propagate.
    return []
  }
  return pruneSamples(parsed, now)
}

/**
 * Append the latest authoritative Live_Presence_Count observation to the
 * venue's rolling series, prune to the trailing window, persist, and return the
 * honest momentum. Called from every site that recomputes the count (check-in,
 * check-out, expiry) so the trend is measured only from real presence changes.
 */
export async function recordPresenceSample(nodeId: string, count: number, now: number): Promise<VenueMomentum> {
  const samples = await readSamples(nodeId, now)
  samples.push({ t: now, count })
  const pruned = pruneSamples(samples, now)
  await kvSet(samplesKey(nodeId), JSON.stringify(pruned), MOMENTUM_SAMPLES_TTL_SECONDS)
  return deriveMomentum(pruned, now)
}

/**
 * Read a venue's current momentum without recording a new observation. Used by
 * the presence read API to seed the label on first paint. Returns `steady` when
 * there is no recent series (no trend to claim).
 */
export async function getMomentum(nodeId: string, now: number): Promise<VenueMomentum> {
  const samples = await readSamples(nodeId, now)
  return deriveMomentum(samples, now)
}
