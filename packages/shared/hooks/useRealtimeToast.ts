import { useEffect, useRef } from 'react'

import { getSocket } from '../lib/socket'
import { haversineDistance } from '../lib/geoUtils'
import { useToastStore } from '../stores/toastStore'
import { useLocationStore } from '../stores/locationStore'
import type { Toast, ToastType } from '../types'

const TOAST_DISPLAY_MS = 4000
const MAX_DISTANCE_KM = 2

const PRIORITY_MAP: Record<ToastType, number> = {
  surge: 1,
  reward_pressure: 2,
  checkin: 3,
  reward_new: 3,
  streak: 4,
  leaderboard: 4,
}

export function useRealtimeToast(token?: string, userId?: string) {
  const addToast = useToastStore((s) => s.addToast)
  const removeToast = useToastStore((s) => s.removeToast)
  const position = useLocationStore((s) => s.lastKnownPosition)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const socket = getSocket(token)

    const handler = (payload: {
      type: ToastType
      message: string
      nodeId?: string
      nodeLat?: number
      nodeLng?: number
      avatarUrl?: string
    }) => {
      // Never show toast for user's own action (handled server-side, but double-check)
      // Client-side haversine filtering
      if (position && payload.nodeLat !== undefined && payload.nodeLng !== undefined) {
        const dist = haversineDistance(position.lat, position.lng, payload.nodeLat, payload.nodeLng)
        if (dist > MAX_DISTANCE_KM) return
      }

      const toast: Toast = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: payload.type,
        message: payload.message,
        priority: PRIORITY_MAP[payload.type] ?? 3,
        timestamp: Date.now(),
      }

      if (payload.nodeId !== undefined) toast.nodeId = payload.nodeId
      if (payload.nodeLat !== undefined) toast.nodeLat = payload.nodeLat
      if (payload.nodeLng !== undefined) toast.nodeLng = payload.nodeLng
      if (payload.avatarUrl !== undefined) toast.avatarUrl = payload.avatarUrl

      addToast(toast)

      // Auto-dismiss after display time
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        removeToast(toast.id)
      }, TOAST_DISPLAY_MS)
    }

    socket.on('toast:new', handler)
    return () => {
      socket.off('toast:new', handler)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [token, userId, position, addToast, removeToast])
}
