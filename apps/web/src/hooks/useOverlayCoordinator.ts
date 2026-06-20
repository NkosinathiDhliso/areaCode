/**
 * Overlay coordination for the Map Discovery / Peek-Carousel experience.
 *
 * The Map_Screen layers several non-blocking guidance overlays over the map:
 * the one-time Onboarding_Hint, the Proximity_Nudge_Banner, the
 * Notification_Priming_Sheet, and the Location_Banner. Left uncoordinated they
 * collide with each other and with an open Commit_Mode sheet. This module
 * centralises the *decision* of which of those overlays may render at a given
 * moment.
 *
 * The decision logic lives in the **pure, total** {@link decideOverlayVisibility}
 * (and its small helpers) so the fast-check property tests (tasks 15.2 / 15.3)
 * can target it directly with no React or store runtime. The
 * {@link useOverlayCoordinator} hook is a thin shell that gathers the live
 * signals — Peek_Carousel `mode` from `selectionStore`, `onboarding.hintSeen`
 * from `userStore`, `permissionState` from `locationStore`, plus the
 * component-local flags it cannot derive itself — and feeds them to the pure
 * core.
 *
 * Coordination rules:
 *   1. Commit_Mode suppression (Requirement 17.3 / Property 27): while
 *      Commit_Mode is open, none of the Onboarding_Hint, Proximity_Nudge_Banner,
 *      or Notification_Priming_Sheet may render. The Location_Banner is *not*
 *      in this set — a denied-permission state is a fundamental blocker that
 *      stays visible regardless of sheet state (Requirement 10.3).
 *   2. Nudge / Location_Banner mutual exclusion (Requirement 17.4 /
 *      Property 28): at most one of the two renders at a time, resolved by
 *      {@link NUDGE_LOCATION_PRECEDENCE}. The Location_Banner wins, because a
 *      missing location permission is a more fundamental blocker than a
 *      proximity nudge — and the nudge depends on a last-known position that a
 *      denied permission tends to starve anyway.
 *   3. Priming gating: the Notification_Priming_Sheet is eligible only after a
 *      successful first check-in, and only once per session (and not while
 *      recently deferred).
 *
 * Feature: map-discovery-experience
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5
 */

import { useLocationStore, useSelectionStore, useUserStore } from '@area-code/shared/stores'
import type { SelectionMode } from '@area-code/shared/stores'

/**
 * Which overlay wins when both the Proximity_Nudge_Banner and the
 * Location_Banner are eligible at the same time (Requirement 17.4).
 *
 * The Location_Banner takes precedence: a denied location permission is a more
 * fundamental blocker than a proximity nudge, and the nudge is driven by a
 * last-known position that a denied permission generally prevents from being
 * fresh in the first place.
 */
export const NUDGE_LOCATION_PRECEDENCE = 'location-banner' as const

/**
 * Live inputs to the overlay decision. Every field is a plain, already-resolved
 * signal so {@link decideOverlayVisibility} stays pure and total — it derives
 * nothing and reads nothing from outside this object.
 */
export interface OverlayCoordinatorInput {
  /** Current Peek_Carousel mode from the Selection_Model. */
  mode: SelectionMode
  /** Whether the consumer has already seen the one-time Onboarding_Hint. */
  onboardingHintSeen: boolean
  /**
   * Whether the Proximity_Nudge_Banner has a venue to surface right now (the
   * `useProximityNudge` hook resolved a `current` target and the feature is
   * enabled for this consumer).
   */
  nudgeAvailable: boolean
  /** Whether location permission is currently `denied`. */
  locationDenied: boolean
  /** Whether the consumer dismissed the Location_Banner this session. */
  locationBannerDismissed: boolean
  /** Whether the consumer has completed their first successful check-in. */
  hasCompletedFirstCheckIn: boolean
  /** Whether the Notification_Priming_Sheet has already been shown this session. */
  primingShownThisSession: boolean
  /** Whether notification priming was deferred recently (within the defer window). */
  primingDeferred: boolean
}

/** The coordinated render decision for each overlay. */
export interface OverlayVisibility {
  showOnboardingHint: boolean
  showNudge: boolean
  showLocationBanner: boolean
  showPriming: boolean
}

