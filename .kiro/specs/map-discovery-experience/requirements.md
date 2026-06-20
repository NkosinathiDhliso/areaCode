# Requirements Document

## Introduction

The map is the front door of Area Code and the primary discovery surface for the product's mission — "the city is alive." Today the map opens on a full-country overview, drops archetype-glyph markers coloured by category and animated by Pulse_State, and lets a user tap a marker to open a `NodeDetailSheet` with rewards, a crowd-vibe section, and a check-in CTA. A first prototype of multi-venue browsing already exists: prev/next chevrons inside the detail sheet fly the map to a neighbouring venue and fire a live check-in-count toast.

This spec has two connected goals.

**Goal 1 — Peek-Carousel browse-and-compare experience.** Reframe the map user's job as _comparison_: "where is it actually buzzing near me right now, and which do we hit first?" The live check-in count is the key social-proof signal. We evolve the prototype into a hybrid two-state bottom sheet: a COLLAPSED browse mode showing a horizontally swipeable strip of compact venue cards (each driving the map's flyTo), and an EXPANDED commit mode that is the full existing detail sheet. Swiping the carousel, the prev/next chevrons, and tapping a marker all feed ONE selection model. The live count ticks inline on the card and header from the existing realtime stream, and toasts are reserved for ambient/passive surfacing rather than active browsing.

**Goal 2 — End-to-end UX sweep of the map discovery flow.** Walk the complete map journey stage by stage — entry and first paint, location-permission lifecycle, marker legibility across zoom, filtering and search, selection through commit and check-in (including GPS-too-far QR fallback and the unauthenticated signup path), cross-screen focus from the Gets list, toast-system coherence, onboarding/priming overlays, and realtime coherence — and define the correct behavior plus every explicit state (loading, empty, populated, error, offline, permission-denied) so the flow is auditable. Each identified gap is encoded as a requirement with EARS acceptance criteria.

This feature is client-side UI built on existing realtime and data surfaces. It introduces no new backend services and honours the project's serverless-only architecture. Consumer identity remains email + Cognito sub only; the signup path referenced from the map uses the existing email/password and Google OAuth surface. No phone-number input or SMS is introduced anywhere in this feature.

Some decisions in this document warranted confirmation and are written as explicit, flagged requirements with testable acceptance criteria for each candidate answer, so a choice can be resolved without rewriting the requirement. The Browse_Mode default scope (Requirement 6) has been resolved to in-viewport.

## Glossary

