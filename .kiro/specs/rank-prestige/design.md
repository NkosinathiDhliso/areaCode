# Design: Rank Prestige

## Overview

Three strands, smallest possible surface:

1. **Rename**: change five label strings in one file, then make that file the
   only label source (it almost is; four duplicates get deleted).
2. **Trophy_Tap**: a pure rapid-tap detector in `packages/shared/lib`, a
   single overlay component in `apps/web`, wired on the profile rank card.
3. **Hidden_Delights registry**: this document becomes the one home for the
   list of shipped word-of-mouth features.

No new stores, no new routes, no backend endpoints, no infra. Backend changes
are copy fixes and one DRY consolidation.

## Decisions

### D1. Rename labels, keep tier ids

`tier` is persisted on live prod user records
(`check-in/repository.ts` writes `updateUser(userId, { tier })`), matched by
campaign segment resolution, carried in socket payloads and API responses,
and mirrored in CSS variable names (`--tier-fixture`). Renaming ids means a
prod data migration, a coordinated API + client deploy, CSS token renames,
and campaign segment rewrites, for zero user-visible gain once labels are
sourced correctly. Ids are storage keys; labels are copy. One home each. This
is not a banned compat shim (`no-fallbacks-no-legacy.md`): there is exactly
one live value (`fixture`) and exactly one live label ("Patron"), and no code
path accepts or emits both names for the same layer.

Consequence: the codebase reads `fixture` where humans read "Patron". That
is acceptable and normal; the guard is Requirement 2 (no raw ids in copy)
plus `getTierLabel` being the only id-to-copy bridge.

### D2. `TIER_LEVELS` is the single label source

It already holds `label` and is already imported by web, mobile, and backend
(`@area-code/shared/constants/tier-levels`). Add `getTierLabel`. Delete the
three duplicate `TIER_LABELS` maps (TierBadge, NativeTierBadge, shareCard)
and the duplicate threshold table in `check-in/repository.ts` (replace with
the shared `getTier`). Labels stay out of i18n for now: they are proper
nouns shared by all portals and the mobile app, and the existing duplicates
prove what happens when they live in more than one place.

### D3. New ladder

| id          | Old label   | New label | Check-ins |
| ----------- | ----------- | --------- | --------- |
| local       | Local       | Local     | 0-9       |
| regular     | Regular     | Insider   | 10-49     |
| fixture     | Fixture     | Patron    | 50-149    |
| institution | Institution | Icon      | 150-499   |
| legend      | Legend      | Legend    | 500+      |

Reads as a climb: you belong (Local), you know the scene (Insider), the
scene values you (Patron), the scene knows you (Icon), the city tells
stories about you (Legend). No label is a synonym for furniture.

### D4. "Rank" is the consumer word

Three collisions today: business paid tier (`tiered-visibility`), consumer
ladder ("Tier" on the profile), leaderboard position (`#n`). Resolution:
consumer ladder copy says **Rank** (matches the Ranks tab and the product's
own language); leaderboard position stays numeric `#n` and never uses the
word alone where it could read as the ladder; business surfaces keep "tier"
for the paid product only. Code identifiers keep `tier` everywhere: renaming
types, columns, and payload fields is churn with migration risk and no user
value.

### D5. Rapid-tap detector is a pure shared core

`packages/shared/lib/rapidTap.ts`. Same philosophy as the gesture and toast
admission cores: pure logic, injectable time, fast-check property tests.

```ts
interface RapidTapOptions {
  taps: number // threshold, >= 2
  gapMs: number // max ms between consecutive taps
  now?: () => number // injectable clock, default Date.now
}
function createRapidTapDetector(opts: RapidTapOptions): { tap(): boolean }
```

State: `count`, `lastTapAt`. `tap()`: if `t - lastTapAt <= gapMs` then
`count++` else `count = 1`; on `count === taps` reset and return true. No
window timer, so nothing to clean up and nothing to leak; staleness falls
out of the timestamp comparison at the next tap. RN-safe (no DOM).

Deliberately distinct from the long-press primitive planned in
`spotlight-mode` (`createLongPressHandlers`): press-and-hold and tap-burst
are different gestures with different state machines. Two homes because they
are two concepts, not a fork of one.

### D6. Overlay is a web component, animation config is data

- `apps/web/src/lib/trophyAnimations.ts`: per-tier descriptor table
  (duration, particle count, effect flags). Pure data, unit-testable,
  keeps the component under the size limit.
- `apps/web/src/components/RankTrophyOverlay.tsx`: fixed full-screen layer,
  `z-index` above BottomNav, backdrop `var(--bg)` at ~92% opacity, badge SVG
  centered, rank label under it (the one place the label appears large).
  Dismiss on click anywhere, `keydown` Escape, and `setTimeout(duration)`,
  all cleaned up on unmount. Hard cap timeout as a second guard.
- Mounted by `ProfileScreen` behind `playing: boolean` state; the rank card
  wrapper owns the detector via a small `useTrophyTap` hook colocated with
  the component.

SVG + CSS keyframes over GIF/Lottie/canvas: GIFs are heavy, unthemeable,
and jank on mid-range Android; canvas and Lottie are runtime cost and a new
dependency for a decoration. Inline SVG uses the existing `--tier-*` tokens
so the trophy matches the badge in both themes, and `transform`/`opacity`
keyframes stay on the compositor.

### D7. Choreography table (escalation)

