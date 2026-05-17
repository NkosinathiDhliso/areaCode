import { kvGet, kvIncr } from '../../shared/kv/dynamodb-kv.js'
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

/**
 * Maps notification types to the corresponding user preference key.
 * If a type is not listed here, the notification is always sent.
 */
const NOTIFICATION_TYPE_TO_PREF: Record<string, keyof typeof DEFAULTS> = {
  reward_new: 'rewardActivated',
  reward_code: 'rewardClaimedPush',
  streak_at_risk: 'streakAtRisk',
  leaderboard_reset: 'leaderboardPrewarning',
  friend_checkin: 'followedUserCheckin',
}

export async function registerPushToken(userId: string, token: string, platform: string, deviceId?: string) {
  return repo.upsertPushToken(userId, token, platform, deviceId)
}

export async function getPreferences(userId: string) {
  const prefs = await repo.getNotificationPreferences(userId)
  return prefs ?? { userId, ...DEFAULTS, updatedAt: new Date() }
}

export async function updatePreferences(userId: string, prefs: Partial<typeof DEFAULTS>) {
  return repo.upsertNotificationPreferences(userId, prefs)
}

// ─── Notification History ───────────────────────────────────────────────────

export async function getNotificationHistory(userId: string, options?: { limit?: number; cursor?: string }) {
  return repo.getNotificationHistory(userId, options)
}

export async function markAllNotificationsAsRead(userId: string) {
  return repo.markNotificationsAsRead(userId)
}

// ─── Preference Checking ────────────────────────────────────────────────────

/**
 * Check if a notification of the given type should be sent to the user
 * based on their notification preferences.
 */
async function shouldSendNotification(userId: string, notificationType: string): Promise<boolean> {
  const prefKey = NOTIFICATION_TYPE_TO_PREF[notificationType]
  if (!prefKey) {
    // No preference mapping — always send (e.g. tier_change, badge_earned)
    return true
  }

  const prefs = await getPreferences(userId)
  const prefValue = (prefs as Record<string, unknown>)[prefKey]
  // If the preference is explicitly false, don't send
  if (prefValue === false) {
    return false
  }
  return true
}

// ─── Enhanced Notification Delivery ─────────────────────────────────────────

export interface SendNotificationOptions {
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  /** If true, skip preference checking (e.g. for system-critical notifications) */
  skipPreferenceCheck?: boolean
}

export interface SendNotificationResult {
  delivered: 'socket' | 'push' | 'no_tokens' | 'preference_blocked' | 'rate_limited'
  notifId?: string
  count?: number
}

/**
 * High-level notification sender that:
 * 1. Checks user preferences before sending
 * 2. Delivers via WebSocket (primary) or push (fallback)
 * 3. Persists the notification to history
 * 4. Emits a `notification:new` WebSocket event
 */
export async function sendNotification(options: SendNotificationOptions): Promise<SendNotificationResult> {
  const { userId, type, title, body, data = {}, skipPreferenceCheck } = options

  // 1. Check preferences
  if (!skipPreferenceCheck) {
    const allowed = await shouldSendNotification(userId, type)
    if (!allowed) {
      // Still persist to history so user can see it if they check later,
      // but mark delivery channel as 'none'
      const record = await repo.persistNotification({
        userId,
        type,
        title,
        body,
        data,
        deliveryChannel: 'none',
      })
      return { delivered: 'preference_blocked', notifId: record.notifId }
    }
  }

  // 2. Deliver via WebSocket or push
  const io = getIO()
  const room = userRoom(userId)
  // In serverless contexts (Lambda) there's no in-process Socket.io server,
  // so fall straight through to push-token delivery.
  const sockets = io ? await io.in(room).fetchSockets() : []

  let deliveryChannel: 'socket' | 'push' | 'none' = 'none'
  let pushCount = 0

  if (io && sockets.length > 0) {
    // Deliver via WebSocket
    io.to(room).emit(
      'notification:new' as 'reward:claimed',
      {
        type,
        title,
        body,
        data,
        createdAt: new Date().toISOString(),
      } as never,
    )
    deliveryChannel = 'socket'
  } else {
    // Fallback to push
    const tokens = await repo.getActivePushTokens(userId)
    if (tokens.length > 0) {
      const results = await Promise.allSettled(
        tokens.map(async (t) => {
          if (t.platform === 'expo') {
            return sendExpoPush(t.token, title, body, data)
          }
          if (t.platform === 'web') {
            return sendWebPush(t.token, title, body, data)
          }
          return { success: false, reason: 'unknown_platform' }
        }),
      )

      // Deactivate invalid tokens
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!
        if (result.status === 'fulfilled' && result.value && 'invalid' in result.value && result.value.invalid) {
          await repo.deactivatePushToken(userId, tokens[i]!.token)
        }
      }

      deliveryChannel = 'push'
      pushCount = tokens.length
    }
  }

  // 3. Persist to notification history
  const record = await repo.persistNotification({
    userId,
    type,
    title,
    body,
    data,
    deliveryChannel,
  })

  const result: SendNotificationResult = {
    delivered: deliveryChannel === 'none' ? 'no_tokens' : deliveryChannel,
    notifId: record.notifId,
  }
  if (deliveryChannel === 'push') {
    result.count = pushCount
  }

  return result
}

