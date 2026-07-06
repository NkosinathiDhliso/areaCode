# Requirements: Rank Prestige (rank renames + Trophy_Tap hidden animation)

## Introduction

Two changes to the consumer rank ladder, plus the first codified entry in a
family of hidden, word-of-mouth delights.

**Problem.** Consumers earn a rank from check-ins: Local, Regular, Fixture,
Institution, Legend. "Regular" and "Fixture" read as put-downs ("part of the
furniture"). Loyalty should feel like climbing, not like being taken for
granted. Quiet resentment here is a churn risk.

**Change one: rename the ladder.** The five ranks become **Local, Insider,
Patron, Icon, Legend**. Each step up must read as the venue world valuing you
more. Thresholds, colours, and tier ids do not change; only the human-facing
labels do.

**Change two: Trophy_Tap.** Rapid-tapping the rank card on your own profile
plays a full-screen celebration animation of your current rank badge. Higher
ranks play a bigger animation, so reaching the top has a payoff you can
revisit. It is a trophy cabinet moment, deliberately undocumented in the app.

**Hidden_Delights principle.** Features like Trophy_Tap are spread by word of
mouth, never by the app. The existing hold-the-Profile-tab theme flip
(`apps/web/src/App.tsx`, `onLongPress`) is the precedent. No tooltips, no
onboarding, no hints, no settings entry, no in-app changelog. The app never
tells; people tell each other.

### Contradictions with the working system, resolved here

These were found in the live code and are settled by this spec (see design.md
for rationale):

1. **Tier ids are persisted prod data.** `tier` is written to the users table
   on every check-in (`backend/src/features/check-in/repository.ts`), used by
   campaign segment resolution, socket payloads, API responses, CSS variable
   names, and e2e fixtures. Ids (`local`, `regular`, `fixture`,
   `institution`, `legend`) stay as the storage enum. Labels are the only
   rename surface. This is the standard enum/label split, not a banned dual
   path: one home for each concept.
2. **Raw ids currently leak into user-facing copy.** `ProfileScreen`'s
   `StatCard` renders the capitalized id; `useNotificationSocket` and the
   check-in service notification say "You've reached fixture tier." After the
   rename these would show the old names. Every user-facing surface must go
   through the one label source.
3. **Label maps are duplicated four times** (`tier-levels.ts`,
   `TierBadge.tsx`, `NativeTierBadge.tsx`, `shareCard.ts`), and the check-in
   repository carries an inline copy of the threshold table that
   `getTier` already owns. Both duplications get consolidated
   (`dry-reuse-no-duplication.md`).
4. **"Tier" is an overloaded word.** Businesses have paid tiers (see
   `tiered-visibility`); consumers have the check-in ladder; leaderboards
   have a numeric position. Consumer-facing copy for the ladder becomes
   **"Rank"** (matching the Ranks tab and the product language). Leaderboard
   position stays `#n`. Business paid tiers are untouched. Code identifiers
   (`tier`, `Tier`, table attributes) do not change.
5. **The rank is city-wide, not per-venue.** It is computed from
   `totalCheckIns` across all venues. Copy must never claim per-venue
   standing ("this venue knows you") that the data cannot back. Honest
   framing: your standing in the city. Per-venue ranks are out of scope.
6. **Benefits copy over-claims.** `GET /v1/users/me/tier-progress` lists
   benefits ("Priority reward access", "Leaderboard boost", "Early access to
   new venues") that are not all implemented. Under-claim, never over-claim:
   the list is audited down to what is real.

#[[.kiro/steering/dry-reuse-no-duplication.md]] #[[.kiro/steering/no-fallbacks-no-legacy.md]] #[[.kiro/steering/honest-presence.md]] #[[.kiro/steering/code-style.md]] #[[packages/shared/constants/tier-levels.ts]]

---

## Requirement 1: Rename the rank ladder in one place

The rank labels SHALL change to Local, Insider, Patron, Icon, Legend, defined
once in `packages/shared/constants/tier-levels.ts` and consumed everywhere.

### Acceptance Criteria

1.1. `TIER_LEVELS` labels SHALL become: `local` = "Local", `regular` =
"Insider", `fixture` = "Patron", `institution` = "Icon", `legend` =
"Legend". Tier ids, `minCheckIns` / `maxCheckIns` thresholds, and colour
tokens SHALL NOT change.

1.2. A `getTierLabel(tier: Tier): string` helper SHALL be exported from
`tier-levels.ts` and be the only way any surface turns a tier id into copy.

1.3. The duplicated `TIER_LABELS` maps in
`packages/shared/components/TierBadge.tsx`,
`apps/mobile/src/components/NativeTierBadge.tsx`, and
`apps/web/src/lib/shareCard.ts` SHALL be deleted and replaced with
`getTierLabel` (or `TIER_LEVELS`) imports.

1.4. The inline threshold table in
`backend/src/features/check-in/repository.ts` SHALL be replaced by the shared
`getTier` (already imported by `profile-handler.ts` via
`@area-code/shared/constants/tier-levels`). Tier computation SHALL exist in
exactly one place.

1.5. Tier permanence SHALL be preserved: the existing never-demote behaviour
and its property tests (`tier-permanence.property.test.ts`,
`tier-computation.property.test.ts`) SHALL still pass unchanged in meaning
(label expectations updated only).

## Requirement 2: No raw tier ids in user-facing copy

Every surface that shows a rank to a human SHALL render the label, never the
id.

### Acceptance Criteria

2.1. `ProfileScreen`'s rank `StatCard` SHALL render `getTierLabel(tier)`
instead of the capitalized raw id.

2.2. `useNotificationSocket`'s tier-change notification and toast SHALL
render the label ("You've reached Patron.") and the title SHALL become
"Rank up" (no exclamation, no emoji, per `code-style.md`).

2.3. The check-in service notification body
(`backend/src/features/check-in/service.ts`) SHALL use `getTierLabel` for the
new tier name.

2.4. Business, staff, and admin surfaces that show a consumer's rank
(`CheckInDetailPanel`, `CampaignsPanel` segment copy, report copy via
`node.tierComposition`, and any others found in the sweep) SHALL render
labels from the one source.

2.5. A repo-wide sweep SHALL find and update any remaining hardcoded
"Regular", "Fixture", "Institution" rank strings in app copy, i18n locale
files (web and mobile), and `tests/e2e` fixtures/assertions. Historical docs
(`docs/PLATFORM_AUDIT_FINDINGS.md` and the like) are records, not copy, and
SHALL NOT be rewritten.

## Requirement 3: Consumer copy says "Rank"

### Acceptance Criteria

3.1. The `profile.currentTier` i18n label SHALL become "Rank" (was "Tier").

3.2. Ladder copy SHALL NOT claim per-venue standing. Allowed framing: rank in
the city ("Icon of the city"). Banned framing: "this venue's Icon", "the
staff know you", or any claim tied to a single venue.

3.3. The `rewards.atRegulars` string ("Gets at Your Regulars") SHALL be
reworded so it cannot be read as the retired rank name (for example "Gets at
your spots"). The key MAY be renamed to match.

3.4. The benefits list in the tier-progress handler SHALL be reduced to
benefits that are actually implemented today. Anything aspirational is
removed, not softened (`honest-presence.md`: under-claim, never over-claim).

## Requirement 4: Trophy_Tap trigger (rapid-tap detection)

Rapid-tapping the rank card on the consumer profile SHALL trigger the trophy
animation. Detection logic SHALL be a pure, shared, property-tested core.

### Acceptance Criteria

4.1. A pure detector SHALL live in `packages/shared/lib/rapidTap.ts`:
`createRapidTapDetector({ taps, gapMs, now? })` returning `{ tap(): boolean }`.
`tap()` returns true (and resets) when `taps` consecutive taps each land
within `gapMs` of the previous one; a slower tap restarts the count at one.
No DOM, no timers of its own (timestamp-injectable), React Native safe.

4.2. Trophy_Tap SHALL use `TROPHY_TAP_COUNT = 3` and
`TROPHY_TAP_GAP_MS = 500`, exported alongside the detector.

4.3. The tap target SHALL be the rank card region on `ProfileScreen` (the
`TierBadge` + rank `StatCard` block), a single wrapper with a
`data-testid="rank-card"`. Touch target SHALL meet the 44px minimum.

4.4. Single and double taps SHALL do nothing except the standard pressed
feedback (`active:scale-95`). No navigation, no sheet, no tooltip. The rank
card has no other tap behaviour today and SHALL gain none.

4.5. Triggering SHALL fire the existing `haptic` helper (short tick) and open
the overlay. Taps while the overlay is open SHALL dismiss it, never re-arm or
re-trigger it.

4.6. Trophy_Tap SHALL NOT conflict with the Profile-tab long-press theme flip
(different element, different gesture). Neither egg's handler may swallow the
other's events.

4.7. The detector SHALL get fast-check property tests, tagged
`Feature: rank-prestige, Property N: <desc>`, min 100 runs, block-statement
predicates: threshold fires exactly at N fast taps, any gap > gapMs resets,
post-fire state is fully reset, and monotonic time is assumed but
non-strictly (equal timestamps allowed).

## Requirement 5: Trophy overlay (the animation)

### Acceptance Criteria

5.1. The overlay SHALL be a full-screen layer rendered by `ProfileScreen`
(web: `apps/web/src/components/RankTrophyOverlay.tsx`). It SHALL show the
current rank's badge as an inline SVG animated with CSS keyframes. No GIFs,
no video, no canvas, no Lottie: SVG + CSS keeps assets tiny, themeable via
the existing `--tier-*` CSS variables, and cheap on mid-range Android.

5.2. Animations SHALL only use `transform` and `opacity` (compositor-only,
no layout thrash). All colours via CSS variables.

5.3. Spectacle SHALL escalate with rank. Baseline choreography (design.md
holds the full table): Local a badge pop and single ring; Insider adds a
spark burst; Patron adds orbiting sparks; Icon adds light rays and a double
ripple; Legend gets the full treatment, reusing the existing Legend shimmer
language plus rays and a particle burst. Legend SHALL be visibly the biggest
payoff.

5.4. The overlay SHALL auto-dismiss when its animation completes
(per-rank duration, 2.0s to 3.6s) and SHALL always be dismissible early by
tap anywhere or Escape. A hard cap (`TROPHY_MAX_DURATION_MS = 6000`) SHALL
guarantee it can never persist.

5.5. `prefers-reduced-motion` SHALL get a static variant: badge and rank
name fade in, hold, fade out. No particles, no rays, no shimmer sweep.

5.6. No sound, ever. No ambient audio, no effect audio.

5.7. The overlay is decorative: content SHALL be `aria-hidden`, focus SHALL
NOT be trapped or moved, and dismissal SHALL restore the page exactly as it
was. No information exists only inside the animation.

5.8. The overlay SHALL render above the bottom nav and respect safe areas
(`env(safe-area-inset-*)`). It SHALL NOT unmount or disturb the profile
screen behind it.

5.9. The animation SHALL always show the user's own current rank. No
parameter may play a rank the user has not reached.

## Requirement 6: Word-of-mouth secrecy (Hidden_Delights contract)

### Acceptance Criteria

6.1. No in-app hint, tooltip, coach mark, onboarding step, settings toggle,
badge, or copy SHALL reference Trophy_Tap or any Hidden_Delight. Discovery
is by accident or by being told.

6.2. Hidden_Delights SHALL never gate real functionality: everything a
delight does must be either pure celebration (Trophy_Tap) or reachable
through a normal path too (theme also follows the SAST time default).

6.3. Hidden_Delights SHALL be free: no backend calls, no new infra, no
tracking events. Fully client-side.

6.4. The registry of shipped delights lives in this spec's design.md (HD-1
theme flip, HD-2 Trophy_Tap, HD-3 diagnostics taps). New delights add an
entry there: one home for the concept.

## Requirement 7: HD-3, diagnostics rapid-tap (optional, same primitive)

A second delight proving the detector is reusable: rapid-tapping the app
version row in Settings reveals a diagnostics card.

### Acceptance Criteria

7.1. Seven taps (gap 500ms) on the version row in the web Settings screen
SHALL toggle an inline diagnostics card: app version/build, environment name,
online/offline state, and websocket connected state. Booleans and names
only; no secrets, no env var values, no URLs.

7.2. It SHALL reuse `createRapidTapDetector` (no second detector
implementation) with `taps: 7`.

7.3. Same secrecy contract as Requirement 6. This requirement is optional
scope: if cut, cut cleanly (no half-wired code).

## Requirement 8: Verification

### Acceptance Criteria

8.1. `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm format:check`
SHALL pass.

8.2. Existing tier property tests SHALL pass with labels updated; no
threshold or permanence semantics change.

8.3. A manual sweep SHALL confirm: no surface in any portal still shows
"Regular", "Fixture", or "Institution" as a rank; the profile shows "Rank"
with the new label; the tier-up toast shows the new label; Trophy_Tap fires
on 3 fast taps and never on 2 or on slow taps; reduced-motion shows the
static variant; the overlay always dismisses.