- **Map_Screen**: the consumer map tab (`apps/web/src/screens/MapScreen.tsx`), the surface that owns the map canvas, markers, overlays, and bottom sheet.
- **Map_Canvas**: the Mapbox GL map instance managed by `useMapInit`, including its camera (center, zoom, bearing, pitch).
- **Bottom_Sheet**: the shared sheet component (`packages/shared/components/BottomSheet.tsx`) that hosts venue content above the nav bar.
- **Peek_Carousel**: the new two-state interaction layered on Bottom_Sheet that supports browse-and-compare. It has exactly two states: Browse_Mode and Commit_Mode.
- **Browse_Mode**: the COLLAPSED state of Peek_Carousel — a horizontally swipeable strip of Venue_Cards. The active card drives the Map_Canvas flyTo.
- **Commit_Mode**: the EXPANDED state of Peek_Carousel — the full existing `NodeDetailSheet` content (rewards, archetype glyph + name, crowd vibe, directions, check-in CTA) for the active venue.
- **Venue_Card**: a compact card in Browse_Mode showing a venue's name, Live_Check_In_Count, and archetype glyph / Pulse_State colour.
- **Active_Venue**: the single venue currently selected across all input methods. Exactly one Active_Venue exists whenever Peek_Carousel is open.
- **Selection_Model**: the single source of truth for the Active_Venue. All three input methods (carousel swipe, prev/next chevrons, marker tap) read and write this one model.
- **Carousel_Swipe**: a horizontal drag/flick gesture on the Venue_Card strip that moves the Active_Venue to an adjacent card.
- **Flick_Controls**: the prev/next chevron buttons that step the Active_Venue one position in the Carousel_Order. These are the keyboard- and screen-reader-operable fallback for Carousel_Swipe.
- **Carousel_Order**: the ordered list of venues presented in Browse_Mode, produced by Proximity_Biased_Ranking.
- **Live_Check_In_Count**: the raw "how many people are here right now" headcount per node, held in `mapStore.checkInCounts` and updated by the `node:pulse_update` socket event. Distinct from the weighted Pulse_Score.
- **Pulse_Score**: the weighted vibe score per node held in `mapStore.pulseScores`.
- **Pulse_State**: one of `dormant`, `quiet`, `active`, `buzzing`, `popping`, derived from Pulse_Score by `getNodeState`.
- **Proximity_Biased_Ranking**: the deterministic ranking that orders venues by buzz (Pulse_Score / Live_Check_In_Count) while biasing toward nearness to the user's Last_Known_Position.
- **Last_Known_Position**: the consumer's most recent successful browser-geolocation result for the session, held in client memory only (`locationStore.lastKnownPosition` + `capturedAt`). Never persisted server-side.
- **Position_Freshness_Window**: the 60000 ms window within which a Last_Known_Position is considered fresh enough to recenter the map or bias ranking.
- **Recenter_Control**: the map control that flies the Map_Canvas to the Last_Known_Position (`recenterUser` in `useMapInit`, surfaced via `MapControls`).
- **Location_Banner**: the non-blocking "Enable location" banner shown on Map_Screen when location permission is denied.
- **Geo_Status**: the geolocation state machine value, one of `requesting`, `denied`, `poorAccuracy`, `timeout`, or a success state, exposed by `useGeolocation`.
- **Marker_Layer**: the set of Mapbox HTML markers managed by `useMapMarkers`, each rendering an archetype glyph (or a dot at lower zoom) plus halo/ripple.
- **Glyph_Zoom**: zoom at or above `GLYPH_ZOOM_THRESHOLD` (12.5) where markers render the detailed archetype glyph.
- **Dot_Zoom**: zoom in `[MIN_MARKER_ZOOM, GLYPH_ZOOM_THRESHOLD)` (8 to 12.5) where markers render a simple category dot.
- **Globe_Zoom**: zoom below `MIN_MARKER_ZOOM` (8) where markers are hidden.
- **Category_Filter**: the active `NodeCategory` filter from `CategoryFilterBar`, or none.
- **Search_Sheet**: the venue search surface (`SearchSheet`) that can select a node and fly to it.
- **Focus_Signal**: the cross-screen focus request `mapStore.focusNodeId`, set by surfaces like the Gets list to ask the map to fly to a node and open it.
- **Toast_System**: the in-app toast surface (`ToastOverlay`, `toastStore`) with a 3-item priority queue and per-toast auto-dismiss.
- **Ambient_Toast**: a toast that surfaces activity at a venue the user is NOT currently looking at (passive surfacing).
- **City_Pulse_Toast**, **Surge_Toast**, **Reward_Pressure_Toast**, **Check_In_Toast**: existing toast types ordered by the `TOAST_PRIORITY` map (`surge` 1, `city_pulse` 2, `reward_pressure` 3, `checkin` 4, …).
- **Proximity_Nudge_Banner**: the banner (`ProximityNudgeBanner`) that nudges the user toward a nearby relevant venue.
- **Notification_Priming_Sheet**: the sheet (`NotificationPrimingSheet`) shown after a first check-in to ask for notification permission.
- **Onboarding_Hint**: the one-time "tap a venue" hint shown until `onboarding.hintSeen`.
- **Signup_Surface**: the existing email/password + Google OAuth signup sheet (`SignupSheet`). The only auth surface reachable from the map.
- **QR_Fallback**: the in-app QR scanner path used to prove presence when GPS places the user too far from the venue to check in.
- **Sheet_Focus_Offset**: the vertical flyTo offset (`sheetFocusOffset`, ~30% of viewport height) that lifts the Active_Venue into the visible strip above the open sheet.
- **Reduced_Motion**: the state where the `prefers-reduced-motion: reduce` media query matches.

