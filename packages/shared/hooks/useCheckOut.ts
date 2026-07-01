import { useCallback, useRef, useState } from 'react'

import { api, type ApiError } from '../lib/api'
import { useErrorStore } from '../stores/errorStore'
import { usePresenceStore } from '../stores/presenceStore'
import type { CheckOutResponse } from '../types'

/**
 * Map a server error response to a short, user-friendly check-out message.
 * Mirrors the `useCheckIn` friendlyMessage shape (statusCode-keyed) with
 * check-out wording. Falls back to the server's own message, which is already
 * human-readable for cases we haven't explicitly covered.
 */
function friendlyMessage(err: ApiError): string {
  // Rate limit (burst or cooldown): show remaining time if we have it.
  if (err.statusCode === 429) {
    const cooldownUntil = (err as ApiError & { cooldownUntil?: string }).cooldownUntil
    if (cooldownUntil) {
      const remainingMs = new Date(cooldownUntil).getTime() - Date.now()
      if (remainingMs > 0) {
        const mins = Math.ceil(remainingMs / 60_000)
        if (mins >= 60) {
          const hours = Math.ceil(mins / 60)
          return `Too many requests. Try again in about ${hours}h.`
        }
        return `Too many requests. Try again in ${mins}m.`
      }
    }
    return err.message ?? 'Easy there - too many requests. Try again in a moment.'
  }

  if (err.statusCode === 401) return 'Please sign in to check out.'
  if (err.statusCode === 403) return 'Check-out is disabled for this account.'

  return err.message ?? 'Check-out failed. Please try again.'
}

export function useCheckOut() {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  const checkOut = useCallback(async (nodeId: string): Promise<CheckOutResponse | null> => {
    // Guard against double-submit when a button click fires twice before the
    // first request resolves. This also prevents the client from contributing
    // to its own rate-limit breach.
    if (inFlightRef.current) return null
    inFlightRef.current = true

    setIsPending(true)
    setError(null)
    try {
      const res = await api.post<CheckOutResponse>('/v1/check-out', { nodeId })
      // Both `checked_out` and `no_active_presence` are successes: clear the
      // local active-presence flag so the check-out CTA stops showing. A stray
      // check-out against a presence the backend no longer holds is a safe
      // no-op, so we clear regardless of which success shape came back.
      usePresenceStore.getState().clearPresent(nodeId)
      return res
    } catch (err) {
      const message = friendlyMessage(err as ApiError)
      setError(message)
      // Surface the message via the global toast so the user actually sees it.
      useErrorStore.getState().showError(message)
      return null
    } finally {
      inFlightRef.current = false
      setIsPending(false)
    }
  }, [])

  return { checkOut, isPending, error }
}
