// Presence momentum — the honest "filling up / winding down" trend.
//
// Feature: presence-integrity (honest-presence rule 5)
//
// Momentum is a pure derivation over a short trailing series of authoritative
// Live_Presence_Count observations. Each observation is written whenever the
// count actually changes (check-in opens presence, check-out, expiry sweep), so
// a downward trend can ONLY appear because real departures (manual check-out or
// expiry) decremented the count — never a decayed or faked signal. That is the
// binding precondition for ever showing "winding down" (honest-presence.md §5).
//
// This module is framework-free and deterministic (the caller supplies `now`),
// so the trend rule is property-testable and has exactly one home. The
// repository is a thin adapter that persists the samples and calls
// `deriveMomentum` here.
import type { VenueMomentum } from '@area-code/shared/types'

/** A single observation of a venue's authoritative Live_Presence_Count. */
export interface PresenceSample {
  /** Epoch seconds (server time) the count was observed. */
  t: number
  /** The authoritative Live_Presence_Count at `t` (non-negative). */
  count: number
}

/**
 * Trailing window over which momentum is measured. Samples older than this are
 * pruned and never influence the trend, so a burst hours ago cannot keep a
 * venue reading "filling up" once activity stops.
 */
export const MOMENTUM_WINDOW_SECONDS = 20 * 60 // 1200

/**
 * Minimum time that must separate the baseline and the latest sample before any
 * trend is claimed. Below this the movement is treated as noise (`steady`), so
 * two check-ins seconds apart never flip the label.
 */
export const MOMENTUM_MIN_SPAN_SECONDS = 5 * 60 // 300

/**
 * Minimum absolute head-count change across the window to call a trend. A delta
 * strictly smaller than this reads as `steady` — under-claim, never over-claim
 * (honest-presence.md §4).
 */
export const MOMENTUM_MIN_DELTA = 2

/**
 * Keep only the observations inside the trailing window `[now - W, now]`, in
 * ascending time order. Pure: no wall-clock read. Used both when appending a new
 * sample (to bound the stored series) and when deriving the trend.
 */
export function pruneSamples(samples: readonly PresenceSample[], now: number): PresenceSample[] {
  const cutoff = now - MOMENTUM_WINDOW_SECONDS
  return samples
    .filter((s) => s.t >= cutoff && s.t <= now)
    .slice()
    .sort((a, b) => a.t - b.t)
}

/**
 * Derive the honest momentum from a series of Live_Presence_Count observations.
 *
 * Compares the earliest in-window observation (baseline) to the latest. Returns
 * `steady` unless there are at least two observations, spanning at least
 * `MOMENTUM_MIN_SPAN_SECONDS`, whose count changed by at least
 * `MOMENTUM_MIN_DELTA`. `filling_up` requires a real rise; `winding_down`
 * requires a real fall (only possible via check-out / expiry).
 */
export function deriveMomentum(samples: readonly PresenceSample[], now: number): VenueMomentum {
  const windowed = pruneSamples(samples, now)
  if (windowed.length < 2) return 'steady'

  const earliest = windowed[0]!
  const latest = windowed[windowed.length - 1]!

  if (latest.t - earliest.t < MOMENTUM_MIN_SPAN_SECONDS) return 'steady'

  const delta = latest.count - earliest.count
  if (delta >= MOMENTUM_MIN_DELTA) return 'filling_up'
  if (delta <= -MOMENTUM_MIN_DELTA) return 'winding_down'
  return 'steady'
}
