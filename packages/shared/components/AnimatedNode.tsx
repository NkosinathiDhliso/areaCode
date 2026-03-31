import type { AnimatedNodeProps } from '../types/map'
import { Box, Text } from './primitives'

const STATE_ANIMATION: Record<string, string> = {
  dormant: 'animate-[breathe_4s_ease-in-out_infinite]',
  quiet: 'animate-[breathe_3s_ease-in-out_infinite]',
  active: 'animate-[pulse_1.5s_ease-in-out_infinite]',
  buzzing: 'animate-[pulse_0.8s_ease-in-out_infinite]',
  popping: 'animate-[pulse_0.4s_ease-in-out_infinite]',
}

/**
 * AnimatedNode — renders a node marker with state-driven animation.
 * Web uses CSS keyframes. Mobile would use Reanimated.
 */
export function AnimatedNode({
  size,
  color,
  state,
  checkInCount,
  onTap,
  onLongPress,
}: AnimatedNodeProps) {
  const animation = STATE_ANIMATION[state] ?? ''
  const showBadge = state === 'buzzing' || state === 'popping'

  return (
    <Box
      className={`relative inline-flex items-center justify-center ${animation}`}
      style={{ width: size, height: size }}
      onClick={onTap}
      onContextMenu={(e) => {
        e.preventDefault()
        onLongPress?.()
      }}
      role="button"
      tabIndex={0}
      aria-label={`Node marker, ${state}`}
    >
      {/* Core dot */}
      <Box
        className="rounded-full"
        style={{ width: size * 0.6, height: size * 0.6, backgroundColor: color }}
      />

      {/* Live count badge */}
      {showBadge && checkInCount > 0 && (
        <Box className="absolute -top-1 -right-1 w-[18px] h-[18px] bg-[var(--bg-raised)] border border-[var(--border)] rounded-full flex items-center justify-center">
          <Text className="text-[var(--text-primary)] text-[10px] font-medium">
            {checkInCount > 99 ? '99+' : checkInCount}
          </Text>
        </Box>
      )}
    </Box>
  )
}
