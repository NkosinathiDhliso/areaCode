# Design: Spotlight Mode (hold-to-isolate a venue)

## Overview

Spotlight_Mode isolates the map to one venue on a long-press (marker glyph
or Venue_Card), holds the isolation while the user inspects, and releases it
on zoom-out, Recenter, carousel close, or selecting a different venue. It is
built as a narrow membership filter over the existing selection, marker, and
carousel machinery, not as a new mode of any of them.

Naming: "Spotlight", never "focus". `focusNodeId` / Focus_Signal /
`openedFromFocus` / `SelectionSource = 'focus'` already mean cross-screen
navigate-to-a-venue; reusing the word would be ambiguous and violate
one-home-per-concept.

## Architecture at a glance

```
selectionStore  (packages/shared/stores/selectionStore.ts)
  + spotlightVenueId: string | null
  + enterSpotlight(id) / exitSpotlight()
  + clears in dismiss / toggleOpen-close / selectVenue(other id)
  + step() no-op while spotlit
        │  (single source of truth; every surface reads from here)
        ├── useMapMarkers        render set → [spotlightVenueId] when set
        ├── useCarouselSelection computeOrder → [spotlightVenueId];
        │                        notifyViewportChanged no-op; exit wrapper
        │                        re-baselines viewport + recomputes
        ├── MapScreen            entry-zoom ref + user-gesture zoom-exit
        │                        effect; Recenter exit; WhisperChip hint;
        │                        onGlyphLongPress wiring
        └── PeekCarousel         card long-press wiring

apps/web/src/lib/longPress.ts   (new) createLongPressHandlers - one pure
                                 hold-timer core for both triggers
apps/web/src/lib/carouselConstants.ts
  + SPOTLIGHT_DIVE_ZOOM = 16 (card-hold camera dive target)
  + SPOTLIGHT_EXIT_ZOOM_DELTA = 1.5
  + shouldExitSpotlight(entryZoom, currentZoom, delta) pure predicate
```

## Decisions, gaps filled, contradictions resolved

These were open or contradictory in the initial plan; each is now decided
and binding for the implementation.