/**
 * Send notification to user — socket primary, push fallback.
 * Never push for toast events, pulse changes, or other users' check-ins.
 *
 * This is the original low-level delivery function. For new code, prefer
 * `sendNotification()` which adds preference checking and history persistence.
 */
export async function notifyUser(userId: string, event: string, payload: Record<string, unknown>) {
  const io = getIO()
  const room = userRoom(userId)
  const sockets = io ? await io.in(room).fetchSockets() : []

  if (io && sockets.length > 0) {
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

  const json = (await res.json()) as { data?: { status?: string; details?: { error?: string } } }
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

    await webpush.sendNotification(subscription, JSON.stringify({ title, body, data }))

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
  const key = `notif:reward_push:${userId}`
  const count = await kvGet(key)
  return !count || parseInt(count, 10) < 2
}

export async function incrementRewardPushCount(userId: string) {
  const key = `notif:reward_push:${userId}`
  await kvIncr(key, 86400)
}

// ─── New Reward Notification Targeting (Task 3.6) ───────────────────────────

/**
 * Notify consumers who checked in at a node within the past 30 days
 * about a new reward. Respects rate limits and notification preferences.
 *
 * This runs asynchronously (fire-and-forget) so it doesn't slow down
 * the reward creation response.
 */
export async function notifyNewRewardConsumers(
  nodeId: string,
  nodeName: string,
  rewardId: string,
  rewardTitle: string,
): Promise<void> {
  try {
    const { getCheckInsByNode } = await import('../check-in/dynamodb-repository.js')

    // Query consumers who checked in at this node within the past 30 days
    const thirtyDaysHours = 30 * 24
    let allCheckIns: Array<{ userId: string }> = []
    let cursor: string | undefined

    // Paginate through all check-ins at this node in the past 30 days
    do {
      const page = await getCheckInsByNode(nodeId, {
        hours: thirtyDaysHours,
        limit: 100,
        cursor,
      })
      allCheckIns = allCheckIns.concat(page.checkIns)
      cursor = page.nextCursor
    } while (cursor)

    // Deduplicate by userId
    const uniqueUserIds = [...new Set(allCheckIns.map((c) => c.userId))]

    // Send notification to each unique consumer
    for (const userId of uniqueUserIds) {
      try {
        // Check rate limit (max 2 reward notifications per consumer per day)
        const canSend = await canSendRewardPush(userId)
        if (!canSend) {
          continue
        }

        const result = await sendNotification({
          userId,
          type: 'reward_new',
          title: 'New Reward Available!',
          body: `${rewardTitle} at ${nodeName}`,
          data: { rewardId, nodeId, rewardTitle, nodeName },
        })

        // Only increment rate limit counter if notification was actually delivered
        if (result.delivered === 'socket' || result.delivered === 'push') {
          await incrementRewardPushCount(userId)
        }
      } catch {
        // Silently skip individual notification failures
        // so one bad user doesn't block the rest
      }
    }
  } catch (err) {
    // Log but don't throw — this is fire-and-forget
    console.error('Failed to send new reward notifications:', err)
  }
}
