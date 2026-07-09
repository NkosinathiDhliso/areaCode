// ============================================================================
// Win-Back Campaigns — Segment Resolver
// ----------------------------------------------------------------------------
// Converts a Segment definition + the campaign's nodes into a deduplicated set
// of target consumer userIds, using ONLY existing check-in data.
//
// Constraint C1 (no SMS / no phone): the only consumer identifier used anywhere
// in this module is `userId` (Cognito sub). Phone numbers are never read, used,
// or returned. See `.kiro/steering/no-sms-no-phone-auth.md`.
//
// The audience query mirrors the proven `notifyNewRewardConsumers()` pattern:
// paginate `getCheckInsByNode` per node, then dedupe/merge by `userId`.
//
// Cost guardrail (Requirement 14.4): a single resolution scans at most the
// most-recent 10000 check-ins per node. When that cap is hit, the result
// surfaces `truncated: true` so callers can warn that the estimate is bounded.
// ============================================================================

import { getTier } from '@area-code/shared/constants/tier-levels'

import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'

import type { Segment } from './types.js'

/** Input to the segment resolver. */
export interface SegmentInput {
  segment: Segment
  /** Nodes owned by the business that the campaign targets. */
  nodeIds: string[]
  /** Lapsed-window length in days. Only meaningful for the `lapsed` segment. */
  lapsedWindowDays: number
  /** "Now" reference time in epoch ms (injected for deterministic resolution). */
  nowMs: number
}

/** Result of a resolution, including the cost-guardrail truncation flag. */
export interface SegmentResult {
  /** Deduplicated set of target consumer userIds. */
  userIds: string[]
  /** True when the per-node 10000 check-in scan cap was hit (Requirement 14.4). */
  truncated: boolean
}

/** Per-user aggregate built across the campaign's nodes. */
interface UserAggregate {
  /** Total check-in count across all of the campaign's nodes. */
  count: number
  /** Most-recent check-in time across all nodes, epoch ms. */
  lastCheckInMs: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Most-recent check-ins scanned per node (Requirement 14.4). */
const PER_NODE_CAP = 10000

/** Page size for `getCheckInsByNode` pagination. */
const PAGE_SIZE = 100

/**
 * Loyalty tiers that count as `regular` or higher (Requirement 3.2). Derived by
 * reusing the platform's existing tier computation (`getTier`) rather than
 * re-deriving thresholds here.
 */
const REGULAR_OR_HIGHER = new Set(['regular', 'fixture', 'institution', 'legend'])

/**
 * Build a per-user `{count, lastCheckInMs}` map merged across all of the
 * campaign's nodes, bounded to the most-recent `PER_NODE_CAP` check-ins per
 * node. Returns the map plus whether any node's scan hit the cap.
 */
async function aggregateCheckIns(
  nodeIds: string[],
): Promise<{ byUser: Map<string, UserAggregate>; truncated: boolean }> {
  const byUser = new Map<string, UserAggregate>()
  let truncated = false

  // Dedupe node ids defensively so a repeated node can't double-count or
  // inflate the scan budget.
  for (const nodeId of [...new Set(nodeIds)]) {
    let scanned = 0
    let cursor: string | undefined

    do {
      // Never request more than the remaining per-node budget.
      const limit = Math.min(PAGE_SIZE, PER_NODE_CAP - scanned)
      const page = await getCheckInsByNode(nodeId, { limit, cursor })

      for (const ci of page.checkIns) {
        const ms = new Date(ci.checkedInAt).getTime()
        const existing = byUser.get(ci.userId)
        if (existing) {
          existing.count += 1
          if (ms > existing.lastCheckInMs) existing.lastCheckInMs = ms
        } else {
          byUser.set(ci.userId, { count: 1, lastCheckInMs: ms })
        }
        scanned += 1
      }

      cursor = page.nextCursor
    } while (cursor && scanned < PER_NODE_CAP)

    // We stopped scanning this node at the cap but more check-ins remain.
    if (cursor && scanned >= PER_NODE_CAP) {
      truncated = true
    }
  }

  return { byUser, truncated }
}

/**
 * Resolve a segment to a deduplicated set of userIds together with the
 * truncation flag. Prefer this when the caller needs the cost-guardrail signal
 * (e.g. the recipient estimate). `resolveSegment` is the thin `string[]` view.
 */
export async function resolveSegmentWithMeta(input: SegmentInput): Promise<SegmentResult> {
  const { segment, nodeIds, lapsedWindowDays, nowMs } = input

  if (nodeIds.length === 0) {
    return { userIds: [], truncated: false }
  }

  const { byUser, truncated } = await aggregateCheckIns(nodeIds)

  // Cutoff for the lapsed window: a consumer is lapsed when their most-recent
  // check-in is strictly older than this boundary (i.e. no check-in within the
  // most recent `lapsedWindowDays`).
  const cutoffMs = nowMs - lapsedWindowDays * MS_PER_DAY

  const userIds: string[] = []

  for (const [userId, { count, lastCheckInMs }] of byUser) {
    let include = false

    switch (segment) {
      case 'lapsed':
        // Visited at least once AND no check-in within the window.
        include = count >= 1 && lastCheckInMs < cutoffMs
        break
      case 'first_timers':
        // Exactly one check-in across the campaign's nodes, ever.
        include = count === 1
        break
      case 'regulars':
        // Tier at the business (derived from per-business check-in count) is
        // `regular` or higher.
        include = REGULAR_OR_HIGHER.has(getTier(count))
        break
      case 'all_past_visitors':
        // Any past check-in qualifies.
        include = count >= 1
        break
    }

    if (include) userIds.push(userId)
  }

  return { userIds, truncated }
}

/**
 * Resolve a segment to a deduplicated set of target consumer userIds.
 *
 * Deduplication is structural: the per-user aggregate is keyed by `userId`, so
 * a consumer who checked in at multiple of the business's nodes is counted and
 * returned exactly once (Requirements 2.2, 3.4).
 */
export async function resolveSegment(input: SegmentInput): Promise<string[]> {
  const { userIds } = await resolveSegmentWithMeta(input)
  return userIds
}
