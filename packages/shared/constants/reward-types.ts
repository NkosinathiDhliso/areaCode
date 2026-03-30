import type { RewardType } from '../types'

export const REWARD_TYPES: readonly { value: RewardType; label: string; description: string }[] = [
  { value: 'nth_checkin', label: 'Nth Check-in', description: "User's Nth check-in at this node" },
  { value: 'daily_first', label: 'Daily First', description: 'First N check-ins of the day' },
  { value: 'streak', label: 'Streak', description: 'N consecutive days with at least 1 check-in' },
  { value: 'milestone', label: 'Milestone', description: 'Node reaches X check-ins today' },
] as const
