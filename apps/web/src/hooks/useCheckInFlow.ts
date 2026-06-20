/**
 * Commit-mode check-in flow for the Map Discovery / Peek-Carousel experience.
 *
 * This hook is the single orchestrator behind the Commit_Mode check-in CTA. It
 * binds the pure CTA contract ({@link getCtaInfo}), the QR parser
 * ({@link parseVenueQr}), the shared {@link useCheckIn} request hook, the
 * geolocation state machine ({@link useGeolocation}), and the relevant stores
 * (consumer auth, connectivity, error, selection, map) into the handful of
 * handlers and flags that `MapScreen` (task 17.1) wires into the UI.
 *
 * What it drives:
 *   - the check-in CTA label/disabled state, derived from Geo_Status, the
 *     GPS-too-far QR fallback flag, and the in-flight pending flag (R14.1,
 *     R10.6, R10.7);
 *   - opening the existing email/password + Google OAuth `SignupSheet` when the
 *     consumer is unauthenticated — there is NO phone-number or SMS surface
 *     anywhere in this flow (R14.3, R20.1, and the no-SMS steering rule);
 *   - offering the in-app `QrScannerSheet` when GPS places the consumer too far
 *     to check in (R14.4);
 *   - routing a scanned QR through {@link parseVenueQr}: a valid Area Code venue
 *     QR runs the check-in for the scanned venue (R14.5); anything else surfaces
 *     an invalid-QR message via the error store and performs no check-in
 *     (R14.6);
 *   - failing safe when offline — a check-in attempted with no connectivity
 *     surfaces a failure and never reports a false success (R19.3);
 *   - preventing duplicate submissions while a request is in flight (R14.8).
 *
 * This feature is strictly client-side UI: it adds no backend service and no
 * always-on resource (serverless-only rule), and the only auth entry it can
 * open is the existing `SignupSheet`.
 *
 * Feature: map-discovery-experience
 * Validates: Requirements 14.2, 14.3, 14.4, 14.5, 14.6, 14.8, 19.3, 20.1
 */

import { useCheckIn, useGeolocation } from '@area-code/shared/hooks'
import { useConnectivityStore, useConsumerAuthStore, useMapStore, useSelectionStore } from '@area-code/shared/stores'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { CheckInRequest, Node } from '@area-code/shared/types'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getCtaInfo, type CtaInfo } from '../lib/checkInCta'
import { parseVenueQr } from '../lib/qrParser'

/** Parameters the hook cannot read from a shared store and must receive from the host screen. */
export interface UseCheckInFlowParams {
  /**
   * Called after a check-in request succeeds, with the id of the venue that was
   * checked into. The host screen owns the success side effects it alone can
   * perform: closing the sheet, haptic feedback, query invalidation, and
   * first-check-in notification priming (R14.7).
   */
  onCheckInSuccess?: (nodeId: string) => void
}

/** The state and handlers the host screen wires into the Commit_Mode CTA and sheets. */
export interface CheckInFlow {
  /** The deterministic CTA presentation for the current Geo_Status / fallback / pending state. */
  ctaInfo: CtaInfo
  /** Whether a check-in request is currently in flight. */
  isPending: boolean
  /** Whether the GPS-too-far QR fallback is being offered. */
  qrFallback: boolean
  /** Whether the `SignupSheet` should be open (unauthenticated check-in attempt). */
  signupOpen: boolean
  /** Whether the `QrScannerSheet` should be open. */
  qrScannerOpen: boolean
  /** Primary CTA handler. Routes to signup, QR scanner, or a check-in submission. */
  activateCheckIn: () => void
  /** Handler for a decoded QR string from `QrScannerSheet`. */
  onQrScanned: (raw: string) => void
  /** Close the `SignupSheet`. */
  closeSignup: () => void
  /** Close the `QrScannerSheet`. */
  closeQrScanner: () => void
}

/**
 * Resolves the current Active_Venue from the Selection_Model and the map store.
 * Returns `null` when nothing is selected or the selected id is not (yet) in the
 * store, so callers can safely no-op.
 */
function useActiveNode(): Node | null {
  const activeVenueId = useSelectionStore((s) => s.activeVenueId)
  const nodesById = useMapStore((s) => s.nodes)
  return activeVenueId ? (nodesById[activeVenueId] ?? null) : null
}

