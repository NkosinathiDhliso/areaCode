import { useEffect } from 'react'

import { getSocket } from '../lib/socket'
import { useMapStore } from '../stores/mapStore'
import type { NodeState, VenueMomentum } from '../types'

export function useNodePulse(token?: string, opts?: { citySlug?: string }) {
  const updateNodePulse = useMapStore((s) => s.updateNodePulse)
  const setLivePresenceCount = useMapStore((s) => s.setLivePresenceCount)

  useEffect(() => {
    const socket = getSocket(token, opts?.citySlug ? { citySlug: opts.citySlug } : undefined)

    const handler = (payload: { nodeId: string; pulseScore: number; state: NodeState; checkInCount: number }) => {
      updateNodePulse(payload.nodeId, payload.pulseScore, payload.checkInCount)
    }

    // Honest presence: `node:presence_update` carries the true Live_Presence_Count
    // (present check-ins, not expired, not the cumulative tally). It drives the map's
    // "people here now" surface and takes precedence over `node:pulse_update.checkInCount`
    // (R7.1, R7.3, R8.3). Same socket/transport and the same store-write mechanism as the
    // pulse subscription above; cleaned up on unmount alongside it.
    const presenceHandler = (payload: {
      nodeId: string
      livePresenceCount: number
      cause: 'check_in' | 'check_out' | 'expiry'
      momentum?: VenueMomentum
    }) => {
      setLivePresenceCount(payload.nodeId, payload.livePresenceCount, payload.momentum)
    }

    socket.on('node:pulse_update', handler)
    socket.on('node:presence_update', presenceHandler)
    // Initial load (R7.6): the honest per-venue count is primed from the read API
    // `GET /v1/nodes/:nodeId/presence` (task 10.1) at the surface that knows which nodes
    // are in view (the map/nodes load), then kept live by `node:presence_update` here.
    // This hook is socket-scoped and not node-scoped, so it does not itself fan out the
    // per-node REST fetch; that priming lives with the nodes payload load.
    return () => {
      socket.off('node:pulse_update', handler)
      socket.off('node:presence_update', presenceHandler)
    }
  }, [token, opts?.citySlug, updateNodePulse, setLivePresenceCount])
}
