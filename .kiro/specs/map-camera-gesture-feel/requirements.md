# Requirements: Map Camera and Gesture Feel

## Introduction

An audit of the consumer map interaction stack (useMapInit, useMapMarkers,
useCarouselSelection, useConstellationSweep, MapControls, cameraControl,
markerBeam, markerPresentation) found the root causes of two reported UX
failures and a set of adjacent gaps.

Reported failures:

1. A two-finger tilt toward the horizon snapped back to the top-down view on
   the next swipe. Cause: the zoom-driven pitch ramp re-applied
   `pitchForZoom(zoom)` on every `zoom` event, and manual pitch was only
   respected while the tilt gesture was literally in progress. Any zoom event
   after release (a pinch component of a two-finger swipe, wheel, inertia)
   overwrote the user's pitch instantly.
2. Zooming felt rough. Causes: (a) the ramp used `map.setPitch`, which is
   `jumpTo` under the hood and stops any in-flight camera animation, so it
   aborted wheel-zoom easing and selection fly-tos every frame (the same bug
   class map-carousel.md records for `setBearing`); (b) `useMapMarkers` pushed
   raw zoom into React state per frame, re-running the full marker-reconcile
   effect (vibeRank sort, per-marker DOM writes, per-marker React renders) on
   every zoom frame, plus a per-frame querySelector and style-rewrite fan-out
   across all markers; (c) the `rotate` handler re-rendered the MapScreen tree
   per frame.

This spec fixes the interaction-layer causes and closes the adjacent gaps so
the camera always preserves user intent and gesture rendering stays inside the
frame budget on a mid-range Android phone.

#[[.kiro/steering/constellation-mode.md]] #[[.kiro/steering/map-carousel.md]] #[[apps/web/src/hooks/useMapInit.ts]] #[[apps/web/src/hooks/useMapMarkers.ts]]

---

## Requirement 1: Manual pitch is preserved (no snap-back)

A deliberate two-finger tilt SHALL survive subsequent zooms, pans, and swipes.
The zoom-driven pitch ramp remains (street-level immersion), but it preserves
the user's chosen tilt as a sticky offset instead of overwriting it.

### Acceptance Criteria

1.1. When a user-gesture pitch ends, the system SHALL capture
`offset = actualPitch - pitchForZoom(zoom)` and apply
`clamp(pitchForZoom(zoom) + offset, PITCH_FLAT, MAX_PITCH)` as the ramp target
on later zooms.

1.2. A manual tilt to the horizon followed by any zoom SHALL leave the camera
within a few degrees of the user's chosen pitch, never snapped back to the
un-offset ramp value.

1.3. Only gestures carrying `originalEvent` count as manual; programmatic
pitch eases SHALL NOT recapture the offset.

1.4. The 3D/2D toggle SHALL reset the offset to 0 (a deliberate re-baseline).

1.5. While a manual pitch gesture is in progress the ramp SHALL NOT apply.

## Requirement 2: The pitch ramp never aborts camera animations

`setPitch`/`setBearing`/`jumpTo` stop in-flight camera animations. No
per-frame handler may call them while a zoom, fly-to, or ease is animating.

### Acceptance Criteria

2.1. The pitch ramp SHALL apply on `zoomend` via `easeTo`, never per `zoom`
frame via `setPitch`.

2.2. Selection fly-tos and wheel-zoom easing SHALL complete without being
cancelled by the ramp.

2.3. The ramp SHALL skip when the target is within 1 degree of the current
pitch (no needless animations).

## Requirement 3: Zoom stays inside the frame budget

Continuous zoom (pinch or wheel) SHALL NOT trigger per-frame React renders or
per-frame full marker restyles.

### Acceptance Criteria

3.1. The marker layer's React zoom state SHALL be quantised (0.25 zoom steps)
so the marker-reconcile effect (vibeRank + marker rebuild + glyph renders)
runs at most once per step, never per frame.

3.2. Per-frame imperative work per marker SHALL be limited to the scale
transform. The tier/blend/animation restyle fan-out SHALL re-apply only when
its inputs (tier, dim state, blend quantised to 0.05) change.

3.3. Marker presentation behaviour at tier thresholds (beam/dot/glyph flips,
beam cap membership) SHALL be unchanged by the quantisation.

## Requirement 4: Rotation does not re-render the screen tree per frame

4.1. The compass bearing state SHALL be quantised to whole degrees; a rotate
gesture re-renders MapScreen at most once per degree changed.

## Requirement 5: Reduced-motion parity for camera moves

`moveCameraToActive` honours `prefers-reduced-motion`; the useMapInit camera
moves do not.

### Acceptance Criteria

5.1. When `prefers-reduced-motion: reduce` is set, the pitch ramp, the 3D/2D
toggle ease, `resetNorth`, and `recenterUser` SHALL use duration 0.

5.2. `markerBeam` SHALL read the reduced-motion media query once (cached with
a change listener), not per marker per restyle.

## Requirement 6: One home for camera constants

6.1. `USER_VIEW_ZOOM` SHALL exist once (today it is declared in
`cameraControl.ts`, `useMapInit.ts`, and `MapScreen.tsx`).

6.2. The 60s position-freshness window SHALL exist once
(`POSITION_FRESHNESS_WINDOW`; `MapControls.tsx` re-declares it as
`LAST_KNOWN_POSITION_FRESHNESS_MS`).