| Rank    | Duration | Choreography                                                                                     |
| ------- | -------- | ------------------------------------------------------------------------------------------------ |
| Local   | 2.0s     | Badge pop (scale 0.6 to 1, spring), one ring ripple                                              |
| Insider | 2.4s     | Pop + 8-spark radial burst                                                                       |
| Patron  | 2.8s     | Pop + burst + 3 orbiting sparks, tier-colour glow pulse                                          |
| Icon    | 3.2s     | Pop + 12 rays sweep + double ripple + rising particle fountain                                   |
| Legend  | 3.6s     | Pop + shimmer sweep (reuse `animate-shimmer` language) + gold rays + 24-particle starfield burst |

Budget: max 24 animated nodes, all `transform`/`opacity`. Reduced motion:
fade in badge + label (300ms), hold, fade out; total 2.0s for every rank.

### D8. Honesty constraints carried into celebration copy

The overlay shows the badge and label only; optionally one line of city
framing ("Icon of Johannesburg" is out of scope until city is plumbed here;
ship label-only). No "your venues love you" claims: rank is global
(`totalCheckIns`), so celebration copy stays venue-free (Requirement 3.2).
The benefits audit (Requirement 3.4) trims `tierBenefits` in
`profile-handler.ts` to implemented capabilities; if a benefit line cannot
be pointed at working code, it goes.

### D9. Hidden_Delights registry

One home for the concept. Contract in Requirement 6 (never hinted in-app,
never load-bearing, always free, always client-side).

| ID   | Delight                     | Trigger                             | Status              |
| ---- | --------------------------- | ----------------------------------- | ------------------- |
| HD-1 | Theme flip (light/dark)     | Hold Profile tab in BottomNav       | Shipped             |
| HD-2 | Trophy_Tap rank celebration | 3 fast taps on profile rank card    | This spec           |
| HD-3 | Diagnostics card            | 7 fast taps on Settings version row | This spec, optional |

Future delights get a row here first. Candidates deliberately not built now:
anything on the map screen (gesture budget there is already contested by
carousel, spotlight, and constellation rules).

### D10. Mobile scope

The detector lives in `packages/shared` and is RN-safe, so mobile pays
nothing now. `NativeTierBadge` switches to `getTierLabel` (label parity on
day one). The native trophy overlay is deferred until the mobile app resumes
active development; when it does, it reuses the same detector and the
`trophyAnimations.ts` descriptor table, with a native animation
implementation. No half-wired mobile code ships in this spec.

## Data flow

```
ProfileScreen
  rank card wrapper (data-testid="rank-card")
    onPointerDown -> detector.tap()
      false -> nothing (pressed feedback only)
      true  -> haptic(10) + setPlaying(true)
  <RankTrophyOverlay tier={tier} playing onDone={() => setPlaying(false)} />
    click / Escape / duration end / hard cap -> onDone
```

Rename flow: `TIER_LEVELS` label edit propagates automatically to
TierProgressNudge, TierProgressBar, profile-handler `tiers[]` response, and
every surface converted to `getTierLabel` in Requirement 2.

## Files touched

| File                                             | Change                                              |
| ------------------------------------------------ | --------------------------------------------------- |
| `packages/shared/constants/tier-levels.ts`       | New labels, add `getTierLabel`                      |
| `packages/shared/lib/rapidTap.ts`                | New: detector + constants                           |
| `packages/shared/components/TierBadge.tsx`       | Drop local map, use `getTierLabel`                  |
| `apps/mobile/src/components/NativeTierBadge.tsx` | Same                                                |
| `apps/web/src/lib/shareCard.ts`                  | Same                                                |
| `apps/web/src/screens/ProfileScreen.tsx`         | Label in StatCard, rank card wrapper, overlay mount |
| `apps/web/src/components/RankTrophyOverlay.tsx`  | New: overlay                                        |
| `apps/web/src/lib/trophyAnimations.ts`           | New: per-tier descriptors                           |
| `packages/shared/hooks/useNotificationSocket.ts` | Label + "Rank up" copy                              |
| `backend/src/features/check-in/service.ts`       | Label in notification body                          |
| `backend/src/features/check-in/repository.ts`    | Use shared `getTier`                                |
| `backend/src/features/auth/profile-handler.ts`   | Benefits audit                                      |
| i18n locales (web, mobile)                       | "Rank", reworded `rewards.atRegulars`               |
| Business/staff/admin rank surfaces               | Label source sweep                                  |
| `tests/e2e` fixtures/assertions                  | New labels                                          |
| Settings screen (web)                            | HD-3 version-row detector (optional)                |

## Test plan

- `rapidTap` property tests (fast-check, min 100 runs, block predicates):
  fires exactly at N, gap reset, post-fire reset, equal-timestamp tolerance.
- `trophyAnimations` unit test: every tier has a descriptor, durations
  within [2000, 3600], all under the hard cap.
- `RankTrophyOverlay` jsdom test: renders for each tier, dismisses on click,
  Escape, and timer; reduced-motion branch renders the static variant;
  cleans up timers/listeners on unmount.
- ProfileScreen jsdom test: 3 fast taps open the overlay, 2 taps or slow
  taps do not; overlay tap dismisses without re-trigger.
- Rename regression: existing tier property tests updated for labels only;
  a sweep test can assert `getTierLabel` output never equals a raw id for
  renamed tiers.
