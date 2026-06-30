import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { BusinessAccount, Node } from '../types'

type DashboardPanel =
  | 'live'
  | 'rewards'
  | 'audience'
  | 'boost'
  | 'plans'
  | 'settings'
  | 'check-ins'
  | 'reward-metrics'
  | 'staff-redemptions'
  | 'staff-leaderboard'
  | 'reports'
  | 'campaigns'
  | 'music-schedule'

/**
 * One-tap win-back prefill: the Reports panel writes this when a retention
 * recommendation's "Create win-back campaign" CTA is tapped, then switches to
 * the campaigns panel. The Campaigns panel consumes it once to seed the
 * composer, then clears it.
 */
export interface CampaignPrefill {
  segment: 'lapsed' | 'first_timers' | 'regulars' | 'all_past_visitors'
  nodeIds: string[]
  title: string
  body: string
  reportId?: string
}

interface BusinessState {
  business: BusinessAccount | null
  nodes: Node[]
  currentPanel: DashboardPanel
  campaignPrefill: CampaignPrefill | null
  setBusiness: (business: BusinessAccount) => void
  setNodes: (nodes: Node[]) => void
  setPanel: (panel: DashboardPanel) => void
  setCampaignPrefill: (prefill: CampaignPrefill | null) => void
  clearBusiness: () => void
}

export const useBusinessStore = create<BusinessState>()(
  immer((set) => ({
    business: null,
    nodes: [],
    currentPanel: 'live',
    campaignPrefill: null,
    setBusiness: (business) =>
      set((state) => {
        state.business = business
      }),
    setNodes: (nodes) =>
      set((state) => {
        state.nodes = nodes
      }),
    setPanel: (panel) =>
      set((state) => {
        state.currentPanel = panel
      }),
    setCampaignPrefill: (prefill) =>
      set((state) => {
        state.campaignPrefill = prefill
      }),
    clearBusiness: () =>
      set((state) => {
        state.business = null
        state.nodes = []
        state.currentPanel = 'live'
        state.campaignPrefill = null
      }),
  })),
)

export type { DashboardPanel }
