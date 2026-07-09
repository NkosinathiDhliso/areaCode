import { api, type ApiError } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useEffect } from 'react'

import { shouldEnqueue, type AttemptResult, type OutboxEntry } from '../lib/checkinOutbox'
import { useCheckinOutboxStore } from '../stores/checkinOutboxStore'

// How often the pump wakes to drain the queue. The retry backoff (30s+) is the
// real cadence; this interval only needs to be frequent enough to notice a due
// entry promptly and cheap enough to run while idle.
const PUMP_INTERVAL_MS = 20_000

// Submit one queued check-in as a replay. Success and 4xx (including
// checkin_replay_expired) remove the entry; transient failures (network/5xx)
// keep it queued for the next tick.
async function submit(entry: OutboxEntry): Promise<AttemptResult> {
  try {
    await api.post('/v1/check-in', {
      nodeId: entry.nodeId,
      type: entry.type,
      lat: entry.lat,
      lng: entry.lng,
      capturedAt: entry.capturedAt,
    })
    return { kind: 'success' }
  } catch (err) {
    const status = (err as ApiError).statusCode ?? 0
    return shouldEnqueue(status) ? { kind: 'transient' } : { kind: 'permanent' }
  }
}

/**
 * Pumps the check-in outbox (cross-portal-lifecycle-alignment R5). Drains queued
 * failed check-ins on an interval and whenever connectivity returns, discarding
 * any that have aged out of the Replay_Window (with an honest toast). Mount once
 * near the app root; it cleans up its interval and listener on unmount.
 *
 * `enabled` gates the pump on authentication: a replay POST needs the consumer
 * session, and pumping while signed out would 401 (a 4xx) and drop the queue.
 */
export function useCheckinOutbox(enabled = true): void {
  const pump = useCheckinOutboxStore((s) => s.pump)
  const showError = useErrorStore((s) => s.showError)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const run = async () => {
      const { discarded } = await pump(submit)
      if (!cancelled && discarded > 0) {
        showError(
          discarded === 1
            ? 'A check-in was too old to record and has been discarded.'
            : `${discarded} check-ins were too old to record and have been discarded.`,
        )
      }
    }

    const interval = setInterval(() => void run(), PUMP_INTERVAL_MS)
    const onOnline = () => void run()
    window.addEventListener('online', onOnline)
    // Drain once on mount so a queue left from a previous session moves promptly.
    void run()

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', onOnline)
    }
  }, [enabled, pump, showError])
}