export function useCheckInFlow(params: UseCheckInFlowParams = {}): CheckInFlow {
  const { onCheckInSuccess } = params
  const { t } = useTranslation()

  const { checkIn, isPending, qrFallback, resetQrFallback } = useCheckIn()
  const { requestLocation, geoStatus } = useGeolocation()

  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const connectivity = useConnectivityStore((s) => s.state)
  const showError = useErrorStore((s) => s.showError)

  const activeNode = useActiveNode()

  const [signupOpen, setSignupOpen] = useState(false)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)

  /**
   * Local in-flight guard. `useCheckIn` already guards its own request with an
   * in-flight ref, but `activateCheckIn` performs an awaited `requestLocation`
   * *before* calling `checkIn`, so two rapid activations could both clear that
   * pre-step before either reaches the request. This ref closes that window so
   * exactly one submission is ever in flight (R14.8 / Property 22).
   */
  const submittingRef = useRef(false)

  // The CTA presentation is a pure function of the live Geo_Status, the QR
  // fallback flag, and the pending flag (R14.1, R10.6, R10.7).
  const ctaInfo = getCtaInfo({ geoStatus, qrFallback, pending: isPending })

  /**
   * Submit a check-in for the given payload, guarding against duplicate and
   * offline submissions. Returns whether a submission was actually performed.
   */
  const submitCheckIn = useCallback(
    async (payload: CheckInRequest): Promise<boolean> => {
      // Prevent duplicate submissions while a request is already in flight
      // (R14.8). The guard wraps the entire await chain, not just the request.
      if (submittingRef.current || isPending) return false

      // Fail safe when offline: surface a failure and never attempt a request
      // that could be misreported as success (R19.3 / Property 30).
      if (connectivity === 'offline') {
        showError(t('checkin.offline', 'You are offline. Reconnect to check in.'))
        return false
      }

      submittingRef.current = true
      try {
        const result = await checkIn(payload)
        if (result) {
          if (navigator.vibrate) navigator.vibrate(50)
          onCheckInSuccess?.(payload.nodeId)
          return true
        }
        return false
      } finally {
        submittingRef.current = false
      }
    },
    [isPending, connectivity, showError, t, checkIn, onCheckInSuccess],
  )

  /**
   * Primary CTA handler. Precedence:
   *   1. unauthenticated  → open the email/password + Google OAuth SignupSheet
   *      (R14.3, R20.1). No phone/SMS surface is ever opened.
   *   2. QR fallback      → open the in-app QR scanner (R14.4).
   *   3. otherwise        → acquire location and submit a check-in (R14.2).
   */
  const activateCheckIn = useCallback(() => {
    if (!activeNode) return

    if (!isAuthenticated) {
      setSignupOpen(true)
      return
    }

    if (qrFallback) {
      setQrScannerOpen(true)
      return
    }

    void (async () => {
      // Acquire a fresh fix before checking in. A poor-accuracy fix is still
      // allowed through so the server can decide (and, if too far, trigger the
      // QR fallback); any other absence of a position aborts the attempt.
      const pos = await requestLocation()
      if (!pos && geoStatus !== 'poorAccuracy') return

      await submitCheckIn({
        nodeId: activeNode.id,
        type: 'reward',
        ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
      })
    })()
  }, [activeNode, isAuthenticated, qrFallback, requestLocation, geoStatus, submitCheckIn])

  /**
   * Handler for a decoded QR payload from `QrScannerSheet`. A valid Area Code
   * venue QR (`…/qr/{nodeId}/{token}`) runs the check-in for the scanned venue
   * using its token to prove presence (R14.5). Anything else surfaces an
   * invalid-QR message and performs no check-in (R14.6).
   */
  const onQrScanned = useCallback(
    (raw: string) => {
      setQrScannerOpen(false)

      const parsed = parseVenueQr(raw)
      if (!parsed) {
        showError(t('qr.invalid', "That QR code isn't a valid Area Code venue code."))
        return
      }

      resetQrFallback()
      void submitCheckIn({
        nodeId: parsed.nodeId,
        type: 'reward',
        qrToken: parsed.token,
      })
    },
    [showError, t, resetQrFallback, submitCheckIn],
  )

  const closeSignup = useCallback(() => setSignupOpen(false), [])
  const closeQrScanner = useCallback(() => setQrScannerOpen(false), [])

  return {
    ctaInfo,
    isPending,
    qrFallback,
    signupOpen,
    qrScannerOpen,
    activateCheckIn,
    onQrScanned,
    closeSignup,
    closeQrScanner,
  }
}
