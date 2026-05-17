# Implementation Plan: Live Vibe on Map

## Overview

This plan implements the five Live Vibe on Map deliverables bottom-up: shared types and constants first, then pure resolvers (Schedule_Resolver, Genre_To_Archetype_Mapping, Live_Archetype) with property tests, then the backend schedule routes and live-archetype evaluator, then the frontend surfaces (sidebar fixes, City Pulse toast, ArchetypeGlyph, Schedule_Editor), then the feature flag wiring and infrastructure. The R1 sidebar fixes ship un-flagged per R12.7; everything else lives behind `live_vibe_on_map = false` until the canary flip. All persistence is DynamoDB PAY_PER_REQUEST, all compute is arm64 Lambda, and no SMS or phone-OTP code is touched.

## Tasks

- [x] 1. Define shared types, archetype rename module, and feature flag entry
  - [x] 1.1 Add Music_Schedule and live archetype types to shared types
    - Edit `packages/shared/types/index.ts` to add `ScheduleSlot`, `LineupEntry`, `MusicSchedule`, `LiveArchetypeBranch`, and the `'node:archetype_change'` payload on `ServerToClientEvents` per the Data Models section of the design
    - Export the new types from the package barrel
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10, 3.11, 11.2_

  - [x] 1.2 Create the archetype rename module
    - Create `packages/shared/constants/archetype-names.ts` with the frozen `ARCHETYPE_NAMES` map and the `getArchetypeDisplayName(id)` and `getArchetypeEtymology(id)` helpers
    - Populate every entry from the R9.5 table (Blaze, Lumen, Kasi, Hymn, Spark, Drum, Noir, Verse, Drift, Cipher, Velvet, Bounce, Root, Prism, Compass) with Kasi's etymology copy
    - Re-export from `packages/shared/constants/index.ts`
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.9, 9.12, 9.13_

  - [x] 1.3 Write property test for archetype rename completeness
    - **Property 11: Every catalog Archetype has exactly one rename entry**
    - **Property 12: Display name is locale-invariant**
    - Create `packages/shared/constants/__tests__/archetype-names.test.ts`
    - Assert `Object.keys(ARCHETYPE_NAMES).length === ARCHETYPE_CATALOG.length`, every catalog `id` has an entry, every `displayName` matches `/^[A-Z][a-z]+$/` and length is 3-8, and `getArchetypeDisplayName` accepts only an id (no locale parameter)
    - **Validates: Requirements 9.1, 9.4, 9.13**

  - [x] 1.4 Register the `live_vibe_on_map` feature flag
    - Edit `packages/shared/lib/featureGating.ts` to declare `live_vibe_on_map` with default `false` and the existing unreachable-store fallback to `false`
    - Add a typed helper `useLiveVibeOnMap()` that returns the boolean for use across web, business, and backend
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 2. Build the Schedule_Resolver and Music_Schedule validator
  - [x] 2.1 Implement the Music_Schedule Zod schema and validator module
    - Create `packages/shared/lib/schedule-validator.ts` exporting Zod schemas (`ScheduleSlotSchema`, `LineupEntrySchema`, `MusicScheduleSchema`) plus `validateMusicSchedule(schedule)` running the validation order from the design (schema shape → field validity → per-slot consistency → cross-slot consistency → Cross_Midnight_Pair pairing) and returning a tagged `ScheduleValidationError`
    - Derive `startTimeMin` / `endTimeMin` deterministically from `HH:mm` on parse so the redundant fields cannot drift
    - Validate IANA timezone using runtime `Intl.DateTimeFormat` resolution
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12, 5.10, 5.11_

  - [x] 2.2 Implement the Schedule_Resolver pure function
    - Create `packages/shared/lib/scheduleResolver.ts` exporting `resolveActiveSlot(schedule, timestampIso): ResolvedSlot | null` and a `ScheduleResolverInternalError` class
    - Convert the input timestamp into the schedule's IANA timezone using `Intl.DateTimeFormat` to derive `(dayOfWeek, minutesSinceMidnight)`, filter slots, return at most one match, and look up the LineupEntry whose `startTimeMin` is the greatest value not exceeding the local minutes when the slot is in lineup mode
    - Throw `ScheduleResolverInternalError` (with slotId and timestamp) on the unreachable lineup branch per R5.8
    - Keep the function observably pure: no `Date.now()`, no globals, no I/O
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 2.3 Write property tests for Schedule_Resolver correctness
    - **Property 1: Schedule resolver returns at most one Active_Slot**
    - **Property 2: Active_Slot interval contains the timestamp**
    - **Property 3: Schedule resolver idempotence**
    - **Property 4: Lineup-active slot always returns exactly one LineupEntry**
    - Create `packages/shared/lib/__tests__/scheduleResolver.test.ts` using fast-check with arbitrary valid `MusicSchedule` and RFC 3339 timestamp generators
    - Assert at-most-one Active_Slot, half-open interval containment via minutes-since-midnight, idempotence under deep equality, and exactly-one LineupEntry whenever a lineup-mode slot is active
    - **Validates: Requirements 5.1, 5.4, 5.7, 5.9, 10.1, 10.2, 10.3**

  - [x] 2.4 Write property tests for the Music_Schedule validator
    - **Property 6: Music_Schedule serialize/parse round-trip**
    - **Property 9: Schedule validator rejects bad intervals and preserves prior state**
    - Create `packages/shared/lib/__tests__/schedule-validator.test.ts`
    - Assert `parse(serialize(schedule))` is deeply equal to the original; assert validator rejects `startTimeMin >= endTimeMin`, overlapping slots on the same `dayOfWeek`, lineup-mode slots whose first entry's `startTimeMin` ≠ slot start, and duplicate LineupEntry `startTime` values within a slot
    - **Validates: Requirements 3.5, 3.7, 3.9, 10.5, 10.8**

