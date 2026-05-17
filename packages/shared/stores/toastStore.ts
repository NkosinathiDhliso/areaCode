import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Toast } from '../types'

// City_Pulse_Toast (live-vibe-on-map design § R2) slots between surge and
// reward_pressure: it is louder than reward pressure but must never preempt
// a true Pulse_State surge. Sort order: lower number = higher priority.
const TOAST_PRIORITY: Record<string, number> = {
  surge: 1,
  city_pulse: 2,
  reward_pressure: 3,
  checkin: 4,
  reward_new: 4,
  streak: 5,
  leaderboard: 5,
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
        state.queue.sort((a, b) => (TOAST_PRIORITY[a.type] ?? 5) - (TOAST_PRIORITY[b.type] ?? 5))
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
