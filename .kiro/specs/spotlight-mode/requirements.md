# Requirements: Spotlight Mode (hold-to-isolate a venue)

## Introduction

Long-press a venue glyph on the map, or a Venue_Card in the Peek_Carousel, to
"spotlight" that one venue: every other marker is filtered off the map, the
camera frames the chosen venue at the user's current zoom, and the isolation
holds until the user zooms out, taps Recenter, or navigates away. It is a
focused, distraction-free look at a single place, then a clean return to
normal browse.

The word "focus" is already taken in this codebase (`focusNodeId`,
`openedFromFocus`, Focus_Signal, `SelectionSource = 'focus'`) and means
cross-screen navigation-to-a-venue. Spotlight_Mode is a distinct concept:
isolate the map to one venue. The two never share a name or a code path
(one home per concept, `dry-reuse-no-duplication.md`).

Spotlight is user-intent isolation, not a ranking or discovery change:
`vibeRank` is untouched, proximity is never promoted, and no live-signal
claim is added or softened. It composes with the existing selection machine
rather than forking it: spotlight state lives in the single `selectionStore`
source of truth, and every surface (markers, carousel, camera, controls)
reads it from there.

#[[.kiro/steering/map-carousel.md]] #[[.kiro/steering/constellation-mode.md]] #[[.kiro/steering/discovery-dna-vibe-over-convenience.md]] #[[packages/shared/stores/selectionStore.ts]]

---

## Requirement 1: Spotlight state in the Selection_Model

Spotlight state SHALL live in `selectionStore`
(`packages/shared/stores/selectionStore.ts`), the single selection source of
truth, as `spotlightVenueId: string | null` plus two actions,
`enterSpotlight(id)` and `exitSpotlight()`.

### Acceptance Criteria

1.1. `enterSpotlight(id)` SHALL set `spotlightVenueId = id`, set
`activeVenueId = id` and `lastVenueId = id`, set `openedFromFocus = false`,
and open Browse_Mode when the carousel is closed (preserving the current open
mode otherwise), mirroring the `selectVenue` shape.

1.2. `exitSpotlight()` SHALL set `spotlightVenueId = null` and leave
`activeVenueId`, `mode`, and `lastVenueId` unchanged (the venue stays
selected; only the isolation lifts).

1.3. `dismiss()` and the close branch of `toggleOpen()` SHALL clear
`spotlightVenueId`, so a closed carousel never leaves a stale isolation.

1.4. **Invariant I1**: after any operation sequence, `mode === 'closed'`
implies `spotlightVenueId === null`.

1.5. **Invariant I2**: after any operation sequence,
`spotlightVenueId !== null` implies `spotlightVenueId === activeVenueId`.
Structural enforcement:

- `selectVenue(id, source)` SHALL clear `spotlightVenueId` when
  `id !== spotlightVenueId` (selecting a different venue, from any source
  including search and Focus_Signal, is an exit intent). Selecting the
  spotlit venue again keeps the spotlight.
- `step(dir)` SHALL be a no-op while `spotlightVenueId !== null`. The
  carousel order collapses to one venue while spotlit (R5), but the order
  write is asynchronous; the store-level guard closes the race where a step
  against a stale multi-venue order would move `activeVenueId` off the
  spotlit venue.

  1.6. Spotlight state SHALL be client-memory only, never persisted (same as
  the rest of the Selection_Model). A fresh session never starts spotlit.

  1.7. `useCarouselSelection` SHALL expose `spotlightVenueId`,
  `enterSpotlight`, and `exitSpotlight` on its result so render shells consume
  them without reaching into the store directly. The exposed `exitSpotlight`
  wraps the store action with the viewport re-baseline and order recompute
  described in R5.4.

---

## Requirement 2: Trigger A, long-press a marker glyph

A long-press on a marker's glyph tap target (`glyphHit` in
`useMapMarkers.ts`) SHALL enter Spotlight_Mode on that venue.

### Acceptance Criteria