---

## Requirements

## Goal 1 — Peek-Carousel Browse-and-Compare Experience

### Requirement 1: Comparison-first browse surface

**User Story:** As a consumer deciding where to go out tonight, I want to compare nearby venues by how busy they are right now, so that I can pick which one to hit first.

#### Acceptance Criteria

1. WHEN the consumer opens Map_Screen AND at least one venue is available in the current Carousel_Order, THE Peek_Carousel SHALL open in Browse_Mode showing a horizontally swipeable strip of Venue_Cards.
2. THE Venue_Card SHALL display the venue name, the venue's Live_Check_In_Count, and the venue's archetype glyph rendered in the venue's Pulse_State colour.
3. WHILE Peek_Carousel is open, THE Selection_Model SHALL hold exactly one Active_Venue.
4. WHEN the Active_Venue changes, THE Map_Canvas SHALL fly to the Active_Venue's coordinates applying the Sheet_Focus_Offset so the venue lands in the visible strip above Peek_Carousel.
5. WHERE the consumer has Reduced_Motion set, THE Map_Canvas SHALL move to the Active_Venue's coordinates without an animated fly-to transition.
6. WHILE Peek_Carousel is in Browse_Mode, THE Map_Screen SHALL NOT render the legacy in-sheet prev/next chevron row as the only browsing affordance; the equivalent stepping function SHALL be provided by Flick_Controls per Requirement 3.

### Requirement 2: Browse_Mode and Commit_Mode states

**User Story:** As a consumer, I want to glance across venues and then dive into one without losing my place, so that browsing and committing feel like one continuous motion.

#### Acceptance Criteria

1. THE Peek_Carousel SHALL expose exactly two states: Browse_Mode (collapsed) and Commit_Mode (expanded).
2. WHEN the consumer drags Peek_Carousel upward past its expand threshold OR taps the active Venue_Card, THE Peek_Carousel SHALL transition to Commit_Mode for the Active_Venue.
3. WHILE in Commit_Mode, THE Peek_Carousel SHALL render the full existing detail content for the Active_Venue, including rewards, archetype glyph and display name, crowd-vibe section, directions, and the check-in CTA.
4. WHEN the consumer drags Commit_Mode downward past its collapse threshold, THE Peek_Carousel SHALL transition back to Browse_Mode while preserving the same Active_Venue.
5. WHEN Peek_Carousel transitions between Browse_Mode and Commit_Mode, THE Peek_Carousel SHALL change height/state on the existing Bottom_Sheet rather than mounting a separate detail surface.
6. WHEN the consumer dismisses Peek_Carousel from Browse_Mode, THE Map_Screen SHALL close the sheet and clear the Active_Venue.
7. WHILE the Active_Venue has no rewards AND its state is dormant, THE Commit_Mode SHALL render the "be the first in" empty state for that venue.

### Requirement 3: Unified selection model across three inputs

**User Story:** As a consumer, I want swiping, the chevron buttons, and tapping a marker to all control the same selection, so that the interface feels coherent however I drive it.

#### Acceptance Criteria

1. THE Selection_Model SHALL be the single source of truth for the Active_Venue, read and written by Carousel_Swipe, Flick_Controls, and marker tap.
2. WHEN the consumer performs a Carousel_Swipe to an adjacent Venue_Card, THE Selection_Model SHALL set the Active_Venue to that card's venue.
3. WHEN the consumer activates the next or previous Flick_Control, THE Selection_Model SHALL move the Active_Venue one position forward or backward in the Carousel_Order, wrapping at the ends.
4. WHEN the consumer taps a marker on the Marker_Layer, THE Selection_Model SHALL set the Active_Venue to that marker's venue AND THE Peek_Carousel SHALL scroll the Venue_Card strip so that venue's card is the active card.
5. IF the consumer taps a marker for a venue not present in the current Carousel_Order, THEN THE Peek_Carousel SHALL insert or surface that venue as the Active_Venue so it is reachable in Browse_Mode.
6. WHEN the Active_Venue changes through any input method, THE Peek_Carousel, THE Map_Canvas camera, and the active Venue_Card SHALL all reflect the same Active_Venue within one render cycle.

