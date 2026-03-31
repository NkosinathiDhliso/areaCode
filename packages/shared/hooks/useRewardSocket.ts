import { useEffect } from 'react'

import { getSocket } from '../lib/socket'
import { useRewardStore } from '../stores/rewardStore'
import { useToastStore } from '../stores/toastStore'
import type { Toast } from '../types'

/**
 * Subscribes to reward-related socket events:
 * - `reward:claimed` → adds reward toast and stores unclaimed reward info
 * - `reward:slots_update` → updates slot counts in reward store
 */
export function useRewardSocket(token?: string) {
  const updateSlots = useRewardStore((s) => s.updateSlots)
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    if (!token) return

    const socket = getSocket(token)

    const claimedHandler = (payload: {
      rewardId: string
      rewardTitle: string
      redemptionCode: string
      codeExpiresAt: string
    }) => {
      const toast: Toast = {
        id: `reward-${payload.rewardId}-${Date.now()}`,
        type: 'reward_new',
        message: `You earned: ${payload.rewardTitle}`,
        priority: 3,
        timestamp: Date.now(),
      }
      addToast(toast)
    }

    const slotsHandler = (payload: { rewardId: string; slotsRemaining: number }) => {
      updateSlots(payload.rewardId, payload.slotsRemaining)
    }

    socket.on('reward:claimed', claimedHandler)
    socket.on('reward:slots_update', slotsHandler)

    return () => {
      socket.off('reward:claimed', claimedHandler)
      socket.off('reward:slots_update', slotsHandler)
    }
  }, [token, updateSlots, addToast])
}
