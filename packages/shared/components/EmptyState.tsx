import { Box, Text } from './primitives'

interface EmptyStateProps {
  icon?: 'search' | 'list' | 'people' | 'reward' | 'chart' | 'flag' | 'shield' | 'inbox' | 'history' | 'staff'
  message: string
  className?: string
}

const ICONS: Record<string, string> = {
  search: '🔍',
  list: '📋',
  people: '👥',
  reward: '🎁',
  chart: '📊',
  flag: '🚩',
  shield: '🛡️',
  inbox: '📭',
  history: '🕐',
  staff: '👤',
}

export function EmptyState({ icon = 'inbox', message, className = '' }: EmptyStateProps) {
  return (
    <Box className={`flex flex-col items-center justify-center py-12 gap-3 ${className}`}>
      <Text className="text-3xl opacity-40" aria-hidden="true">
        {ICONS[icon] ?? ICONS.inbox}
      </Text>
      <Text className="text-[var(--text-muted)] text-sm text-center max-w-xs">
        {message}
      </Text>
    </Box>
  )
}
