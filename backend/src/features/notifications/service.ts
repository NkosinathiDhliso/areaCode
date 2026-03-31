import { redis } from '../../shared/redis/client.js'
import { rewardNotificationsToday } from '../../shared/redis/keys.js'
import * as repo from './repository.js'
import { getIO } from '../../shared/socket/server.js'
import { userRoom } from '../../shared/socket/rooms.js'

const DEFAULTS = {
  streakAtRisk: false,
  rewardActivated: false,
  rewardClaimedPush: true,
  leaderboardPrewarning: false,
  followedUserCheckin: false,
}

export async function registerPushToken(
  userId: string,
  token: string,
  platform: string,
  deviceId?: string,
) {
  return repo.upsertPushToken(userId, token, platform, deviceId)
}

export async function getPreferences(userId: string) {
  const prefs = await repo.getNotificationPreferences(userId)
  return prefs ?? { userId, ...DEFAULTS, updatedAt: new Date() }
}

export async function updatePreferences(
  userId: string,
  prefs: Partial<typeof DEFAULTS>,
) {
  return repo.upsertNotificationPreferences(userId, prefs)
}

/**
 * Send notification to user — socket primary, push fallback with 60s delay.
 * Never push for toast events, pulse changes, or other users' check-ins.
 */
export async function notifyUser(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  const io = getIO()
  const room = userRoom(userId)
  const sockets = await io.in(room).fetchSockets()

  if (sockets.length > 0) {
    // User has active socket — deliver via socket
    io.to(room).emit(event as 'reward:claimed', payload as never)
    return { delivered: 'socket' }
  }

  // No active socket — queue push with 60s delay
  // In production, this would enqueue to SQS with delay
  console.log(`[notifications] Queuing push for ${userId}: ${event}`)
  return { delivered: 'push_queued' }
}

/**
 * Check if reward push limit reached (2/day/user).
 */
export async function canSendRewardPush(userId: string): Promise<boolean> {
  const key = rewardNotificationsToday(userId)
  const count = await redis.get(key)
  return !count || parseInt(count, 10) < 2
}

export async function incrementRewardPushCount(userId: string) {
  const key = rewardNotificationsToday(userId)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 86400)
}
