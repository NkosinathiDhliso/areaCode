# Implementation Plan: Map Camera and Gesture Feel

## Overview

Fixes the reported pitch snap-back and zoom jank at their interaction-layer
roots (done), then closes the adjacent camera/gesture gaps found in the audit.
All work edits the existing hooks in place; no new stores, no new infra.

## Tasks

- [x] 1. Sticky manual pitch + animation-safe ramp (`useMapInit.ts`)
  - [x] 1.1 Add `manualPitchOffsetRef`; capture `pitch - pitchForZoom(zoom)` on
        manual `pitchend`; guard capture on `manualPitchRef` so programmatic
        eases never recapture
  - [x] 1.2 Ramp target = `clamp(pitchForZoom(zoom) + offset, PITCH_FLAT, MAX_PITCH)`
  - [x] 1.3 Move ramp application from per-`zoom` `setPitch` to `zoomend`
        `easeTo(450ms)`, skip within 1 degree
  - [x] 1.4 Reset the offset in `setPitch3D` (mode toggle re-baseline)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3_

- [x] 2. Quantise compass bearing state (`useMapInit.ts`)
  - Round to whole degrees, functional update only on change
  - _Requirements: 4.1_

- [x] 3. Frame-budget marker layer (`useMapMarkers.ts`)
  - [x] 3.1 Quantise `mapZoom` React state to 0.25 steps (functional update)
  - [x] 3.2 Gate the per-marker tier/blend/animation restyle behind
        `el.dataset.presentationKey` (tier | dim | blend@0.05); keep only
        `applyZoomScale` per frame
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Reduced-motion parity
  - [x] 4.1 Shared cached `reducedMotion()` helper (matchMedia + change listener)
  - [x] 4.2 Duration 0 for the pitch ramp, 3D toggle, `resetNorth`,
        `recenterUser` when set; replace markerBeam's per-call matchMedia reads
  - _Requirements: 5.1, 5.2_

- [x] 5. Consolidate camera constants
  - [x] 5.1 Import `USER_VIEW_ZOOM` from `cameraControl.ts` in `useMapInit.ts`
        and `MapScreen.tsx`; delete the local copies
  - [x] 5.2 `MapControls.tsx` imports `POSITION_FRESHNESS_WINDOW`; delete
        `LAST_KNOWN_POSITION_FRESHNESS_MS`
  - _Requirements: 6.1, 6.2_

- [x] 6. Device-tier render budget (`useMapInit.ts`)
  - One synchronous heuristic at init; low tier drops antialias, cast shadows,
    and terrain exaggeration; interaction model identical across tiers
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 7. Constellation sweep whisper (`useConstellationSweep.ts` + MapScreen)
  - Magnet whisper chip for the brushed beam (belonging > momentum > aliveness
    copy, honest-presence compliant); dismiss on pointerup
  - _Requirements: 8.1, 8.2_

- [x] 8. Pointer-only zoom controls (`MapControls.tsx`)
  - `zoomIn`/`zoomOut` buttons in the glass cluster, 44px targets, hidden on
    small viewports
  - _Requirements: 9.1_

- [x] 9. Property test: sticky pitch offset
  - **Property: for any zoom sequence and any manual offset, the ramp target
    always equals `clamp(pitchForZoom(z) + offset, 0, 85)` and never jumps
    while a manual gesture is in progress** (extract `pitchForZoom` + target
    computation into a pure helper first)
  - _Validates: Requirements 1.1, 1.2, 1.5_

- [x] 10. Property test: presentation-key gating
  - **Property: for any zoom walk, the keyed restyle fires iff
    (tier, dim, blend@0.05) changed, and tier flips are never missed**
  - _Validates: Requirements 3.2, 3.3_

- [x] 11. Non-modal Browse strip (`BottomSheet.tsx`, `PeekCarousel.tsx`)
  - [x] 11.1 `modal` prop on `BottomSheet` (default true): non-modal renders no
        backdrop, passes pointer events through, skips focus trap and
        autofocus, omits `aria-modal`; Escape still dismisses
  - [x] 11.2 `PeekCarousel` passes `modal={mode === 'commit'}` so Browse_Mode
        and the Constellation peek leave the map interactive while Commit_Mode
        stays a modal takeover
  - [x] 11.3 Record the invariant in `rules/map-carousel.md` (synced)
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
