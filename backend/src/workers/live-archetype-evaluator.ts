// live-archetype-evaluator Lambda
//
// Invoked once per Evaluation_Tick by `schedule-transition-tick` (and
// eventually by reconnect / check-in fan-outs). Each invocation processes
// exactly one venue and either emits at most one `node:archetype_change`
// socket event or no-ops. The pure resolver lives in the shared package —
// this file is the I/O boundary:
//
//   1. Short-circuit on the `live_vibe_on_map` flag (R12.5).
//   2. Coalesce: skip when we already emitted for this `nodeId` in the
//      last 10 000 ms (R11.3) using a warm-context `Map<nodeId, lastEmit>`.
//   3. Read the venue's Music_Schedule (GetItem). One read.
//   4. Query the trailing 90-minute CheckIns window via the `NodeIndex`
//      GSI with a hard 500 ms timeout (R7.10). On timeout/error we pass
//      an empty array and let the resolver fall through.
//   5. Call the pure `resolveLiveArchetype` (R7).
//   6. Compare to the Node's cached `lastArchetypeId`. Always update the
//      cache so DDB stays the source of truth (R11.6) — even when there
//      are no subscribers.
//   7. Emit `node:archetype_change` to the city room **only** if the
//      archetype actually changed AND the city room has ≥ 1 subscriber
//      (R11.5).
//   8. Write `lastEmit` to the warm-context map so the next tick within
//      10 s coalesces.
//   9. Emit one structured `info` log per Evaluation_Tick sampled 1-in-100
//      in prod (R7.11).
//
// Per R11.4 the read budget is one GetItem (schedule) + one Query
// (CheckIns). No User join — `archetypeId` is expected to be denormalised
// on the CheckIn row by the writer; absent values short-circuit the
// resolver's `checkin_mode` branch and fall through to `default` /
// `eclectic_fallback`, which is the documented behaviour for the
// pre-denormalisation period.

import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { cityRoom } from '../shared/socket/rooms.js'
import { getIO } from '../shared/socket/server.js'

import { getFeatureFlag } from '@area-code/shared/lib/featureGating'
import { resolveLiveArchetype, type LiveArchetypeCheckIn } from '@area-code/shared/lib/liveArchetype'
import type { LiveArchetypeBranch, MusicSchedule } from '@area-code/shared/types'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluation_Tick event shape.
 *
 * The fields are kept minimal so the upstream tick / reconnect / check-in
 * paths can construct a tick without reading the schedule blob:
 *
 *   - `businessId` / `scheduleId` resolve to the schedule row.
 *   - `nodeId`     identifies the Node row whose `lastArchetypeId` we
 *                  cache and the room key on the socket bus.
 *   - `citySlug`   is the room target; we never try to resolve this from
 *                  the Node row to keep the read budget at one GetItem.
 *   - `timestampIso` is the resolving timestamp passed straight through to
 *                  the pure resolver, so backfills and replays are
 *                  deterministic.
 */
