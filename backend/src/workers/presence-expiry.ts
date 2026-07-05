// Presence expiry worker — the serverless half of honest presence.
//
// Feature: presence-integrity (Requirements 5.1, 5.2, 5.3, 5.6, 6.1, 6.2, 6.3, 6.5)
//
// An `arm64` Lambda on an EventBridge `rate(5 minutes)` schedule, aligned with
// the existing `pulse-decay` cadence and reusing its exact SAST 18:00–23:59 peak
// boundary (`isPeakHour`). It mirrors `pulse-decay`'s structure: iterate cities,
// then the active nodes per city.
//
// For each node it queries the `NodeIndex` GSI for DUE records (`present` with
// `expiresAt <= now`) and applies the conditional expire transition via
// `endPresenceByExpiry`, which:
//   - transitions `present -> expired` only when still due (so it never
//     re-transitions a `checked_out`/`expired` record and never double-decrements
//     if it races a manual check-out — Requirements 5.6, 3.3),
//   - sets `endedAt = expiresAt` so the recorded dwell is bounded by the
//     Expiry_Window (Requirements 5.2, 9.2), flagged `expiry_terminated`,
//   - performs the guarded counter decrement on success.
//
// On each successful expiry we write an anonymised dwell row. After processing a
// node's due records we reconcile the cached counter to the authoritative
// record-derived count (design "two layers, one honest number") and best-effort
// emit a `node:presence_update` event with cause `expiry` carrying the reconciled
// count — wrapped so a fan-out failure is logged and never rolls back the
// committed expiry (Requirement 7.5 spirit).
//
// Serverless-only: no always-on resource, just this EventBridge-driven handler.
// The Terraform wiring (rate(5 minutes), arm64 Lambda) lives in infra.
import { ScanCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { writeDwellRow } from '../features/presence/dwell-sink.js'
import {
  endPresenceByExpiry,
  queryDuePresenceRecords,
  reconcileCounter,
  recordPresenceSample,
} from '../features/presence/repository.js'
import { broadcastPresenceUpdate } from '../shared/websocket/broadcast.js'
import { emitFriendCheckout } from '../shared/socket/events.js'
import { getMutualFollowIds, getFollowingIds } from '../features/social/repository.js'
import { canEmitIdentity } from '../shared/privacy/privacy-guard.js'

/** Cities are stored in `app-data` as `CITY#<id>` rows where `sk = pk`. */
async function getCities() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND sk = pk',
      ExpressionAttributeValues: { ':prefix': 'CITY#' },
    }),
  )
  return (result.Items || []).map((c) => ({ id: (c['cityId'] ?? c['pk']) as string, slug: c['slug'] as string }))
}

/**
 * Presence expiry sweep — EventBridge Lambda every 5 minutes.
 *
 * Mirrors `pulse-decay`'s per-city / active-node iteration. For every active
 * node it expires all due `present` records, captures bounded dwell, reconciles
 * the cached counter to the authoritative count, and best-effort broadcasts the
 * new honest count when it changed.
 */
export async function handler() {
  console.log('[presence-expiry] Starting presence expiry worker')

  const cities = await getCities()
  let totalExpired = 0
  let nodesTouched = 0

  for (const city of cities) {
    // All active nodes for this city (same Scan pattern as pulse-decay).
    const nodesResult = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.nodes,
        FilterExpression: 'cityId = :cityId AND isActive = :active',
        ExpressionAttributeValues: { ':cityId': city.id, ':active': true },
      }),
    )

    for (const n of nodesResult.Items || []) {
      const nodeId = n['nodeId'] as string

      // Compute `now` per node so a long sweep stays accurate as it progresses.
      const now = Math.floor(Date.now() / 1000)
      const due = await queryDuePresenceRecords(nodeId, now)
      if (due.length === 0) continue

      let expiredForNode = 0
      for (const record of due) {
        // Conditional expire: only fires while still due. Returns the expired
        // record (with bounded dwell) on success, or null on a no-op (already
        // ended / raced by a check-out).
        const expired = await endPresenceByExpiry({ userId: record.userId, nodeId, now })
        if (!expired) continue

        await writeDwellRow({
          nodeId,
          durationSeconds: expired.dwellSeconds!,
          termination: 'expiry_terminated',
          endedAt: expired.endedAt!,
        })

        // Best-effort emit `friend:checkout` to the expired user's mutual friends
        // so their taste-match store stays honest (Requirements 3.4, 3.5).
        try {
          const canEmit = await canEmitIdentity(record.userId)
          if (canEmit) {
            const followingIds = await getFollowingIds(record.userId)
            const friendIds = await getMutualFollowIds(record.userId, followingIds)
            for (const friendId of friendIds) {
              emitFriendCheckout(friendId, { userId: record.userId, nodeId })
            }
          }
        } catch (err) {
          console.warn(`[presence-expiry] friend:checkout emit failed for user ${record.userId}: ${String(err)}`)
        }

        expiredForNode++
        totalExpired++
      }

      if (expiredForNode === 0) continue
      nodesTouched++

      // Reconcile the cached counter to the authoritative record-derived count,
      // then best-effort broadcast the honest count with cause 'expiry'.
      const count = await reconcileCounter(nodeId, now)
      // Record the reconciled count so expiry-driven departures feed the honest
      // momentum trend (a venue emptying overnight reads as "winding down").
      const momentum = await recordPresenceSample(nodeId, count, now)
      try {
        await broadcastPresenceUpdate(city.slug, nodeId, count, 'expiry', momentum)
      } catch (err) {
        // Best-effort fan-out: a broadcast failure must never roll back the
        // committed expiry (Requirement 7.5 spirit).
        console.error(`[presence-expiry] Failed to broadcast presence update for node ${nodeId}`, err)
      }
    }
  }

  console.log(`[presence-expiry] Expired ${totalExpired} records across ${nodesTouched} nodes`)
  return { expired: totalExpired, nodes: nodesTouched }
}
