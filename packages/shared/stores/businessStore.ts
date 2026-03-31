import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { BusinessAccount, Node } from '../types'

type DashboardPanel = 'live' | 'rewards' | 'audience' | 'node' | 'boost' | 'settings'

interface BusinessState {
  business: BusinessAccount | null
  nodes: Node[]
  currentPanel: DashboardPanel
  setBusiness: (business: BusinessAccount) => void
  setNodes: (nodes: Node[]) => void
  setPanel: (panel: DashboardPanel) => void
  clearBusiness: () => void
}

export const useBusinessStore = create<BusinessState>()(
  immer((set) => ({
    business: null,
    nodes: [],
    currentPanel: 'live',
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
    clearBusiness: () =>
      set((state) => {
        state.business = null
        state.nodes = []
        state.currentPanel = 'live'
      }),
  })),
)

export type { DashboardPanel }
