import { useEffect, useRef, useCallback } from 'react'

import { api } from '../lib/api'
import { useMapStore, type DeltaNode } from '../stores/mapStore'

interface DeltaResponse {
  nodes: DeltaNode[]
  serverTime: string
}

/**
 * Polls the delta endpoint every 10 seconds to retrieve node state changes.
 * Replaces WebSocket subscriptions for consumer apps.
 *
 * - Tracks `serverTime` from the last response as the next `since` value
 * - Stops polling when `enabled` is false (map not visible)
 * - Resumes polling when `enabled` becomes true again
 * - Updates the shared map store with delta node data
 */
export function useDeltaPoll(
  citySlug: string,
  token: string | undefined,
  options?: {
    intervalMs?: number
    enabled?: boolean
  },
): void {
  const intervalMs = options?.intervalMs ?? 10_000
  const enabled = options?.enabled ?? true

  const applyDelta = useMapStore((s) => s.applyDelta)
  const sinceRef = useRef<string>(new Date().toISOString())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!citySlug || !token) return

    try {
      const since = encodeURIComponent(sinceRef.current)
      const response = await api.get<DeltaResponse>(
        `/v1/pulse/city/${encodeURIComponent(citySlug)}/delta?since=${since}`,
      )

      if (response.serverTime) {
        sinceRef.current = response.serverTime
      }

      if (response.nodes && response.nodes.length > 0) {
        applyDelta(response.nodes)
      }
    } catch {
      // Silently ignore poll failures — next poll will retry.
      // Network errors are surfaced by the API client's error toast for 5xx.
    }
  }, [citySlug, token, applyDelta])

  useEffect(() => {
    if (!enabled || !citySlug || !token) {
      // Clear any existing interval when disabled or missing auth
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Initial poll immediately on mount/enable
    void poll()

    // Set up recurring poll at the configured interval
    intervalRef.current = setInterval(() => {
      void poll()
    }, intervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, citySlug, token, intervalMs, poll])
}
