import { useCallback, useEffect, useState } from 'react'

import { api } from '../lib/api'
import { useNotificationStore, type NotificationItem } from '../stores/notificationStore'

interface NotificationHistoryResponse {
  notifications: NotificationItem[]
  nextCursor?: string | null
}

/**
 * Loads the consumer's notification history (the notification center) and
 * exposes pagination + mark-all-read. Live arrivals are pushed into the same
 * store by `useNotificationSocket`, so the badge and list stay current without
 * a refetch.
 */
export function useNotifications() {
  const items = useNotificationStore((s) => s.items)
  const nextCursor = useNotificationStore((s) => s.nextCursor)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const setItems = useNotificationStore((s) => s.setItems)
  const appendItems = useNotificationStore((s) => s.appendItems)
  const markAllReadLocal = useNotificationStore((s) => s.markAllRead)

  const [isPending, setIsPending] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setIsPending(true)
    setError(false)
    try {
      const res = await api.get<NotificationHistoryResponse>('/v1/users/me/notifications?limit=20')
      setItems(res.notifications ?? [], res.nextCursor ?? null)
    } catch {
      setError(true)
    } finally {
      setIsPending(false)
    }
  }, [setItems])

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await api.get<NotificationHistoryResponse>(
        `/v1/users/me/notifications?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
      )
      appendItems(res.notifications ?? [], res.nextCursor ?? null)
    } catch {
      // Soft-fail: keep what we have.
    } finally {
      setIsLoadingMore(false)
    }
  }, [nextCursor, isLoadingMore, appendItems])

  const markAllRead = useCallback(async () => {
    // Optimistic: clear the badge immediately, then persist.
    markAllReadLocal()
    try {
      await api.post('/v1/users/me/notifications/mark-read')
    } catch {
      // If it fails the next load will restore true state.
    }
  }, [markAllReadLocal])

  useEffect(() => {
    void load()
  }, [load])

  return {
    items,
    unreadCount,
    isPending,
    isLoadingMore,
    hasMore: !!nextCursor,
    error,
    refetch: load,
    loadMore,
    markAllRead,
  }
}
