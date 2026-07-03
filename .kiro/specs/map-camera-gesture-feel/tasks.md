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

- [x] 12. Motion signature at full depth (`cameraEasing.ts`, `cameraControl.ts`,
      `useMapInit.ts`, `MapScreen.tsx`)
  - [x] 12.1 Add `cameraMotion(ms: number)` to `cameraEasing.ts` returning
        `{ duration: reducedMotion() ? 0 : ms, easing: cameraEasing }`; replace
        the inline tuple at all six call sites (useMapInit: setPitch3D,
        resetNorth, recenterUser, zoom-pitch ramp; MapScreen: handleZoomIn,
        handleZoomOut)
  - [x] 12.2 Apply the shared motion to `moveCameraToActive` and
        `recenterIfFresh` in `cameraControl.ts` (keep `moveCameraToActive`'s
        exactly-one-flyTo contract and its reduced-motion zero-duration rule)
        and to `handleEnableLocation`'s flyTo in `MapScreen.tsx`
  - [x] 12.3 Forward `easing` through the `MapInstance` adapter: add it to the
        `MapInstance.flyTo` option type in `packages/shared/types` and pass it
        through `buildMapInstance` in `useMapInit.ts` (today it is silently
        dropped, so the store-driven fly-tos can never carry the curve)
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 13. One home for easeOutCubic
  - Replace the inline `1 - Math.pow(1 - p, 3)` in
    `apps/web/src/components/CheckInCelebration.tsx` (count-up easing, ~line 56) with an import of `easeOutCubic` from `../lib/cameraEasing`
  - _Requirements: 11.4_

- [x] 14. WhisperChip correctness and cost (`WhisperChip.tsx`,
      `MapScreen.test.tsx`)
  - [x] 14.1 Tighten visibility: `const visible = text != null && text !== ''`
        so undefined/empty text never renders a visible empty chip
  - [x] 14.2 Replace the `displayText` state + effect + unread `lastTextRef`
        with a render-time ref: `if (visible) lastShown.current = text`,
        render `text ?? lastShown.current ?? ''` (removes the extra render per
        pointermove-driven text change and the dead ref)
  - [x] 14.3 Add `visibility: hidden` while faded out (include `visibility` in
        the transition with a delay matching the 180ms fade) so the invisible
        backdrop-blur layer stops compositing over the WebGL canvas
  - [x] 14.4 Update the `useConstellationSweep` mock in
        `apps/web/src/screens/__tests__/MapScreen.test.tsx` (~line 63) to
        return `{ brushedNodeId: null, whisperText: null }`
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 15. Lint and wording cleanup
  - [x] 15.1 Fix the three `import/order` warnings in `MapScreen.tsx`
        (lib imports at lines 32-34 placed among hook imports; eslint --fix)
  - [x] 15.2 Rename the `cameraEasing.test.ts` case "progress is ahead of
        linear in the first half" to "...at every interior point" to match the
        assertion range [0.01, 0.99]
  - _Requirements: 12.5_