2.1. The hold SHALL activate after 500 ms of continuous pointer contact with
no pointer movement beyond the shared movement tolerance
(`DRAG_AXIS_THRESHOLD`). Movement past the tolerance, pointer-up,
pointer-cancel, or pointer-leave before the timer fires SHALL cancel the
hold with no action.

2.2. On activation the handler SHALL call `enterSpotlight(node.id)` and fire
a haptic tick via the shared `haptic()` helper
(`packages/shared/lib/haptics.ts`), which already gates on device support.

2.3. A fired hold SHALL suppress the subsequent `click` on the same target,
so the hold does not also run the normal select-and-fly tap path (the
proven `longPressFired` pattern from `BottomNav.tsx`).

2.4. The hold SHALL only enter spotlight when the live map zoom is at or
above `MIN_MARKER_ZOOM` (dot and glyph presentation tiers). At Constellation
zoom the long-press does nothing: beams keep their existing tap-to-peek and
double-tap-to-commit behaviour untouched (see R8 and
`constellation-mode.md`).

2.5. `contextmenu` SHALL be prevented on the hold target so a touch
long-press never opens the browser context menu instead (same treatment as
`BottomNav`).

2.6. The timer and movement logic SHALL come from one shared pure helper,
`createLongPressHandlers` (new, `apps/web/src/lib/longPress.ts`), usable by
both the imperative marker DOM and the React carousel (R3), and
property-testable without a DOM. No third copy of hold-timer logic.

---

## Requirement 3: Trigger B, long-press a Venue_Card

A long-press on a venue card in the Peek_Carousel Browse_Mode strip SHALL
enter Spotlight_Mode on that card's venue.

### Acceptance Criteria

3.1. The hold uses the same `createLongPressHandlers` core as R2 (500 ms,
same movement tolerance), wired into `PeekCarousel`'s existing pointer
handling. The card under the pointer is resolved via the existing
`[data-venue-card]` dataset id.

3.2. A drag that the existing gesture tracking reads as movement past the
tolerance (an in-progress Carousel_Swipe or sheet gesture) SHALL cancel the
hold. A hold that fires SHALL NOT also settle as a swipe or a card select
on release (the movement-cancel and click-suppression rules make these
mutually exclusive).

3.3. On activation: `enterSpotlight(id)` plus the shared `haptic()` tick,
identical feel to the marker trigger.

3.4. The hold SHALL be active only in Browse_Mode. It does not apply to the
Constellation peek card (spotlight is not offered at Constellation zoom,
R8), the "Keep exploring" card, FlickControls, or any other control.

3.5. Long-pressing the already-active venue's card SHALL enter spotlight on
it without changing the selection (and without a camera move, R6.2).

---

## Requirement 4: Map isolation (marker filtering)

While `spotlightVenueId` is set, the Marker_Layer SHALL render only the
spotlit venue's marker.

### Acceptance Criteria

4.1. The existing reconcile loop in `useMapMarkers` SHALL narrow its
membership set to the spotlit venue when `spotlightVenueId` is set: the same
removal loop tears down every other marker, and exit rebuilds them. One
reconcile path, no parallel "spotlight renderer"
(`no-fallbacks-no-legacy.md`).

4.2. `useMapMarkers` SHALL subscribe to `spotlightVenueId` so the reconcile
effect re-runs on enter and exit.

4.3. The spotlight filter applies after the category filter (a spotlit venue
that stops matching a newly applied Category_Filter is handled by the
existing filter-reassignment path, which clears the spotlight via R1.5's
`selectVenue` rule or dismisses when the order is empty).

4.4. The spotlit marker keeps its normal presentation: active ring, pulse
animation, live-count badge, and tap targets all behave exactly as today.
Spotlight changes membership only, never presentation or honest-signal
rendering (`honest-presence.md`).

---

## Requirement 5: Carousel scoping while spotlit

While spotlit, the Browse_Mode strip SHALL show only the isolated venue, and
viewport-driven rescoping SHALL pause.

### Acceptance Criteria

