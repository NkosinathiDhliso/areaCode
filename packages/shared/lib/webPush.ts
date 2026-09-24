/**
 * Web Push subscription, one home (proof-of-demand R9.6).
 *
 * Permission, subscription and token registration for the browser. Two callers
 * use it: the notification priming sheet, and the Tonight_Reminder opt-in on the
 * Going control. Neither hand-rolls the `pushManager.subscribe` sequence, so the
 * VAPID key, the subscription shape and the registration endpoint have one
 * definition (`dry-reuse-no-duplication.md`).
 *
 * Web Push only. There is no SMS path and no phone identifier anywhere in this
 * module (`no-sms-no-phone-auth.md`); the Expo path is the mobile app's own
 * (`apps/mobile/src/lib/push.ts`).
 *
 * The outcome is reported honestly instead of being flattened into a boolean.
 * Some real browsers genuinely cannot subscribe (iOS Safari outside an installed
 * PWA has no `PushManager`), and a caller that shows "notifications on" in that
 * case would be lying. What each surface says about a given outcome is its own
 * business; this only reports which one happened.
 */

import { api } from './api'
import { getDeviceInfo } from './platform'

/**
 * What happened when we tried to turn Web Push on.
 *
 * - `subscribed`: permission granted, subscription registered with the server.
 * - `unsupported`: this browser has no Notification, service worker or
 *   PushManager. iOS Safari outside an installed PWA lands here.
 * - `denied`: the person said no, or had already said no.
 * - `not_configured`: no VAPID public key in this build, so no subscription can
 *   be created. A deploy gap, not a user choice.
 * - `failed`: permission was granted but the subscribe or the registration threw.
 */
export type WebPushOutcome = 'subscribed' | 'unsupported' | 'denied' | 'not_configured' | 'failed'

/** Whether this browser can subscribe to Web Push at all. */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

/**
 * Whether Web Push on this browser needs the app installed to the Home Screen
 * first: iOS or iPadOS outside a standalone display mode.
 *
 * iOS Safari in an ordinary tab has no `PushManager` at all, so `enableWebPush`
 * can only ever return `unsupported` there and no permission prompt would change
 * that. The one true thing to say is the step that does work: add it to the Home
 * Screen. This lives beside the capability check so a single module knows what
 * iOS can and cannot do (`dry-reuse-no-duplication.md`).
 */
export function needsHomeScreenInstall(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (getDeviceInfo().platform !== 'ios') return false
  return !isStandaloneDisplay()
}

/** Installed-app display mode: the iOS-specific flag, or the standard media query. */
function isStandaloneDisplay(): boolean {
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(display-mode: standalone)').matches
}

/**
 * Ask for notification permission, subscribe, and register the subscription with
 * the backend. Safe to call again: `pushManager.subscribe` returns the existing
 * subscription, and the token upsert is idempotent.
 *
 * Must be called from a user gesture: browsers reject a permission prompt that
 * did not come from a tap.
 */
export async function enableWebPush(): Promise<WebPushOutcome> {
  if (!isWebPushSupported()) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const vapidKey = readVapidPublicKey()
  if (vapidKey === null) return 'not_configured'

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey,
    })
    await api.post('/v1/users/me/push-token', { token: JSON.stringify(subscription), platform: 'web' })
    return 'subscribed'
  } catch {
    // Permission is granted but this device has no working subscription, so no
    // push will arrive. Reported, not hidden: the caller has to say something
    // true about what will and will not reach the person.
    return 'failed'
  }
}

/**
 * The VAPID public key from the build, or null when it was not provisioned.
 *
 * Read as a bare `import.meta.env` member expression so Vite statically replaces
 * it at build time; the optional-chained form is not replaced and reads as
 * undefined in the browser.
 */
function readVapidPublicKey(): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    const raw = env?.['VITE_VAPID_PUBLIC_KEY']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  } catch {
    // import.meta unavailable in this runtime (Node tests, RN): no key.
  }
  return null
}
