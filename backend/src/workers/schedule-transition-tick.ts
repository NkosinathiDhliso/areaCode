// schedule-transition-tick Lambda
//
// Invoked every 60s by an EventBridge rule (R11.5). Each invocation:
//
//   1. Queries `MusicSchedules` GSI `ByNextTransition` for schedules whose
//      `nextTransitionAt` is inside `[now, now + 60s]`. The GSI is sparse
//      so empty schedules are not paid for.
//   2. For each matching schedule, resolves the venue's `(nodeId, citySlug)`
//      and fans out one Evaluation_Tick to the in-process
//      `evaluateLiveArchetype` orchestrator. We call it directly (not via
//      `lambda.Invoke`) because at our scale a single Lambda handling the
//      whole tick is simpler, cheaper, and matches the design's "low
//      scale, one Lambda per concern" assumption (≤100 venues per minute).
//   3. Catches per-venue exceptions, logs them, and continues with the
//      next venue — one bad row never poisons the whole tick (R11.5).
//   4. Emits a single structured tick-level metric line:
//        { venuesEvaluated, changesEmitted, p99LatencyMs }
//      Goes to the existing CloudWatch dashboard (design "Observability").
//
// Read budget: this Lambda performs one Query against the GSI plus, for
// each matching schedule, one Query against the Nodes BusinessIndex GSI
// and one GetItem against the appData city row. The per-venue R11.4
// budget (one GetItem schedule + one Query CheckIns) lives entirely
// inside `evaluateLiveArchetype`.

import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { getSchedule, type NextTransitionRow, queryNextTransitions } from '../features/music/schedule-repository.js'
import { datedSlotStartsInWindow } from '../features/music/schedule-transitions.js'
import { sendTonightReminders } from '../features/nodes/tonight-reminder.js'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'

import {
  evaluateLiveArchetype,
  type EvaluationTickEvent,
  type EvaluationTickOutcome,
} from './live-archetype-evaluator.js'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Forward-looking window matching the EventBridge tick cadence (R11.5). */
const TICK_WINDOW_MS = 60_000

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Aggregated outcome of a single tick — surfaced for tests. */
export interface ScheduleTransitionTickOutcome {
  /** Number of venues for whom `evaluateLiveArchetype` returned (errors don't count). */
  venuesEvaluated: number
  /** Number of those evaluations where the resolver actually changed `lastArchetypeId`. */
  changesEmitted: number
  /** P99 of per-venue `evaluateLiveArchetype` latency in milliseconds. */
  p99LatencyMs: number
  /** Number of GSI rows that failed routing resolution (no node, no city). */
  routingFailures: number
  /** Number of per-venue evaluator exceptions caught and logged. */
  evaluatorErrors: number
  /**
   * Tonight_Reminders delivered this tick (proof-of-demand R9.7). Counted here
   * rather than in a second worker: the reminder fires at a Dated_Slot start,
   * which is a boundary this tick already wakes on.
   */
  tonightRemindersSent: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing resolution (businessId → { nodeId, citySlug })
// ─────────────────────────────────────────────────────────────────────────────

interface VenueRouting {
  nodeId: string
  citySlug: string
}

/**
 * Resolve the routing target for a business. Picks the first active node
 * owned by the business via the `BusinessIndex` GSI on the Nodes table,
 * then resolves its city slug from the `appData` table (CITY# row).
 *
 * Returns `null` when the business has no active node, when the node is
 * missing a `cityId`, or when the city row is missing a `slug`. The
 * caller treats `null` as a routing failure and skips the venue.
 *
 * Costs one Query (Nodes BusinessIndex) plus one GetItem (appData city).
 * That sits outside the R11.4 per-venue budget which scopes the
 * **evaluator** to one GetItem schedule + one Query CheckIns. The
 * routing reads are an unavoidable part of the fan-out and run once
 * per tick per matching schedule.
 */
async function resolveVenueRouting(businessId: string): Promise<VenueRouting | null> {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
      // Only need nodeId + cityId + isActive — keeps the response small.
      ProjectionExpression: 'nodeId, cityId, isActive',
    }),
  )
  const items = nodesResult.Items ?? []
  // Prefer active nodes; fall back to the first row if none are flagged
  // active so a misconfigured `isActive` doesn't silently disable the tick.
  const active = items.find((it) => it['isActive'] === true) ?? items[0]
  if (!active) return null

  const nodeId = active['nodeId'] as string | undefined
  const cityId = active['cityId'] as string | undefined
  if (!nodeId || !cityId) return null

  const cityResult = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `CITY#${cityId}`, sk: `CITY#${cityId}` },
      ProjectionExpression: 'slug',
    }),
  )
  const citySlug = cityResult.Item?.['slug'] as string | undefined
  if (!citySlug) return null

  return { nodeId, citySlug }
}

