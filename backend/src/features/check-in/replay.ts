// Pure logic core for offline check-in replay (cross-portal-lifecycle-alignment
// R5). Kept free of I/O so the Replay_Window and honest-presence invariants can
// be property-tested directly (Property 3).

// Max age of a queued (replayed) check-in the backend will accept: 15 minutes
// from `capturedAt` (R5.3).
export const REPLAY_WINDOW_MS = 15 * 60 * 1000

// True when a queued check-in captured at `capturedAtIso` is still acceptable at
// `nowMs`: it must be no older than the Replay_Window. A malformed timestamp
// never parses and is rejected. A future `capturedAt` (clock skew) has a negative
// age and is accepted — the honest-presence guarantee below keeps it truthful.
export function isWithinReplayWindow(capturedAtIso: string, nowMs: number): boolean {
  const capturedMs = Date.parse(capturedAtIso)
  if (!Number.isFinite(capturedMs)) return false
  return nowMs - capturedMs <= REPLAY_WINDOW_MS
}

// Honest-presence seam (R5.3, Property 3): a replayed check-in's presence window
// starts at DELIVERY time, never at `capturedAt`. This deliberately ignores
// `capturedAt` and returns `nowMs`. Changing it to backdate presence to
// `capturedAt` would violate honest-presence and is caught by the Property 3 test.
export function replayPresenceStartMs(nowMs: number, _capturedAtIso?: string | null): number {
  return nowMs
}
