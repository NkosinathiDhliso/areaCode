import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { Reward, RewardRedemption } from '../types'

interface RewardState {
  activeRewards: Record<string, Reward[]>
  unclaimedRewards: RewardRedemption[]
  setNodeRewards: (nodeId: string, rewards: Reward[]) => void
  setUnclaimedRewards: (rewards: RewardRedemption[]) => void
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