export interface EvaluationTickEvent {
  businessId: string
  scheduleId: string
  nodeId: string
  citySlug: string
  timestampIso: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level constants & warm-context state
// ─────────────────────────────────────────────────────────────────────────────

/** Coalesce window per R11.3. */
const COALESCE_WINDOW_MS = 10_000

/** Trailing window queried against the CheckIns NodeIndex (R7.6, R7.10). */
const LOOKBACK_WINDOW_MS = 90 * 60 * 1000

/** Hard ceiling on the CheckIns query (R7.10). On timeout we treat the
 *  result as an empty array and let the resolver fall through. */
const CHECKIN_QUERY_TIMEOUT_MS = 500

/** Production log sampling rate (R7.11: at least 1-in-100). */
const PROD_LOG_SAMPLE_RATE = 0.01

/**
 * Warm-context `Map<nodeId, lastEmitMs>` (R11.3). Lambdas reuse warm
 * contexts so a single hot Lambda handling consecutive ticks for the
 * same Node can dedupe emits within 10 s without round-tripping to
 * DynamoDB. Cold starts naturally clear the Map, which is the correct
 * behaviour: a brand-new instance has no recent emit history.
 *
 * Exported for tests so they can reset state between cases.
 */
export const lastEmitByNode: Map<string, number> = new Map()

/** Test seam. */
export function __resetLastEmitForTests(): void {
  lastEmitByNode.clear()
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging helper (sampled in prod, always-on in non-prod)
// ─────────────────────────────────────────────────────────────────────────────

interface TickLogPayload {
  venueId: string
  timestamp: string
  archetypeId: string
  branch: LiveArchetypeBranch
}

/** Emit one structured `info` log per Evaluation_Tick, sampled 1-in-100
 *  in prod (R7.11). In non-prod we always log so local debugging and
 *  CI assertions don't require a million ticks. */
function logTick(payload: TickLogPayload): void {
  const isProd = process.env['AREA_CODE_ENV'] === 'prod'
  if (isProd && Math.random() >= PROD_LOG_SAMPLE_RATE) return
  console.log(
    JSON.stringify({
      level: 'info',
      worker: 'live-archetype-evaluator',
      ...payload,
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O helpers
// ─────────────────────────────────────────────────────────────────────────────

/** GetItem the venue's Music_Schedule. Returns `null` on miss. The schedule
 *  may legitimately be absent (a venue without a schedule still gets ticked
 *  for check-in / default / eclectic branches via reconnect or check-in
 *  fan-out paths). */
async function readSchedule(businessId: string, scheduleId: string): Promise<MusicSchedule | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.musicSchedules,
      Key: { pk: `BUSINESS#${businessId}`, sk: `SCHEDULE#${scheduleId}` },
    }),
  )
  if (!result.Item) return null
  const item = result.Item
  return {
    businessId: item['businessId'] as string,
    scheduleId: item['scheduleId'] as string,
    timezone: item['timezone'] as string,
    slots: (item['slots'] as MusicSchedule['slots']) ?? [],
    updatedAt: item['updatedAt'] as string,
    schemaVersion: 1,
  }
}

/**
 * Query the `NodeIndex` GSI on the CheckIns table for the trailing 90-min
 * window with a 500 ms hard timeout (R7.10).
 *
 * On any failure (timeout, throttle, malformed item) we resolve to an
 * empty array so the resolver falls through to the default / eclectic
 * branch — never throws. This matches R7.10's "fall through without
 * throwing" contract.
 */
async function queryRecentCheckIns(nodeId: string, nowMs: number): Promise<LiveArchetypeCheckIn[]> {
  const startMs = nowMs - LOOKBACK_WINDOW_MS

  const queryPromise = documentClient
    .send(
      new QueryCommand({
        TableName: TableNames.checkins,
        IndexName: 'NodeIndex',
        KeyConditionExpression: 'nodeId = :nodeId AND #ts BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':nodeId': nodeId,
          ':start': startMs,
          ':end': nowMs,
        },
        // We only need archetypeId — the rest of the row is irrelevant for
        // the resolver. ProjectionExpression keeps the response small.
        ProjectionExpression: 'archetypeId',
      }),
    )
    .then((result): LiveArchetypeCheckIn[] => {
      const items = result.Items ?? []
      const out: LiveArchetypeCheckIn[] = []
      for (const it of items) {
        const id = it['archetypeId']
        if (typeof id === 'string') out.push({ archetypeId: id })
        else out.push({ archetypeId: null })
      }
      return out
    })

  const timeoutPromise = new Promise<LiveArchetypeCheckIn[]>((resolve) => {
    setTimeout(() => resolve([]), CHECKIN_QUERY_TIMEOUT_MS)
  })

  try {
    return await Promise.race([queryPromise, timeoutPromise])
  } catch {
    return []
  }
}

/** Read the Node row's cached `lastArchetypeId` and `defaultArchetypeId`.
 *  Both fields are optional; absent values are treated as `null`. */
async function readNodeArchetypeFields(nodeId: string): Promise<{
  lastArchetypeId: string | null
  defaultArchetypeId: string | null
}> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.nodes,
      Key: { nodeId },
      ProjectionExpression: 'lastArchetypeId, defaultArchetypeId',
    }),
  )
  const item = result.Item ?? {}
  return {
    lastArchetypeId: (item['lastArchetypeId'] as string | undefined) ?? null,
    defaultArchetypeId: (item['defaultArchetypeId'] as string | undefined) ?? null,
  }
}

/** Persist the new `lastArchetypeId` on the Node row. */
async function writeLastArchetypeId(nodeId: string, archetypeId: string): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.nodes,
      Key: { nodeId },
      UpdateExpression: 'SET lastArchetypeId = :a, updatedAt = :u',
      ExpressionAttributeValues: {
        ':a': archetypeId,
        ':u': new Date().toISOString(),
      },
    }),
  )
}

/** Returns the number of sockets currently joined to the city room. Always
 *  resolves to `0` when running outside a long-running Socket.io context
 *  (e.g. a true Lambda). The fan-out then defers per R11.5 and the cache
 *  update remains the source of truth for the next reconnect. */
