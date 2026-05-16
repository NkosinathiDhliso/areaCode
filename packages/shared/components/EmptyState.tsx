import { Search, List, Users, Gift, BarChart3, Flag, Shield, Inbox, Clock, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Box, Text } from './primitives'

interface EmptyStateProps {
  icon?: 'search' | 'list' | 'people' | 'reward' | 'chart' | 'flag' | 'shield' | 'inbox' | 'history' | 'staff'
  message: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

const ICONS: Record<string, LucideIcon> = {
  search: Search,
  list: List,
  people: Users,
  reward: Gift,
  chart: BarChart3,
  flag: Flag,
  shield: Shield,
  inbox: Inbox,
  history: Clock,
  staff: UserRound,
}

export function EmptyState({ icon = 'inbox', message, actionLabel, onAction, className = '' }: EmptyStateProps) {
  const IconComponent = ICONS[icon] ?? Inbox

  return (
    <Box className={`flex flex-col items-center justify-center py-12 gap-3 ${className}`}>
      <IconComponent size={32} strokeWidth={1.5} className="text-[var(--text-muted)] opacity-40" aria-hidden="true" />
      <Text className="text-[var(--text-muted)] text-sm text-center max-w-xs">{message}</Text>
      {actionLabel && onAction && (
        <button onClick={onAction} className="text-[var(--accent)] text-sm font-medium mt-1">
          {actionLabel}
        </button>
      )}
    </Box>
  )
}
