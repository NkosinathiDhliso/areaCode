// Expiry_Window helper for Presence Integrity.
//
// A Presence_Record with no check-out expires a bounded duration after its most
// recent check-in. That duration is longer during the SAST evening peak (when
// people genuinely dwell longer) and shorter off-peak, mirroring the existing
// pulse-decay peak definition so the two aliveness signals stay coherent.
//
// The peak-hour boundary is NOT redefined here: `expiryWindowSeconds` reuses the
// exact SAST 18:00–23:59 (UTC+2) boundary from the pulse-decay worker via the
// shared, exported `isPeakHour`, keeping a single source of truth.
import { isPeakHour } from '../../workers/pulse-decay.js'

/**
 * Founder-flagged candidate Expiry_Window durations (Requirement 13.1), kept here
 * as the single source of truth so a change is a one-line edit. Both are measured
 * in whole seconds from the most recent check-in.
 */
export const OFF_PEAK_WINDOW_SECONDS = 90 * 60 // 5400  (00:00–17:59 SAST)
export const PEAK_WINDOW_SECONDS = 180 * 60 // 10800 (18:00–23:59 SAST)

/**
 * Returns the Expiry_Window (in whole seconds) that applies at the given moment.
 *
 * Returns the peak window if and only if the SAST (UTC+2) hour is in 18:00–23:59
 * — the exact boundary used by the pulse-decay worker — and the off-peak window
 * otherwise. (Requirements 5.4, 13.1)
 *
 * @param nowEpoch - the current time as epoch seconds (server time), matching the
 *   `checkedInAt` / `expiresAt` epoch-seconds convention on the Presence_Record.
 */
export function expiryWindowSeconds(nowEpoch: number): number {
  return isPeakHour(new Date(nowEpoch * 1000)) ? PEAK_WINDOW_SECONDS : OFF_PEAK_WINDOW_SECONDS
}
