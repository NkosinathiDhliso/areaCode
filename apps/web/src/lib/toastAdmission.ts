/**
 * Pure toast admission logic for the Map Discovery / Peek-Carousel experience.
 *
 * The implementation lives in `@area-code/shared` so the shared `toastStore`
 * can delegate to it without depending on app code (the shared package must not
 * import from `apps/web`). This module re-exports that single source of truth so
 * the web app and its fast-check property tests can keep importing from
 * `apps/web/src/lib/toastAdmission`.
 *
 * It holds the two decidable rules of the Toast_System:
 *   - {@link admitToQueue} — keeps the queue priority-ordered and capped, using
 *     the shared `TOAST_PRIORITY` map the store sorts by.
 *   - {@link shouldEnqueueCheckInToast} — per-venue Check_In_Toast dedup within
 *     a single auto-dismiss interval.
 *
 * Feature: map-discovery-experience
 */

export {
  TOAST_QUEUE_CAP,
  TOAST_PRIORITY,
  admitToQueue,
  shouldEnqueueCheckInToast,
} from '@area-code/shared/lib/toastAdmission'
