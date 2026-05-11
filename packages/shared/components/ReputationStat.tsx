import { Star, Trophy } from 'lucide-react'
import { Box, Text } from './primitives'

export interface ReputationStatProps {
  reputation: number
  citySlug?: string
  onLeaderboardPress?: () => void
}

/**
 * Displays the user's Reputation stat on their profile.
 *
 * Reputation is a separate metric from check-in count and tier —
 * it does NOT contribute to tier progression. It reflects signal
 * contributions (genre/queue reports) to the community.
 *
 * Includes a link to the city leaderboard when citySlug or
 * onLeaderboardPress is provided.
 */
export function ReputationStat({ reputation, citySlug, onLeaderboardPress }: ReputationStatProps) {
  const showLeaderboard = Boolean(citySlug || onLeaderboardPress)

  return (
    <Box className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <Box className="flex items-center gap-3">
        <Box
          className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--bg-raised)]"
          aria-hidden="true"
        >
          <Star size={18} className="text-[var(--accent)]" />
        </Box>
        <Box className="flex-1">
          <Text
            className="text-[var(--text-primary)] font-bold text-xl font-[Syne] block"
            style={{ letterSpacing: '-0.03em' }}
          >
            {reputation}
          </Text>
          <Text className="text-[var(--text-muted)] text-xs block">Reputation</Text>
        </Box>
        {showLeaderboard && (
          <button
            onClick={onLeaderboardPress}
            className="flex items-center gap-1.5 text-[var(--accent)] text-xs font-medium transition-all active:scale-95"
            aria-label="View city leaderboard"
          >
            <Trophy size={14} aria-hidden="true" />
            <span>Leaderboard</span>
          </button>
        )}
      </Box>
    </Box>
  )
}