| #   | Question / conflict                                                                                                                                      | Decision                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Enter zoom: fly to a fixed zoom or preserve zoom? (amended)                                                                                              | Split by trigger. Glyph hold: preserve the user's zoom, pan-only via the existing Active_Venue fly-to. Card hold: dive to `SPOTLIGHT_DIVE_ZOOM` (16), never zooming out (see D14).                                               | A glyph hold happens on the node itself, already framed at the user's chosen zoom; a card hold happens on the strip, away from the node, and reads as "take me there". The exit-delta baseline re-records after the dive settles (D11), so the release gesture stays consistent.                            |
| D2  | Spotlight at Constellation zoom (beam long-press)?                                                                                                       | Not offered. Spotlight exists only at `zoom >= MIN_MARKER_ZOOM`; crossing below exits it.                                                                                                                                        | `constellation-mode.md` mandates top-20 beams by `vibeRank` and the recommended scope lock at country zoom; a one-beam sky contradicts "see the living city". Beam tap/double-tap/sweep behaviour untouched.                                                                                                |
| D3  | Exit-hint affordance?                                                                                                                                    | Yes: reuse `WhisperChip` with `map.spotlightHint`.                                                                                                                                                                               | The chip already exists, is non-interactive, aria-live, and reduced-motion aware. Sweep whispers (< `MIN_MARKER_ZOOM`) and spotlight (>= `MIN_MARKER_ZOOM`) are mutually exclusive by zoom band, so sharing it adds no arbitration logic beyond `whisperText ?? spotlightHint`.                             |
| D4  | Long-press on the already-active venue moves the camera?                                                                                                 | Glyph hold: no camera move. Card hold: still dives (D14).                                                                                                                                                                        | For the glyph, `activeVenueId` does not change so the fly-to effect (keyed on change) does not fire, and re-framing would punish a user who deliberately repositioned. The card dive issues its own move, so it applies uniformly whether or not the venue was active.                                      |
| D5  | Search / Focus_Signal can select a venue whose marker is hidden while spotlit.                                                                           | `selectVenue` with a different id clears the spotlight in the store.                                                                                                                                                             | Navigating elsewhere is an exit intent. Doing it in the store (not per-caller) covers search, Focus_Signal, and the filter-reassignment path with one rule and keeps invariant I2 provable.                                                                                                                 |
| D6  | Step race: `setOrder([spotlightId])` lands asynchronously; a flick against the stale multi-venue order could move `activeVenueId` off the spotlit venue. | `step()` is a store-level no-op while `spotlightVenueId !== null`.                                                                                                                                                               | Closes the race without touching the recompute pipeline; while spotlit there is by definition nothing to step to.                                                                                                                                                                                           |
| D7  | 3D fly-through arc dips zoom by 2.2 (> exit delta 1.5) during the entry fly-to; naive zoom listeners would false-exit.                                   | Zoom-exit predicate is evaluated only on zoom events with `e.originalEvent` (user pinch/wheel), mirroring the existing user-gesture `moveend` guard in `MapScreen`.                                                              | Programmatic camera motion must never count as the user's release gesture.                                                                                                                                                                                                                                  |
| D8  | Haptics API.                                                                                                                                             | Shared `haptic()` from `packages/shared/lib/haptics.ts`, not raw `navigator.vibrate`.                                                                                                                                            | It is the existing single home (BottomNav uses it) and already handles support gating.                                                                                                                                                                                                                      |
| D9  | Movement-cancel tolerance for the hold.                                                                                                                  | Reuse `DRAG_AXIS_THRESHOLD` (8 px) as the default tolerance in `createLongPressHandlers`.                                                                                                                                        | Once movement reads as a drag by the app's own gesture standard, it is not a hold; no second magic number.                                                                                                                                                                                                  |
| D10 | Fold `BottomNav`'s hold timer onto the new core now?                                                                                                     | No. `BottomNav` keeps its React-local version; adopting the shared core there is a flagged follow-up, out of scope.                                                                                                              | Keeps this change focused; the nav's timer is coupled to its click/navigate suppression and works.                                                                                                                                                                                                          |
| D11 | Where is the entry zoom recorded?                                                                                                                        | A `MapScreen` ref, captured on the `spotlightVenueId` null-to-id transition, then re-recorded whenever a programmatic zoom settles while spotlit (`zoomend` without `originalEvent`).                                            | The store stays pure and map-free; the map read belongs to the screen that owns the map instance. The re-baseline makes the exit delta measure from wherever the camera settled (the card-hold dive raises zoom after entry; measuring from the pre-dive zoom would demand a 4+ level zoom-out to release). |
| D12 | Scope baseline after exit.                                                                                                                               | The `useCarouselSelection`-exposed `exitSpotlight` wrapper calls the store action, then `snapshotViewport()` + `recomputeOrder()` (the `showRecommended` pattern).                                                               | Panning done while spotlit must not retroactively flip the browse scope to `area` the instant isolation lifts (R5.4).                                                                                                                                                                                       |
| D13 | Spotlight vs Commit_Mode.                                                                                                                                | Independent. A spotlit venue can open Commit_Mode; check-in success dismisses the carousel, which clears the spotlight (R1.3).                                                                                                   | Spotlight is map membership, mode is sheet state; coupling them would add transitions with no user value.                                                                                                                                                                                                   |
| D14 | Card-hold dive: one camera move, not two.                                                                                                                | `enterSpotlight(id, { dive: true })` in the hook issues the `moveCameraToActive` call itself with `zoom = max(currentZoom, SPOTLIGHT_DIVE_ZOOM)` and advances `prevActiveRef` to mark the Active_Venue change as camera-handled. | Without the mark, the fly-to-on-change effect would fire a second, zoom-less move after render and cancel the dive mid-flight. `max()` guarantees the dive never zooms out on a user who is already closer than the dive zoom.                                                                              |

## State model (selectionStore)

```ts
/** The venue isolated on the map (Spotlight_Mode), or null. All other
 *  markers are hidden while set. Independent of mode; a spotlight can be
 *  held in Browse or Commit. Invariants: mode === 'closed' implies null;
 *  non-null implies it equals activeVenueId. */
spotlightVenueId: string | null
/** Enter Spotlight_Mode: isolate the map to `id` and make it the
 *  Active_Venue (selectVenue shape: sets lastVenueId, opens Browse when
 *  closed, openedFromFocus = false). */
enterSpotlight: (id: string) => void
/** Exit Spotlight_Mode, restoring the full marker set. The venue stays
 *  selected (activeVenueId, mode, lastVenueId unchanged). */
exitSpotlight: () => void
```

