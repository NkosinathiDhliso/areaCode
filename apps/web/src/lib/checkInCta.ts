/**
 * Pure check-in CTA contract for the Peek_Carousel Commit_Mode.
 *
 * `getCtaInfo` is a deterministic, total function: for any combination of
 * Geo_Status, QR-fallback flag, and pending flag it returns a fixed
 * `{ label, disabled }` pair. It never throws and has no dependency on i18n,
 * the DOM, or any store - the label is a stable translation *key* that the
 * rendering layer resolves through `t()`. Keeping the decision pure is what
 * makes the CTA contract property-testable (design Property 15).
 *
 * Precedence (highest first):
 *   1. pending      → a check-in request is in flight
 *   2. qrFallback   → GPS placed the user too far; offer the QR scanner
 *   3. geoStatus    → the geolocation state machine value
 *
 * CTA contract:
 *   - pending        → checking / disabled
 *   - QR fallback    → scan / enabled
 *   - requesting     → locating / disabled
 *   - denied         → (default label) / disabled
 *   - poorAccuracy   → weak-signal / enabled
 *   - timeout        → unavailable / enabled
 *   - acquired/idle  → ready (default label) / enabled
 *
 * Validates: Requirements 10.6, 10.7, 14.1
 */

import type { GeoStatus } from '@area-code/shared/stores/locationStore'

/**
 * Stable CTA label keys. These are i18n translation keys, not user-facing
 * copy, so the function stays deterministic and free of locale state. The
 * rendering layer passes the returned `label` through `t()`.
 */
export const CTA_LABEL = {
  /** A check-in request is in progress. */
  checking: 'checkin.checking',
  /** GPS-too-far fallback: tap to open the in-app QR scanner. */
  scanQr: 'checkin.scanQr',
  /** Geolocation is being acquired. */
  locating: 'checkin.locating',
  /** Location signal is weak but a check-in may still be attempted. */
  weakSignal: 'checkin.weakSignal',
  /** Geolocation timed out / is unavailable. */
  locationUnavailable: 'checkin.locationUnavailable',
  /** Default ready/denied label ("Check In"). */
  button: 'checkin.button',
} as const

export type CtaLabel = (typeof CTA_LABEL)[keyof typeof CTA_LABEL]

/** Inputs to the CTA contract. */
export interface CtaInput {
  /** The current geolocation state machine value. */
  geoStatus: GeoStatus
  /** Whether the GPS-too-far QR fallback is being offered. */
  qrFallback: boolean
  /** Whether a check-in request is currently in flight. */
  pending: boolean
}

/** The deterministic CTA presentation. */
export interface CtaInfo {
  label: CtaLabel
  disabled: boolean
}

/**
 * Derives the check-in CTA's label key and disabled state from the current
 * Geo_Status, QR-fallback flag, and pending flag.
 *
 * The precedence order matters: a pending request always wins, then the QR
 * fallback, then the Geo_Status. The same input always yields the same
 * output.
 *
 * Validates: Requirements 10.6, 10.7, 14.1
 */
export function getCtaInfo({ geoStatus, qrFallback, pending }: CtaInput): CtaInfo {
  // 1. Pending takes precedence over everything: a request is already running.
  if (pending) {
    return { label: CTA_LABEL.checking, disabled: true }
  }

  // 2. QR fallback: GPS placed the user too far; tapping opens the scanner.
  if (qrFallback) {
    return { label: CTA_LABEL.scanQr, disabled: false }
  }

  // 3. Geo_Status drives the remaining cases.
  switch (geoStatus) {
    case 'requesting':
      return { label: CTA_LABEL.locating, disabled: true }
    case 'denied':
      return { label: CTA_LABEL.button, disabled: true }
    case 'poorAccuracy':
      return { label: CTA_LABEL.weakSignal, disabled: false }
    case 'timeout':
      return { label: CTA_LABEL.locationUnavailable, disabled: false }
    case 'acquired':
    case 'idle':
    default:
      // Ready: a position is available (or the machine is idle and the user
      // may still attempt a check-in). Default label, enabled.
      return { label: CTA_LABEL.button, disabled: false }
  }
}
