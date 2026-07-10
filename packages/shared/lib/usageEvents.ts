/**
 * Consumer usage beacon (audit-gap-closure R4). One home for consented,
 * PII-free product-usage instrumentation on the client.
 *
 * `trackEvent(name, props?)` buffers events in memory and flushes them in
 * batches to `POST /v1/events` via the shared api client, at most every 15s or
 * once 20 events accumulate. It is gated hard on consent: nothing is buffered
 * and nothing is sent unless the current signed-in user has `analyticsOptIn`
 * true. Anonymous sessions and opted-out users emit nothing (R4.2).
 *
 * Privacy posture (R4.3, POPIA): the only identifier ever sent is a per-session
 * random id held in memory only, never persisted and never a real userId. Props
 * are a small closed typed set with no free-text, no coordinates, and no
 * user-plus-venue join that could reconstruct a movement trail. The typed props
 * shape is what prevents callers from passing arbitrary location/user fields.
 *
 * Failures never degrade the app (R4.7): a failed flush is swallowed and the
 * batch is dropped. We do not retry or let the buffer grow without bound.
 */
import type { CitySlug } from '../constants/sa-cities'
import { isUsageEventName, type UsageEventName } from '../constants/usage-events'

import { api } from './api'

export { USAGE_EVENT_NAMES, isUsageEventName, type UsageEventName } from '../constants/usage-events'

/**
 * Coarse, non-identifying properties an event may carry. Deliberately a closed
 * interface, never an open record: callers cannot attach location, coordinates,
 * a userId, or free-text. Extend this type (add a coarse enum field) rather than
 * forking a second props shape if a wire point needs more context.
 */
export interface UsageEventProps {
  /** City-level context only. Never a coordinate or a precise location. */
  city?: CitySlug
  /** Sign-in / sign-up method, for the signup funnel. */
  method?: 'email' | 'google'
}

/** The wire shape of a single buffered event. */
interface UsageEvent {
  name: UsageEventName
  /** Per-session random id, memory-only, never a real userId (R4.3). */
  sessionId: string
  /** Coarse client timestamp (epoch ms). */
  ts: number
  props?: UsageEventProps
}

// Flush triggers (design.md R4): at most every 15s, or once 20 events buffer.
const FLUSH_INTERVAL_MS = 15_000
const FLUSH_BATCH_SIZE = 20

// ─── Module state (memory only) ──────────────────────────────────────────────

// Fail closed: emit nothing until the app tells us the user opted in (R4.2).
let analyticsOptIn = false

// Per-session random id, created lazily on first use, held only in memory.
let sessionId: string | null = null

let buffer: UsageEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function getSessionId(): string {
  if (sessionId === null) {
    sessionId = crypto.randomUUID()
  }
  return sessionId
}

/**
 * Set the current consent state. Call this from the app once the consent read
 * (GET /v1/users/me/consent) resolves, and whenever it changes. Turning the gate
 * off clears any buffered events so an opted-out user sends nothing.
 */
export function setAnalyticsOptIn(optedIn: boolean): void {
  analyticsOptIn = optedIn
  if (!optedIn) {
    buffer = []
    clearFlushTimer()
  }
}

/** Current gate state. Exposed for wire points that want to avoid extra work. */
export function isAnalyticsOptedIn(): boolean {
  return analyticsOptIn
}

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    void flushEvents()
  }, FLUSH_INTERVAL_MS)
}

/**
 * Buffer a usage event. No-ops unless the user is opted in and the name is on
 * the allowlist. Flushes immediately once the buffer reaches the batch size,
 * otherwise ensures a timer is running to flush within the interval.
 */
export function trackEvent(name: UsageEventName, props?: UsageEventProps): void {
  // Hard opt-in gate (R4.2): opted-out or anonymous sessions buffer nothing.
  if (!analyticsOptIn) return
  // Defence in depth against an off-allowlist name reaching the beacon (R4.5
  // is enforced server-side too). Drop silently rather than buffer garbage.
  if (!isUsageEventName(name)) return

  buffer.push({ name, sessionId: getSessionId(), ts: Date.now(), props })

  if (buffer.length >= FLUSH_BATCH_SIZE) {
    void flushEvents()
  } else {
    scheduleFlush()
  }
}

/**
 * Send the buffered events as one batch. Drains the buffer first so new events
 * accumulate for the next flush. All failures are swallowed and the drained
 * batch is dropped (R4.7): instrumentation never throws to the caller and the
 * buffer never grows without bound from repeated failures.
 */
export async function flushEvents(): Promise<void> {
  clearFlushTimer()
  if (!analyticsOptIn || buffer.length === 0) return

  const events = buffer
  buffer = []
  try {
    await api.post('/v1/events', { events })
  } catch {
    // Endpoint down or request failed: drop the batch. Do not re-buffer (that
    // would grow unbounded) and do not surface the error (R4.7).
  }
}

/**
 * Reset all beacon state. Test-only helper so suites start from a clean gate,
 * empty buffer, and no pending timer.
 */
export function resetUsageBeaconForTest(): void {
  analyticsOptIn = false
  sessionId = null
  buffer = []
  clearFlushTimer()
}