- [x] 3. Build the Genre_To_Archetype_Mapping and Live_Archetype resolvers
  - [x] 3.1 Implement the Genre_To_Archetype_Mapping wrapper
    - Create `packages/shared/lib/genreToArchetype.ts` exporting `genresToArchetype(genres)` that returns `archetype-uncharted` on empty input, returns `archetype-uncharted` plus a structured warning on unknown genres, otherwise calls the existing `computeDimensionScores` and `resolveArchetype` from `archetypeResolver.ts`
    - Reject `null` / `undefined` / non-Set/Array inputs with a tagged validation error
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_

  - [x] 3.2 Write property test for Genre_To_Archetype_Mapping order-independence
    - **Property 5: Genre→Archetype order-independence**
    - Create `packages/shared/lib/__tests__/genreToArchetype.test.ts` using fast-check
    - Generate non-empty `MusicGenre` sets of size 1-50, shuffle into two permutations, assert both return Archetypes with the same `id`
    - Also assert determinism: two consecutive calls with the same input return the same `id`
    - **Validates: Requirements 6.6, 6.7, 10.4**

  - [x] 3.3 Implement the Live_Archetype resolver pure function
    - Create `packages/shared/lib/liveArchetype.ts` exporting `resolveLiveArchetype(inputs): LiveArchetypeResult` with the branch field (`schedule_lineup` / `schedule_blanket` / `checkin_mode` / `default` / `eclectic_fallback`)
    - Implement the branch decision tree from the design's table; tie-break check-in mode by `(highest count) → (lowest catalog priority) → (lexicographically smallest id)`
    - Surface the unreachable lineup branch as `LiveArchetypeInternalError`; the Lambda catches it and falls through to check-in / default / eclectic per R7.4
    - Keep the function pure (no I/O, no `Date.now()`); it accepts pre-filtered `recentCheckIns`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x] 3.4 Write property tests for Live_Archetype resolver
    - **Property 7: Live_Archetype returns exactly one catalog Archetype**
    - **Property 8: Live_Archetype idempotence**
    - Create `packages/shared/lib/__tests__/liveArchetype.test.ts` using fast-check
    - Generate valid `LiveArchetypeInputs` covering each branch, assert the returned archetype `id` is always present in `ARCHETYPE_CATALOG` and that two consecutive calls return the same `id` and `branch`
    - **Validates: Requirements 7.1, 7.9, 10.6, 10.7**

