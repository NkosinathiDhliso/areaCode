import { redis } from '../../shared/redis/client.js'
import { rewardNotificationsToday, notifDeferred } from '../../shared/redis/keys.js'
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
 * Send notification to user — socket primary, push fallback.
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
    io.to(room).emit(event as 'reward:claimed', payload as never)
    return { delivered: 'socket' }
  }

  // No active socket — deliver via push
  const tokens = await repo.getActivePushTokens(userId)
  if (tokens.length === 0) {
    return { delivered: 'no_tokens' }
  }

  const title = (payload['title'] as string) ?? 'Area Code'
  const body = (payload['message'] as string) ?? ''

  const results = await Promise.allSettled(
    tokens.map(async (t) => {
      if (t.platform === 'expo') {
        return sendExpoPush(t.token, title, body, payload)
      }
      if (t.platform === 'web') {
        return sendWebPush(t.token, title, body, payload)
      }
      return { success: false, reason: 'unknown_platform' }
    }),
  )

  // Deactivate tokens that are no longer valid
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled' && result.value && 'invalid' in result.value && result.value.invalid) {
      await repo.deactivatePushToken(userId, tokens[i]!.token)
    }
  }

  return { delivered: 'push', count: tokens.length }
}

// ─── Expo Push (React Native) ───────────────────────────────────────────────

interface ExpoPushResult {
  success: boolean
  invalid?: boolean
}

async function sendExpoPush(
  pushToken: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<ExpoPushResult> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: pushToken,
      title,
      body,
      data,
      sound: 'default',
      channelId: 'default',
    }),
  })

  if (!res.ok) {
    return { success: false }
  }

  const json = await res.json() as { data?: { status?: string; details?: { error?: string } } }
  const status = json.data?.status

  if (status === 'error') {
    const errorType = json.data?.details?.error
    // DeviceNotRegistered means the token is stale
    if (errorType === 'DeviceNotRegistered') {
      return { success: false, invalid: true }
    }
    return { success: false }
  }

  return { success: true }
}

// ─── Web Push (VAPID) ───────────────────────────────────────────────────────

interface WebPushResult {
  success: boolean
  invalid?: boolean
}

async function sendWebPush(
  subscriptionJson: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<WebPushResult> {
  try {
    const webpush = await import('web-push')

    const vapidPublic = process.env['AREA_CODE_VAPID_PUBLIC_KEY'] ?? ''
    const vapidPrivate = process.env['AREA_CODE_VAPID_PRIVATE_KEY'] ?? ''
    const vapidSubject = process.env['AREA_CODE_VAPID_SUBJECT'] ?? 'mailto:tech@areacode.co.za'

    if (!vapidPublic || !vapidPrivate) {
      return { success: false }
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

    const subscription = JSON.parse(subscriptionJson) as {
      endpoint: string
      keys: { p256dh: string; auth: string }
    }

    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, data }),
    )

    return { success: true }
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode
    // 410 Gone or 404 means subscription expired
    if (statusCode === 410 || statusCode === 404) {
      return { success: false, invalid: true }
    }
    return { success: false }
  }
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

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