5.1. `computeOrder` in `useCarouselSelection` SHALL short-circuit to
`[spotlightVenueId]` while spotlight is set. Step and swipe naturally no-op
on a length-1 order (and are store-guarded per R1.5); FlickControls render
disabled exactly as they do today for a single-venue order.

5.2. `notifyViewportChanged` SHALL early-return while spotlit: panning and
zooming around the isolated venue never flips the browse scope to `area`
and never recomputes the order.

5.3. The "Keep exploring" affordance SHALL NOT render while spotlit (the
order has one venue; the existing `deriveBrowseStrip` length rules already
produce this, no special case needed).

5.4. On exit, the hook SHALL re-baseline the viewport snapshot to the
current camera and recompute the order in the current scope, so panning done
during the spotlight does not retroactively count as a scope-flipping
exploration move the instant the isolation lifts.

---

## Requirement 6: Camera behaviour

### Acceptance Criteria

6.1. Entering spotlight on a venue that is not the current Active_Venue
SHALL reuse the existing "fly to Active_Venue on change" effect (via
`moveCameraToActive`, Sheet_Focus_Offset and Reduced_Motion honoured). No
new camera code path. The move preserves the user's current zoom, matching
the map-carousel "preserve the user's zoom" contract; spotlight is a lens,
not a zoom action.

6.2. Entering spotlight on the already-active venue SHALL NOT move the
camera (the venue was framed when it was selected; the user may have
deliberately repositioned since, and yanking the camera on a hold would
punish inspection).

6.3. Exiting spotlight SHALL NOT move the camera (except when the exit came
from the Recenter tap, whose own recenter fly-to proceeds as normal).

---

## Requirement 7: Exit conditions

Spotlight ends on any of the following. All exits go through
`exitSpotlight()` (or `dismiss`/`toggleOpen`, which clear the state per
R1.3); there is no second exit mechanism.

### Acceptance Criteria

7.1. **Zoom-out**: when the user zooms out by at least
`SPOTLIGHT_EXIT_ZOOM_DELTA` (new constant in `carouselConstants.ts`,
value 1.5) below the zoom recorded at spotlight entry, OR the zoom crosses
below `MIN_MARKER_ZOOM` (entering Constellation, R8), spotlight exits. The
decision is the pure predicate
`shouldExitSpotlight(entryZoom, currentZoom, delta)` in
`carouselConstants.ts`.

7.2. The zoom-out evaluation SHALL run only on user-gesture zoom events
(`e.originalEvent` present), mirroring the existing `moveend` guard in
`MapScreen`. This is load-bearing: the 3D fly-through arc dips the camera
by `FLY_THROUGH_ZOOM_DIP` (2.2) zoom levels mid-animation, which exceeds the
1.5 exit delta; evaluating programmatic zoom frames would false-exit the
spotlight during its own entry fly-to.

7.3. **Recenter**: tapping the Recenter control SHALL exit spotlight
(before or with the recenter fly-to), regardless of whether the recenter
itself proceeds (stale position).

7.4. **Carousel close**: `dismiss` (swipe-down, sheet close, check-in
success) and the Map-tab re-tap `toggleOpen` close branch clear the
spotlight (R1.3).

7.5. **Selecting a different venue**: any `selectVenue` with a different id
(search select, Focus_Signal consumption, filter reassignment) clears the
spotlight (R1.5). This closes the gap where the Search_Sheet or another
screen's Focus_Signal can target a venue whose marker is currently hidden:
the isolation lifts and the new selection proceeds normally on the full map.

7.6. On every exit, the full marker set and carousel order are restored by
the ordinary reconcile and recompute paths; the previously spotlit venue
remains the Active_Venue (R1.2).

---

## Requirement 8: Zoom-band gating (Constellation compliance)

Spotlight is a dot/glyph-tier affordance only.

### Acceptance Criteria

8.1. Spotlight SHALL NOT be enterable while `zoom < MIN_MARKER_ZOOM` (R2.4,
R3.4), and SHALL exit when the zoom crosses below `MIN_MARKER_ZOOM` (R7.1).