### Requirement 4: Live check-in count behavior

**User Story:** As a consumer, I want to see each venue's live check-in count update as I browse, so that I trust the busy-ness signal without being spammed by notifications.

#### Acceptance Criteria

1. THE Venue_Card SHALL display the Active_Venue's and each visible card's Live_Check_In_Count inline from `mapStore.checkInCounts`.
2. WHILE in Commit_Mode, THE Peek_Carousel header SHALL display the Active_Venue's Live_Check_In_Count inline.
3. WHEN a `node:pulse_update` event updates the Live_Check_In_Count for a venue whose Venue_Card is currently rendered, THE Peek_Carousel SHALL update that card's displayed count within 1000 ms without re-opening or re-animating the sheet.
4. WHEN the consumer changes the Active_Venue via Carousel_Swipe, Flick_Controls, or marker tap, THE Map_Screen SHALL NOT enqueue a Check_In_Toast for that selection.
5. WHERE a check-in occurs at a venue that is not the Active_Venue and is not currently visible in the Browse_Mode strip, THE Map_Screen MAY enqueue an Ambient_Toast for that venue subject to Requirement 16.
6. IF a venue has a Live_Check_In_Count of zero, THEN THE Venue_Card SHALL render a "be the first in" affordance in place of a numeric count.

### Requirement 5: Proximity-biased ranking and ordering

**User Story:** As a consumer, I want the busiest venues near me to come first as I swipe, so that the first cards are the ones most worth my attention.

#### Acceptance Criteria

1. THE Carousel_Order SHALL be produced by Proximity_Biased_Ranking, ranking venues by buzz (Pulse_Score and Live_Check_In_Count) while biasing toward nearness to the Last_Known_Position.
2. WHILE no fresh Last_Known_Position is available, THE Proximity_Biased_Ranking SHALL fall back to ranking by buzz alone without raising an error.
3. THE Proximity_Biased_Ranking SHALL be deterministic: for a fixed set of venues, pulse scores, check-in counts, and Last_Known_Position, two consecutive computations SHALL produce the same Carousel_Order.
4. WHEN the active Category_Filter changes, THE Carousel_Order SHALL be recomputed to include only venues matching the filter.
5. IF two venues have equal rank under Proximity_Biased_Ranking, THEN THE ordering between them SHALL be broken deterministically by venue id so the order is stable.

### Requirement 6: Browse_Mode default scope (in-viewport)

**User Story:** As a consumer, I want the browse strip to start with the venues I am currently looking at on the map, so that browsing stays spatially grounded in what is on screen.

> **Resolved decision:** Browse_Mode defaults to IN-VIEWPORT scope — the strip is scoped to venues within the current Map_Canvas bounds, ordered by Proximity_Biased_Ranking. (The alternative nearest-to-me-regardless-of-viewport behavior was considered and rejected.)

#### Acceptance Criteria

1. THE Carousel_Order SHALL include only venues whose coordinates fall within the current Map_Canvas bounds, ordered by Proximity_Biased_Ranking.
2. WHEN the consumer pans or zooms the Map_Canvas, THE Carousel_Order SHALL recompute to reflect the venues within the new Map_Canvas bounds.
3. IF no venue falls within the current Map_Canvas bounds, THEN THE Peek_Carousel SHALL render an empty Browse_Mode state inviting the consumer to zoom out or move the map.
4. WHEN the consumer selects a venue outside the current Map_Canvas bounds via marker tap, Search_Sheet, or a Focus_Signal, THE Selection_Model SHALL set that venue as the Active_Venue AND THE Map_Canvas SHALL fly to it so it falls within bounds and is included in the recomputed Carousel_Order.
5. WHILE the Active_Venue is set, THE recomputed Carousel_Order SHALL continue to include the Active_Venue even if a pan or zoom would otherwise exclude it, so the Active_Venue is never silently dropped mid-selection.

