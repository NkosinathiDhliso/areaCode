/**
 * Pure toast admission logic for the Toast_System (Map Discovery / Peek-Carousel).
 *
 * This module is intentionally **pure** - it imports no React, no Mapbox, and
 * no stores' runtime state - so it is the single source of truth shared by:
 *   - the `toastStore` wiring (which delegates `addToast` to {@link admitToQueue}
 *     and gates Check_In_Toasts via {@link shouldEnqueueCheckInToast}), and
 *   - the web `apps/web/src/lib/toastAdmission.ts` re-export consumed by the
 *     fast-check property tests against the pure logic cores.
 *
 * It lives in `@area-code/shared` (rather than `apps/web`) because the
 * `toastStore` also lives in the shared package and must not depend on app
 * code; keeping the logic here lets both the store and the web app use one
 * implementation.
 *
 * Feature: map-discovery-experience
 */

import type { Toast, ToastType } from '../types'

/**
 * Toast priority map (lower number = higher priority, surge first).
 *
 * City_Pulse_Toast (live-vibe-on-map design § R2) slots between surge and
 * reward_pressure: it is louder than reward pressure but must never preempt a
 * true Pulse_State surge.
 *
 * This is the canonical definition; `toastStore` re-exports it so existing
 * importers of `@area-code/shared/stores/toastStore` keep working.
 */
export const TOAST_PRIORITY: Record<string, number> = {
  surge: 1,
  city_pulse: 2,
  reward_pressure: 3,
  // Belonging (a friend checked in) is the strongest personal magnet, so it
  // sits above ambient check-in / reward toasts and is a distinct type: unlike
  // `checkin` it is never suppressed by the per-venue Check_In_Toast dedup, so
  // an ambient city buzz toast can't swallow "your friend is here".
  friend_checkin: 3,
  checkin: 4,
  reward_new: 4,
  streak: 5,
  leaderboard: 5,
}

/**
 * Maximum number of toasts the Toast_System retains at once. The queue is
 * priority-ordered, so the cap keeps the three highest-priority toasts and
 * drops the rest (Requirement 16.1).
 */
export const TOAST_QUEUE_CAP = 3

/**
 * Priority value used when a toast's type is absent from {@link TOAST_PRIORITY}.
 * Mirrors the `?? 5` fallback the store used so unknown types sort to the back
 * rather than crashing the comparison.
 */
const DEFAULT_TOAST_PRIORITY = 5

function priorityOf(toast: Toast): number {
  return TOAST_PRIORITY[toast.type] ?? DEFAULT_TOAST_PRIORITY
}

/**
 * Admits a toast into the queue, returning a **new** priority-ordered queue
 * capped at {@link TOAST_QUEUE_CAP} items.
 *
 * The queue is sorted ascending by the {@link TOAST_PRIORITY} value (lower
 * number = higher priority, surge first); the sort is stable so toasts of equal
 * priority keep their relative insertion order. Once sorted, only the highest
 * three are retained, so a lower-priority toast is dropped before a higher one
 * (Requirements 16.1, 16.5).
 *
 * This function does not mutate the input `queue` or `toast`; it is total over
 * any array of valid-shaped toasts and never throws.
 *
 * Validates: Requirements 16.1, 16.5
 */
export function admitToQueue(queue: Toast[], toast: Toast): Toast[] {
  const next = [...queue, toast]
  // Stable sort by priority (lower number = higher priority).
  next.sort((a, b) => priorityOf(a) - priorityOf(b))
  // Cap the queue, keeping the highest-priority items.
  return next.slice(0, TOAST_QUEUE_CAP)
}

/**
 * Decides whether a Check_In_Toast may be enqueued for `venueId` given the last
 * time a Check_In_Toast was admitted per venue.
 *
 * Returns `true` when the venue has never produced a Check_In_Toast, or when the
 * most recent one is at least `interval` ms old; returns `false` while a prior
 * Check_In_Toast for the same venue is still within the auto-dismiss `interval`.
 * This caps a burst of check-in events for one venue to a single toast per
 * interval (Requirement 16.6).
 *
 * The function is total: a missing or non-finite `lastSeenAt[venueId]` is
 * treated as "never seen" so the toast is admitted, and it never throws.
 *
 * @param venueId the venue the Check_In_Toast would be for
 * @param lastSeenAt map of venue id → timestamp (ms) of its last admitted
 *   Check_In_Toast
 * @param now the current time in ms
 * @param interval the auto-dismiss interval in ms within which duplicates are
 *   suppressed
 *
 * Validates: Requirements 16.6
 */
export function shouldEnqueueCheckInToast(
  venueId: string,
  lastSeenAt: Record<string, number>,
  now: number,
  interval: number,
): boolean {
  const last = lastSeenAt[venueId]
  if (last === undefined || !Number.isFinite(last)) return true
  return now - last >= interval
}

/** Re-exported for callers that want the toast type union alongside the logic. */
export type { Toast, ToastType }