- [x] 4. Checkpoint — pure resolver layer green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Build the music-schedule backend feature
  - [x] 5.1 Add the `MusicSchedules` DynamoDB table accessor
    - Create `backend/src/features/music/schedule-repository.ts` exporting `getSchedule`, `upsertSchedule`, `deleteScheduleSlot`, and `queryNextTransitions(windowStart, windowEnd)` against the `MusicSchedules` table with `PK = BUSINESS#<businessId>`, `SK = SCHEDULE#<scheduleId>`, GSI `ByNextTransition`
    - Compute and write `nextTransitionAt` on every upsert based on the slot list and the schedule's IANA timezone
    - _Requirements: 3.1, 3.2, 3.10, 11.4_

  - [x] 5.2 Implement schedule-crud Lambda routes
    - Create `backend/src/features/music/handler.ts` registering `GET`, `POST`, and `DELETE /v1/business/{businessId}/music-schedule[/...]` on the existing HTTP API surface
    - Wrap with the existing JWT middleware; reject with 403 when the operator's `businessId` claim does not match the path parameter (R4.11, R4.12) without performing any DynamoDB I/O
    - Run `validateMusicSchedule` server-side on every write regardless of what the editor sends; return 400 with field-level errors on validation failure
    - On Cross_Midnight_Pair input from the editor, persist the two same-day slots per R3.12 / R4.13
    - _Requirements: 3.1, 3.5, 3.7, 3.8, 3.9, 3.11, 3.12, 4.5, 4.7, 4.11, 4.12, 4.13_

  - [x] 5.3 Write integration tests for schedule-crud
    - Create `backend/src/features/music/__tests__/handler.test.ts`
    - Cover round-trip CRUD, every validation failure path returning the correct 4xx + structured error, the Cross_Midnight_Pair split being persisted as two same-day slots and re-derivable on read, and the JWT-claims mismatch returning 403 with no DynamoDB I/O
    - _Requirements: 3.5, 3.9, 3.12, 4.5, 4.11, 4.12_

- [x] 6. Build the live-archetype evaluator and transition tick
  - [x] 6.1 Implement the live-archetype-evaluator Lambda
    - Create `backend/src/workers/live-archetype-evaluator.ts` invoked per Evaluation_Tick
    - Short-circuit immediately when `live_vibe_on_map` flag is `false` (R12.5)
    - Read the schedule (already in hand from the GSI query) and Query the `CheckIns` GSI on `(nodeId, createdAt)` for the trailing 90-minute window with a 500ms timeout; on timeout pass an empty array to the resolver
    - Call `resolveLiveArchetype`, compare to the Node's cached `lastArchetypeId`, update the cache, and emit `node:archetype_change` over the existing socket bus only when the city room has at least one subscriber (R11.5)
    - Coalesce changes within a 10s window using a warm-context `Map<nodeId, lastEmit>`
    - Emit one structured `info` log per Evaluation_Tick `{ venueId, timestamp, archetypeId, branch }` sampled at 1-in-100 in prod (R7.11)
    - _Requirements: 7.1, 7.6, 7.10, 7.11, 11.2, 11.3, 11.4, 11.5, 12.5_

  - [x] 6.2 Implement the schedule-transition-tick Lambda
    - Create `backend/src/workers/schedule-transition-tick.ts` invoked by the 60s EventBridge rule
    - Query `MusicSchedules` GSI `ByNextTransition` for `nextTransitionAt` in `[now, now + 60s]`, fan out one Evaluation_Tick to `live-archetype-evaluator` per venue
    - Catch per-venue exceptions, log, and continue with the next venue so one bad row never poisons the whole tick
    - Emit a tick-level metric: venues evaluated, changes emitted, p99 evaluator latency
    - _Requirements: 11.2, 11.4, 11.5_

  - [x] 6.3 Write integration test for transition-tick fanout and read budget
    - **Property 13: Evaluator stays inside the DynamoDB read budget**
    - **Property 14: Live delivery defers when no subscribers and recovers on reconnect**
    - Create `backend/src/workers/__tests__/schedule-transition-tick.test.ts`
    - 100-venue fanout simulation; assert ≤ 1 GetItem and ≤ 1 Query per venue per Evaluation_Tick, the no-subscribers branch skips the socket emit but still updates `lastArchetypeId`, and changes within a 10s window coalesce into a single delta
    - **Validates: Requirements 11.3, 11.4, 11.5**