### Requirement 7: Gesture-conflict resolution

**User Story:** As a consumer, I want horizontal swiping on the carousel to never accidentally dismiss the sheet or fight the reward chips, so that browsing feels predictable.

#### Acceptance Criteria

1. WHEN the consumer performs a predominantly horizontal drag on the Venue_Card strip in Browse_Mode, THE Peek_Carousel SHALL interpret the gesture as a Carousel_Swipe AND SHALL NOT trigger the sheet's swipe-to-dismiss.
2. WHEN the consumer performs a predominantly vertical drag on Peek_Carousel, THE Peek_Carousel SHALL interpret the gesture as a Browse_Mode/Commit_Mode state change or dismiss, AND SHALL NOT advance the Carousel_Swipe.
3. WHILE in Commit_Mode AND the consumer drags horizontally on the rewards chip row, THE Peek_Carousel SHALL route the gesture to the reward chip horizontal scroll AND SHALL NOT change the Active_Venue.
4. THE Peek_Carousel SHALL classify a drag as horizontal or vertical using a measurable dominant-axis threshold so that the same gesture yields the same interpretation on repeat.
5. IF a gesture's dominant axis cannot be determined within the classification threshold, THEN THE Peek_Carousel SHALL take no selection or state-change action for that gesture.

### Requirement 8: Accessibility of the carousel

**User Story:** As a consumer using a keyboard or screen reader, I want every browse action available without swiping, so that I can compare and commit to venues like anyone else.

#### Acceptance Criteria

1. THE Flick_Controls SHALL be operable by keyboard, advancing the Active_Venue forward or backward in the Carousel_Order on activation.
2. THE Flick_Controls SHALL expose accessible labels identifying the previous-venue and next-venue actions.
3. WHEN the Active_Venue changes, THE Peek_Carousel SHALL announce the new Active_Venue's name and Live_Check_In_Count to assistive technology.
4. THE Peek_Carousel SHALL provide a keyboard- and screen-reader-operable control to enter Commit_Mode for the Active_Venue and to return to Browse_Mode.
5. WHERE the consumer has Reduced_Motion set, THE Peek_Carousel and Map_Canvas SHALL perform Active_Venue changes and state transitions without animated fly-to or motion transitions.
6. THE Venue_Card strip SHALL NOT rely on Carousel_Swipe as the only means of changing the Active_Venue.

---

## Goal 2 — End-to-End Map Discovery UX Sweep

### Requirement 9: Map entry and first paint

**User Story:** As a consumer opening the map, I want a reliable first paint with clear feedback if it fails, so that I am never stuck on a blank screen.

#### Acceptance Criteria

1. WHEN the consumer first opens Map_Screen, THE Map_Canvas SHALL initialise on a full-country overview centred on South Africa at the configured country zoom.
2. WHILE the Map_Canvas is initialising and not yet interactive, THE Map_Screen SHALL render a loading overlay.
3. WHEN the Map_Canvas finishes loading and becomes interactive, THE Map_Screen SHALL remove the loading overlay and render the Marker_Layer for the available venues.
4. IF the Map_Canvas fails to initialise, THEN THE Map_Screen SHALL render a map-unavailable state with a retry control AND SHALL NOT crash the surrounding app.
5. WHEN the consumer activates the retry control, THE Map_Screen SHALL tear down and re-initialise the Map_Canvas.
6. IF the Map_Canvas does not become interactive within the configured load-timeout window, THEN THE Map_Screen SHALL render the map-unavailable state with a retry control.
7. WHILE no venues are available for the current city, THE Map_Screen SHALL render an empty map (no markers) without raising an error.
8. IF the venue list request fails, THEN THE Map_Screen SHALL keep the Map_Canvas interactive AND SHALL render the map without markers rather than blocking the surface.

### Requirement 10: Location permission lifecycle

**User Story:** As a consumer, I want the map to handle every location-permission outcome gracefully, so that I always understand whether the map can find me.

#### Acceptance Criteria

