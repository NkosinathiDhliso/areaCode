import { useCallback, useRef, useState } from 'react'

import { api, type ApiError } from '../lib/api'
import { useErrorStore } from '../stores/errorStore'
import type { CheckInRequest, CheckInResponse } from '../types'

/**
 * Map a server error response to a short, user-friendly message.
 * Falls back to the server's own message, which is already human-readable
 * for cases we haven't explicitly covered.
 */
function friendlyMessage(err: ApiError): string {
  // Rate limit (burst or cooldown): show remaining time if we have it
  if (err.statusCode === 429) {
    const cooldownUntil = (err as ApiError & { cooldownUntil?: string }).cooldownUntil
    if (cooldownUntil) {
      const remainingMs = new Date(cooldownUntil).getTime() - Date.now()
      if (remainingMs > 0) {
        const mins = Math.ceil(remainingMs / 60_000)
        if (mins >= 60) {
          const hours = Math.ceil(mins / 60)
          return `You can check in here again in about ${hours}h.`
        }
        return `You can check in here again in ${mins}m.`
      }
    }
    return err.message ?? 'Easy there — too many check-ins. Try again in a moment.'
  }

  if (err.statusCode === 401) return 'Please sign in to check in.'
  if (err.statusCode === 403) return 'Check-ins are disabled for this account.'
  if (err.statusCode === 404) return 'This venue is no longer listed.'
  // 422 accuracy_insufficient is handled by the caller (QR fallback UI),
  // so we don't surface it as a toast.

  return err.message ?? 'Check-in failed. Please try again.'
}

export function useCheckIn() {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrFallback, setQrFallback] = useState(false)
  const lastPayloadRef = useRef<CheckInRequest | null>(null)
  const inFlightRef = useRef(false)

  const checkIn = useCallback(async (payload: CheckInRequest): Promise<CheckInResponse | null> => {
    // Guard against double-submit when a button click fires twice before the
    // first request resolves. This also prevents the client from contributing
    // to its own rate-limit breach.
    if (inFlightRef.current) return null
    inFlightRef.current = true

    lastPayloadRef.current = payload
    setIsPending(true)
    setError(null)
    setQrFallback(false)
    try {
      const res = await api.post<CheckInResponse>('/v1/check-in', payload)
      return res
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.statusCode === 422 && apiError.error === 'accuracy_insufficient') {
        setQrFallback(true)
        setError('accuracy_insufficient')
      } else {
        const message = friendlyMessage(apiError)
        setError(message)
        // Surface the message via the global toast so the user actually sees it.
        useErrorStore.getState().showError(message)
      }
      return null
    } finally {
      inFlightRef.current = false
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

  return { checkIn, retry, isPending, error, qrFallback, resetQrFallback }
}
