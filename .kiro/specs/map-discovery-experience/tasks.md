# Implementation Plan: Map Discovery Experience

## Overview

This plan delivers the Peek-Carousel browse-and-compare surface and the end-to-end map discovery UX sweep as **client-side UI** in TypeScript (React + Mapbox GL), with **fast-check + Vitest** property tests against the pure logic cores. No new backend service, no always-on resource, no phone/SMS auth — consistent with the serverless-only and no-SMS steering rules.

The build is bottom-up: pure deterministic cores first (each validated by property tests), then the `selectionStore` single source of truth, then the camera/recenter coordination, then the React shells (`VenueCard`, `FlickControls`, `PeekCarousel`), then marker styling, then the commit/check-in and overlay flows, and finally wiring everything into `MapScreen`. Each step builds on the previous so nothing is left orphaned.

All test sub-tasks are marked optional with `*` and may be skipped for a faster MVP. Property tests run a minimum of 100 iterations and carry a tag comment referencing their design property.

## Tasks

- [x] 1. Foundations: constants and Venue_Card view model
  - [x] 1.1 Create carousel constants and view-model derivation
    - Create `apps/web/src/lib/carouselConstants.ts` with `DRAG_AXIS_THRESHOLD` (8), `BUZZ_WEIGHT` (1.0), `PROX_WEIGHT` (0.5), `POSITION_FRESHNESS_WINDOW` (60000), re-exporting existing `GLYPH_ZOOM_THRESHOLD`, `MIN_MARKER_ZOOM`, `SHEET_FOCUS_OFFSET_RATIO`
    - Add a pure `toVenueCardVM(node, checkInCounts, pulseScores, archetypeIds)` helper returning `VenueCardVM` (id, name, liveCheckInCount, pulseState via `getNodeState`, archetypeId fallback chain, `isFirstIn`)
    - _Requirements: 4.1, 4.6, 12.1, 12.2, 12.3_

- [x] 2. Pure proximity-biased ranking and viewport scoping
  - [x] 2.1 Implement `carouselRanking.ts`
    - Create `apps/web/src/lib/carouselRanking.ts` with `haversineMeters`, `proximityBiasedRank(input: RankInput)`, and `scopeToViewport(ranked, bounds, activeVenueId)`
    - Score = `buzz * BUZZ_WEIGHT + proximity * PROX_WEIGHT`; sort desc; total tie-break by venue id ascending; proximity term is zero when `positionFresh` is false; `scopeToViewport` always re-inserts the Active_Venue and returns it for `null` bounds
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5_

  - [x]\* 2.2 Write property test for ranking determinism and tie-break
    - **Property 8: Proximity_Biased_Ranking is deterministic with a total tie-break**
    - **Validates: Requirements 5.1, 5.3, 5.5**

  - [x]\* 2.3 Write property test for buzz-only fallback
    - **Property 9: Ranking falls back to buzz without a fresh position**
    - **Validates: Requirements 5.2**

  - [x]\* 2.4 Write property test for filter and viewport scope
    - **Property 10: Carousel_Order respects category filter and viewport scope**
    - **Validates: Requirements 5.4, 6.1, 6.2, 13.1, 13.2**

  - [x]\* 2.5 Write property test for Active_Venue retention on recompute
    - **Property 11: Active_Venue is never dropped on recompute**
    - **Validates: Requirements 6.5**

- [x] 3. Pure gesture classification and stepping
  - [x] 3.1 Implement `gestureClassifier.ts`
    - Create `apps/web/src/lib/gestureClassifier.ts` with `classifyDrag(dx, dy, threshold)` returning `'horizontal' | 'vertical' | 'indeterminate'` and `stepIndex(current, dir, length)` that wraps via `(index + dir + length) mod length` and returns the input for length ≤ 1
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 3.2, 3.3_

  - [x]\* 3.2 Write property test for dominant-axis classification
    - **Property 13: Gesture dominant-axis classification**
    - **Validates: Requirements 7.1, 7.2, 7.4, 7.5**

