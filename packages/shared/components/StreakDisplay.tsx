import { Flame, Moon } from 'lucide-react'

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
        <Box className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--bg-raised)]" aria-hidden="true">
          {streakCount > 0 ? (
            <Flame size={18} className="text-[var(--danger)]" />
          ) : (
            <Moon size={18} className="text-[var(--text-muted)]" />
          )}
        </Box>
        <Box>
          <Text className="text-[var(--text-primary)] text-sm font-semibold">{streakCount} day streak</Text>
          {streakStartDate && (
            <Text className="text-[var(--text-muted)] text-xs">Since {formatDate(streakStartDate)}</Text>
          )}
        </Box>
      </Box>

      {atRisk && streakCount > 0 && (
        <Box className="bg-[var(--warning)] bg-opacity-10 rounded-xl px-3 py-2 mt-1 flex items-center gap-2">
          <Flame size={14} className="text-[var(--warning)] shrink-0" />
          <Text className="text-[var(--warning)] text-xs font-medium">
            Check in today to keep your {streakCount} day streak going.
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