1. WHEN Map_Screen mounts, THE Map_Screen SHALL request the consumer's location without moving the Map_Canvas camera away from the country overview.
2. WHILE Geo_Status is `requesting`, THE Recenter_Control SHALL indicate an in-progress location acquisition rather than appearing ready.
3. IF location permission is `denied`, THEN THE Map_Screen SHALL render the Location_Banner with an enable-location action AND SHALL keep the map fully usable without location.
4. WHEN the consumer activates the Location_Banner enable action AND a position is obtained, THE Map_Canvas SHALL fly to that position at the user-view zoom.
5. IF the consumer activates the Location_Banner enable action AND permission remains denied, THEN THE Map_Screen SHALL dismiss the Location_Banner without moving the Map_Canvas.
6. IF Geo_Status is `poorAccuracy`, THEN THE Map_Screen SHALL still allow check-in attempts but SHALL communicate the weak-signal condition on the check-in CTA.
7. IF Geo_Status is `timeout`, THEN THE Map_Screen SHALL communicate that location is unavailable on the check-in CTA AND SHALL keep the map usable.
8. WHEN the consumer dismisses the Location_Banner, THE Map_Screen SHALL NOT re-show the Location_Banner for the remainder of the session.

### Requirement 11: Recenter control gating on position freshness

**User Story:** As a consumer, I want the recenter button to only move me when it actually knows where I am, so that it never flies the map to a stale location.

#### Acceptance Criteria

1. WHEN the consumer activates the Recenter_Control AND a Last_Known_Position exists no older than the Position_Freshness_Window, THE Map_Canvas SHALL fly to that position at the user-view zoom.
2. WHILE no Last_Known_Position exists OR the most recent Last_Known_Position is older than the Position_Freshness_Window, THE Recenter_Control SHALL render in a disabled, non-interactive state with an accessible disabled indication AND SHALL NOT trigger a fly-to when activated.
3. IF the Map_Canvas reports not-loaded when the Recenter_Control is activated, THEN THE Map_Screen SHALL ignore the activation without raising an unhandled exception.

### Requirement 12: Marker legibility across zoom

**User Story:** As a consumer zooming in and out, I want markers to stay legible at every zoom, so that the map never reads as clutter or empty space.

#### Acceptance Criteria

1. WHILE the Map_Canvas zoom is at Glyph_Zoom, THE Marker_Layer SHALL render each venue as its detailed archetype glyph.
2. WHILE the Map_Canvas zoom is at Dot_Zoom, THE Marker_Layer SHALL render each venue as a simple category-coloured dot.
3. WHILE the Map_Canvas zoom is at Globe_Zoom, THE Marker_Layer SHALL hide venue markers.
4. WHEN the Map_Canvas zoom crosses a marker-rendering threshold, THE Marker_Layer SHALL transition marker presentation without detaching markers from their coordinates.
5. WHILE markers overlap at a packed zoom, THE Marker_Layer SHALL keep the Active_Venue's marker and its tap target reachable.
6. WHILE the Active_Venue is set, THE Marker_Layer SHALL visually distinguish the Active_Venue's marker from non-active markers.

### Requirement 13: Category filtering and search coherence

**User Story:** As a consumer filtering or searching, I want the map, carousel, and any open venue to stay consistent, so that nothing shows content that contradicts my filter.

#### Acceptance Criteria

1. WHEN the consumer selects a Category_Filter, THE Marker_Layer SHALL render only venues matching the filter AND THE Carousel_Order SHALL recompute to include only matching venues.
2. WHEN the consumer clears the Category_Filter, THE Marker_Layer and Carousel_Order SHALL include all available venues consistent with the Browse_Mode default scope.
3. IF the Active_Venue no longer matches the Category_Filter after a filter change, THEN THE Selection_Model SHALL set the Active_Venue to the first venue in the recomputed Carousel_Order, or clear the Active_Venue and close Peek_Carousel if the recomputed order is empty.
4. WHEN the consumer selects a venue from Search_Sheet, THE Selection_Model SHALL set that venue as the Active_Venue AND THE Map_Canvas SHALL fly to it applying the Sheet_Focus_Offset.
5. IF a venue selected from Search_Sheet does not match the active Category_Filter, THEN THE Map_Screen SHALL surface that venue as the Active_Venue without silently discarding the selection.
6. WHILE Search_Sheet returns no results for the consumer's query, THE Search_Sheet SHALL render a no-results state.

