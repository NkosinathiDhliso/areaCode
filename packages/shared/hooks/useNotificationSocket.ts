import { useEffect } from 'react'

import { getSocket } from '../lib/socket'
import { useNotificationStore } from '../stores/notificationStore'
import { useToastStore } from '../stores/toastStore'
import type { Toast } from '../types'

/**
 * Subscribes to user-targeted notification events:
 * - `notification:new` → prepends to the notification center + raises a toast
 * - `tier:changed`     → congratulatory toast + a notification-center entry
 *
 * Previously the backend emitted both of these but no client listened, so an
 * active user got a silent tier upgrade and never saw delivered notifications
 * unless they happened to have no socket (push fallback). This closes that gap.
 */
export function useNotificationSocket(token?: string) {
  const prepend = useNotificationStore((s) => s.prepend)
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    if (!token) return

    const socket = getSocket(token)

    const onNotification = (payload: {
      type: string
      title: string
      body: string
      data?: Record<string, unknown>
      createdAt: string
    }) => {
      prepend({
        notifId: `live-${payload.type}-${Date.parse(payload.createdAt) || Date.now()}`,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        isRead: false,
        createdAt: payload.createdAt ?? new Date().toISOString(),
      })
      const toast: Toast = {
        id: `notif-${Date.now()}`,
        type: 'streak',
        message: payload.title,
        priority: 5,
        timestamp: Date.now(),
      }
      addToast(toast)
    }

    const onTierChanged = (payload: { oldTier: string; newTier: string; benefits?: string[] }) => {
      const createdAt = new Date().toISOString()
      prepend({
        notifId: `tier-${payload.newTier}-${Date.now()}`,
        type: 'tier_change',
        title: 'Tier upgrade!',
        body: `You've reached ${payload.newTier} tier.`,
        data: { oldTier: payload.oldTier, newTier: payload.newTier, benefits: payload.benefits ?? [] },
        isRead: false,
        createdAt,
      })
      const toast: Toast = {
        id: `tier-${Date.now()}`,
        type: 'streak',
        message: `You've reached ${payload.newTier} tier!`,
        priority: 5,
        timestamp: Date.now(),
      }
      addToast(toast)
    }

    socket.on('notification:new', onNotification)
    socket.on('tier:changed', onTierChanged)

    return () => {
      socket.off('notification:new', onNotification)
      socket.off('tier:changed', onTierChanged)
    }
  }, [token, prepend, addToast])
}
