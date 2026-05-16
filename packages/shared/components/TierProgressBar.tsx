import type { Tier } from '../types'
import { TIER_LEVELS } from '../constants/tier-levels'
import type { TierLevel } from '../constants/tier-levels'
import { Box, Text } from './primitives'

interface TierProgressBarProps {
  currentTier: Tier
  currentCheckIns: number
  nextTier: Tier | null
  nextTierThreshold: number | null
  checkInsRemaining: number
}

export function TierProgressBar({
  currentTier,
  currentCheckIns,
  nextTier,
  nextTierThreshold,
  checkInsRemaining,
}: TierProgressBarProps) {
  const currentLevel = TIER_LEVELS.find((l: TierLevel) => l.tier === currentTier)
  const nextLevel = nextTier ? TIER_LEVELS.find((l: TierLevel) => l.tier === nextTier) : null

  // Calculate progress percentage within current tier range
  let progress = 100
  if (currentLevel && nextLevel) {
    const rangeStart = currentLevel.minCheckIns
    const rangeEnd = nextLevel.minCheckIns
    const range = rangeEnd - rangeStart
    progress = range > 0 ? Math.min(100, ((currentCheckIns - rangeStart) / range) * 100) : 100
  }

  return (
    <Box className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <Box className="flex items-center justify-between mb-3">
        <Text className="text-[var(--text-primary)] text-sm font-semibold capitalize">
          {currentLevel?.label ?? currentTier}
        </Text>
        {nextLevel && <Text className="text-[var(--text-muted)] text-xs">→ {nextLevel.label}</Text>}
      </Box>

      <Box className="w-full h-2 bg-[var(--bg-raised)] rounded-full overflow-hidden mb-2">
        <Box
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            backgroundColor: currentLevel?.colour ?? 'var(--accent)',
          }}
        />
      </Box>

      <Box className="flex items-center justify-between">
        <Text className="text-[var(--text-muted)] text-xs">{currentCheckIns} check-ins</Text>
        {nextTierThreshold !== null && checkInsRemaining > 0 ? (
          <Text className="text-[var(--text-secondary)] text-xs font-medium">
            {checkInsRemaining} more to {nextLevel?.label}
          </Text>
        ) : (
          <Text className="text-[var(--text-secondary)] text-xs font-medium">Max tier reached</Text>
        )}
      </Box>
    </Box>
  )
}
