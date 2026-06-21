/**
 * Push notification registration and tap-routing for React Native (Expo).
 *
 * Flow:
 *  1. `setNotificationHandler` (module load) decides foreground behaviour -
 *     show the banner, stay silent over an already-open app.
 *  2. `registerForPushNotifications()` requests OS permission, sets up the
 *     Android channel, acquires an Expo push token (needs the EAS projectId),
 *     and registers it with the backend (`POST /v1/users/me/push-token`,
 *     platform `expo`) so the pipeline can deliver via Expo when no socket is
 *     connected. Called after auth so the token is attributed to the user.
 *  3. `attachNotificationResponseHandler()` deep-links a tapped notification to
 *     the relevant screen, including the cold-start case (a notification that
 *     launched the app from a killed state).
 *
 * Push is best-effort: every path is non-throwing and must never block startup
 * or sign-in. No SMS or phone identifiers are involved - this is the data-only
 * Expo push channel, compatible with the email + Google OAuth identity model.
 */

import { api } from '@area-code/shared/lib/api'
import { storage } from '@area-code/shared/lib/storage'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const PUSH_TOKEN_KEY = 'push:expoToken'
const DEVICE_ID_KEY = 'push:deviceId'
const ANDROID_CHANNEL_ID = 'default'

/** Minimal router contract - avoids a hard dependency on expo-router's types. */
interface PushRouter {
  push: (href: string) => void
}

// Foreground presentation: show the banner when a push arrives while the app is
// open, but stay silent (no sound/badge) to avoid being noisy over an
// already-open app. Set once at module load. Fields match the
// NotificationBehavior shape in expo-notifications 0.29 (SDK 52).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

/** Resolve the EAS project id that scopes the Expo push token. */
function resolveProjectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  return fromExtra || Constants.easConfig?.projectId || process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined
}

/**
 * Stable per-install device id so the backend can dedupe a user's tokens across
 * refreshes. Generated once and persisted.
 */
function getDeviceId(): string {
  const existing = storage.get(DEVICE_ID_KEY)
  if (existing) return existing
  const id = `${Platform.OS}-${Constants.sessionId ?? Math.random().toString(36).slice(2, 12)}`
  storage.set(DEVICE_ID_KEY, id)
  return id
}

/**
 * Ensure the Android notification channel exists. No-op on iOS. Android
 * requires a channel before any notification can be displayed.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#7c5cff',
  })
}

/**
 * Register this device for push notifications and persist the token to the
 * backend. Safe to call repeatedly; the backend upserts by token and this skips
 * the network round-trip when the token is unchanged this session. No-op on web
 * and when no projectId is configured (e.g. Expo Go without EAS).
 *
 * Returns the Expo push token, or `null` when push is unavailable.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null

  try {
    await ensureAndroidChannel()

    // 1. Permission - only prompt if not already decided.
    const existing = await Notifications.getPermissionsAsync()
    let granted = existing.granted
    if (!granted && existing.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync()
      granted = requested.granted
    }
    if (!granted) return null

    // 2. Expo push token. Requires a projectId; bail quietly if absent so we
    //    don't throw in bare Expo Go without EAS configured.
    const projectId = resolveProjectId()
    if (!projectId) {
      if (__DEV__) console.warn('[push] no EAS projectId - skipping push registration')
      return null
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId })
    const token = tokenResponse.data
    if (!token) return null

    // Skip the network call if this exact token is already registered.
    if (storage.get(PUSH_TOKEN_KEY) === token) return token

    // 3. Register with the backend. Endpoint requires consumer auth; the API
    //    client attaches the bearer token automatically.
    await api.post('/v1/users/me/push-token', {
      token,
      platform: 'expo',
      deviceId: getDeviceId(),
    })

    storage.set(PUSH_TOKEN_KEY, token)
    return token
  } catch (err) {
    // Best-effort: never let push registration break startup.
    if (__DEV__) console.warn('[push] registration failed:', err)
    return null
  }
}

/**
 * Route a tapped-notification payload to the relevant screen. The data object
 * mirrors what the backend attaches in `sendNotification(... data)`:
 *  - explicit in-app `url` (highest priority, future-proofs server-driven routes)
 *  - `rewardId` → rewards tab
 *  - `nodeId`   → map (default tab)
 *  - otherwise  → map
 */
function routeFromNotificationData(router: PushRouter, data: Record<string, unknown> | undefined): void {
  if (data && typeof data['url'] === 'string' && data['url'].startsWith('/')) {
    router.push(data['url'])
    return
  }
  if (data && data['rewardId']) {
    router.push('/rewards')
    return
  }
  // nodeId or anything else lands the user on the map.
  router.push('/')
}

/**
 * Wire notification-tap deep-linking. Call once after the navigator is mounted.
 * Handles both the warm path (app running/backgrounded) and the cold-start path
 * (a notification launched the app from a killed state).
 *
 * Returns a cleanup function that removes the listener.
 */
export function attachNotificationResponseHandler(router: PushRouter): () => void {
  if (Platform.OS === 'web') return () => {}

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    routeFromNotificationData(router, data)
  })

  // Cold start: if a notification tap opened the app, route to it once, then
  // clear so a re-mount doesn't re-trigger the same route.
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (!response) return
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    routeFromNotificationData(router, data)
    void Notifications.clearLastNotificationResponseAsync().catch(() => {})
  })

  return () => subscription.remove()
}

/** Re-exported key for callers that want to clear the device id on logout. */
export const PUSH_DEVICE_ID_KEY = DEVICE_ID_KEY