- [x] 4. Pure check-in CTA and QR parsing helpers
  - [x] 4.1 Implement check-in CTA contract in `checkInCta.ts`
    - Create `apps/web/src/lib/checkInCta.ts` with `getCtaInfo({ geoStatus, qrFallback, pending })` returning deterministic `{ label, disabled }` per the CTA contract (pending → checking/disabled; QR fallback → scan/enabled; `requesting` → locating/disabled; `denied` → disabled; `poorAccuracy` → weak-signal/enabled; `timeout` → unavailable/enabled; acquired → ready/enabled)
    - _Requirements: 10.6, 10.7, 14.1_

  - [x]\* 4.2 Write property test for CTA label/disabled derivation
    - **Property 15: Check-in CTA label is a function of Geo_Status**
    - **Validates: Requirements 10.6, 10.7, 14.1**

  - [x] 4.3 Implement QR parser in `qrParser.ts`
    - Create `apps/web/src/lib/qrParser.ts` with `parseVenueQr(input)` that extracts `{ nodeId, token }` from strings matching `…/qr/{nodeId}/{token}` (non-empty segments) and returns null/invalid for non-matching strings
    - _Requirements: 14.5, 14.6_

  - [x]\* 4.4 Write property test for valid QR round-trip
    - **Property 20: Valid venue QR round-trips to a check-in**
    - **Validates: Requirements 14.5**

  - [x]\* 4.5 Write property test for invalid QR rejection
    - **Property 21: Invalid QR is rejected without check-in**
    - **Validates: Requirements 14.6**

- [x] 5. Pure toast admission logic
  - [x] 5.1 Implement `toastAdmission.ts`
    - Create `apps/web/src/lib/toastAdmission.ts` with `admitToQueue(queue, toast)` (priority-sorted by the existing `TOAST_PRIORITY` map, capped at 3) and `shouldEnqueueCheckInToast(venueId, lastSeenAt, now, interval)` for per-venue dedup within the auto-dismiss interval
    - _Requirements: 16.1, 16.5, 16.6_

  - [x]\* 5.2 Write property test for priority ordering and cap
    - **Property 24: Toast queue is priority-ordered and capped**
    - **Validates: Requirements 16.1, 16.5**

  - [x]\* 5.3 Write property test for check-in toast dedup
    - **Property 25: Check_In_Toast deduplication within the auto-dismiss interval**
    - **Validates: Requirements 16.6**

  - [ ]\* 5.4 Write property test for selection never enqueuing check-in toast
    - **Property 26: Selection changes never enqueue a Check_In_Toast**
    - **Validates: Requirements 4.4, 16.2, 16.7**

- [x] 6. Selection_Model store
  - [x] 6.1 Implement `selectionStore.ts`
    - Create `packages/shared/stores/selectionStore.ts` Zustand slice holding `activeVenueId`, `mode`, `carouselOrder`, `openedFromFocus`, with mutators `selectVenue`, `step`, `enterCommit`, `enterBrowse`, `dismiss`, `setOrder`
    - `step` uses `stepIndex` over `carouselOrder`; `dismiss` clears `activeVenueId` and sets `mode='closed'`; commit/browse transitions preserve `activeVenueId`
    - _Requirements: 1.3, 2.4, 2.6, 3.1, 3.2, 3.3_

  - [x]\* 6.2 Write property test for the single Active_Venue invariant
    - **Property 3: Single Active_Venue invariant**
    - **Validates: Requirements 1.3, 2.6**

  - [x]\* 6.3 Write property test for Commit↔Browse preservation
    - **Property 4: Commit↔Browse preserves Active_Venue**
    - **Validates: Requirements 2.4**

  - [x]\* 6.4 Write property test for flick stepping wrap
    - **Property 5: Flick stepping wraps deterministically**
    - **Validates: Requirements 3.2, 3.3**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Camera coordination and recenter gating
  - [x] 8.1 Implement `moveCameraToActive` helper
    - Create `apps/web/src/lib/cameraControl.ts` with `moveCameraToActive(map, node, { reducedMotion })` issuing exactly one `flyTo` with `sheetFocusOffset()`, using zero-duration (non-animated) movement when `reducedMotion` is set
    - _Requirements: 1.4, 1.5, 8.5_

  - [x]\* 8.2 Write property test for camera move honouring Reduced_Motion
    - **Property 7: Camera move on Active_Venue change honours Reduced_Motion**
    - **Validates: Requirements 1.4, 1.5, 8.5**

  - [x] 8.3 Implement recenter freshness gate
    - Add `canRecenter(capturedAt, now, freshnessWindow)` to `cameraControl.ts` and a `recenterIfFresh` wrapper that flies to Last_Known_Position only when a position exists within the Position_Freshness_Window and the map reports loaded; otherwise no-op
    - _Requirements: 11.1, 11.2, 11.3_

  - [x]\* 8.4 Write property test for recenter gating on freshness
    - **Property 16: Recenter is gated on position freshness**
    - **Validates: Requirements 11.1, 11.2**