8.2. Rationale (binding): at Constellation zoom, `constellation-mode.md`
mandates the top-`RECOMMENDED_LIMIT` beams by `vibeRank` and the
`recommended` scope lock; the promise is "see the living city". A
single-beam sky would contradict that designed mode, so the isolation lens
and the constellation view never overlap. Beam interactions (tap to peek,
double-tap to commit-zoom, sweep to brush) are untouched by this spec.

8.3. Because spotlight cannot exist below `MIN_MARKER_ZOOM`, the
constellation beam cap and the spotlight filter never both apply; the
marker-membership rule stays single-sourced (R4.1) with the zoom-exit
effect guaranteeing the invariant.

---

## Requirement 9: Exit-hint affordance

The exit gesture must be discoverable without new chrome.

### Acceptance Criteria

9.1. While spotlit, the existing `WhisperChip` SHALL show a short hint (e.g.
"Spotlight on. Zoom out or recenter to exit", via i18n key
`map.spotlightHint`). The chip is already non-interactive, `aria-live`
polite, reduced-motion aware, and positioned above the carousel.

9.2. Sharing the chip is safe by construction: sweep whispers only occur at
Constellation zoom and spotlight only exists at or above `MIN_MARKER_ZOOM`,
so the two texts are mutually exclusive. Precedence in `MapScreen`:
`whisperText ?? spotlightHint`.

9.3. The hint clears the instant spotlight exits (text returns to null and
the chip fades out through its existing exit animation).

9.4. Copy follows the writing rules: no em dashes, no emojis, no
superlatives.

---

## Requirement 10: Steering compliance

10.1. **Discovery DNA**: spotlight changes marker membership on explicit
user intent only. `vibeRank` and every ranking surface are untouched;
proximity gains no weight anywhere.

10.2. **Map-carousel contract**: single selection source of truth holds
(all spotlight writes go through `selectionStore`); Browse_Mode stays
non-modal and the map stays fully interactive while spotlit; cards remain
selection-only (a long-press spotlights, it never opens Commit_Mode);
`notifyViewportChanged` stays wired to user `moveend` only.

10.3. **Honest presence**: no live-signal copy, count, or claim is added,
duplicated, or softened. Spotlight renders the same honest marker, card,
and detail surfaces that exist today.

10.4. **DRY / no-fallbacks**: one long-press core (`longPress.ts`), one
marker reconcile path, one camera helper, one exit mechanism through the
store. No `spotlight2`, no parallel renderer, no compatibility shim.

---

## Requirement 11: Testing

11.1. `selectionStore.test.ts` SHALL extend the existing fast-check
state-machine property with `enterSpotlight`/`exitSpotlight` operations and
assert invariants I1 and I2 (R1.4, R1.5) after every operation, plus:
`exitSpotlight` preserves `activeVenueId`; `dismiss` and `toggleOpen`
clear the spotlight.

11.2. `createLongPressHandlers` SHALL have unit and fast-check property
tests (tagged `Feature: spotlight-mode, Property N: <desc>`, min 100 runs,
block-statement predicates): fires only after the duration with no movement
past the tolerance; any cancel path (move, up, cancel, leave) before the
timer prevents firing; `didFire()` gates exactly the next click.

11.3. `shouldExitSpotlight` SHALL be property-tested as a pure predicate:
false for any `currentZoom >= MIN_MARKER_ZOOM` within the delta band; true
whenever `entryZoom - currentZoom >= delta` or
`currentZoom < MIN_MARKER_ZOOM`.

11.4. `useCarouselSelection` tests (existing harness with the map stub)
SHALL cover: order collapses to `[spotlightVenueId]` while set and restores
on exit; `notifyViewportChanged` is a no-op while spotlit; exit re-baselines
the viewport so the next `moveend` does not flip scope.

11.5. Marker-layer coverage: reconcile with a spotlight set renders exactly
one marker and exit restores the filtered set (extend the existing
`useMapMarkers` test files' approach).
