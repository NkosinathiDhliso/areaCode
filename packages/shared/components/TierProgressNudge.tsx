import { TIER_LEVELS } from '../constants/tier-levels'
import { getTier } from '../constants/tier-levels'
import type { TierLevel } from '../constants/tier-levels'

interface TierProgressNudgeProps {
  /** The consumer's check-in count for the current leaderboard period (or total) */
  checkInCount: number
}

/**
 * Compact tier progression nudge shown on the consumer's rank card.
 * Displays "X more to [NextTier]" or a celebratory label at Legend.
 */
export function TierProgressNudge({ checkInCount }: TierProgressNudgeProps) {
  const currentTier = getTier(checkInCount)
  const currentIndex = TIER_LEVELS.findIndex((l: TierLevel) => l.tier === currentTier)
  const nextLevel: TierLevel | undefined = TIER_LEVELS[currentIndex + 1]

  // At Legend (highest tier) — celebratory label
  if (!nextLevel) {
    return <span className="text-[var(--tier-legend)] text-xs font-medium">Legend | top of the city</span>
  }

  const remaining = Math.max(0, nextLevel.minCheckIns - checkInCount)

  return (
    <span className="text-[var(--text-secondary)] text-xs font-medium">
      {remaining} more to {nextLevel.label}
    </span>
  )
}