Mutations to existing actions:

- `dismiss` and `toggleOpen` (close branch): `state.spotlightVenueId = null`.
- `selectVenue(id, source)`: `if (id !== state.spotlightVenueId)
state.spotlightVenueId = null` before the normal body.
- `step`: `if (state.spotlightVenueId !== null) return` at the top.

## Long-press core (`apps/web/src/lib/longPress.ts`, new)

Pure, DOM-event-shaped, no React:

```ts
interface LongPressOptions {
  durationMs?: number      // default LONG_PRESS_MS = 500
  moveTolerancePx?: number // default DRAG_AXIS_THRESHOLD
  onLongPress: (e: PointerEvent) => void
}
interface LongPressHandlers {
  onPointerDown / onPointerMove / onPointerUp /
  onPointerCancel / onPointerLeave / onContextMenu
  didFire(): boolean // true exactly once for the click after a fired hold
}
export function createLongPressHandlers(opts: LongPressOptions): LongPressHandlers
```

Semantics (property-tested): the timer starts on pointer-down; any of move
past tolerance, up, cancel, or leave before `durationMs` cancels with no
action; on fire the callback runs once and `didFire()` returns true for
exactly the next click query (used to suppress the synthetic click that
follows a touch hold). `onContextMenu` prevents default so touch holds do
not open the browser menu. Timer injection (`setTimeout`-compatible) keeps
it testable with fake timers.

Consumers: `useMapMarkers` (attach to `glyphHit` alongside the existing
listeners) and `PeekCarousel` (compose into its container pointer handlers,
resolving the card id from `closest('[data-venue-card]')`). `BottomNav` is
NOT migrated (D10).

## Marker filtering (`useMapMarkers.ts`)

- Subscribe: `const spotlightVenueId = useSelectionStore((s) => s.spotlightVenueId)`
  (first `selectionStore` read in this hook; it already subscribes to
  `mapStore` and `userStore`). Add to the reconcile effect's dep array.
- In `addMarkers`, after the category filter:
  `const visible = spotlightVenueId ? filtered.filter((n) => n.id === spotlightVenueId) : filtered`
  and use `visible` for `vibeRank` input, `filteredIds`, and the add loop.
  The existing removal loop then tears down every non-member marker on
  enter and rebuilds on exit. One reconcile path.
- New extra on `MapMarkerExtras`: `onGlyphLongPress?: (node: Node) => void`,
  held in a ref like `onCommitZoomRef`, passed into `buildMarkerElement`,
  wired to `glyphHit` via `createLongPressHandlers`. The fired-hold flag
  suppresses the `glyphHit` click listener's `onTap()`.
- The beam cap (`constellationVisibleIds`) and the spotlight filter never
  co-apply: spotlight cannot exist below `MIN_MARKER_ZOOM` (zoom-exit
  effect). The filter is still applied unconditionally as written, so even
  a single-frame overlap during the exit transition renders safely.

## Carousel scoping (`useCarouselSelection.ts`)

- `computeOrder`: first line
  `const spotlightId = useSelectionStore.getState().spotlightVenueId;
if (spotlightId) return [spotlightId]`.
- `notifyViewportChanged`: early-return while spotlit (before the
  constellation branch).
- Exposed `exitSpotlight` wrapper: store `exitSpotlight()`, then
  `snapshotViewport()`, then `recomputeOrder()` (D12).
- Exposed `enterSpotlight(id, opts?: { dive?: boolean })`: calls the store
  action; with `dive: true` (the card hold) it also issues the camera dive
  itself via `moveCameraToActive` with
  `zoom = max(currentZoom, SPOTLIGHT_DIVE_ZOOM)` and advances
  `prevActiveRef` so the fly-to-on-change effect does not fire a second,
  zoom-less move that would cancel the dive (D14). Without `dive` it is a
  plain store passthrough (R1.7).
- Expose `spotlightVenueId` on the result (R1.7).

## Camera (one helper, trigger-split intent)

Glyph-hold enter reuses the existing "fly to Active_Venue on change" effect:
because `enterSpotlight` sets `activeVenueId`, a spotlight on a non-active
venue flies exactly like a card tap, preserving the user's zoom (the effect
omits `zoom` above `MIN_MARKER_ZOOM`); a glyph hold on the already-active
venue does not move the camera (D4). Card-hold enter dives to
`SPOTLIGHT_DIVE_ZOOM` through the same `moveCameraToActive` helper, never
zooming out, active or not (D1, D14). Exit never moves the camera; the
Recenter exit's own fly-to proceeds as normal.