- [x] 9. Selection orchestration hook
  - [x] 9.1 Implement `useCarouselSelection`
    - Create `apps/web/src/hooks/useCarouselSelection.ts` binding inputs/renderers to `selectionStore`; recompute `carouselOrder` via `scopeToViewport ∘ proximityBiasedRank` on debounced `moveend`/`zoom`/filter changes; call `moveCameraToActive` on Active_Venue change; consume and clear `focusNodeId`; lock order while a swipe is in progress
    - On filter change where Active_Venue no longer matches: set Active_Venue to first of recomputed order, or dismiss when empty
    - _Requirements: 3.4, 3.5, 3.6, 6.4, 13.3, 13.4, 13.5, 15.1, 15.2, 15.4, 15.5_

  - [ ]\* 9.2 Write property test for selection coherence across input sources
    - **Property 6: Selection coherence across all input sources**
    - **Validates: Requirements 3.6, 15.4**

  - [ ]\* 9.3 Write property test for deterministic filter-change reassignment
    - **Property 12: Filter change reassigns the Active_Venue deterministically**
    - **Validates: Requirements 13.3**

  - [ ]\* 9.4 Write property test for consumed Focus_Signal clearing
    - **Property 23: Consumed Focus_Signal is cleared**
    - **Validates: Requirements 15.2**

  - [ ]\* 9.5 Write property test for order stability during an in-progress swipe
    - **Property 29: Browse_Mode order is stable during an in-progress swipe**
    - **Validates: Requirements 18.3**

- [x] 10. Browse-mode card and flick controls
  - [x] 10.1 Implement `VenueCard`
    - Create `apps/web/src/components/VenueCard.tsx` rendering venue name, Live_Check_In_Count from `checkInCounts`, archetype glyph in Pulse_State colour, and the "be the first in" affordance when count is zero
    - _Requirements: 1.2, 4.1, 4.6_

  - [ ]\* 10.2 Write property test for Venue_Card content
    - **Property 1: Venue_Card content**
    - **Validates: Requirements 1.2, 4.1**

  - [ ]\* 10.3 Write property test for zero-count affordance
    - **Property 2: Zero-count "be the first in" affordance**
    - **Validates: Requirements 4.6**

  - [x] 10.4 Implement `FlickControls`
    - Create `apps/web/src/components/FlickControls.tsx` with keyboard-operable previous/next buttons carrying accessible labels, calling `selectionStore.step(dir)`
    - _Requirements: 8.1, 8.2, 8.6, 1.6_

- [x] 11. Peek_Carousel host
  - [x] 11.1 Implement `PeekCarousel`
    - Create `apps/web/src/components/PeekCarousel.tsx` hosting Browse_Mode (Venue_Card strip + `FlickControls`) and Commit_Mode (existing `NodeDetailSheet` content) over `BottomSheet`; route gestures via `classifyDrag` (horizontal → swipe, suppress dismiss; vertical → mode change/dismiss, suppress swipe; rewards-row horizontal in Commit_Mode → native scroll); render empty Browse_Mode invite when no in-viewport venue; render "be the first in" empty state in Commit_Mode; include an aria-live region announcing Active_Venue name + Live_Check_In_Count
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 4.2, 4.3, 6.3, 7.1, 7.2, 7.3, 8.3, 8.4_

  - [ ]\* 11.2 Write property test for aria-live announcement
    - **Property 14: Active_Venue change is announced to assistive technology**
    - **Validates: Requirements 8.3**

  - [ ]\* 11.3 Write render tests for mode transitions and keyboard operation
    - Test Browse↔Commit transitions on the same Bottom_Sheet, FlickControls keyboard operation, and aria-labels
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 8.1, 8.2, 8.4_

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Marker layer legibility and active distinction
  - [x] 13.1 Extend `useMapMarkers` presentation and active styling
    - Update `apps/web/src/hooks/useMapMarkers.ts` to apply glyph/dot/hidden tiers by zoom, distinguish the Active_Venue marker, keep markers geo-anchored across threshold crossings, and update live-count badge on `node:pulse_update` without detaching
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 18.1_

  - [ ]\* 13.2 Write property test for presentation tier by zoom
    - **Property 17: Marker presentation tier is a function of zoom**
    - **Validates: Requirements 12.1, 12.2, 12.3**

  - [ ]\* 13.3 Write property test for geo-anchoring across transitions/updates
    - **Property 18: Markers stay geo-anchored across transitions and updates**
    - **Validates: Requirements 12.4, 18.1**

  - [ ]\* 13.4 Write property test for active-marker distinction
    - **Property 19: Active_Venue marker is visually distinguished**
    - **Validates: Requirements 12.6**

- [x] 14. Toast system wiring
  - [x] 14.1 Wire toast admission and positioning
    - Integrate `toastAdmission` into `toastStore`/`ToastOverlay` so selection changes never enqueue Check_In_Toasts, ambient toasts respect priority + cap, and toasts position so they do not occlude the active Venue_Card or check-in CTA while Peek_Carousel is open
    - _Requirements: 4.4, 4.5, 16.2, 16.3, 16.4, 16.7_

