import type { NotificationPreferences } from '../types'

/**
 * Single source of truth for the consumer notification preference toggles.
 *
 * The shape lives in `NotificationPreferences` (packages/shared/types). This
 * file owns the ordered key list and the default values so the frontend
 * settings screen, the backend preference read, and the send-time preference
 * check all agree. Do not redefine these anywhere else (see
 * dry-reuse-no-duplication and no-fallbacks-no-legacy).
 */

/**
 * Keys in the order they should render in the settings UI. Reward-claim push
 * (opt-out) leads because it is the one that defaults on.
 */
export const NOTIFICATION_PREFERENCE_KEYS = [
  'rewardClaimedPush',
  'rewardActivated',
  'streakAtRisk',
  'leaderboardPrewarning',
  'followedUserCheckin',
] as const

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number]

/**
 * Default value for every preference when the user has no persisted record.
 * Only `rewardClaimedPush` defaults on: the code a consumer earns is the one
 * transactional push they expect. Everything else is opt-in.
 */
export const NOTIFICATION_PREFERENCE_DEFAULTS: NotificationPreferences = {
  streakAtRisk: false,
  rewardActivated: false,
  rewardClaimedPush: true,
  leaderboardPrewarning: false,
  followedUserCheckin: false,
}
