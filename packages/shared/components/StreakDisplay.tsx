import { Box, Text } from './primitives'

interface StreakDisplayProps {
  streakCount: number
  streakStartDate: string | null
  atRisk: boolean
}

export function StreakDisplay({ streakCount, streakStartDate, atRisk }: StreakDisplayProps) {
  function formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <Box className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <Box className="flex items-center gap-3 mb-2">
        <Text className="text-2xl" aria-hidden="true">
          {streakCount > 0 ? (atRisk ? '⚠️' : '🔥') : '💤'}
        </Text>
        <Box>
          <Text className="text-[var(--text-primary)] text-sm font-semibold">
            {streakCount} day streak
          </Text>
          {streakStartDate && (
            <Text className="text-[var(--text-muted)] text-xs">
              Since {formatDate(streakStartDate)}
            </Text>
          )}
        </Box>
      </Box>

      {atRisk && streakCount > 0 && (
        <Box className="bg-[var(--danger)] bg-opacity-10 rounded-xl px-3 py-2 mt-1">
          <Text className="text-[var(--danger)] text-xs font-medium">
            ⚠️ Your streak is at risk! Check in today to keep it going.
          </Text>
        </Box>
      )}

      {streakCount === 0 && (
        <Text className="text-[var(--text-muted)] text-xs">
          Check in at a venue to start a streak. Keep checking in daily to grow it!
        </Text>
      )}
    </Box>
  )
}
