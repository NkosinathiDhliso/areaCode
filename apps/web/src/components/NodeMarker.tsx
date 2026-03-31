import { NODE_CATEGORIES } from '@area-code/shared/constants/node-categories'
import type { NodeCategory, NodeState } from '@area-code/shared/types'

interface NodeMarkerProps {
  category: NodeCategory
  pulseScore: number
  state: NodeState
  onClick: () => void
}

const STATE_CONFIG: Record<NodeState, { base: number; breathe: string; speed: string }> = {
  dormant: { base: 8, breathe: 'breathe', speed: '4s' },
  quiet: { base: 10, breathe: 'breathe', speed: '3s' },
  active: { base: 14, breathe: 'pulse', speed: '1.5s' },
  buzzing: { base: 20, breathe: 'pulse', speed: '0.8s' },
  popping: { base: 28, breathe: 'pulse', speed: '0.4s' },
}

function getCategoryColour(category: NodeCategory): string {
  const cat = NODE_CATEGORIES.find((c) => c.value === category)
  return cat?.colour ?? 'var(--node-default)'
}

export function NodeMarker({ category, pulseScore, state, onClick }: NodeMarkerProps) {
  const config = STATE_CONFIG[state]
  const size = Math.min(config.base + pulseScore * 0.4, config.base * 2.5)
  const colour = getCategoryColour(category)
  const showBadge = state === 'buzzing' || state === 'popping'

  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center"
      style={{ width: size * 2.5, height: size * 2.5 }}
      aria-label={`${category} venue, ${state}`}
    >
      {/* Blur halo */}
      <div
        className="absolute rounded-full opacity-30"
        style={{
          width: size * 2,
          height: size * 2,
          background: colour,
          filter: 'blur(8px)',
          animation: `${config.breathe} ${config.speed} ease-in-out infinite`,
        }}
      />
      {/* Outer ring */}
      <div
        className="absolute rounded-full border-2"
        style={{
          width: size * 1.6,
          height: size * 1.6,
          borderColor: colour,
          opacity: 0.6,
        }}
      />
      {/* Core dot */}
      <div
        className="rounded-full"
        style={{
          width: size,
          height: size,
          background: colour,
          animation: `${config.breathe} ${config.speed} ease-in-out infinite`,
        }}
      />
      {/* Live count badge */}
      {showBadge && (
        <div className="absolute -top-1 -right-1 bg-[var(--bg-raised)] border border-[var(--border)] rounded-full px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] font-medium">
          {pulseScore}
        </div>
      )}
    </button>
  )
}
