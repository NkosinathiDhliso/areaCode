# Implementation Plan: Spotlight Mode

## Overview

Hold-to-isolate a venue: long-press a glyph or a Venue_Card to filter the
map to that one venue, exit on zoom-out, Recenter, carousel close, or
selecting a different venue. All work composes with the existing selection,
marker, and carousel machinery; no new stores, no new camera paths, no new
infra. Tasks marked `*` are the deferred test tasks per house convention.

## Tasks

- [x] 1. Selection_Model: spotlight state
     (`packages/shared/stores/selectionStore.ts`)
  - [x] 1.1 Add `spotlightVenueId: string | null` plus `enterSpotlight(id)`
        (selectVenue shape: sets active + last, opens Browse when closed,
        `openedFromFocus = false`) and `exitSpotlight()` (clears spotlight
        only, selection preserved)
  - [x] 1.2 Clear `spotlightVenueId` in `dismiss` and the close branch of
        `toggleOpen`
  - [x] 1.3 `selectVenue`: clear the spotlight when the selected id differs
        from `spotlightVenueId`
  - [x] 1.4 `step`: no-op while `spotlightVenueId !== null` (stale-order
        race guard, design D6)
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 7.4, 7.5_

- [x] 2. Constants and pure exit predicate
     (`apps/web/src/lib/carouselConstants.ts`)
  - Add `SPOTLIGHT_EXIT_ZOOM_DELTA = 1.5` and
    `shouldExitSpotlight(entryZoom, currentZoom, delta)` (true when
    `currentZoom < MIN_MARKER_ZOOM` or `entryZoom - currentZoom >= delta`)
  - _Requirements: 7.1, 8.1_

- [x] 3. Long-press core (`apps/web/src/lib/longPress.ts`, new)
  - `createLongPressHandlers({ durationMs = 500, moveTolerancePx =
DRAG_AXIS_THRESHOLD, onLongPress })` returning pointer + contextmenu
    handlers and a single-shot `didFire()` click gate; pure, DOM-event
    shaped, timer-injectable. Do NOT migrate `BottomNav` (design D10)
  - _Requirements: 2.1, 2.3, 2.5, 2.6, 3.1_

- [x] 4. Carousel scoping (`apps/web/src/hooks/useCarouselSelection.ts`)
  - [x] 4.1 `computeOrder`: short-circuit to `[spotlightVenueId]` while set
  - [x] 4.2 `notifyViewportChanged`: early-return while spotlit
  - [x] 4.3 Expose `spotlightVenueId`, `enterSpotlight` (passthrough), and a
        wrapped `exitSpotlight` (store exit, then `snapshotViewport()` +
        `recomputeOrder()`) on the hook result
  - _Requirements: 1.7, 5.1, 5.2, 5.4_

- [x] 5. Marker isolation + glyph trigger
     (`apps/web/src/hooks/useMapMarkers.ts`)
  - [x] 5.1 Subscribe to `spotlightVenueId`; in `addMarkers` narrow the
        membership set to the spotlit venue when set (same reconcile,
        removal, and add loops); add to the effect deps
  - [x] 5.2 Add `onGlyphLongPress?: (node: Node) => void` to
        `MapMarkerExtras` (ref-held like `onCommitZoomRef`); wire
        `createLongPressHandlers` onto `glyphHit` in `buildMarkerElement`;
        fired hold suppresses the glyph click's `onTap`
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 4.1, 4.2, 4.4_

- [x] 6. Card trigger (`apps/web/src/components/PeekCarousel.tsx`)
  - Compose the long-press core into the container pointer handlers (add
    `onPointerMove` for movement cancel); Browse_Mode only; resolve the
    venue from `closest('[data-venue-card]')`; `enterSpotlight(id)` +
    `haptic()` on fire; `onCardSelect` checks `didFire()` so a hold never
    also selects
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 7. Screen wiring: enter, exits, hint
     (`apps/web/src/screens/MapScreen.tsx`)
  - [x] 7.1 Pass `onGlyphLongPress` into `useMapMarkers` extras, gated on
        live zoom `>= MIN_MARKER_ZOOM`, with `haptic()`
  - [x] 7.2 Entry-zoom ref: record `map.getZoom()` on the
        `spotlightVenueId` null-to-id transition
  - [x] 7.3 Zoom-out exit effect: `map.on('zoom', ...)` while spotlit,
        evaluate `shouldExitSpotlight` only when `e.originalEvent` is
        present (fly-through arc guard, design D7), call the wrapped
        `exitSpotlight`
  - [x] 7.4 Recenter exit: wrap `MapControls` `onRecenter` to
        `exitSpotlight()` then `recenterUser()`
  - [x] 7.5 Hint chip: `WhisperChip` text becomes
        `whisperText ?? spotlightHint` with new i18n key
        `map.spotlightHint` ("Spotlight on. Zoom out or recenter to exit")
  - _Requirements: 2.4, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 8.1, 9.1, 9.2, 9.3_

- [x] 8. Verification pass
  - `pnpm typecheck`, `pnpm test`, `pnpm lint`; manual sweep of the
    steering invariants: no ranking change, non-modal browse intact,
    constellation beams untouched at country zoom
  - _Requirements: 8.2, 8.3, 10.1, 10.2, 10.3, 10.4_

- [x] 9. Tests
  - [x] 9.1 Extend `selectionStore.test.ts` state-machine property with
        spotlight ops; assert I1 and I2 after every op; unit cases for
        exit-preserves-selection and dismiss/toggle clearing
  - [x] 9.2 `longPress.test.ts` property tests (fake timers): fire only
        after duration with sub-tolerance movement; every cancel path;
        `didFire()` single-shot gate. Tagged
        `Feature: spotlight-mode, Property N`
  - [x] 9.3 `shouldExitSpotlight` property tests (threshold and
        constellation-floor behaviour)
  - [x] 9.4 `useCarouselSelection` harness: order collapse/restore,
        viewport-change no-op while spotlit, exit re-baseline
  - [x] 9.5 Marker-layer test: exactly one marker while spotlit, full
        filtered set restored on exit
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 10. Card-hold camera dive (amendment: D1/D4/D11/D14, R6.4, R6.5, R7.2.1)
  - [x] 10.1 Add `SPOTLIGHT_DIVE_ZOOM = 16` to `carouselConstants.ts`
  - [x] 10.2 `useCarouselSelection.enterSpotlight(id, opts?: { dive?: boolean })`:
        with `dive`, fly via `moveCameraToActive` at
        `max(currentZoom, SPOTLIGHT_DIVE_ZOOM)` (never zoom out) and advance
        `prevActiveRef` so the fly-to-on-change effect does not issue a
        second, zoom-less move
  - [x] 10.3 `PeekCarousel` card hold passes `{ dive: true }`; glyph hold
        unchanged (pan-only, preserve zoom)
  - [x] 10.4 `MapScreen`: re-baseline the spotlight entry zoom on
        programmatic `zoomend` (no `originalEvent`) so the zoom-out exit
        delta measures from where the dive settled
  - [ ]\* 10.5 Harness test: dive flies with `zoom = max(current, 16)` and
    the fly-to-on-change effect issues no second move
  - _Requirements: 6.4, 6.5, 7.2.1_
