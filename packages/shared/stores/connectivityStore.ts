import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

type ConnectivityState = 'online' | 'offline'

interface ConnectivityStoreState {
  state: ConnectivityState
  lastUpdated: string | null
  setOnline: () => void
  setOffline: () => void
}

export const useConnectivityStore = create<ConnectivityStoreState>()(
  immer((set) => ({
    state: 'online',
    lastUpdated: null,
    setOnline: () =>
      set((s) => {
        s.state = 'online'
        s.lastUpdated = new Date().toISOString()
      }),
    setOffline: () =>
      set((s) => {
        s.state = 'offline'
        s.lastUpdated = new Date().toISOString()
      }),
  })),
)

export type { ConnectivityState }
