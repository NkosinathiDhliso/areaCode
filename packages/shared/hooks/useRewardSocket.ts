import { useEffect } from 'react'

import { getSocket } from '../lib/socket'
import { useRewardStore } from '../stores/rewardStore'
import { useToastStore } from '../stores/toastStore'
import type { Toast } from '../types'

/**
 * Subscribes to reward-related socket events:
 * - `reward:claimed` → stores the earned reward (with its redemption code)
 *   in the wallet and raises a toast pointing the user at it
 * - `reward:slots_update` → updates slot counts in reward store
 */
export function useRewardSocket(token?: string) {
  const updateSlots = useRewardStore((s) => s.updateSlots)
  const upsertUnclaimedReward = useRewardStore((s) => s.upsertUnclaimedReward)
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    if (!token) return

    const socket = getSocket(token)

    const claimedHandler = (payload: {
      rewardId: string
      rewardTitle: string
      redemptionCode: string
      codeExpiresAt: string
      nodeName?: string
    }) => {
      // Persist the code into the wallet so the user can present it to staff.
      // Without this the code only ever existed in a transient toast and the
      // reward could never actually be redeemed.
      upsertUnclaimedReward({
        id: payload.rewardId,
        rewardTitle: payload.rewardTitle,
        redemptionCode: payload.redemptionCode,
        codeExpiresAt: payload.codeExpiresAt,
        nodeName: payload.nodeName ?? '',
        createdAt: new Date().toISOString(),
      })

      const toast: Toast = {
        id: `reward-${payload.rewardId}-${Date.now()}`,
        type: 'reward_new',
        message: `You earned: ${payload.rewardTitle} - tap Rewards to view your code`,
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
  }, [token, updateSlots, upsertUnclaimedReward, addToast])
}
