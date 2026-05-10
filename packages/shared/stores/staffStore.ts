/**
 * Staff Zustand store managing live queue, recent redemptions, today's stats, and WS status.
 *
 * Requirements: 6.1, 6.2, 6.3
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { NodeState, Tier } from '../types'

export interface StaffCheckInEvent {
  id: string
  nodeId: string
  consumerName: string
  tier: Tier
  timestamp: string
}

export interface StaffRedemptionRecord {
  id: string
  code: string
  rewardTitle: string
  consumerName: string
  status: 'success' | 'failed'
  timestamp: string
}

export type StaffWsStatus = 'connected' | 'disconnected' | 'reconnecting'

export interface StaffTodayStats {
  checkIns: number
  redemptions: number
  pulseState: NodeState
}

interface StaffState {
  liveQueue: StaffCheckInEvent[]
  recentRedemptions: StaffRedemptionRecord[]
  todayStats: StaffTodayStats
  wsStatus: StaffWsStatus
}

interface StaffActions {
  addCheckIn: (event: StaffCheckInEvent) => void
  addRedemption: (record: StaffRedemptionRecord) => void
  updateStats: (stats: Partial<StaffTodayStats>) => void
  setWsStatus: (status: StaffWsStatus) => void
  reset: () => void
}

const MAX_LIVE_QUEUE = 20
const MAX_RECENT_REDEMPTIONS = 50

const initialState: StaffState = {
  liveQueue: [],
  recentRedemptions: [],
  todayStats: { checkIns: 0, redemptions: 0, pulseState: 'dormant' },
  wsStatus: 'disconnected',
}

export const useStaffStore = create<StaffState & StaffActions>()(
  immer((set) => ({
    ...initialState,

    addCheckIn: (event) =>
      set((state) => {
        state.liveQueue.unshift(event)
        if (state.liveQueue.length > MAX_LIVE_QUEUE) {
          state.liveQueue.length = MAX_LIVE_QUEUE
        }
      }),

    addRedemption: (record) =>
      set((state) => {
        state.recentRedemptions.unshift(record)
        if (state.recentRedemptions.length > MAX_RECENT_REDEMPTIONS) {
          state.recentRedemptions.length = MAX_RECENT_REDEMPTIONS
        }
      }),

    updateStats: (stats) =>
      set((state) => {
        if (stats.checkIns !== undefined) state.todayStats.checkIns = stats.checkIns
        if (stats.redemptions !== undefined) state.todayStats.redemptions = stats.redemptions
        if (stats.pulseState !== undefined) state.todayStats.pulseState = stats.pulseState
      }),

    setWsStatus: (status) =>
      set((state) => {
        state.wsStatus = status
      }),

    reset: () => set(() => ({ ...initialState })),
  })),
)

export { MAX_LIVE_QUEUE, MAX_RECENT_REDEMPTIONS }
