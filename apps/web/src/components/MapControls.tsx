import { useMapStore } from '@area-code/shared/stores/mapStore'
import { Box, Square, Compass, Crosshair, Activity, Plus, Minus } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { POSITION_FRESHNESS_WINDOW } from '../lib/carouselConstants'

/**
 * R1 debounce window shared by Compass_Button and Recenter_Button. A
 * double-tap inside this window collapses to a single intent so the map
 * does not whiplash between a bearing reset and a fly-to.
 */
const SIDEBAR_TAP_DEBOUNCE_MS = 250

/**
 * R1.5 - minimum idle-drift pause after a sidebar tap so the city does not
 * counter-rotate against the user's intent.
 */
const SIDEBAR_DRIFT_PAUSE_MS = 4000

interface MapControlsProps {
  is3D: boolean
  bearing: number
  onToggle3D: () => void
  onResetNorth: () => void
  onRecenter: () => void
  /** Zoom in one level (eased). Desktop-only affordance. */
  onZoomIn: () => void
  /** Zoom out one level (eased). Desktop-only affordance. */
  onZoomOut: () => void
  /**
   * Timestamp (Date.now() ms) of the most recent Last_Known_Position, or
   * `null` if the consumer has not yet granted permission / acquired a fix.
   * Used by Recenter_Button to derive freshness per R1.3 / R1.4.
   */
  lastKnownPositionFreshAt: number | null
  /**
   * Pause the idle bearing-drift loop for at least `ms` milliseconds (R1.5).
   * Wired through from `useMapInit`.
   */
  pauseIdleDrift?: (ms: number) => void
}

/**
 * Floating glass control cluster, anchored to the right edge of the map.
 *
 * - 3D / Flat toggle: switches pitch and bearing for the layered city view.
 * - Compass: spins with the map; tap to snap back to north.
 * - Recenter: flies to the user's last known position.
 * - "Live" pill: a small breathing badge that surfaces only when the
 *   network is awake (`totalPulse > 0`). The City_Pulse number itself
 *   has moved out of this cluster and onto the once-per-session toast
 *   surfaced by `useCityPulseToast` (R2 / R2.7) so the map stays the
 *   focus.
 */
export function MapControls({
  is3D,
  bearing,
  onToggle3D,
  onResetNorth,
  onRecenter,
  onZoomIn,
  onZoomOut,
  lastKnownPositionFreshAt,
  pauseIdleDrift,
}: MapControlsProps) {
  const { t } = useTranslation()
  const pulseScores = useMapStore((s) => s.pulseScores)
  const nodes = useMapStore((s) => s.nodes)

  // Shared debounce timestamp across Compass_Button and Recenter_Button so a
  // double-tap within 250ms is collapsed to a single intent (R1.7).
  const lastTapAtRef = useRef<number>(0)

  // R1.3 - freshness is derived at render time from the captured timestamp
  // so the affordance flips back to disabled the moment the fix ages out,
  // without requiring an extra timer to re-render the button.
  const hasFreshUserLocation =
    lastKnownPositionFreshAt !== null && Date.now() - lastKnownPositionFreshAt <= POSITION_FRESHNESS_WINDOW

  const handleResetNorth = useCallback(() => {
    const now = Date.now()
    if (now - lastTapAtRef.current < SIDEBAR_TAP_DEBOUNCE_MS) return
    lastTapAtRef.current = now
    pauseIdleDrift?.(SIDEBAR_DRIFT_PAUSE_MS)
    onResetNorth()
  }, [onResetNorth, pauseIdleDrift])

  const handleRecenter = useCallback(() => {
    const now = Date.now()
    if (now - lastTapAtRef.current < SIDEBAR_TAP_DEBOUNCE_MS) return
    lastTapAtRef.current = now
    pauseIdleDrift?.(SIDEBAR_DRIFT_PAUSE_MS)
    onRecenter()
  }, [onRecenter, pauseIdleDrift])

  // The City_Pulse total used to drive a permanent glass card here. R2 moved
  // it to a once-per-session toast (`useCityPulseToast`), so this component
  // only needs the boolean "is anything pulsing right now?" to gate the
  // small "LIVE" badge below.
  const totalPulse = useMemo(() => {
    let total = 0
    for (const id of Object.keys(nodes)) total += pulseScores[id] ?? 0
    return total
  }, [pulseScores, nodes])

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-end gap-2 pointer-events-none">
      {/* Control stack */}
      <div className="glass-raised rounded-2xl p-1 flex flex-col gap-1 pointer-events-auto">
        {/*
          3D toggle - a clear two-state pill. We render it as a wider
          button with both an icon and a "3D" / "2D" label so the active
          state is obvious. Earlier the active icon swap (Box↔Square)
          was easy to misread as broken once flattened.
        */}
        <button
          onClick={onToggle3D}
          aria-pressed={is3D}
          aria-label={is3D ? t('map.controls.flatten') : t('map.controls.lift')}
          title={is3D ? t('map.controls.flatten') : t('map.controls.lift')}
          className={`
            w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all
            ${
              is3D
                ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-glow)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]'
            }
          `}
        >
          {is3D ? <Box size={16} strokeWidth={1.75} /> : <Square size={16} strokeWidth={1.75} />}
          <span className="text-[9px] font-bold tracking-wider leading-none">{is3D ? '3D' : '2D'}</span>
        </button>

        <ControlButton onClick={handleResetNorth} label={t('map.controls.north')} testId="map-sidebar-compass">
          <span
            className="inline-flex"
            style={{
              transform: `rotate(${-bearing}deg)`,
              transition: 'transform 200ms ease-out',
            }}
          >
            <Compass size={18} strokeWidth={1.75} />
          </span>
        </ControlButton>

        <ControlButton
          onClick={handleRecenter}
          disabled={!hasFreshUserLocation}
          label={t('map.controls.recenter')}
          testId="map-sidebar-recenter"
        >
          <Crosshair size={18} strokeWidth={1.75} />
        </ControlButton>

        {/* Zoom controls: pointer-only affordance, hidden on mobile (R9.1) */}
        <div className="hidden md:flex flex-col gap-1">
          <ControlButton onClick={onZoomIn} label={t('map.controls.zoomIn')} testId="map-sidebar-zoom-in">
            <Plus size={18} strokeWidth={1.75} />
          </ControlButton>
          <ControlButton onClick={onZoomOut} label={t('map.controls.zoomOut')} testId="map-sidebar-zoom-out">
            <Minus size={18} strokeWidth={1.75} />
          </ControlButton>
        </div>
      </div>

      {/* Live signal indicator - mission cue: "this is real-time" */}
      {totalPulse > 0 && (
        <div
          className="glass rounded-full px-2.5 py-1 flex items-center gap-1.5 pointer-events-auto"
          aria-hidden="true"
        >
          <Activity size={11} strokeWidth={2} className="text-[var(--success)]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {t('map.controls.live')}
          </span>
        </div>
      )}
    </div>
  )
}

interface ControlButtonProps {
  onClick: () => void
  children: React.ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  testId?: string
}

function ControlButton({ onClick, children, label, active, disabled, testId }: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-disabled={disabled ? true : undefined}
      title={label}
      data-testid={testId}
      className={`
        w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95
        ${
          active
            ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-glow)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
    >
      {children}
    </button>
  )
}
