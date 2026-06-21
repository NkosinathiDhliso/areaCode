import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { OverlayCoordinatorInput } from '../useOverlayCoordinator'
import { decideOverlayVisibility, isPrimingEligible } from '../useOverlayCoordinator'

/**
 * Map Discovery - overlay coordination property tests (deferred tasks 15.2, 15.3).
 *
 *   - Property 27: Commit_Mode suppresses overlapping overlays
 *   - Property 28: Nudge and Location_Banner are mutually exclusive
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5
 */

const inputArb: fc.Arbitrary<OverlayCoordinatorInput> = fc.record({
  mode: fc.constantFrom('closed' as const, 'browse' as const, 'commit' as const),
  onboardingHintSeen: fc.boolean(),
  nudgeAvailable: fc.boolean(),
  locationDenied: fc.boolean(),
  locationBannerDismissed: fc.boolean(),
  hasCompletedFirstCheckIn: fc.boolean(),
  primingShownThisSession: fc.boolean(),
  primingDeferred: fc.boolean(),
})

describe('Feature: map-discovery-experience, Property 27: Commit_Mode suppresses overlapping overlays', () => {
  it('hides the onboarding hint, nudge, and priming sheet while Commit_Mode is open', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const v = decideOverlayVisibility({ ...input, mode: 'commit' })
        expect(v.showOnboardingHint).toBe(false)
        expect(v.showNudge).toBe(false)
        expect(v.showPriming).toBe(false)
      }),
    )
  })

  it('keeps the Location_Banner independent of Commit_Mode (a denied permission is a hard blocker)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const expected = input.locationDenied && !input.locationBannerDismissed
        expect(decideOverlayVisibility({ ...input, mode: 'commit' }).showLocationBanner).toBe(expected)
        expect(decideOverlayVisibility({ ...input, mode: 'browse' }).showLocationBanner).toBe(expected)
        expect(decideOverlayVisibility({ ...input, mode: 'closed' }).showLocationBanner).toBe(expected)
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 28: Nudge and Location_Banner are mutually exclusive', () => {
  it('never shows the Proximity_Nudge_Banner and Location_Banner at the same time', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const v = decideOverlayVisibility(input)
        expect(v.showNudge && v.showLocationBanner).toBe(false)
      }),
    )
  })
})

describe('Map Discovery - overlay coordination contract', () => {
  it('shows the Location_Banner iff permission is denied and it was not dismissed', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(decideOverlayVisibility(input).showLocationBanner).toBe(
          input.locationDenied && !input.locationBannerDismissed,
        )
      }),
    )
  })

  it('shows the onboarding hint iff unseen and not in Commit_Mode', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(decideOverlayVisibility(input).showOnboardingHint).toBe(
          !input.onboardingHintSeen && input.mode !== 'commit',
        )
      }),
    )
  })

  it('gates priming on a first check-in, once per session, outside a recent defer and Commit_Mode', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(isPrimingEligible(input)).toBe(
          input.hasCompletedFirstCheckIn && !input.primingShownThisSession && !input.primingDeferred,
        )
        expect(decideOverlayVisibility(input).showPriming).toBe(isPrimingEligible(input) && input.mode !== 'commit')
      }),
    )
  })
})
