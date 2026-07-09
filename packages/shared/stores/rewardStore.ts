import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { Reward } from '../types'

/**
 * A reward the consumer has earned but not yet had redeemed by staff.
 * Carries the redemption code the consumer must present at the venue.
 */
export interface UnclaimedReward {
  id: string
  rewardTitle: string
  rewardType?: string
  redemptionCode: string
  codeExpiresAt: string
  nodeName: string
  createdAt?: string
  // Whether the code's venue is still active on Area Code
  // (cross-portal-lifecycle-alignment R4.2). Carried on the wallet read so the
  // RedemptionCodeCard can render the honest lapsed-venue line without a
  // per-card venue fetch. Absent on older payloads is treated as active.
  venueActive?: boolean
}

interface RewardState {
  activeRewards: Record<string, Reward[]>
  unclaimedRewards: UnclaimedReward[]
  setNodeRewards: (nodeId: string, rewards: Reward[]) => void
  setUnclaimedRewards: (rewards: UnclaimedReward[]) => void
  /** Insert or replace a single earned reward (e.g. from a live socket event). */
  upsertUnclaimedReward: (reward: UnclaimedReward) => void
  /** Remove an earned reward once it's been redeemed or has expired. */
  removeUnclaimedReward: (id: string) => void
  updateSlots: (rewardId: string, slotsRemaining: number) => void
}

export const useRewardStore = create<RewardState>()(
  immer((set) => ({
    activeRewards: {},
    unclaimedRewards: [],
    setNodeRewards: (nodeId, rewards) =>
      set((state) => {
        state.activeRewards[nodeId] = rewards
      }),
    setUnclaimedRewards: (rewards) =>
      set((state) => {
        state.unclaimedRewards = rewards
      }),
    upsertUnclaimedReward: (reward) =>
      set((state) => {
        const idx = state.unclaimedRewards.findIndex((r) => r.id === reward.id)
        if (idx >= 0) {
          state.unclaimedRewards[idx] = reward
        } else {
          state.unclaimedRewards.unshift(reward)
        }
      }),
    removeUnclaimedReward: (id) =>
      set((state) => {
        state.unclaimedRewards = state.unclaimedRewards.filter((r) => r.id !== id)
      }),
    updateSlots: (rewardId, slotsRemaining) =>
      set((state) => {
        for (const nodeRewards of Object.values(state.activeRewards)) {
          if (!nodeRewards) continue
          const reward = nodeRewards.find((r) => r.id === rewardId)
          if (reward && reward.totalSlots !== null) {
            reward.claimedCount = reward.totalSlots - slotsRemaining
          }
        }
      }),
  })),
)
