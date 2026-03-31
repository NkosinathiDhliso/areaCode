import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Toast } from '../types'

const TOAST_PRIORITY: Record<string, number> = {
  surge: 1,
  reward_pressure: 2,
  checkin: 3,
  reward_new: 3,
  streak: 4,
  leaderboard: 4,
}

interface ToastStore {
  queue: Toast[]
  isBottomSheetOpen: boolean
  addToast: (toast: Toast) => void
  removeToast: (id: string) => void
  setBottomSheetOpen: (open: boolean) => void
}

export const useToastStore = create<ToastStore>()(
  immer((set) => ({
    queue: [],
    isBottomSheetOpen: false,
    addToast: (toast) =>
      set((state) => {
        state.queue.push(toast)
        // Sort by priority (lower = higher priority)
        state.queue.sort(
          (a, b) =>
            (TOAST_PRIORITY[a.type] ?? 5) - (TOAST_PRIORITY[b.type] ?? 5),
        )
        // Drop oldest lowest-priority if queue > 3
        while (state.queue.length > 3) {
          state.queue.pop()
        }
      }),
    removeToast: (id) =>
      set((state) => {
        state.queue = state.queue.filter((t) => t.id !== id)
      }),
    setBottomSheetOpen: (open) =>
      set((state) => {
        state.isBottomSheetOpen = open
      }),
  })),
)
