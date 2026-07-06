# Implementation Plan: Rank Prestige

## Overview

Rename the consumer rank ladder to Local, Insider, Patron, Icon, Legend with
one label source of truth, fix every surface that leaks raw tier ids, and
ship Trophy_Tap: a hidden rapid-tap celebration on the profile rank card.
Client-side feature; backend work is copy fixes and one DRY consolidation.
Tasks marked `*` are the deferred test tasks per house convention.

## Tasks

- [x] 1. Label source of truth
     (`packages/shared/constants/tier-levels.ts`)
  - [x] 1.1 Update `TIER_LEVELS` labels: Insider, Patron, Icon (Local and
        Legend unchanged); thresholds, ids, colours untouched
  - [x] 1.2 Add and export `getTierLabel(tier: Tier): string`
  - [x] 1.3 Delete duplicate `TIER_LABELS` maps in `TierBadge.tsx`,
        `NativeTierBadge.tsx`, `shareCard.ts`; import `getTierLabel`
  - [x] 1.4 Replace the inline threshold table in
        `backend/src/features/check-in/repository.ts` with the shared
        `getTier` import
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Raw-id leak fixes (copy through `getTierLabel`)
  - [x] 2.1 `ProfileScreen` rank `StatCard`: render the label, drop
        `capitalize` of the raw id
  - [x] 2.2 `useNotificationSocket`: tier-change title "Rank up", body and
        toast use the label
  - [x] 2.3 `check-in/service.ts`: notification body uses `getTierLabel`
  - [x] 2.4 Business/staff/admin sweep: `CheckInDetailPanel`,
        `CampaignsPanel`, report tier-composition copy, and any grep hits
        for rank ids/old names rendered to users
  - [x] 2.5 Repo-wide grep for "Regular"/"Fixture"/"Institution" as rank
        copy: web + mobile i18n locales, components, `tests/e2e` fixtures
        and assertions. Leave historical docs untouched
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Consumer copy: "Rank" and honesty
  - [x] 3.1 i18n `profile.currentTier` becomes "Rank"
  - [x] 3.2 Reword `rewards.atRegulars` so it cannot read as the retired
        rank name
  - [x] 3.3 Benefits audit in `profile-handler.ts`: keep only implemented
        benefits, delete aspirational lines
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Rapid-tap core (`packages/shared/lib/rapidTap.ts`, new)
  - `createRapidTapDetector({ taps, gapMs, now? })` per design D5; export
    `TROPHY_TAP_COUNT = 3`, `TROPHY_TAP_GAP_MS = 500`; pure, RN-safe,
    timestamp-injected, no timers
  - _Requirements: 4.1, 4.2_

- [x] 5. Trophy animation config
     (`apps/web/src/lib/trophyAnimations.ts`, new)
  - Per-tier descriptor table (duration, particles, effect flags) per
    design D7; export `TROPHY_MAX_DURATION_MS = 6000`
  - _Requirements: 5.3, 5.4_

- [x] 6. Trophy overlay
     (`apps/web/src/components/RankTrophyOverlay.tsx`, new)
  - [x] 6.1 Full-screen decorative layer: inline SVG badge, CSS keyframe
        choreography from the descriptor table, `--tier-*` variables only,
        transform/opacity only, safe-area padding, above BottomNav
  - [x] 6.2 Dismissal: click anywhere, Escape, animation-end timer, hard
        cap; all listeners/timers cleaned up on unmount
  - [x] 6.3 `prefers-reduced-motion`: static fade variant, 2.0s flat
  - [x] 6.4 Accessibility: content `aria-hidden`, no focus trap, page
        untouched behind it; no sound
  - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7, 5.8_

- [x] 7. Profile wiring (`apps/web/src/screens/ProfileScreen.tsx`)
  - Wrap the TierBadge + rank StatCard block as the rank card
    (`data-testid="rank-card"`, 44px+ target, `active:scale-95`); detector
    via a colocated `useTrophyTap` hook; on fire `haptic(10)` + mount the
    overlay with the user's current tier; taps while open dismiss only.
    No hint copy anywhere (Hidden_Delights contract)
  - _Requirements: 4.3, 4.4, 4.5, 4.6, 5.9, 6.1_

- [x] 8. HD-3 diagnostics taps (optional; cut cleanly if dropped)
  - Settings version row: reuse the detector with `taps: 7`; inline
    diagnostics card (version/build, env name, online state, socket state;
    booleans and names only, no secrets or URLs)
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 9. Verification pass
  - `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`; manual
    sweep per Requirement 8.3 (no old names anywhere, Trophy_Tap fires at 3
    fast taps only, reduced-motion static variant, overlay always
    dismisses)
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 10. Tests
  - [x] 10.1 Update existing tier tests for new labels (`tier-levels`,
        `tier-computation`, `tier-permanence` label expectations; semantics
        unchanged)
  - [x] 10.2 `rapidTap` fast-check property tests: fires exactly at N
        consecutive fast taps, gap > gapMs resets to one, post-fire reset,
        equal timestamps allowed. Tagged `Feature: rank-prestige,
Property N`, min 100 runs, block-statement predicates
  - [x] 10.3 `trophyAnimations` unit test: descriptor per tier, durations
        in range, under hard cap
  - [x] 10.4 `RankTrophyOverlay` jsdom test: per-tier render, click/
        Escape/timer dismissal, reduced-motion branch, unmount cleanup
  - [x] 10.5 ProfileScreen jsdom test: 3 fast taps open, 2 or slow taps do
        not, tap-while-open dismisses without re-trigger
  - _Requirements: 4.7, 8.2_