### Requirement 14: Node selection, commit, and check-in

**User Story:** As a consumer at a venue, I want to check in reliably even when GPS is imperfect or I am not signed in, so that I can claim the moment without friction.

#### Acceptance Criteria

1. WHEN the consumer enters Commit_Mode for the Active_Venue, THE Peek_Carousel SHALL present a check-in CTA whose label reflects the current Geo_Status.
2. WHEN the consumer activates check-in AND is authenticated AND within GPS range, THE Map_Screen SHALL perform the check-in and provide success feedback.
3. IF the consumer activates check-in AND is not authenticated, THEN THE Map_Screen SHALL open the Signup_Surface using the existing email/password and Google OAuth surface AND SHALL NOT present any phone-number or SMS input.
4. IF the consumer activates check-in AND GPS places the consumer too far from the venue, THEN THE Map_Screen SHALL offer the QR_Fallback to prove presence.
5. WHEN a QR_Fallback scan yields a valid Area Code venue QR, THE Map_Screen SHALL run the check-in flow for the scanned venue.
6. IF a QR_Fallback scan yields content that is not a valid Area Code venue QR, THEN THE Map_Screen SHALL surface an invalid-QR message AND SHALL NOT perform a check-in.
7. WHEN a check-in succeeds AND it is the consumer's first check-in AND notification priming has not been deferred recently, THE Map_Screen SHALL present the Notification_Priming_Sheet once per session.
8. WHILE a check-in request is in progress, THE check-in CTA SHALL render a pending state AND SHALL prevent duplicate submissions.

### Requirement 15: Cross-screen focus coexistence

**User Story:** As a consumer arriving from the Gets list, I want the map to fly to and open the chosen venue while keeping neighbouring venues visible, so that I can plan a multi-venue evening.

#### Acceptance Criteria

1. WHEN a Focus_Signal is set AND the Map_Canvas is ready AND the target venue is available, THE Map_Screen SHALL set that venue as the Active_Venue, fly to it applying the Sheet_Focus_Offset, and open Peek_Carousel.
2. WHEN the Map_Screen consumes a Focus_Signal, THE Map_Screen SHALL clear `focusNodeId` so the same focus is not re-applied.
3. WHILE Peek_Carousel was opened from a Focus_Signal, THE Bottom_Sheet SHALL use the lighter backdrop so neighbouring venues stay visible.
4. WHEN a Focus_Signal targets a venue, THE resulting Active_Venue SHALL be reflected in the same Selection_Model used by Carousel_Swipe, Flick_Controls, and marker tap.
5. IF a Focus_Signal references a venue that is not available in the store, THEN THE Map_Screen SHALL clear the Focus_Signal without opening Peek_Carousel and without raising an error.

### Requirement 16: Toast system coherence

**User Story:** As a consumer, I want toasts to stay calm and relevant while I browse, so that the live signal is helpful rather than noisy.

#### Acceptance Criteria

1. THE Toast_System SHALL order queued toasts by the existing priority map (`surge`, `city_pulse`, `reward_pressure`, `checkin`, …) and SHALL cap the queue at three items.
2. WHILE the consumer is actively browsing Peek_Carousel, THE Map_Screen SHALL surface Live_Check_In_Count changes for the Active_Venue inline rather than as a Check_In_Toast.
3. WHERE a check-in occurs at a venue the consumer is not currently looking at, THE Map_Screen MAY enqueue an Ambient_Toast subject to the priority ordering and queue cap.
4. WHILE Peek_Carousel is open, THE Toast_System SHALL position toasts so they do not occlude the active Venue_Card or the check-in CTA.
5. WHEN a Surge_Toast and a lower-priority toast are queued together, THE Toast_System SHALL present the Surge_Toast first.
6. THE Toast_System SHALL NOT enqueue more than one Check_In_Toast for the same venue within a single auto-dismiss interval.
7. WHILE the consumer remains in Browse_Mode, THE Map_Screen SHALL NOT emit a Check_In_Toast on each Active_Venue change (no per-flick toast spam).

