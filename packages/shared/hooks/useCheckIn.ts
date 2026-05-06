import { useCallback, useRef, useState } from 'react'

import { api, type ApiError } from '../lib/api'
import type { CheckInRequest, CheckInResponse } from '../types'
import { analytics } from '../analytics/client'

export function useCheckIn() {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrFallback, setQrFallback] = useState(false)
  const [tooFar, setTooFar] = useState(false)
  // nodeId -> ISO cooldownUntil — persists across sheet open/close within session
  const [cooldowns, setCooldowns] = useState<Record<string, string>>({})
  const lastPayloadRef = useRef<CheckInRequest | null>(null)

  const checkIn = useCallback(async (payload: CheckInRequest): Promise<CheckInResponse | null> => {
    lastPayloadRef.current = payload

    analytics.track('checkin_started', {
      nodeId: payload.nodeId,
      method: 'qrCode' in payload && payload.qrCode ? 'qr' : 'gps',
    })

    setIsPending(true)
    setError(null)
    setQrFallback(false)
    setTooFar(false)
    try {
      const res = await api.post<CheckInResponse>('/v1/check-in', payload)
      if (res.cooldownUntil) {
        setCooldowns((prev) => ({ ...prev, [payload.nodeId]: res.cooldownUntil }))
      }

      analytics.track('checkin_completed', {
        nodeId: payload.nodeId,
        type: payload.type,
        success: true,
      })

      return res
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.statusCode === 422 && apiError.error === 'accuracy_insufficient') {
        setQrFallback(true)
        setError('accuracy_insufficient')
      } else if (apiError.statusCode === 429) {
        // Server told us we're in cooldown; store it so the UI reflects it
        const until = (apiError as ApiError & { cooldownUntil?: string }).cooldownUntil
        if (until) {
          setCooldowns((prev) => ({ ...prev, [payload.nodeId]: until }))
        }
        setTooFar(false)
      } else if ((apiError.message ?? '').toLowerCase().includes('too far')) {
        setTooFar(true)
      } else {
        const message = apiError.message ?? 'Check-in failed'
        setError(message)
      }

      analytics.track('checkin_completed', {
        nodeId: payload.nodeId,
        type: payload.type,
        success: false,
      })

      return null
    } finally {
      setIsPending(false)
    }
  }, [])

  const retry = useCallback(async (): Promise<CheckInResponse | null> => {
    if (!lastPayloadRef.current) return null
    return checkIn(lastPayloadRef.current)
  }, [checkIn])

  const resetQrFallback = useCallback(() => {
    setQrFallback(false)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setTooFar(false)
  }, [])

  const getCooldown = useCallback(
    (nodeId: string): string | null => {
      const until = cooldowns[nodeId]
      if (!until) return null
      return new Date(until).getTime() > Date.now() ? until : null
    },
    [cooldowns],
  )

  return { checkIn, retry, isPending, error, qrFallback, tooFar, cooldowns, getCooldown, resetQrFallback, clearError }
}