// ─────────────────────────────────────────────────────────────────────────────
// p99 helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the 99th percentile of a sample of millisecond latencies. Returns
 * `0` when the sample is empty so the metric stays well-typed. We use the
 * "nearest-rank" method (sort ascending, take ceil(p · n) − 1) which is
 * stable across small samples and matches what CloudWatch shows for low
 * traffic minutes.
 */
function p99(latenciesMs: readonly number[]): number {
  if (latenciesMs.length === 0) return 0
  const sorted = [...latenciesMs].sort((a, b) => a - b)
  const idx = Math.max(0, Math.ceil(0.99 * sorted.length) - 1)
  return sorted[idx] ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-venue fan-out
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single matching schedule row. Wrapped in its own try/catch so
 * the caller can keep going on per-venue failures (R11.5 "one bad row
 * never poisons the whole tick").
 *
 * Returns the outcome plus the latency in ms; the caller folds these into
 * the tick-level metric. Routing failures are logged and counted but do
 * not fail the tick.
 */
async function processVenue(
  row: NextTransitionRow,
  timestampIso: string,
  windowEndIso: string,
): Promise<{
  outcome: EvaluationTickOutcome | null
  latencyMs: number
  routingFailed: boolean
  errored: boolean
  tonightRemindersSent: number
}> {
  const started = Date.now()
  let routing: VenueRouting | null = null
  try {
    routing = await resolveVenueRouting(row.businessId)
  } catch (err) {
    console.error(
      `[schedule-transition-tick] Routing lookup failed for business=${row.businessId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return {
      outcome: null,
      latencyMs: Date.now() - started,
      routingFailed: true,
      errored: false,
      tonightRemindersSent: 0,
    }
  }
  if (!routing) {
    console.warn(
      `[schedule-transition-tick] No routing target for business=${row.businessId} (no active node or missing city slug)`,
    )
    return {
      outcome: null,
      latencyMs: Date.now() - started,
      routingFailed: true,
      errored: false,
      tonightRemindersSent: 0,
    }
  }

  // Tonight_Reminder (R9.7). Runs before the evaluator so an evaluator failure
  // cannot swallow a reminder the consumer explicitly asked for, and it is
  // counted separately so the tick metric shows reminders even on a tick where
  // no archetype changed.
  const tonightRemindersSent = await fanOutTonightReminders(row, routing.nodeId, timestampIso, windowEndIso)

  const event: EvaluationTickEvent = {
    businessId: row.businessId,
    scheduleId: row.scheduleId,
    nodeId: routing.nodeId,
    citySlug: routing.citySlug,
    timestampIso,
  }

  try {
    const outcome = await evaluateLiveArchetype(event)
    return {
      outcome,
      latencyMs: Date.now() - started,
      routingFailed: false,
      errored: false,
      tonightRemindersSent,
    }
  } catch (err) {
    console.error(
      `[schedule-transition-tick] Evaluator failed for business=${row.businessId} node=${routing.nodeId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return {
      outcome: null,
      latencyMs: Date.now() - started,
      routingFailed: false,
      errored: true,
      tonightRemindersSent,
    }
  }
}

/**
 * Fan out the Tonight_Reminder for any Dated_Slot starting in this tick's window
 * (proof-of-demand R9.7).
 *
 * One schedule read, and only for a business the GSI already says has a boundary
 * inside the window, so the reminder costs nothing on a quiet minute. The window
 * is the tick's own `[now, now + 60s)`: a start lands in exactly one tick, which
 * is the first half of "once per row" (the second half is the conditional claim
 * on the Going row itself).
 *
 * A slot the owner deleted or moved produces no start here, so no reminder is
 * sent for a night that is no longer on, while the Going rows themselves stay
 * (R9.10).
 *
 * Failures are logged and counted as zero rather than thrown: one venue's
 * reminder must not poison the tick (R11.5), and the claim-before-send rule means
 * an unclaimed row is simply picked up by nothing, never sent twice.
 */
async function fanOutTonightReminders(
  row: NextTransitionRow,
  nodeId: string,
  windowStartIso: string,
  windowEndIso: string,
): Promise<number> {
  try {
    const schedule = await getSchedule(row.businessId, row.scheduleId)
    if (!schedule) return 0

    const starting = datedSlotStartsInWindow(schedule, windowStartIso, windowEndIso)
    let sent = 0
    for (const slot of starting) {
      const outcome = await sendTonightReminders({ nodeId, date: slot.date, headline: slot.headline })
      sent += outcome.sent
    }
    return sent
  } catch (err) {
    console.error(
      `[schedule-transition-tick] Tonight_Reminder fan-out failed for business=${row.businessId} node=${nodeId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tick orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a single transition tick. Pure-ish orchestration: queries the GSI
 * and fans out per-venue Evaluation_Ticks sequentially. Sequential is fine
 * — at ≤100 venues per minute and ≤10 ms per evaluator call, the whole
 * fan-out fits in a single second of Lambda time.
 *
 * Exported separately from `handler` so tests can drive the orchestration
 * with a fixed timestamp without going through EventBridge.
 */
export async function runTransitionTick(nowMs: number = Date.now()): Promise<ScheduleTransitionTickOutcome> {
  const windowStartIso = new Date(nowMs).toISOString()
  const windowEndIso = new Date(nowMs + TICK_WINDOW_MS).toISOString()

  let rows: NextTransitionRow[]
  try {
    rows = await queryNextTransitions(windowStartIso, windowEndIso)
  } catch (err) {
    // GSI query failure: log and emit a zeroed metric so dashboards still
    // show the tick fired. Throwing here would make EventBridge mark the
    // invocation as failed and retry, which doubles up the next tick.
    console.error(
      `[schedule-transition-tick] queryNextTransitions failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    rows = []
  }

  const latencies: number[] = []
  let venuesEvaluated = 0
  let changesEmitted = 0
  let routingFailures = 0
  let evaluatorErrors = 0
  let tonightRemindersSent = 0

  for (const row of rows) {
    const result = await processVenue(row, windowStartIso, windowEndIso)
    latencies.push(result.latencyMs)
    tonightRemindersSent += result.tonightRemindersSent
    if (result.routingFailed) {
      routingFailures++
      continue
    }
    if (result.errored) {
      evaluatorErrors++
      continue
    }
    if (result.outcome) {
      venuesEvaluated++
      if (result.outcome.changed) changesEmitted++
    }
  }

  const tickOutcome: ScheduleTransitionTickOutcome = {
    venuesEvaluated,
    changesEmitted,
    p99LatencyMs: p99(latencies),
    routingFailures,
    evaluatorErrors,
    tonightRemindersSent,
  }

  // Tick-level metric (design "Observability"). Single structured info log
  // so CloudWatch metric filters can pick the fields up without needing
  // the AWS SDK PutMetricData path.
  console.log(
    JSON.stringify({
      level: 'info',
      worker: 'schedule-transition-tick',
      timestamp: windowStartIso,
      windowEnd: windowEndIso,
      candidateRows: rows.length,
      ...tickOutcome,
    }),
  )

  return tickOutcome
}

// ─────────────────────────────────────────────────────────────────────────────
// Lambda handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EventBridge entry point. Accepts the standard Scheduled Event payload
 * but doesn't read any of its fields — the tick is parameterised entirely
 * by `Date.now()`. Errors at the orchestration layer are caught and
 * logged so EventBridge does not retry the whole tick.
 */
export async function handler(): Promise<ScheduleTransitionTickOutcome> {
  try {
    return await runTransitionTick()
  } catch (err) {
    console.error(`[schedule-transition-tick] Unhandled error: ${err instanceof Error ? err.message : String(err)}`)
    return {
      venuesEvaluated: 0,
      changesEmitted: 0,
      p99LatencyMs: 0,
      routingFailures: 0,
      evaluatorErrors: 0,
      tonightRemindersSent: 0,
    }
  }
}
