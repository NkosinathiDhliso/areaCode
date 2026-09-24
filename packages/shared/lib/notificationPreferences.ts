/**
 * Notification preferences, client side.
 *
 * One home for the read and the partial write, so every surface that turns a
 * toggle on or off goes through the same route and the same shape: the settings
 * screen, and the Tonight_Reminder opt-in on the Going control
 * (proof-of-demand R9.6).
 *
 * The keys and their defaults live in
 * `packages/shared/constants/notification-preferences.ts`; this only moves them
 * over the wire. The PATCH is a partial merge server side, so one toggle never
 * rewrites another.
 */

import type { NotificationPreferences } from '../types'

import { api } from './api'

/** The consumer's stored preferences. Missing keys take their default. */
export async function readNotificationPreferences(): Promise<Partial<NotificationPreferences>> {
  return api.get<Partial<NotificationPreferences>>('/v1/users/me/notification-preferences')
}

/**
 * Write the given toggles and leave the rest alone. Throws on failure: a
 * preference the consumer believes they set must never silently not be set.
 */
export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<Partial<NotificationPreferences>> {
  return api.patch<Partial<NotificationPreferences>>('/v1/users/me/notification-preferences', patch)
}