/**
 * Whether the Notification_Priming_Sheet is *eligible* to present, ignoring
 * Commit_Mode suppression.
 *
 * Eligible exactly when a first check-in has succeeded, it has not already been
 * shown this session, and it is not within a recent defer window
 * (Requirement 17.5). Pure and total.
 */
export function isPrimingEligible(input: OverlayCoordinatorInput): boolean {
  return input.hasCompletedFirstCheckIn && !input.primingShownThisSession && !input.primingDeferred
}

/**
 * The pure, total core of overlay coordination. For any input it returns the
 * four render decisions; it never throws and depends on nothing outside its
 * argument, which is what makes Properties 27 and 28 decidable against it.
 *
 * - The Location_Banner shows whenever permission is denied and it has not been
 *   dismissed — it is intentionally *not* suppressed by Commit_Mode
 *   (Requirement 10.3).
 * - The Onboarding_Hint, Proximity_Nudge_Banner, and Notification_Priming_Sheet
 *   are all suppressed while Commit_Mode is open (Requirement 17.3 / Property 27).
 * - When both the nudge and the Location_Banner are otherwise eligible, the
 *   Location_Banner wins per {@link NUDGE_LOCATION_PRECEDENCE}, so at most one
 *   renders (Requirement 17.4 / Property 28).
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5
 */
export function decideOverlayVisibility(input: OverlayCoordinatorInput): OverlayVisibility {
  const commitOpen = input.mode === 'commit'

  // Location_Banner: denied + not dismissed. Survives Commit_Mode (R10.3).
  const showLocationBanner = input.locationDenied && !input.locationBannerDismissed

  // Onboarding_Hint: until seen, suppressed in Commit_Mode (R17.1, R17.3).
  const showOnboardingHint = !input.onboardingHintSeen && !commitOpen

  // Proximity_Nudge_Banner: available, suppressed in Commit_Mode (R17.3), and
  // yields to the Location_Banner when both are eligible (R17.4 precedence).
  const showNudge = input.nudgeAvailable && !commitOpen && !showLocationBanner

  // Notification_Priming_Sheet: eligible gate, suppressed in Commit_Mode (R17.3).
  const showPriming = isPrimingEligible(input) && !commitOpen

  return { showOnboardingHint, showNudge, showLocationBanner, showPriming }
}

/** Parameters the hook cannot read from a shared store and must receive from the host screen. */
export interface UseOverlayCoordinatorParams {
  /** The Proximity_Nudge_Banner resolved a venue to surface and is enabled. */
  nudgeAvailable: boolean
  /** The consumer dismissed the Location_Banner this session. */
  locationBannerDismissed: boolean
  /** The consumer has completed their first successful check-in. */
  hasCompletedFirstCheckIn: boolean
  /** The Notification_Priming_Sheet has already been shown this session. */
  primingShownThisSession: boolean
  /** Notification priming was deferred recently. */
  primingDeferred: boolean
}

/**
 * React shell over {@link decideOverlayVisibility}. Reads the Peek_Carousel
 * `mode`, the `onboarding.hintSeen` flag, and the location `permissionState`
 * from their shared stores, combines them with the component-local
 * {@link UseOverlayCoordinatorParams}, and returns the coordinated
 * {@link OverlayVisibility}.
 *
 * The hook holds no state of its own — it is a pure projection of store and
 * parameter state — so it re-derives on every relevant store change without
 * extra effects.
 */
export function useOverlayCoordinator(params: UseOverlayCoordinatorParams): OverlayVisibility {
  const mode = useSelectionStore((s) => s.mode)
  const onboardingHintSeen = useUserStore((s) => s.onboarding.hintSeen)
  const permissionState = useLocationStore((s) => s.permissionState)

  return decideOverlayVisibility({
    mode,
    onboardingHintSeen,
    nudgeAvailable: params.nudgeAvailable,
    locationDenied: permissionState === 'denied',
    locationBannerDismissed: params.locationBannerDismissed,
    hasCompletedFirstCheckIn: params.hasCompletedFirstCheckIn,
    primingShownThisSession: params.primingShownThisSession,
    primingDeferred: params.primingDeferred,
  })
}
