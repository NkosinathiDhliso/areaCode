import { useEffect, useMemo, useRef } from 'react'

import { useMapStore } from '../stores/mapStore'
import { useToastStore } from '../stores/toastStore'
import type { NodeState, Toast } from '../types'

/**
 * Mirror of the Pulse_State threshold table in
 * `apps/web/src/lib/mapHelpers.ts`. Kept inline so this shared hook does
 * not have to depend on app-side code; the values are spec-stable per R8
 * Pulse_State and are intentionally duplicated rather than introducing a
 * new shared module just for this constant.
 */
const STATE_THRESHOLDS: ReadonlyArray<{ min: number; state: NodeState }> = [
  { min: 61, state: 'popping' },
  { min: 31, state: 'buzzing' },
  { min: 11, state: 'active' },
  { min: 1, state: 'quiet' },
  { min: 0, state: 'dormant' },
]

function deriveNodeState(score: number): NodeState {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}

const TOAST_ID = 'city-pulse'
const GRACE_MS = 2000
const AUTO_DISMISS_MS = 6000
// R2.6 — lower bound of the 'buzzing' Pulse_State; the city has to be
// materially livelier than the moment the user dismissed the toast before
// it re-surfaces.
const RESURFACE_THRESHOLD = 60
// R2.2 — display value clamp matches the legacy City_Pulse glass card.
const TOTAL_PULSE_DISPLAY_MAX = 9999

interface UseCityPulseToastOptions {
  /**
   * `true` once the map's tiles are loaded and the canvas is interactive.
   * The 2000ms grace window in R2.1 starts from this transition.
   */
  mapReady: boolean
}

/**
 * Surfaces the City_Pulse readout as a once-per-session dismissible toast on
 * the map tab (live-vibe-on-map § R2). Replaces the legacy permanent glass
 * card behind the `live_vibe_on_map` flag.
 *
 * Behaviour:
 * - First paint after `mapReady === true`: 2000ms grace, then enqueue once
 *   if `totalPulse > 0` and node data is available (R2.1, R2.9, R2.10).
 * - Auto-dismiss after 6000ms (R2.4); manual swipe / tap-to-close handled
 *   by `ToastOverlay` against the same `id`.
 * - Re-surface exactly once when `totalPulse` crosses from below 60 to
 *   ≥ 60 and the toast is no longer visible (R2.6).
 * - Suppressed entirely on `totalPulse === 0` (R2.9) and on retrieval
 *   failure / empty node set (R2.10) without consuming the once-per-session
 *   slot.
 * - `prefers-reduced-motion` is honoured downstream by `LiveToast`; this
 *   hook does not animate.
 *
 * The hook is a no-op render — it only mutates the toast queue. Callers
 * mount it from the map screen so it is gated to the map tab (R2.5).
 */
export function useCityPulseToast({ mapReady }: UseCityPulseToastOptions): void {
  const pulseScores = useMapStore((s) => s.pulseScores)
  const nodes = useMapStore((s) => s.nodes)
  const isCityPulseInQueue = useToastStore((s) => s.queue.some((t) => t.id === TOAST_ID))
  const addToast = useToastStore((s) => s.addToast)
  const removeToast = useToastStore((s) => s.removeToast)

  // Compute total + hottest state in lockstep with MapControls so the toast
  // shows the same number and tone as the legacy card.
  const { totalPulse, hottestState, hasNodeData } = useMemo(() => {
    const ids = Object.keys(nodes)
    if (ids.length === 0) {
      return { totalPulse: 0, hottestState: 'dormant' as NodeState, hasNodeData: false }
    }
    let total = 0
    let hottest = 0
    for (const id of ids) {
      const score = pulseScores[id] ?? 0
      total += score
      if (score > hottest) hottest = score
    }
    return { totalPulse: total, hottestState: deriveNodeState(hottest), hasNodeData: true }
  }, [pulseScores, nodes])

  // Once-per-session bookkeeping. Refs persist across re-renders without
  // re-firing effects.
  const hasShownInitiallyRef = useRef(false)
  const hasResurfaceFiredRef = useRef(false)
  const lastTotalPulseRef = useRef(0)
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // First paint after mapReady — 2000ms grace then evaluate exactly once.
  useEffect(() => {
    if (!mapReady) return
    if (hasShownInitiallyRef.current) return
    if (graceTimerRef.current) return // grace already pending

    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null
      // Re-read latest store values at firing time. The closure captured
      // when the timer was scheduled can be stale because store mutations
      // don't re-fire this effect, and we want to enqueue using whatever
      // is on screen 2000ms after `mapReady` flipped.
      const { nodes: liveNodes, pulseScores: liveScores } = useMapStore.getState()
      const ids = Object.keys(liveNodes)
      if (ids.length === 0) return // R2.10 — retrieval failure / no data, no slot consumed
      let total = 0
      let hottest = 0
      for (const id of ids) {
        const score = liveScores[id] ?? 0
        total += score
        if (score > hottest) hottest = score
      }
      if (total === 0) return // R2.9 — suppress without consuming the slot
      hasShownInitiallyRef.current = true
      lastTotalPulseRef.current = total
      enqueueCityPulseToast({
        totalPulse: total,
        hottestState: deriveNodeState(hottest),
        addToast,
      })
      autoDismissTimerRef.current = setTimeout(() => {
        autoDismissTimerRef.current = null
        removeToast(TOAST_ID)
      }, AUTO_DISMISS_MS)
    }, GRACE_MS)

    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current)
        graceTimerRef.current = null
      }
    }
  }, [mapReady, addToast, removeToast])

  // R2.6 — re-surface exactly once when totalPulse crosses from < 60 → ≥ 60
  // after the initial toast has been shown and is no longer in the queue
  // (i.e. the user dismissed it or the auto-dismiss fired).
  useEffect(() => {
    const previous = lastTotalPulseRef.current
    lastTotalPulseRef.current = totalPulse

    if (!hasShownInitiallyRef.current) return
    if (hasResurfaceFiredRef.current) return
    if (isCityPulseInQueue) return // still visible to the user, don't double-up
    if (!hasNodeData) return
    if (previous >= RESURFACE_THRESHOLD) return
    if (totalPulse < RESURFACE_THRESHOLD) return

    hasResurfaceFiredRef.current = true
    enqueueCityPulseToast({ totalPulse, hottestState, addToast })
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current)
    autoDismissTimerRef.current = setTimeout(() => {
      autoDismissTimerRef.current = null
      removeToast(TOAST_ID)
    }, AUTO_DISMISS_MS)
  }, [totalPulse, hottestState, hasNodeData, isCityPulseInQueue, addToast, removeToast])

  // Cleanup outstanding timers on unmount so a route change away from the
  // map tab doesn't leave a stranded auto-dismiss timer.
  useEffect(
    () => () => {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current)
      if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current)
    },
    [],
  )
}

function enqueueCityPulseToast({
  totalPulse,
  hottestState,
  addToast,
}: {
  totalPulse: number
  hottestState: NodeState
  addToast: (toast: Toast) => void
}): void {
  const display = totalPulse > TOTAL_PULSE_DISPLAY_MAX ? TOTAL_PULSE_DISPLAY_MAX : totalPulse
  const toast: Toast = {
    id: TOAST_ID,
    type: 'city_pulse',
    message: `City pulse ${display} — ${hottestState}`,
    priority: 2,
    timestamp: Date.now(),
  }
  addToast(toast)
}
