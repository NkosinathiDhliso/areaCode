import { useEffect, useRef } from 'react'

import { getSocket } from '../lib/socket'
import { useMapStore } from '../stores/mapStore'
import type { LiveArchetypeBranch } from '../types'

/**
 * Five-minute retention window for cached Live_Archetype ids per R11.6.
 * After this window, the cache entry for a node is dropped so the renderer
 * falls back to `node.defaultArchetypeId ?? 'archetype-eclectic'` until the
 * next `node:archetype_change` event or live nodes payload arrives.
 */
const ARCHETYPE_CACHE_TTL_MS = 5 * 60 * 1000

interface ArchetypeChangePayload {
  nodeId: string
  liveArchetypeId: string
  branch: LiveArchetypeBranch
}

/**
 * Subscribe to live archetype deltas for the consumer map.
 *
 * Mirrors `useNodePulse`: opens (or reuses) the singleton WebSocket, listens
 * for `node:archetype_change` events, and writes each payload's
 * `liveArchetypeId` into `useMapStore.archetypeIds[nodeId]` (R11.2).
 *
 * Per-node retention is enforced by a 5-minute `setTimeout` keyed by
 * `nodeId`; each new event for the same node clears and re-arms the timer
 * so the cached value lives at most 5 minutes past the last delta (R11.6).
 *
 * On reconnect, the next live nodes payload (REST `setNodes(...)` ingest in
 * `MapScreen`) carries each Node's current `liveArchetypeId`. A store
 * subscription replaces cached values for those nodes and clears the cache
 * for any node missing from the payload, so a stale archetype id cannot
 * survive a reconnect (R11.7).
 */
export function useNodeArchetype(token?: string, opts?: { citySlug?: string }) {
  const setArchetypeId = useMapStore((s) => s.setArchetypeId)
  const clearArchetypeId = useMapStore((s) => s.clearArchetypeId)

  // Per-node retention timers. Held in a ref so re-renders do not lose them
  // and so the cleanup path can clear every pending timeout.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const socket = getSocket(token, opts?.citySlug ? { citySlug: opts.citySlug } : undefined)
    const timers = timersRef.current

    const armRetentionTimer = (nodeId: string) => {
      const existing = timers.get(nodeId)
      if (existing !== undefined) clearTimeout(existing)
      const handle = setTimeout(() => {
        timers.delete(nodeId)
        clearArchetypeId(nodeId)
      }, ARCHETYPE_CACHE_TTL_MS)
      timers.set(nodeId, handle)
    }

    const handleArchetypeChange = (payload: ArchetypeChangePayload) => {
      if (!payload?.nodeId || typeof payload.liveArchetypeId !== 'string') return
      setArchetypeId(payload.nodeId, payload.liveArchetypeId, payload.branch)
      armRetentionTimer(payload.nodeId)
    }

    socket.on('node:archetype_change', handleArchetypeChange)

    // Reconnect reconciliation (R11.7). The backend replays the live nodes
    // payload via the REST `setNodes(...)` path; we observe `state.nodes`
    // and replace cached archetype ids for those nodes from each Node's
    // `liveArchetypeId`. Nodes whose payload omits `liveArchetypeId` have
    // their cache entry cleared so a stale id cannot survive a reconnect.
    const unsubscribeNodes = useMapStore.subscribe((state, prev) => {
      if (state.nodes === prev.nodes) return
      for (const node of Object.values(state.nodes)) {
        if (typeof node.liveArchetypeId === 'string' && node.liveArchetypeId.length > 0) {
          setArchetypeId(node.id, node.liveArchetypeId)
          armRetentionTimer(node.id)
        } else if (state.archetypeIds[node.id] !== undefined) {
          const existing = timers.get(node.id)
          if (existing !== undefined) {
            clearTimeout(existing)
            timers.delete(node.id)
          }
          clearArchetypeId(node.id)
        }
      }
    })

    return () => {
      socket.off('node:archetype_change', handleArchetypeChange)
      unsubscribeNodes()
      for (const handle of timers.values()) clearTimeout(handle)
      timers.clear()
    }
  }, [token, opts?.citySlug, setArchetypeId, clearArchetypeId])
}