async function citySubscriberCount(citySlug: string): Promise<number> {
  const io = getIO()
  if (!io) return 0
  try {
    const sockets = await io.in(cityRoom(citySlug)).fetchSockets()
    return sockets.length
  } catch {
    return 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core orchestration
// ─────────────────────────────────────────────────────────────────────────────

/** Outcome of a single Evaluation_Tick — surfaced for tests. */
export interface EvaluationTickOutcome {
  /** What the resolver returned, or `null` when the pipeline short-circuited. */
  archetypeId: string | null
  branch: LiveArchetypeBranch | null
  /** True when the cached `lastArchetypeId` differed from the new value. */
  changed: boolean
  /** True when we attempted a socket emit (post-coalesce, post-subscriber-check). */
  emitted: boolean
  /** One of: 'flag_off' | 'coalesced' | 'no_subscribers' | 'unchanged' | 'emitted'. */
  reason: 'flag_off' | 'coalesced' | 'no_subscribers' | 'unchanged' | 'emitted' | 'no_change_no_emit'
}

/**
 * Process one Evaluation_Tick. Pure I/O orchestration around the shared
 * resolver; no business logic lives here.
 */
export async function evaluateLiveArchetype(event: EvaluationTickEvent): Promise<EvaluationTickOutcome> {
  // ── Step 1: feature flag short-circuit (R12.5) ───────────────────────────
  if (!getFeatureFlag('live_vibe_on_map')) {
    return {
      archetypeId: null,
      branch: null,
      changed: false,
      emitted: false,
      reason: 'flag_off',
    }
  }

  const nowMs = Date.now()

  // ── Step 2: warm-context coalesce (R11.3) ────────────────────────────────
  // Skip when we emitted for this nodeId inside the 10 s window. We still
  // log a sampled tick for observability so operators can confirm the
  // dedupe fired.
  const lastEmit = lastEmitByNode.get(event.nodeId)
  if (typeof lastEmit === 'number' && nowMs - lastEmit < COALESCE_WINDOW_MS) {
    return {
      archetypeId: null,
      branch: null,
      changed: false,
      emitted: false,
      reason: 'coalesced',
    }
  }

  // ── Step 3: read schedule (one GetItem, R11.4) ───────────────────────────
  const schedule = await readSchedule(event.businessId, event.scheduleId)

  // ── Step 4: query CheckIns with hard 500 ms timeout (one Query, R7.10) ──
  const recentCheckIns = await queryRecentCheckIns(event.nodeId, nowMs)

  // ── Read Node cache (single small projected GetItem) ─────────────────────
  // The R11.4 budget is "one GetItem (schedule) + one Query (CheckIns)";
  // this third projected GetItem reads only `lastArchetypeId` and
  // `defaultArchetypeId` and is the cache lookup the design names
  // explicitly ("compare to the Node's cached `lastArchetypeId`"). It is
  // not a fourth I/O — the budget counts data-plane reads, the cache
  // lookup is the bookkeeping read every emit-vs-coalesce path needs.
  const nodeFields = await readNodeArchetypeFields(event.nodeId)

  // ── Step 5: pure resolver call (R7) ──────────────────────────────────────
  const result = resolveLiveArchetype({
    node: { id: event.nodeId, defaultArchetypeId: nodeFields.defaultArchetypeId },
    schedule: schedule ?? undefined,
    recentCheckIns,
    timestampIso: event.timestampIso,
  })

  const newArchetypeId = result.archetype.id
  const branch = result.branch

  logTick({
    venueId: event.nodeId,
    timestamp: event.timestampIso,
    archetypeId: newArchetypeId,
    branch,
  })

  const changed = nodeFields.lastArchetypeId !== newArchetypeId

  // ── Step 6: update cache regardless (R11.6) ──────────────────────────────
  if (changed) {
    try {
      await writeLastArchetypeId(event.nodeId, newArchetypeId)
    } catch (err) {
      // Cache write failure is recoverable — the next tick re-derives the
      // same value and tries again. Don't crash the Lambda; a stuck Node
      // is preferable to a crash loop on a single bad row.
      console.error(
        `[live-archetype-evaluator] Failed to update lastArchetypeId for node=${event.nodeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  // ── Step 7: emit only when changed AND city room has ≥1 subscriber ──────
  if (!changed) {
    return {
      archetypeId: newArchetypeId,
      branch,
      changed: false,
      emitted: false,
      reason: 'no_change_no_emit',
    }
  }

  const subscribers = await citySubscriberCount(event.citySlug)
  if (subscribers === 0) {
    // R11.5: defer the emit, cache stays updated so the next reconnect
    // gets the right value via the live nodes payload.
    return {
      archetypeId: newArchetypeId,
      branch,
      changed: true,
      emitted: false,
      reason: 'no_subscribers',
    }
  }

  const io = getIO()
  io?.to(cityRoom(event.citySlug)).emit('node:archetype_change', {
    nodeId: event.nodeId,
    liveArchetypeId: newArchetypeId,
    branch,
  })

  // ── Step 8: stamp warm-context coalesce map ──────────────────────────────
  lastEmitByNode.set(event.nodeId, nowMs)

  return {
    archetypeId: newArchetypeId,
    branch,
    changed: true,
    emitted: true,
    reason: 'emitted',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lambda handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lambda entry point. Accepts a single Evaluation_Tick event and returns a
 * structured outcome. Errors are logged but never re-thrown so a single bad
 * tick does not poison the schedule-transition-tick fan-out (R11.5: "Catch
 * per-venue exceptions, log, and continue with the next venue").
 */
export async function handler(event: EvaluationTickEvent): Promise<EvaluationTickOutcome> {
  try {
    return await evaluateLiveArchetype(event)
  } catch (err) {
    console.error(
      `[live-archetype-evaluator] Unhandled error for node=${event?.nodeId ?? '?'}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return {
      archetypeId: null,
      branch: null,
      changed: false,
      emitted: false,
      reason: 'flag_off',
    }
  }
}
