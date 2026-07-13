// Per-venue share counters for the Weekly Attribution Digest.
//
// Feature: weekly-attribution-digest (shares Attribution_Metric)
//
// A consumer completing the "share this venue" action increments a per-node,
// per-Digest_Week counter. The digest generator reads and sums these counters
// for a business's active nodes to render the honest "N shares recorded" line.
//
// Storage reuses the shared KV store (app-data table) rather than a new access
// pattern (dry-reuse). The KV value carries a TTL so counters expire on their
// own once the week's digest has snapshotted them into the durable Digest_Row.
// Shares are a reach fact for the business surface only; they never feed
// ranking (discovery-dna) and never carry consumer identity (POPIA): the key is
// node + week, nothing about who shared.

import { kvBatchGet, kvIncr } from '../../shared/kv/dynamodb-kv.js'

import { digestWeekFor } from './digest.js'

// Counters only need to outlive the gap between the share and the Monday
// pipeline pass that closes the week (plus slack for a delayed/re-run pass).
// 90 days is generous and self-cleaning; no cleanup job required.
const SHARE_COUNTER_TTL_SECONDS = 90 * 24 * 60 * 60

/** KV key for one node's share tally within one Digest_Week. */
function shareKey(nodeId: string, weekStartIso: string): string {
  return `share:${nodeId}:${weekStartIso}`
}

/**
 * Record one completed share of a node. Buckets into the Digest_Week the share
 * instant falls in (the same week arithmetic the generator uses to read), so a
 * mid-week share lands in the week the Monday pass will close.
 */
export async function recordNodeShare(nodeId: string, nowIso: string = new Date().toISOString()): Promise<void> {
  const { weekStartIso } = digestWeekFor(nowIso)
  await kvIncr(shareKey(nodeId, weekStartIso), SHARE_COUNTER_TTL_SECONDS)
}

/**
 * Sum the recorded shares across the given nodes for one Digest_Week. Missing
 * counters are a genuine zero (a node nobody shared), never a swallowed error.
 */
export async function getNodeShareCountsForWeek(nodeIds: string[], weekStartIso: string): Promise<number> {
  if (nodeIds.length === 0) return 0
  const counts = await kvBatchGet(nodeIds.map((nodeId) => shareKey(nodeId, weekStartIso)))
  let total = 0
  for (const value of counts.values()) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isNaN(parsed)) total += parsed
  }
  return total
}