- [x] 7. Wire infrastructure for the new table, rule, and Lambdas
  - [x] 7.1 Add the `MusicSchedules` DynamoDB table to Terraform
    - Edit `infra/environments/dev/main.tf` and `infra/environments/prod/main.tf` to define the `MusicSchedules` table with `billing_mode = "PAY_PER_REQUEST"`, primary key `(PK, SK)`, and a sparse GSI `ByNextTransition` keyed on `(GSI-PK = "NEXT_TRANSITION", nextTransitionAt)`
    - Use the existing DynamoDB module conventions for tags and PITR
    - _Requirements: 3.1, 3.2_

  - [x] 7.2 Add the schedule-transition-tick EventBridge rule and Lambda packaging
    - Wire `schedule-transition-tick` into the existing Lambda packaging in `infra/environments/{dev,prod}/main.tf` using `arm64` architecture; the `evaluateLiveArchetype` orchestrator runs in-process inside the same Lambda (called directly, not via `lambda.Invoke`) so no separate packaging is required
    - Add a single EventBridge rule firing every 60 seconds invoking `schedule-transition-tick`
    - Grant least-privilege IAM: read access to `MusicSchedules` (GSI + base) and `CheckIns`, update access to `Nodes` for `lastArchetypeId`, and `execute-api:ManageConnections` on the WebSocket API for the archetype-change publish
    - _Requirements: 11.4, 11.5_

  - [x] 7.3 Register the new schedule routes on the existing HTTP API
    - Add `GET`, `POST`, `DELETE /v1/business/{businessId}/music-schedule[/...]` to the existing API Gateway HTTP API IaC, wired to the schedule-crud Lambda
    - _Requirements: 3.1, 4.1_

- [x] 8. Checkpoint — backend integration green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement R1 sidebar correctness fixes (un-flagged)
  - [x] 9.1 Replace stale singletonMap access in useMapInit
    - Edit `apps/web/src/hooks/useMapInit.ts` to replace module-level `singletonMap` access in `resetNorth` and `recenterUser` with a closure over `mapRef.current`
    - Guard both callbacks with `mapRef.current?.loaded()`; on early-out emit at most one debug-level log per ignored tap
    - In `recenterUser`, read `Last_Known_Position` from `useLocationStore`, check `Date.now() - capturedAt <= 60000`, and bail otherwise
    - Expose a `pauseIdleDrift(ms)` callback used to pause idle bearing-drift for at least 4000ms after a tap
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 9.2 Update MapControls for freshness, debounce, and test ids
    - Edit `apps/web/src/components/MapControls.tsx` to:
      - Plumb a `lastKnownPositionFreshAt` value through props instead of just a boolean, and reflect freshness in the disabled affordance (`aria-disabled="true"`, reduced opacity, non-interactive cursor)
      - Share a 250ms `lastTapAt` ref between Compass_Button and Recenter_Button to debounce double-taps
      - Add `data-testid="map-sidebar-compass"` and `data-testid="map-sidebar-recenter"` to the buttons
      - Call `pauseIdleDrift(4000)` from each button's handler
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.7, 1.8_

  - [x] 9.3 Write component-level R1 tests for MapControls
    - Create `apps/web/src/components/__tests__/MapControls.r1.test.tsx`
    - Cover: data-testids present (R1.8); disabled aria/cursor state when no fresh position (R1.4); enabled when fresh; 250ms shared debounce across both buttons (R1.7); `pauseIdleDrift(4000)` is called on every accepted sidebar tap (R1.5)
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 1.8_

  - [x] 9.4 Write hook-level R1 tests for useMapInit
    - Create `apps/web/src/hooks/__tests__/useMapInit.r1.test.ts`
    - Cover: compass tap with bearing > 1° → `easeTo({ bearing: 0 })` within 1000ms (R1.1); compass tap within ±1° of 0° → no animation, no error log (R1.2); recenter tap with stale `Last_Known_Position` (>60s old) → no fly-to (R1.3, R1.4); recenter tap with fresh position → `flyTo` within 1500ms (R1.3); both buttons with `mapRef.current?.loaded() === false` → silent early-out with at most one debug log per ignored tap (R1.6); double-tap of either button within 250ms → debounced to a single intent (R1.8)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.8_