## Exits (`MapScreen.tsx`)

- **Entry zoom ref**: an effect watching `spotlightVenueId`; on null-to-id,
  record `map.getZoom()`. While spotlit, a programmatic zoom settle
  (`zoomend` without `originalEvent`, i.e. the card-hold dive arriving)
  re-records the baseline, so the exit delta always measures from where the
  camera settled (D11).
- **Zoom-out**: `map.on('zoom', handler)` while spotlit; handler ignores
  events without `originalEvent` (D7) and calls the wrapped
  `exitSpotlight()` when
  `shouldExitSpotlight(entryZoomRef.current, map.getZoom(), SPOTLIGHT_EXIT_ZOOM_DELTA)`.

```ts
// carouselConstants.ts (pure)
export const SPOTLIGHT_DIVE_ZOOM = 16
export const SPOTLIGHT_EXIT_ZOOM_DELTA = 1.5
export function shouldExitSpotlight(
  entryZoom: number,
  currentZoom: number,
  delta: number = SPOTLIGHT_EXIT_ZOOM_DELTA,
): boolean {
  return currentZoom < MIN_MARKER_ZOOM || entryZoom - currentZoom >= delta
}
```

- **Recenter**: wrap `MapControls`' `onRecenter` to call `exitSpotlight()`
  then `recenterUser()`.
- **Close / other selection**: handled inside the store (R1.3, R1.5).

## Trigger wiring (`MapScreen.tsx`, `PeekCarousel.tsx`)

- `MapScreen` passes
  `onGlyphLongPress: (node) => { if (zoom >= MIN_MARKER_ZOOM) { selection.enterSpotlight(node.id); haptic(8) } }`
  into `useMapMarkers` extras (zoom read via the map instance at fire time).
- `PeekCarousel` composes the long-press handlers into its existing
  `onPointerDown`/`onPointerUp`/`onPointerCancel` (adding `onPointerMove`
  for the movement cancel), gated on `mode === 'browse'` and a
  `[data-venue-card]` target. On fire it calls
  `enterSpotlight(id, { dive: true })` so the camera dives into the venue
  (D14). `onCardSelect` checks `didFire()` before running `selectVenue`, so
  a hold never doubles as a select. The swipe path needs no guard: a fired
  hold implies sub-tolerance movement, which `classifyDrag` already reads
  as `indeterminate`.

## Hint chip

`MapScreen` renders
`<WhisperChip text={whisperText ?? (spotlightVenueId ? t('map.spotlightHint', 'Spotlight on. Zoom out or recenter to exit') : null)} />`.
Mutually exclusive by zoom band (D3); chip fades via its existing exit
animation when the text returns to null.

## Testing strategy

Per `tech.md`: pure cores get fast-check property tests
(`Feature: spotlight-mode, Property N: <desc>`, min 100 runs, block-statement
predicates); component/hook tests opt into jsdom per file; stores driven via
`setState` and reset in `beforeEach`; the map is the existing in-memory stub.

1. **Store state machine** (extend `selectionStore.test.ts`): add
   `enterSpotlight`/`exitSpotlight` to the op arbitrary; assert I1
   (`closed` implies no spotlight) and I2 (spotlight equals active) after
   every op; plus unit cases for exit preserving the selection and
   dismiss/toggle clearing.
2. **Long-press core** (`longPress.test.ts`, fake timers): fire/cancel
   properties over arbitrary event sequences and durations; `didFire()`
   single-shot gating.
3. **Exit predicate** (`carouselConstants` tests): `shouldExitSpotlight`
   totality and threshold properties.
4. **Selection hook** (existing harness): spotlit order collapse/restore,
   `notifyViewportChanged` no-op, exit re-baseline.
5. **Marker layer** (existing `useMapMarkers` test approach): one marker
   while spotlit, full set restored on exit.

## Out of scope (flagged follow-ups)

- Migrating `BottomNav` onto `createLongPressHandlers` (D10).
- Any spotlight affordance at Constellation zoom (D2 decides against; a
  future spec may revisit only with a constellation-mode.md amendment).
- Mobile app (Expo) parity: `apps/mobile` is paused; the store change is
  shared and forward-compatible, the DOM long-press core is web-only by
  design.