- [x] 15. Overlay coordination
  - [x] 15.1 Implement overlay coordinator hook
    - Create `apps/web/src/hooks/useOverlayCoordinator.ts` deciding visibility of Onboarding_Hint, Proximity_Nudge_Banner, Notification_Priming_Sheet, and Location_Banner: suppress all three overlapping overlays while Commit_Mode is open; enforce nudge/Location_Banner mutual exclusion by precedence; gate priming to after first successful check-in, once per session
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]\* 15.2 Write property test for Commit_Mode overlay suppression
    - **Property 27: Commit_Mode suppresses overlapping overlays**
    - **Validates: Requirements 17.3**

  - [ ]\* 15.3 Write property test for nudge/Location_Banner exclusion
    - **Property 28: Nudge and Location_Banner are mutually exclusive**
    - **Validates: Requirements 17.4**

- [x] 16. Commit and check-in flow
  - [x] 16.1 Implement check-in flow hook
    - Create `apps/web/src/hooks/useCheckInFlow.ts` driving the CTA via `getCtaInfo`, opening the existing `SignupSheet` (email/password + Google OAuth only — no phone/SMS) when unauthenticated, offering `QrScannerSheet` on GPS-too-far, routing valid QR via `parseVenueQr`, surfacing invalid-QR/offline failures, and preventing duplicate submissions while pending
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.8, 19.3, 20.1_

  - [ ]\* 16.2 Write property test for duplicate-submission prevention
    - **Property 22: In-progress check-in prevents duplicate submissions**
    - **Validates: Requirements 14.8**

  - [ ]\* 16.3 Write property test for offline check-in failing safe
    - **Property 30: Offline check-in fails safe**
    - **Validates: Requirements 19.3**

  - [ ]\* 16.4 Write property test for no phone/SMS on map auth entry
    - **Property 31: No phone-number or SMS input on any map auth entry**
    - **Validates: Requirements 20.1**

- [x] 17. MapScreen integration
  - [x] 17.1 Wire all components into `MapScreen`
    - Update `apps/web/src/screens/MapScreen.tsx` to mount `PeekCarousel` driven by `useCarouselSelection`, the updated marker layer, toast wiring, `useOverlayCoordinator`, `useCheckInFlow`, recenter gating, and Focus_Signal consumption; preserve existing first-paint/loading/error/empty/offline states and realtime reconnect handling
    - _Requirements: 1.1, 3.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.8, 11.3, 15.1, 15.3, 18.2, 18.4, 18.5, 19.1, 19.2, 19.4, 20.2, 20.3, 20.4_

  - [ ]\* 17.2 Write example/render tests for map states
    - Cover first-paint config, loading/error/empty overlays, Location_Banner interactions, search no-results, focus open + lighter backdrop, and onboarding/priming gating
    - _Requirements: 9.1, 9.2, 9.4, 9.7, 10.3, 10.8, 13.6, 15.1, 15.3, 17.1_

  - [ ]\* 17.3 Write integration tests for realtime/offline coherence
    - Drive `node:pulse_update` payloads into `mapStore` and toggle connectivity to assert Commit/Browse updates without sheet re-open, disconnect retains last-known values, and reconnect reconciles without reload
    - _Requirements: 18.2, 18.4, 18.5, 19.2, 19.4_

- [x] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Property tests use fast-check + Vitest, run a minimum of 100 iterations, and are tagged with a comment referencing their design property (e.g. `// Feature: map-discovery-experience, Property 8: ...`).
- Mapbox GL, realtime sockets, and `useCheckIn` are mocked in tests per the design's Testing Strategy — no network or WebGL required.
- This feature is strictly client-side UI: no new backend service, no always-on resource (serverless-only rule), and no phone/SMS auth anywhere (no-SMS rule); the only map auth entry is the existing email/password + Google OAuth `SignupSheet`.
- Each task references specific granular requirements for traceability; checkpoints ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "4.3", "5.1"] },
    {
      "id": 1,
      "tasks": [
        "2.2",
        "2.3",
        "2.4",
        "2.5",
        "3.2",
        "4.2",
        "4.4",
        "4.5",
        "5.2",
        "5.3",
        "5.4",
        "6.1",
        "8.1",
        "8.3",
        "10.1",
        "10.4",
        "13.1"
      ]
    },
    { "id": 2, "tasks": ["6.2", "6.3", "6.4", "8.2", "8.4", "9.1", "10.2", "10.3", "13.2", "13.3", "13.4"] },
    { "id": 3, "tasks": ["9.2", "9.3", "9.4", "9.5", "11.1", "14.1", "15.1", "16.1"] },
    { "id": 4, "tasks": ["11.2", "11.3", "15.2", "15.3", "16.2", "16.3", "16.4", "17.1"] },
    { "id": 5, "tasks": ["17.2", "17.3"] }
  ]
}
```
