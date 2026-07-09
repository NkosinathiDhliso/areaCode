/**
 * Check-in outbox — pure logic core (cross-portal-lifecycle-alignment R5).
 *
 * A failed GPS check-in (network error or 5xx) is durable: it is queued in
 * localStorage and replayed oldest-first with bounded exponential backoff until
 * it lands, is rejected for good (4xx), or ages out of the Replay_Window. This
 * module is pure — no React, no I/O beyond the injected storage adapter — so the
 * enqueue/retry/park/discard state machine can be property-tested (Property 2).
 *
 * Honest-presence: the backend starts presence at delivery time and rejects a
 * replay older than 15 minutes; the client discards those before any network
 * call, so a stale visit is never resurrected.
 */

// 15 minutes from capturedAt (R5.3). Matches the backend Replay_Window.
export const REPLAY_WINDOW_MS = 15 * 60 * 1000

// At most 3 automatic retries, then the entry parks as failed (R5.2).
export const MAX_RETRIES = 3

// Backoff before retry #1, #2, #3: 30s, 2m, 8m (R5.2).
export const RETRY_SCHEDULE_MS: readonly number[] = [30_000, 120_000, 480_000]

export type CheckinType = 'reward' | 'presence'

export interface OutboxEntry {
  id: string
  nodeId: string
  type: CheckinType
  // The instant the user actually tried to check in; the Replay_Window is
  // measured from here and the backend refuses anything older.
  capturedAt: string
  lat: number
  lng: number
  // Number of automatic retries ATTEMPTED so far (0..MAX_RETRIES).
  retryCount: number
  // Earliest instant the next automatic attempt may run.
  nextAttemptAt: string
  // Set once the entry has exhausted its retries and is awaiting a manual
  // retry/discard in the profile. A parked entry never retries automatically.
  parkedAt?: string
}

export interface CheckinAttempt {
  nodeId: string
  type: CheckinType
  lat: number
  lng: number
}

// Storage adapter (injected). The localStorage-backed implementation lives with
// the pump hook; tests pass an in-memory double so the core is driven
// synchronously with no browser globals.
export interface OutboxStorage {
  read(): OutboxEntry[]
  write(entries: OutboxEntry[]): void
}

// Only transient failures are queued: a network error / timeout surfaces as
// statusCode 0 from the shared API client, and 5xx is a server fault. 4xx
// (proximity, rate limit, validation) is the user's answer and surfaces
// immediately — never queued (R5.1).
export function shouldEnqueue(statusCode: number): boolean {
  return statusCode === 0 || statusCode >= 500
}

// Backoff before the next attempt given how many retries have already run, or
// null when the retry budget is spent (the entry should park).
export function retryDelayMs(retryCount: number): number | null {
  return retryCount < RETRY_SCHEDULE_MS.length ? RETRY_SCHEDULE_MS[retryCount]! : null
}

// True once the entry is older than the Replay_Window (or its timestamp is
// unparseable). Such an entry must be discarded, never sent (R5.4).
export function isExpired(entry: OutboxEntry, nowMs: number): boolean {
  const captured = Date.parse(entry.capturedAt)
  if (!Number.isFinite(captured)) return true
  return nowMs - captured > REPLAY_WINDOW_MS
}

export function isParked(entry: OutboxEntry): boolean {
  return entry.parkedAt !== undefined
}

// An entry is due for an automatic attempt when it is queued (not parked), still
// inside the Replay_Window, and past its backoff. An expired entry is never due,
// so the Replay_Window guard holds before any network call (Property 2).
export function isDue(entry: OutboxEntry, nowMs: number): boolean {
  return !isParked(entry) && !isExpired(entry, nowMs) && Date.parse(entry.nextAttemptAt) <= nowMs
}

// Build a queued entry from a failed live check-in. The first retry waits
// RETRY_SCHEDULE_MS[0] from now.
export function createEntry(attempt: CheckinAttempt, capturedAt: string, nowMs: number, id: string): OutboxEntry {
  return {
    id,
    nodeId: attempt.nodeId,
    type: attempt.type,
    capturedAt,
    lat: attempt.lat,
    lng: attempt.lng,
    retryCount: 0,
    nextAttemptAt: new Date(nowMs + (retryDelayMs(0) ?? 0)).toISOString(),
  }
}

export type AttemptResult = { kind: 'success' } | { kind: 'transient' } | { kind: 'permanent' }

// Apply a network attempt's result to a queued entry. Returns the next entry, or
// null when the entry should be REMOVED — success, or a permanent 4xx (R5.5). A
// transient failure increments retryCount and reschedules, or parks once the
// retry budget is spent (retryCount never exceeds MAX_RETRIES).
export function applyResult(entry: OutboxEntry, result: AttemptResult, nowMs: number): OutboxEntry | null {
  // A parked entry is terminal for automatic processing — the pump never
  // attempts it, and only reEnqueue revives it. Guard so retryCount can never
  // exceed MAX_RETRIES under any call sequence.
  if (isParked(entry)) return entry
  if (result.kind === 'success' || result.kind === 'permanent') return null
  const retryCount = entry.retryCount + 1
  const delay = retryDelayMs(retryCount)
  if (delay === null) {
    return { ...entry, retryCount, parkedAt: new Date(nowMs).toISOString() }
  }
  return { ...entry, retryCount, nextAttemptAt: new Date(nowMs + delay).toISOString() }
}

// Re-enqueue a parked entry from the profile retry action, subject to the
// Replay_Window. Returns null when it has already aged out (the caller discards
// it with a toast, R5.6); otherwise resets the retry budget and schedules an
// immediate attempt.
export function reEnqueue(entry: OutboxEntry, nowMs: number): OutboxEntry | null {
  if (isExpired(entry, nowMs)) return null
  const next: OutboxEntry = {
    id: entry.id,
    nodeId: entry.nodeId,
    type: entry.type,
    capturedAt: entry.capturedAt,
    lat: entry.lat,
    lng: entry.lng,
    retryCount: 0,
    nextAttemptAt: new Date(nowMs).toISOString(),
  }
  return next
}

// Split entries into the expired ones to discard (queued, aged out) and the rest
// to keep. Parked entries are kept even when expired: they are user-managed in
// the profile and only leave via a manual retry (which re-checks the window) or
// discard.
export function partitionExpired(
  entries: OutboxEntry[],
  nowMs: number,
): { expired: OutboxEntry[]; kept: OutboxEntry[] } {
  const expired: OutboxEntry[] = []
  const kept: OutboxEntry[] = []
  for (const e of entries) {
    if (!isParked(e) && isExpired(e, nowMs)) expired.push(e)
    else kept.push(e)
  }
  return { expired, kept }
}

// The single oldest-by-capturedAt entry that is due for an automatic attempt, or
// undefined when nothing is due. The pump processes one entry per tick.
export function selectNextDue(entries: OutboxEntry[], nowMs: number): OutboxEntry | undefined {
  return entries.filter((e) => isDue(e, nowMs)).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))[0]
}

// Lifecycle classification used by the invariant tests: every entry (or its
// absence) is in exactly one of these states.
export type OutboxState = 'queued' | 'parked' | 'gone'

export function classify(entry: OutboxEntry | null): OutboxState {
  if (entry === null) return 'gone'
  return isParked(entry) ? 'parked' : 'queued'
}