## Requirement 7: Render cost fits a mid-range Android

The "4D" stack (terrain DEM, globe projection, cast shadows, flood light,
antialias) is GPU-heavy. Constellation-mode requires the map to work on a
mid-range Android without overwhelming spectacle or battery drain.

### Acceptance Criteria

7.1. A device-tier heuristic (e.g. `devicePixelRatio`, WebGL renderer string,
`navigator.hardwareConcurrency`) SHALL gate the expensive extras: cast
shadows, terrain exaggeration, antialias.

7.2. Low-tier devices SHALL keep the full interaction model (markers, beams,
selection); only cosmetic layers tier down.

7.3. The tiering decision SHALL be honest and one-path (no runtime FPS
polling loop that flip-flops layers).

## Requirement 8: Constellation sweep completes Phase C

8.1. A sweep across beams SHALL show the one-line magnet whisper
(constellation-mode "magic on intent"); today only brightness and the optional
haptic tick are wired.

8.2. Sweep SHALL be discriminated from globe pan per the constellation-mode
decision 4 (axis threshold via `classifyDrag` is in place; the whisper and the
pan/sweep coexistence rules need explicit treatment).

## Requirement 9: Pointer-only zoom affordance

9.1. Desktop and pointer-only users SHALL have on-screen zoom in/out controls
(44px targets, styled to the existing glass control cluster), since pinch is
unavailable and wheel zoom is undiscoverable for some users. Mobile layouts
MAY hide them.

## Requirement 10: The Browse strip never blocks the map

Reported: the app is not interactive while the carousel is open. Cause: the
shared `BottomSheet` is unconditionally modal (full-screen `inset: 0` wrapper
with a backdrop that swallows every pointer event and a focus trap). Since the
cold open auto-opens Browse_Mode, the map was effectively never interactive.
This also made the `area` browse scope unreachable: it is entered only by a
meaningful user pan/zoom on the map, which the backdrop made impossible. This
is a defect, not a persuasion mechanic.

### Acceptance Criteria

10.1. `BottomSheet` SHALL support a non-modal mode: no backdrop, pointer
events pass through everywhere above the sheet panel, no focus trap, no
autofocus, no `aria-modal`. Escape SHALL still dismiss.

10.2. Browse_Mode and the Constellation peek SHALL render non-modal; the map
behind them SHALL accept pan, zoom, rotate, pitch, and marker taps.

10.3. Commit_Mode SHALL remain a modal takeover (backdrop, focus trap,
tap-outside dismiss), including the lighter `transparentBackdrop` variant for
Focus_Signal opens.

10.4. Every other `BottomSheet` consumer (search, sign-in, QR scanner,
directions, notification priming) SHALL remain modal by default.

10.5. With the strip open, a user pan or zoom past the existing thresholds
SHALL flip the browse scope to `area` (the previously dead path).

## Requirement 11: One motion signature, applied at full depth

`cameraEasing.ts` promises every camera move shares the same motion signature,
but a code review found it applied at only some call sites while the module
that centralises camera moves (`cameraControl.ts`) never receives it, and the
`{ duration: reducedMotion() ? 0 : N, easing: cameraEasing }` tuple is
copy-pasted at six call sites.

### Acceptance Criteria

11.1. A single `cameraMotion(ms)` helper (in `cameraEasing.ts`) SHALL build
the shared animation options (`duration` honouring reduced motion, `easing`),
and every camera-move call site SHALL consume it instead of inlining the
tuple.

11.2. `moveCameraToActive` (the selection fly-to) and `recenterIfFresh` in
`cameraControl.ts`, and `handleEnableLocation`'s fly-to in `MapScreen.tsx`,
SHALL use the shared easing like every other camera move.

11.3. The `MapInstance` adapter (`buildMapInstance` in `useMapInit.ts`) SHALL
forward an `easing` option to `map.flyTo` instead of silently dropping it,
and the `MapInstance` type SHALL accept it.

11.4. `easeOutCubic` SHALL have one home: `CheckInCelebration.tsx` (inline
`1 - Math.pow(1 - p, 3)` at its count-up) SHALL import it from
`cameraEasing.ts` per `dry-reuse-no-duplication.md`.

## Requirement 12: WhisperChip correctness and cost

The exit-fade enhancement loosened the visibility check and over-built the
retained-text mechanism.

### Acceptance Criteria

12.1. The chip SHALL be hidden for `null`, `undefined`, and empty-string
text (`text != null && text !== ''`), never rendering a visible empty chip.

12.2. The retained last copy SHALL be derived without extra renders: assign a
ref during render (`if (text) lastShown.current = text`) and display
`text ?? lastShown.current ?? ''`; the `displayText` state, its effect, and
the unread `lastTextRef` are removed.

12.3. While hidden, the chip SHALL NOT keep a live `backdrop-filter` layer
composited over the map canvas: toggle `visibility: hidden` after the exit
transition (transition `visibility` with a delay matching the fade), so the
GPU skips it entirely.

12.4. The `useConstellationSweep` mock in `MapScreen.test.tsx` SHALL include
`whisperText: null` so tests exercise the real prop contract.

12.5. The new lib imports in `MapScreen.tsx` SHALL satisfy `import/order`
(currently three warnings at lines 32-34), and the `cameraEasing.test.ts`
title "in the first half" SHALL be corrected to "at every interior point" to
match its assertion.
