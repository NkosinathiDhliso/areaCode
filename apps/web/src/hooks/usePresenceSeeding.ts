import { api } from '@area-code/shared/lib/api'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { Node, VenueMomentum } from '@area-code/shared/types'
import { useEffect } from 'react'

import { RECOMMENDED_LIMIT } from '../lib/carouselConstants'
import { vibeRank } from '../lib/carouselRanking'

/**
 * First-paint presence seeding (honest-presence-ui R4).
 *
 * When the map's nodes load, prime each in-view venue's honest
 * Live_Presence_Count over REST from the existing
 * `GET /v1/nodes/:nodeId/presence` read so venues do not read 0/quiet on first
 * paint while waiting for the first `node:presence_update` socket event. After
 * seeding, the live value is kept current solely by `node:presence_update` via
 * the unchanged `useNodePulse` -> `mapStore.setLivePresenceCount` path; this
 * hook introduces no polling loop, no new transport, and no second live-count
 * store (R4.2, R4.6, R5.1, R5.4).
 */

/** Max concurrent presence reads in flight during seeding (R4.5 bound). */
const SEED_CONCURRENCY = 5

/** Shape returned by the honest presence read API. Unchanged backend contract. */
interface PresenceRead {
  nodeId: string
  livePresenceCount: number
  momentum?: VenueMomentum
}

/**
 * Select the venues to prime presence for: the top {@link RECOMMENDED_LIMIT}
 * (20) by `vibeRank` ordering - the set the consumer can actually act on at
 * cold open - bounding the fan-out so a large city load never issues an
 * unbounded burst of per-venue requests (R4.5).
 *
 * Pure and total so it can be unit/property tested in isolation. The live
 * signal maps (pulse, check-in counts, position) are not available at
 * seed-target selection time, so this reuses `vibeRank` with empty signals
 * rather than re-implementing a separate ordering: the result degrades to the
 * deterministic tail of the same ranking concept (business tier, then id).
 * Output never exceeds the cap and never repeats a node id.
 */
export function pickSeedTargets(nodes: Node[]): Node[] {
  const ranked = vibeRank({
    venues: nodes,
    pulseScores: {},
    checkInCounts: {},
    lastKnownPosition: null,
    positionFresh: false,
  })

  const seen = new Set<string>()
  const targets: Node[] = []
  for (const node of ranked) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    targets.push(node)
    if (targets.length >= RECOMMENDED_LIMIT) break
  }
  return targets
}

/**
 * Run `worker` over `targets` with at most `limit` calls in flight at once.
 * A fixed-size pool of runners drains a shared cursor, so seeding stays bounded
 * regardless of how many venues are primed.
 */
async function seedWithConcurrency(
  targets: Node[],
  limit: number,
  worker: (nodeId: string) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runNext = async (): Promise<void> => {
    while (cursor < targets.length) {
      const target = targets[cursor++]
      if (!target) return
      await worker(target.id)
    }
  }
  const poolSize = Math.min(limit, targets.length)
  await Promise.all(Array.from({ length: poolSize }, () => runNext()))
}

/**
 * One-shot REST priming of the in-view venues' Live_Presence_Count, keyed on
 * the loaded nodes payload. Re-runs only when the nodes reference changes; a
 * cancellation guard drops any in-flight write after unmount or a new payload.
 */
export function usePresenceSeeding(nodes: Node[]): void {
  const setLivePresenceCount = useMapStore((s) => s.setLivePresenceCount)

  useEffect(() => {
    if (nodes.length === 0) return

    let cancelled = false
    const targets = pickSeedTargets(nodes)

    void seedWithConcurrency(targets, SEED_CONCURRENCY, async (nodeId) => {
      if (cancelled) return
      try {
        const res = await api.get<PresenceRead>(`/v1/nodes/${nodeId}/presence`)
        // Honest 0 (R4.3): write the read value exactly as returned, including
        // 0. Never substitute a decayed pulse value or a cumulative historical
        // tally to make a quiet venue look occupied.
        if (!cancelled) setLivePresenceCount(res.nodeId, res.livePresenceCount, res.momentum)
      } catch {
        // R4.4: a per-venue read failure leaves that node unseeded so the
        // `node:presence_update` socket event can populate it later. The
        // failure is isolated here and never thrown past the nodes-load flow,
        // so it cannot block or break the map render.
      }
    })

    return () => {
      cancelled = true
    }
  }, [nodes, setLivePresenceCount])
}
