import { useEffect } from 'react'

import { getSocket } from '../lib/socket'
import { useMapStore } from '../stores/mapStore'
import { useToastStore } from '../stores/toastStore'
import type { NodeState, Toast } from '../types'

/**
 * Subscribes to `node:state_surge` socket events.
 * Updates mapStore pulse state and adds surge toasts to the toast queue.
 */
export function useStateSurge(token?: string) {
  const updateNodePulse = useMapStore((s) => s.updateNodePulse)
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    const socket = getSocket(token)

    const handler = (payload: { nodeId: string; fromState: NodeState; toState: NodeState }) => {
      // Map state to approximate pulse score for marker update
      const stateScores: Record<NodeState, number> = {
        dormant: 0,
        quiet: 5,
        active: 20,
        buzzing: 45,
        popping: 75,
      }
      updateNodePulse(payload.nodeId, stateScores[payload.toState] ?? 0)

      // Surge toast for popping state (priority 1)
      if (payload.toState === 'popping') {
        const toast: Toast = {
          id: `surge-${payload.nodeId}-${Date.now()}`,
          type: 'surge',
          message: 'A spot just hit peak energy nearby',
          nodeId: payload.nodeId,
          priority: 1,
          timestamp: Date.now(),
        }
        addToast(toast)
      }
    }

    socket.on('node:state_surge', handler)
    return () => {
      socket.off('node:state_surge', handler)
    }
  }, [token, updateNodePulse, addToast])
}
