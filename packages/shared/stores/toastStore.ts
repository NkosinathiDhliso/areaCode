import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Toast } from '../types'
import { TOAST_PRIORITY, admitToQueue, shouldEnqueueCheckInToast } from '../lib/toastAdmission'

// `TOAST_PRIORITY` is defined in the pure `toastAdmission` core (single source
// of truth for the Toast_System) and re-exported here so existing importers of
// `@area-code/shared/stores/toastStore` keep working.
export { TOAST_PRIORITY }

/**
 * Window (ms) within which a second Check_In_Toast for the same venue is
 * suppressed. Matches the ToastOverlay auto-dismiss interval so a burst of
 * check-ins at one venue yields at most one toast per interval (Requirement 16.6).
 */
export const CHECK_IN_TOAST_DEDUP_INTERVAL = 5000

interface ToastStore {
  queue: Toast[]
  isBottomSheetOpen: boolean
  /** venue id → timestamp (ms) of its last admitted Check_In_Toast, for dedup. */
  checkInToastSeenAt: Record<string, number>
  addToast: (toast: Toast) => void
  removeToast: (id: string) => void
  setBottomSheetOpen: (open: boolean) => void
}

export const useToastStore = create<ToastStore>()(
  immer((set) => ({
    queue: [],
    isBottomSheetOpen: false,
    checkInToastSeenAt: {},
    addToast: (toast) =>
      set((state) => {
        // Per-venue Check_In_Toast dedup within the auto-dismiss interval
        // (Requirement 16.6). Only check-in toasts tied to a specific venue are
        // deduped; ambient/non-venue toasts are always admitted.
        if (toast.type === 'checkin' && toast.nodeId) {
          const now = Number.isFinite(toast.timestamp) ? toast.timestamp : Date.now()
          if (!shouldEnqueueCheckInToast(toast.nodeId, state.checkInToastSeenAt, now, CHECK_IN_TOAST_DEDUP_INTERVAL)) {
            return
          }
          state.checkInToastSeenAt[toast.nodeId] = now
        }

        // Delegate priority ordering + cap to the pure admission core
        // (Requirements 16.1, 16.5) - single source of truth shared with the
        // web property tests.
        state.queue = admitToQueue(state.queue, toast)
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
