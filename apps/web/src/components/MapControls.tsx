import { useMapStore } from '@area-code/shared/stores/mapStore'
import { Box, Square, Compass, Crosshair, Activity } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getNodeState } from '../lib/mapHelpers'

interface MapControlsProps {
  is3D: boolean
  bearing: number
  onToggle3D: () => void
  onResetNorth: () => void
  onRecenter: () => void
  hasUserLocation: boolean
}

/**
 * Floating glass control cluster, anchored to the right edge of the map.
 *
 * - 3D / Flat toggle: switches pitch and bearing for the layered city view.
 * - Compass: spins with the map; tap to snap back to north.
 * - Recenter: flies to the user's last known position.
 * - City Pulse readout: live sum of every node's pulse score in the
 *   current category filter. The mission is "your venue is alive — see it";
 *   this surfaces the network heartbeat in one number.
 */
export function MapControls({
  is3D,
  bearing,
  onToggle3D,
  onResetNorth,
  onRecenter,
  hasUserLocation,
}: MapControlsProps) {
  const { t } = useTranslation()
  const pulseScores = useMapStore((s) => s.pulseScores)
  const nodes = useMapStore((s) => s.nodes)

  const { totalPulse, hottestState } = useMemo(() => {
    let total = 0
    let hottest = 0
    for (const id of Object.keys(nodes)) {
      const score = pulseScores[id] ?? 0
      total += score
      if (score > hottest) hottest = score
    }
    return { totalPulse: total, hottestState: getNodeState(hottest) }
  }, [pulseScores, nodes])

  const pulseTone =
    hottestState === 'popping'
      ? 'var(--node-food)'
      : hottestState === 'buzzing'
        ? 'var(--warning)'
        : hottestState === 'active'
          ? 'var(--success)'
          : 'var(--accent-bright)'

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-end gap-2 pointer-events-none">
      {/* City Pulse readout */}
      <div
        className="glass-raised rounded-2xl px-3 py-2 flex items-center gap-2 pointer-events-auto"
        style={{ minWidth: '88px' }}
        aria-label={t('map.controls.cityPulse')}
        title={t('map.controls.cityPulseHint')}
      >
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{
            background: pulseTone,
            boxShadow: `0 0 8px ${pulseTone}, 0 0 16px ${pulseTone}`,
            animation: 'breathe 2s ease-in-out infinite',
          }}
        />
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            {t('map.controls.cityPulse')}
          </span>
          <span className="text-[var(--text-primary)] text-sm font-bold tabular-nums">
            {totalPulse > 999 ? '999+' : totalPulse}
          </span>
        </div>
      </div>

      {/* Control stack */}
      <div className="glass-raised rounded-2xl p-1 flex flex-col gap-1 pointer-events-auto">
        {/*
          3D toggle — a clear two-state pill. We render it as a wider
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

        <ControlButton onClick={onResetNorth} label={t('map.controls.north')}>
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

        <ControlButton onClick={onRecenter} disabled={!hasUserLocation} label={t('map.controls.recenter')}>
          <Crosshair size={18} strokeWidth={1.75} />
        </ControlButton>
      </div>

      {/* Live signal indicator — mission cue: "this is real-time" */}
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
}

function ControlButton({ onClick, children, label, active, disabled }: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`
        w-10 h-10 rounded-xl flex items-center justify-center transition-all
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
