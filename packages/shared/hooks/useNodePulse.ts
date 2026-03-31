import { useEffect } from 'react'

import { getSocket } from '../lib/socket'
import { useMapStore } from '../stores/mapStore'
import type { NodeState } from '../types'

export function useNodePulse(token?: string, opts?: { citySlug?: string }) {
  const updateNodePulse = useMapStore((s) => s.updateNodePulse)

  useEffect(() => {
    const socket = getSocket(token, opts?.citySlug ? { citySlug: opts.citySlug } : undefined)

    const handler = (payload: { nodeId: string; pulseScore: number; state: NodeState; checkInCount: number }) => {
      updateNodePulse(payload.nodeId, payload.pulseScore)
    }

    socket.on('node:pulse_update', handler)
    return () => {
      socket.off('node:pulse_update', handler)
    }
  }, [token, opts?.citySlug, updateNodePulse])
}