- [x] 10. Implement R2 City Pulse toast
  - [x] 10.1 Extend the toast priority map and add the city_pulse type
    - Edit `packages/shared/stores/toastStore.ts` to add `city_pulse` priority slotting between `surge` and `reward_pressure` (per the design's `TOAST_PRIORITY` map)
    - Update the toast type union and any selectors that gate on type
    - _Requirements: 2.2_

  - [x] 10.2 Implement the useCityPulseToast hook
    - Create `packages/shared/hooks/useCityPulseToast.ts` subscribing to the same `pulseScores` and `nodes` streams `MapControls` already uses
    - On first paint after `mapReady === true`, after a 2000ms grace, if `totalPulse > 0` and the data is available, enqueue a single `city_pulse` toast with the existing 6000ms auto-dismiss
    - Track dismissed-this-session via a `useToastStore` selector; only re-surface when `totalPulse` crosses from below 60 to ≥ 60 (R2.6)
    - Suppress entirely on `totalPulse === 0` and on retrieval failure without consuming the once-per-session slot (R2.9, R2.10)
    - Honour `prefers-reduced-motion` via the existing `LiveToast` component
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10_

  - [x] 10.3 Remove the legacy permanent City Pulse glass card
    - Delete the legacy permanent City_Pulse glass card from `apps/web/src/components/MapControls.tsx` unconditionally; the City_Pulse readout lives only on the toast going forward (R2.7, R12.4)
    - Mount `useCityPulseToast()` from `apps/web/src/screens/MapScreen.tsx` via a `CityPulseToastMount` wrapper so the toast surfaces only on the map tab
    - _Requirements: 2.5, 2.7, 12.4_

  - [x] 10.4 Write tests for the City Pulse toast behaviour
    - Create `packages/shared/hooks/__tests__/useCityPulseToast.test.ts` covering: once per session by default; re-surface on cross from < 60 to ≥ 60; suppressed on `totalPulse === 0` without burning the slot; suppressed on retrieval failure; auto-dismiss after 6000ms; `prefers-reduced-motion` respected; not rendered while on a tab other than the map
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10_

- [x] 11. Implement R8 Archetype glyph as the live-map node
  - [x] 11.1 Create the shared archetype glyph registry
    - Create `packages/shared/constants/archetype-glyphs.tsx` exporting a `Record<iconId, ReactNode>` of inline SVGs (each painting with `fill="currentColor"`) for every catalog `iconId`, plus a `dynamicContrastForCategory(category)` helper that picks white or near-black so the silhouette/outline pair clears the WCAG 3:1 floor
    - Add a build-time check that every catalog `iconId` has a registered glyph
    - _Requirements: 8.2, 8.7, 8.9_

  - [x] 11.2 Implement the ArchetypeGlyph component
    - Create `apps/web/src/components/ArchetypeGlyph.tsx` accepting `{ archetypeId, pulseState, category, size? }`
    - Render the registered glyph; on missing `iconId` render a generic dot fallback and (in dev builds only) emit one `console.warn` per session per missing id
    - Stack the glyph SVG twice: a stroked outline pass underneath in `dynamicContrastForCategory(category)` colour, a fill pass on top in `getCategoryColour(category)` colour. Pair with the `.archetype-glyph-outline svg` rule in `packages/shared/tokens.css` so the outline pass strokes every nested SVG with `paint-order: stroke` and a width that scales with size
    - Render at 50-55% opacity for `dormant`, 100% otherwise
    - Share the marker wrapper's breathe / pulse animation so the scale curve stays within 16ms of the halo
    - On `archetypeId` prop change, crossfade the new glyph over 400ms ± 20ms with linear easing using the two-phase opacity transition (no intermediate frame at 0% opacity)
    - Render at no smaller than 8px
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [x] 11.3 Make the ArchetypeGlyph the marker in the map renderer
    - Edit `apps/web/src/hooks/useMapMarkers.ts` to drop the legacy core / ring / inner-ring layers; the only retained chrome is the halo, the popping ripple, and the live-count badge. Mount `<ArchetypeGlyph archetypeId={archetypeId} pulseState={state} category={category} />` inside a `glyph-wrapper` element that owns the per-state breathe / pulse animation, the category-coloured drop-shadow, and the click target
    - Glyph renders unconditionally (no flag gate). Source `archetypeId` from `useMapStore((s) => s.archetypeIds[nodeId] ?? node.defaultArchetypeId ?? 'archetype-eclectic')`
    - _Requirements: 8.1, 12.4_

  - [x] 11.4 Surface the glyph and display name in the node detail sheet
    - Edit the existing node detail sheet to render the resolved `ArchetypeGlyph` and `getArchetypeDisplayName(archetype.id)` alongside the existing `CrowdVibeSection`, without further interaction
    - _Requirements: 8.10, 9.6_

  - [x] 11.5 Write the contrast property test for ArchetypeGlyph
    - **Property 10: Archetype_Glyph silhouette ≥ 3:1 against its outline**
    - Create `apps/web/src/components/__tests__/ArchetypeGlyph.contrast.test.tsx`
    - Enumerate the cross-product (15 archetypes × 5 pulse states × 6 categories) at the smallest supported glyph size; assert the silhouette colour (category hex) vs the outline colour (`dynamicContrastForCategory(category)`) produces a contrast ratio ≥ 3:1 using a colour-pair contrast helper. Pulse_State does not affect the formula because both layers render at 1.0 opacity inside the SVG and the wrapper opacity scales them together
    - **Validates: Requirements 8.9, 10.10**

- [x] 12. Implement live archetype delivery on the web client
  - [x] 12.1 Add the useNodeArchetype hook
    - Create `packages/shared/hooks/useNodeArchetype.ts` mirroring `useNodePulse`: subscribe to `node:archetype_change`, write into `useMapStore.archetypeIds[nodeId]`, and reset a 5-minute `setTimeout` per `nodeId` on each update so cached values clear after the retention window
    - On reconnect, replace cached values from the next live nodes payload's `liveArchetypeId`
    - _Requirements: 11.1, 11.2, 11.6, 11.7_

  - [x] 12.2 Extend mapStore for archetypeIds
    - Edit `packages/shared/stores/mapStore.ts` to track `archetypeIds: Record<NodeId, string>` and the `setArchetypeId(nodeId, id)` setter
    - _Requirements: 11.1, 11.2, 11.6, 11.7_

  - [x] 12.3 Mount useNodeArchetype on the map screen
    - Mount `useNodeArchetype()` from `apps/web/src/screens/MapScreen.tsx` (via a flag-gated `LiveArchetypeSubscriber` wrapper) so the subscription is a no-op while the flag is `false`
    - _Requirements: 11.1, 12.4, 12.6_

  - [x] 12.4 Write tests for useNodeArchetype reconnect behaviour
    - Create `packages/shared/hooks/__tests__/useNodeArchetype.test.ts`
    - Assert: cached value is kept for ≤ 5 minutes after disconnect; on reconnect the next live nodes payload's `liveArchetypeId` replaces the cache for visible nodes; flag flip from `false` → `true` recovers within one socket reconnect cycle
    - _Requirements: 11.6, 11.7, 12.6_

- [x] 13. Implement the Schedule_Editor in Business_Portal
  - [x] 13.1 Create the MusicSchedulePanel screen and tab entry
    - Create `apps/business/src/screens/MusicSchedulePanel.tsx` rendering a horizontal week view (MON-SUN, 24-hour timeline) with each Schedule_Slot drawn as a coloured band
    - Add a "Music Schedule" tab to the existing nav in `apps/business/src/screens/BusinessDashboard.tsx`
    - Render an empty-state with a one-tap "Add first slot" action when no slots exist
    - When the operator's JWT claims do not include the venue's `businessId`, render a denial state and do not issue any schedule API requests
    - _Requirements: 4.1, 4.2, 4.10, 4.11, 4.12_

  - [x] 13.2 Implement the slot editor sheet and inline validation
    - Create the slot editor sheet with day-of-week, start/end `HH:mm`, mode toggle (`blanket` / `lineup`), genre multi-select, and the lineup builder
    - Pre-seed one LineupEntry at the slot's start time when the operator switches `blanket → lineup`, mirroring the blanket genres
    - Run inline validation by calling the shared `schedule-validator.ts` on every change; disable Save while any error is present; show overlap conflicts inline against existing slots for the same `(businessId, dayOfWeek)`
    - On successful save, POST to `/v1/business/{businessId}/music-schedule`; surface server validation errors inline on failure and keep dirty state
    - On delete, require a confirmation step; on API failure keep the slot in the UI and surface a retry affordance
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 13.3 Implement Cross_Midnight_Pair handling in the editor
    - Detect cross-midnight drafts via `endTime <= startTime` and surface the friendly inline notice ("we'll save it as two halves on …") rather than a hard error
    - On save, split the draft into a Cross_Midnight_Pair per R3.12 (`pair-<base>-a` ending `23:59` on the entered day, `pair-<base>-b` starting `00:00` on the next day) preserving `mode`; for `blanket` mode copy the genres to both halves; for `lineup` mode keep entries before the cutoff on half A and move entries at or after `00:00` to half B, forcing half B's first LineupEntry to `00:00` per R3.7
    - On read, derive pairs from the `pair-<base>-a/-b` slotId convention via `derivePairs` and render both halves as a single visual band that spans the day boundary using a stable per-base hue; half-pairs (only A or only B survived) are surfaced as singletons so no slot is silently dropped
    - When the operator opens one half of a pair, merge both halves into a virtual ScheduleSlot via `mergePairForEditing` (start on day A at A.startTime, end at B.endTime so the cross-midnight branch fires) so editing always operates on the pair as a unit (R4.14)
    - On save reuse the existing pair `base` so both halves are replaced, never duplicated; if the operator collapses a previously cross-midnight slot to a same-day slot, promote to a fresh non-pair slotId and strip the orphan halves from the proposed schedule
    - On delete, POST a single full schedule with both halves removed so the pair-delete is atomic from the operator's perspective
    - _Requirements: 4.13, 4.14_

  - [x] 13.4 Write integration tests for the Schedule_Editor
    - Create `apps/business/src/screens/__tests__/MusicSchedulePanel.test.tsx`
    - Cover: validation surfacing inline (time format, ordering, mode-specific genre/lineup including the first-entry-aligned-with-slot-start rule, IANA timezone); overlap conflict blocks save; delete confirmation + API-failure retry; Cross_Midnight_Pair save split + render-as-single-band + edit-as-unit; denial state when JWT claims do not include the venue's `businessId`
    - _Requirements: 4.5, 4.6, 4.7, 4.8, 4.9, 4.11, 4.12, 4.13, 4.14_

- [x] 14. Apply the archetype rename across consumer surfaces
  - [x] 14.1 Swap consumer surfaces from `archetype.name` to `getArchetypeDisplayName`
    - Replace every consumer-facing render of `archetype.name` (live map, node detail sheet, profile screen, archetype reveal modal) with `getArchetypeDisplayName(archetype.id)`
    - Leave the catalog `name` field intact; do not modify the admin Archetype management screen except to render id and display name side-by-side as required by R9.7
    - On any unknown `archetypeId` at render time, render the raw id and emit a non-blocking observability warning (R9.10)
    - _Requirements: 9.6, 9.7, 9.10_

  - [x] 14.2 Update the archetype reveal modal with description and etymology
    - Edit the existing reveal component to render `getArchetypeDisplayName(archetype.id)` plus the catalog `description` (R9.11) and, when `getArchetypeEtymology` returns a string, an italicised etymology line beneath the display name
    - Ensure the same component is reachable from the consumer profile screen for re-reading
    - For `archetype-uncharted`, also surface the existing helper copy ("Connect a streaming service or pick your genres") so the rename does not erase the call to action
    - _Requirements: 9.8, 9.11, 9.12_

- [x] 15. Final checkpoint — full feature green behind the flag
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Tier-driven glyph size multiplier (boost = paid lever, halo = honest lever)
  - [ ] 16.1 Expose `businessTier` on the nodes-for-city REST payload
    - Edit `backend/src/features/nodes/repository.ts` `getNodesByCitySlug` to include the owning business's `tier` field in the returned node objects (already fetched during the paid-tier filter pass — just pass it through)
    - Add `businessTier?: BusinessTier` to the shared `Node` interface in `packages/shared/types/index.ts`; default to `'starter'` when absent on the client
    - _Requirements: 8.1 (size driven by tier), 12.4 (data plumbing)_

  - [ ] 16.2 Add `TIER_SIZE_MULTIPLIER` constant and apply in `useMapMarkers.ts`
    - Create `packages/shared/constants/tier-size.ts` exporting `TIER_SIZE_MULTIPLIER: Record<BusinessTier, number>` with values `{ free: 1.0, starter: 1.0, payg: 1.0, growth: 1.3, pro: 1.6 }`
    - In `useMapMarkers.ts`, multiply the base glyph size (`getGlyphSize(state, score)`) by `TIER_SIZE_MULTIPLIER[node.businessTier ?? 'starter']` so tier drives size independently of pulse score
    - Halo radius stays proportional to the multiplied glyph size (bigger venue = bigger halo radius) but halo brightness/speed stays locked to pulse score only — no tier influence on animation
    - _Requirements: 8.1 (size = paid lever), 8.5 (halo = honest lever)_

  - [ ] 16.3 Smooth size transition on tier change
    - Add a CSS `transition: width 400ms ease, height 400ms ease` on the `glyph-wrapper` element in `buildMarkerElement` so a mid-session tier upgrade rescales smoothly rather than snapping
    - _Requirements: 8.6 (crossfade / smooth transitions)_

  - [ ] 16.4 Write property test: glyph size is non-decreasing with tier rank
    - Create `apps/web/src/hooks/__tests__/useMapMarkers.tier-size.test.ts`
    - For every (Pulse_State × score × tier) triple, assert `glyphSize(state, score, tierA) <= glyphSize(state, score, tierB)` whenever `tierRank(tierA) <= tierRank(tierB)`
    - Assert that halo animation speed is identical across tiers for the same Pulse_State (tier does not buy brightness)
    - **Validates: size = paid lever, halo = honest lever invariant**

  - [ ] 16.5 Confirm free-tier exclusion from the map (existing behaviour)
    - Write a focused integration test in `backend/src/features/nodes/__tests__/repository.test.ts` asserting that `getNodesByCitySlug` returns zero nodes for businesses with `tier = 'free'`
    - This is existing behaviour (the `PAID_TIERS_SET` filter) but not currently tested — pin it so a future refactor can't accidentally expose free-tier venues
    - _Requirements: map visibility = paid subscription only_

- [ ] 17. Checkpoint — tier-driven size green
  - Run all new tests from 16.x plus the existing contrast test (which should still pass since tier doesn't affect the silhouette/outline colour pairing)
  - Ensure no regressions in the full task 15 surface

## Notes

- The R1 sidebar fixes (Task 9) are pure bug fixes and ship un-flagged per R12.7
- The City Pulse toast (Task 10) ships un-flagged — the legacy permanent glass card is removed unconditionally
- The Archetype_Glyph is the marker (no more coloured core circle) and renders unconditionally; only the live `node:archetype_change` subscription is gated by `live_vibe_on_map`
- Glyph size is driven by `businessTier` (the paid lever); halo brightness/speed is driven by pulse score from real check-ins (the honest lever). These are independent channels — tier cannot buy halo brightness, and check-ins cannot buy size
- Free-tier businesses (`tier = 'free'`) do not appear on the map at all (existing `PAID_TIERS_SET` filter in `getNodesByCitySlug`)
- Dynamic pricing (adjusting subscription cost based on neighbourhood demand) is deferred to a separate spec — the data foundation (`businessTier` on the node payload, the existing `neighbourhoodId` field) is in place for it to hook into
- All Lambdas are arm64; the `MusicSchedules` table is PAY_PER_REQUEST; no new always-on resources are introduced (no ECS, RDS, ElastiCache, ALB, NAT Gateway)
- The R9 rename is id-stable: no DynamoDB migration is required and the catalog `name` field is preserved for admin tools (Property 15)
- Property tests use the existing `fast-check` setup that already lives in `packages/shared/lib/__tests__/`
- The `live-archetype-evaluator` runs in-process inside the `schedule-transition-tick` Lambda (called directly, not via `lambda.Invoke`) and short-circuits on `live_vibe_on_map === false`, so the worker can be deployed before the flag flip without consuming DynamoDB budget

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4"] },
    { "id": 1, "tasks": ["1.3", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.2"] },
    { "id": 3, "tasks": ["2.3", "3.3", "5.1", "11.1"] },
    { "id": 4, "tasks": ["3.4", "5.2", "6.1", "11.2", "12.2", "13.1"] },
    { "id": 5, "tasks": ["5.3", "6.2", "7.1", "7.3", "10.1", "11.3", "12.1", "13.2", "14.1"] },
    { "id": 6, "tasks": ["6.3", "7.2", "9.1", "10.2", "11.4", "11.5", "12.3", "13.3", "14.2"] },
    { "id": 7, "tasks": ["9.2", "10.3", "12.4", "13.4"] },
    { "id": 8, "tasks": ["9.3", "9.4", "10.4"] },
    { "id": 9, "tasks": ["16.1"] },
    { "id": 10, "tasks": ["16.2", "16.5"] },
    { "id": 11, "tasks": ["16.3", "16.4"] },
    { "id": 12, "tasks": ["17"] }
  ]
}
```