### Requirement 17: Onboarding, nudge, and priming overlay coordination

**User Story:** As a consumer, I want hints and nudges to appear one at a time and not collide with the carousel, so that guidance never blocks what I am trying to do.

#### Acceptance Criteria

1. WHILE the consumer has not seen the Onboarding_Hint, THE Map_Screen SHALL render the Onboarding_Hint until the consumer's first venue interaction or explicit dismissal.
2. WHEN the consumer first interacts with a venue, THE Map_Screen SHALL mark the Onboarding_Hint as seen and stop rendering it.
3. WHILE Commit_Mode is open, THE Map_Screen SHALL NOT render the Onboarding_Hint, the Proximity_Nudge_Banner, or the Notification_Priming_Sheet so they do not overlap the open sheet.
4. IF both the Proximity_Nudge_Banner and the Location_Banner would render at the same time, THEN THE Map_Screen SHALL show at most one of them at a time with a defined precedence.
5. WHEN the Notification_Priming_Sheet is eligible to show, THE Map_Screen SHALL present it only after a successful first check-in and only once per session.

### Requirement 18: Realtime coherence while browsing or committed

**User Story:** As a consumer, I want live pulse and state updates to reflect on the map and in any open venue without disruption, so that the experience stays current and stable.

#### Acceptance Criteria

1. WHEN a `node:pulse_update` event arrives for a rendered venue, THE Marker_Layer SHALL update that venue's Pulse_State presentation and live-count badge without detaching the marker.
2. WHILE Commit_Mode is open for the Active_Venue, WHEN a pulse or state update arrives for that venue, THE Peek_Carousel SHALL reflect the updated Live_Check_In_Count and state without closing or re-opening the sheet.
3. WHILE Browse_Mode is open, WHEN pulse updates arrive for visible venues, THE Carousel_Order SHALL remain stable for the current Active_Venue and SHALL NOT reorder the strip out from under an in-progress Carousel_Swipe.
4. WHEN realtime connectivity is lost, THE Map_Screen SHALL continue to render the most recent known Pulse_State and Live_Check_In_Count values without raising an error.
5. WHEN realtime connectivity is restored, THE Map_Screen SHALL apply the next authoritative payload to reconcile Pulse_State and Live_Check_In_Count values.

### Requirement 19: Offline and degraded connectivity

**User Story:** As a consumer with a flaky connection, I want the map to degrade gracefully, so that I can still see the last known state instead of an error screen.

#### Acceptance Criteria

1. IF the venue list cannot be retrieved AND no cached venues exist, THEN THE Map_Screen SHALL render the empty map state without raising an error.
2. WHILE offline, THE Map_Screen SHALL render the most recently loaded venues and their last known Pulse_State and Live_Check_In_Count.
3. IF a check-in is attempted while offline, THEN THE Map_Screen SHALL surface a failure state AND SHALL NOT report a false success.
4. WHEN connectivity is restored, THE Map_Screen SHALL resume realtime updates without requiring a manual reload.

### Requirement 20: Identity and architecture constraints

**User Story:** As a product owner, I want this feature to honour the platform's identity and serverless constraints, so that it stays compliant and low-cost.

#### Acceptance Criteria

1. THE Map_Screen SHALL use only email/password and Google OAuth via the existing Signup_Surface for any authentication entry point AND SHALL NOT present any phone-number or SMS input.
2. THE feature SHALL operate on existing realtime, venue, and check-in data surfaces AND SHALL NOT require any new always-on backend service.
3. THE Map_Screen SHALL treat the consumer identity as email and Cognito sub only AND SHALL NOT introduce any phone-number identifier.
4. THE Last_Known_Position SHALL remain in client memory only AND SHALL NOT be newly persisted server-side by this feature.
