import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface NotificationItem {
  notifId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  isRead: boolean
  createdAt: string
}

interface NotificationState {
  items: NotificationItem[]
  unreadCount: number
  nextCursor: string | null
  /** Replace the list (initial load) */
  setItems: (items: NotificationItem[], nextCursor: string | null) => void
  /** Append a page (infinite scroll) */
  appendItems: (items: NotificationItem[], nextCursor: string | null) => void
  /** Prepend a freshly-arrived notification (from a live socket event) */
  prepend: (item: NotificationItem) => void
  /** Mark everything read locally (after the mark-read call) */
  markAllRead: () => void
  recomputeUnread: () => void
}

function countUnread(items: NotificationItem[]): number {
  return items.reduce((n, i) => (i.isRead ? n : n + 1), 0)
}

export const useNotificationStore = create<NotificationState>()(
  immer((set) => ({
    items: [],
    unreadCount: 0,
    nextCursor: null,
    setItems: (items, nextCursor) =>
      set((state) => {
        state.items = items
        state.nextCursor = nextCursor
        state.unreadCount = countUnread(items)
      }),
    appendItems: (items, nextCursor) =>
      set((state) => {
        const seen = new Set(state.items.map((i) => i.notifId))
        for (const item of items) {
          if (!seen.has(item.notifId)) state.items.push(item)
        }
        state.nextCursor = nextCursor
        state.unreadCount = countUnread(state.items)
      }),
    prepend: (item) =>
      set((state) => {
        if (state.items.some((i) => i.notifId === item.notifId)) return
        state.items.unshift(item)
        state.unreadCount = countUnread(state.items)
      }),
    markAllRead: () =>
      set((state) => {
        for (const i of state.items) i.isRead = true
        state.unreadCount = 0
      }),
    recomputeUnread: () =>
      set((state) => {
        state.unreadCount = countUnread(state.items)
      }),
  })),
)
