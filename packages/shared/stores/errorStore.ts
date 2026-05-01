import { create } from 'zustand'

interface ErrorState {
  error: string | null
  showError: (msg: string) => void
  clearError: () => void
}

export const useErrorStore = create<ErrorState>()((set) => ({
  error: null,
  showError: (msg) => set({ error: msg }),
  clearError: () => set({ error: null }),
}))
