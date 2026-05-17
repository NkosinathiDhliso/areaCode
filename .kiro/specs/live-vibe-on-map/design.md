# Design Document

## Overview

Live Vibe on Map is five small features carried by one shared idea: **a venue's identity at any moment is its current archetype, computed from a deterministic schedule and rendered the same way everywhere.** That sentence drives every architectural choice below.

This design is grounded in the existing codebase, not in fiction. Every component named here either exists already (and is referenced by file path) or is a small extension to something that does. No new always-on resources are introduced. All persistence stays on DynamoDB PAY_PER_REQUEST. The SMS / phone-OTP architectural ban is preserved without exception — this feature touches authentication zero times.

The five user-visible deliverables map cleanly to layers:

| Requirement                  | Layer                     | Existing surface extended                                                                  |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| R1 Map sidebar correctness   | web frontend              | `apps/web/src/hooks/useMapInit.ts`, `apps/web/src/components/MapControls.tsx`              |
| R2 City Pulse toast          | web frontend              | `packages/shared/stores/toastStore.ts`, `apps/web/src/components/ToastOverlay.tsx`         |
| R3-R4 Schedule data + editor | backend + business portal | New Lambda routes; new screen in `apps/business`                                           |
| R5-R7 Resolvers              | shared lib                | `packages/shared/lib/archetypeResolver.ts` (existing); new sibling modules                 |
| R8 Archetype glyph           | web frontend              | Node renderer; new shared glyph registry                                                   |
| R9 Archetype rename          | shared constants          | `packages/shared/constants/archetype-catalog.ts` (id-stable); new rename module            |
| R10 Property tests           | shared lib + backend      | Existing `fast-check` setup (`archetypeResolver.test.ts`, `toastStore.test.ts`)            |
| R11 Live delivery            | backend                   | Existing socket bus (`backend/src/shared/socket/events.ts`); new EventBridge rule + Lambda |
| R12 Flag + rollback          | shared lib                | `packages/shared/lib/featureGating.ts`                                                     |

The entire feature ships behind a single feature flag (`live_vibe_on_map`) defaulting to `false`, except the R1 sidebar bug fixes which ship un-flagged per R12.7 because they are pure bug fixes with no rollback risk.

## Architecture

### High-level shape

```
┌────────────────────────────────────────────────────────────────────────┐
│                          apps/web (consumer)                           │
│                                                                        │
│   MapScreen ── MapControls (R1)                                        │
│       │             │                                                  │
│       │             └─ Compass (resetNorth + freshness pause)          │
│       │             └─ Recenter (Last_Known_Position freshness gate)   │
│       │                                                                │
│       ├─ ToastOverlay ── CityPulseToast (R2)                          │
│       │                                                                │
│       └─ VenueNode ── ArchetypeGlyph (R8)                             │
│             │                                                          │
│             └─ subscribes to 'node:archetype_change' (R11.2)          │
└────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │  socket.io (existing)
                                  │
┌────────────────────────────────────────────────────────────────────────┐
│                                Backend                                 │
│                                                                        │
│   API Gateway (HTTP) ── Schedule routes (R3-R4)                        │
│            │                                                           │
│            └─ Lambda: schedule-crud  ── DynamoDB MusicSchedules        │
│                                                                        │
│   EventBridge (60s rule, R11.5)  ── Lambda: schedule-transition-tick   │
│            │                                                           │
│            └─ for each venue with an Active_Slot transition: emit     │
│               an Evaluation_Tick                                       │
│                                                                        │
│   Lambda: live-archetype-evaluator (R7, R11.4)                         │
│            │                                                           │
│            ├─ DynamoDB GetItem (MusicSchedules)                       │
│            ├─ DynamoDB Query (recent CheckIns, 90-min window)         │
│            └─ socket emit 'node:archetype_change'                     │
│                                                                        │
│   Lambda: city-pulse-aggregator (existing)                             │
│            └─ same pulse stream, no changes                            │
└────────────────────────────────────────────────────────────────────────┘
```

### Data flow for a single Active_Slot transition

1. Operator saves a Schedule_Slot via Schedule_Editor → `POST /v1/business/music-schedule` → `schedule-crud` Lambda → DynamoDB `MusicSchedules` table → `updatedAt` refreshed (R3.10).
2. EventBridge rule fires every 60s → `schedule-transition-tick` Lambda → scans MusicSchedules' GSI by `nextTransitionAt`, finds venues whose `[startTime, endTime)` boundary lies in the next 60s window.
3. For each such venue, `schedule-transition-tick` invokes `live-archetype-evaluator` once with one Evaluation_Tick.
4. `live-archetype-evaluator` runs the Live_Archetype resolver pure function. If the resolved Archetype `id` differs from the cached previous value (held in DynamoDB attribute `lastArchetypeId` on the Node), it emits `node:archetype_change` on the city room. The cached previous value is updated.
5. Web client receives the event in a new `useNodeArchetype` hook, updates `mapStore.archetypeIds[nodeId]`, and the VenueNode crossfades the new glyph (R8.6).
6. R11.5: if no consumer is subscribed to that city room (`io.in(cityRoom(citySlug)).fetchSockets().length === 0`), the evaluator skips the socket emit. The cached value still updates so the next subscription gets the right value.

### Why a 60s EventBridge rule instead of a step function or per-slot schedule

Per-slot scheduling would mean creating an EventBridge schedule per Schedule_Slot per venue — at 100 venues × 14 slots/week, that's 1,400 schedules with churn. EventBridge schedules are free but the management overhead and IaC churn are not.

A single 60s rule with a fan-out scan is bounded: the GSI on `nextTransitionAt` returns ≤100 venues per minute even at 10× current scale, each Evaluation_Tick is ≤10ms of compute, and the whole system stays inside Lambda free-tier-ish bounds. This is the same pattern the existing pulse aggregator already uses, so we're not introducing a new operational model.

The 60s granularity is acceptable because the spec's R11.2 worst-case latency budget is 5000ms only when **subscribed**; for un-subscribed venues, R11.5 explicitly defers recomputation, and a brand-new subscription always recomputes immediately on connect. A 60-second tick only matters for the small subset of venues whose Active_Slot transition happens to fire during a moment where someone is watching but no other event has woken the evaluator.

## Components and Interfaces

### Frontend: R1 sidebar correctness

The bug today lives in two places. `useMapInit.ts` lines 290-310 holds `resetNorth` and `recenterUser`. Both reach for a module-level `singletonMap`, so when the map instance has been torn down and recreated (the `retryMap` path), the callbacks point at a stale reference and silently no-op. `recenterUser` reads `useLocationStore.getState().lastKnownPosition` but never checks `capturedAt` for freshness.

Fix shape:

- Replace `singletonMap` access with a closure over `mapRef.current`. The callback is recreated whenever the ref changes, so a teardown-recreate cycle wires the latest map.
- Wrap both callbacks in a guard that checks `mapRef.current?.loaded()` (R1.6) and emits a debug log on early-out.
- `recenterUser`: read `Last_Known_Position`, check `Date.now() - capturedAt <= 60000` (R1.3), bail otherwise.
- Add a 250ms debounce shared between Compass_Button and Recenter_Button (R1.8). The simplest implementation is a `lastTapAt` ref shared between both buttons in `MapControls`.
- Add a 4000ms idle-drift pause (R1.5). The bearing-drift idle is in `useMapInit.ts` already; expose a `pauseIdleDrift(ms)` callback and call it from both R1 buttons.
- Add `data-testid="map-sidebar-compass"` and `data-testid="map-sidebar-recenter"` to the buttons in `MapControls.tsx` (R1.7).
- The disabled-state rendering for Recenter_Button (R1.4) extends the existing `disabled={!hasUserLocation}` to also reflect freshness. Plumb a `lastKnownPositionFreshAt` value through `MapScreen` instead of just the boolean.

The sidebar fixes ship un-flagged. They have no rollback dependency — they are correctness-of-existing-behaviour fixes.

### Frontend: R2 City Pulse toast

The Toast_System (`packages/shared/stores/toastStore.ts`) already has a priority queue capped at 3 entries. We add a new toast type `'city_pulse'` slotting in below `surge` (priority 1) and above `reward_pressure` (priority 2):

```ts
const TOAST_PRIORITY: Record<string, number> = {
  surge: 1,
  city_pulse: 2, // NEW
  reward_pressure: 3, // bumped
  checkin: 4,
  reward_new: 4,
  streak: 5,
  leaderboard: 5,
}
```

A new hook `useCityPulseToast()` in `packages/shared/hooks/`:

- Subscribes to the same `pulseScores` and `nodes` streams `MapControls` already uses today.
- On first paint after `mapReady === true`, after a 2000ms grace (R2.1), if `totalPulse > 0` (R2.9) and the data is available (R2.10), enqueues a single `city_pulse` toast.
- Tracks dismissed-this-session via a `useToastStore` selector. Once dismissed, the toast is not re-enqueued unless the cross-from-below-60-to-≥60 condition fires (R2.6).
- Auto-dismiss is the existing 6000ms behaviour in `ToastOverlay.tsx`.
- `prefers-reduced-motion` (R2.8) is already honoured by the `LiveToast` shared component; no change needed.

The legacy permanent City_Pulse glass card in `MapControls.tsx` is removed unconditionally — the City_Pulse readout lives only on the toast (R2.7, R12.4). `MapControls` keeps its compass / recenter / 3D buttons; the small "LIVE" pill below the buttons (gated only by `totalPulse > 0`) is the only City_Pulse-derived chrome that remains in the cluster.

### Backend: R3 Music Schedule data model

New DynamoDB table `MusicSchedules`:

```
PK = BUSINESS#<businessId>
SK = SCHEDULE#<scheduleId>

Attributes:
  businessId       String
  scheduleId       String
  timezone         String  (IANA)
  slots            List<Map> (denormalised, see below)
  updatedAt        String  (ISO-8601 ms)
  nextTransitionAt String  (ISO-8601, used by GSI)
  schemaVersion    Number  (currently 1)

GSI: ByNextTransition
  GSI-PK = "NEXT_TRANSITION"  (constant)
  GSI-SK = nextTransitionAt
```

Each `slot` Map looks like:

```
{
  slotId:        String  (uuid)
  dayOfWeek:     "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
  startTime:     String  ("HH:mm")
  endTime:       String  ("HH:mm")
  startTimeMin:  Number  (0..1439, computed and stored alongside for ordering)
  endTimeMin:    Number  (0..1439)
  mode:          "blanket" | "lineup"
  genres:        List<String>     (only when mode = blanket)
  lineup:        List<Map>        (only when mode = lineup)
}
```

`startTimeMin` and `endTimeMin` are stored on disk so the validator's R3.5 minutes-since-midnight comparison stays cheap and any future schema migration that changes `startTime`/`endTime` cannot silently corrupt ordering.

The Cross_Midnight_Pair contract (R3.12) lives in the Schedule_Editor; the data model never holds a wrap-around slot. The pairing is derivable on read by joining slots in the same `(businessId, mode)` where `endTimeMin === 1439` on day N and `startTimeMin === 0` on day N+1 (and matching genres or matching lineup tail/head).

`billing_mode = "PAY_PER_REQUEST"` per R3.1 and the serverless steering rule.

### Backend: R3-R4 Schedule routes

New routes added to the existing business-portal API surface:

```
GET    /v1/business/{businessId}/music-schedule
POST   /v1/business/{businessId}/music-schedule         (upsert)
DELETE /v1/business/{businessId}/music-schedule/{slotId}
```

All three require business-operator JWT claims to include `businessId` (R4.11/R4.12), enforced by the existing JWT middleware. The validator runs all R3 checks server-side regardless of what the editor sends — never trust the client (R3.5, R3.7-R3.9, R3.11). Validation lives in a new `packages/shared/lib/schedule-validator.ts` so the editor and the Lambda use the same code, eliminating drift.

Validation order matters because it determines the error message the operator sees. Order:

1. Schema shape (Zod) — rejects malformed payloads with field-level errors.
2. Per-slot field validity (`HH:mm` regex, dayOfWeek, mode, IANA timezone) — R3.4, R3.5, R3.11.
3. Per-slot internal consistency (`startTimeMin < endTimeMin`, mode-specific genres or lineup with first-entry-aligned-with-slot-start, unique LineupEntry start times, no top-level genres in lineup mode) — R3.5, R3.7.
4. Cross-slot consistency (overlap detection per `(businessId, dayOfWeek)`) — R3.9.
5. Cross_Midnight_Pair pairing consistency, if applicable — R3.12.

### Shared lib: R5 Schedule Resolver

New module `packages/shared/lib/scheduleResolver.ts`:

```ts
export interface ResolvedSlot {
  slot: ScheduleSlot
  lineupEntry?: LineupEntry // present iff mode === 'lineup'
}

export function resolveActiveSlot(schedule: MusicSchedule, timestampIso: string): ResolvedSlot | null
```

The function:

1. Validates the schedule (R5.3) and the timestamp (R5.2). Validation failures throw a tagged `ScheduleValidationError`.
2. Converts the timestamp to the schedule's IANA timezone using the runtime's Intl APIs (Node 22 Lambda + modern browsers both have full ICU). The conversion produces `(dayOfWeek, minutesSinceMidnight)`.
3. Filters slots by `dayOfWeek` and finds the unique slot where `startTimeMin <= minutesSinceMidnight < endTimeMin`. Validation guarantees at most one match (R3.9 + R5.6).
4. If no slot matches, returns `null` (R5.5).
5. If the matching slot is `lineup` mode, finds the LineupEntry whose `startTimeMin` is the greatest value not exceeding the timestamp's minutes (R5.7). R3.7's first-entry-aligned-with-slot-start invariant guarantees exactly one match. If no entry matches, throws `ScheduleResolverInternalError` (R5.8) with the slotId and timestamp; this is a programmer error, not a runtime fallback.

The function is **observably pure** (R5.9, R10.3): no I/O, no `Date.now()`, no globals. The caller passes the timestamp in.

### Shared lib: R6 Genre→Archetype mapping

New module `packages/shared/lib/genreToArchetype.ts`. This is a thin wrapper over the existing `archetypeResolver.ts`:

```ts
export function genresToArchetype(genres: MusicGenre[] | Set<MusicGenre>): PersonalityArchetype
```

Behaviour:

- Empty input → `archetype-uncharted` (R6.3).
- Unknown genre → `archetype-uncharted` + emits a structured warning (R6.4).
- Otherwise computes `DimensionScoreVector` via `computeDimensionScores(genres, GENRE_WEIGHT_MATRIX)` and returns `resolveArchetype(scores, ARCHETYPE_CATALOG)`.
- Order-independence (R6.6, R10.4) is automatic because `computeDimensionScores` averages weights across genres — addition is commutative.
- Determinism (R6.7) is automatic because both upstream functions are pure.

### Shared lib: R7 Live_Archetype resolver

New module `packages/shared/lib/liveArchetype.ts`:

```ts
export interface LiveArchetypeInputs {
  node: Node
  schedule?: MusicSchedule
  recentCheckIns: CheckIn[] // already filtered to the 90-min window
  timestampIso: string
}

export interface LiveArchetypeResult {
  archetype: PersonalityArchetype
  branch: 'schedule_lineup' | 'schedule_blanket' | 'checkin_mode' | 'default' | 'eclectic_fallback'
}

export function resolveLiveArchetype(inputs: LiveArchetypeInputs): LiveArchetypeResult
```

The function calls `resolveActiveSlot` first. The branch decision tree mirrors R7 verbatim:

| Active_Slot | Mode    | Check-ins in window  | Default archetype  | Branch              |
| ----------- | ------- | -------------------- | ------------------ | ------------------- |
| present     | lineup  | —                    | —                  | `schedule_lineup`   |
| present     | blanket | —                    | —                  | `schedule_blanket`  |
| absent      | —       | ≥1 with catalog id   | —                  | `checkin_mode`      |
| absent      | —       | none with catalog id | present in catalog | `default`           |
| absent      | —       | none with catalog id | absent             | `eclectic_fallback` |

The `branch` field returned alongside the archetype is what the Lambda will log per R7.11 — the resolver doesn't log itself (still pure). The Lambda is the I/O boundary.

The check-in lookup (R7.6) tie-break is `(highest count) → (lowest catalog priority) → (lexicographically smallest id)`. The "lowest catalog priority" rule means a tie between `archetype-festival-spirit` (priority 15) and `archetype-eclectic` (priority 2) resolves to `archetype-eclectic`. That's intentional: when the data is genuinely ambiguous, the catalog's least-distinctive label is the most honest label.

The 500ms timeout for check-in lookup (R7.10) lives in the Lambda, not the pure function. The pure function takes `recentCheckIns` already filtered. If the Lambda can't fetch them, it passes an empty array and the function falls through to the default branch.

### Shared constants: R9 Archetype rename module

New module `packages/shared/constants/archetype-names.ts`:

```ts
export interface ArchetypeNameEntry {
  id: string
  displayName: string
  etymology?: string // present only for non-English names (R9.12)
}

export const ARCHETYPE_NAMES: Readonly<Record<string, ArchetypeNameEntry>> = Object.freeze({
  'archetype-festival-spirit': { id: 'archetype-festival-spirit', displayName: 'Blaze' },
  'archetype-conscious-creative': { id: 'archetype-conscious-creative', displayName: 'Lumen' },
  'archetype-township-royal': {
    id: 'archetype-township-royal',
    displayName: 'Kasi',
    etymology: 'isiZulu and isiXhosa for township; a word of pride, born in South Africa.',
  },
  'archetype-sacred-rebel': { id: 'archetype-sacred-rebel', displayName: 'Hymn' },
  'archetype-firecracker': { id: 'archetype-firecracker', displayName: 'Spark' },
  'archetype-heritage-groover': { id: 'archetype-heritage-groover', displayName: 'Drum' },
  'archetype-midnight-philosopher': { id: 'archetype-midnight-philosopher', displayName: 'Noir' },
  'archetype-street-poet': { id: 'archetype-street-poet', displayName: 'Verse' },
  'archetype-soul-wanderer': { id: 'archetype-soul-wanderer', displayName: 'Drift' },
  'archetype-vibe-architect': { id: 'archetype-vibe-architect', displayName: 'Cipher' },
  'archetype-smooth-operator': { id: 'archetype-smooth-operator', displayName: 'Velvet' },
  'archetype-groove-seeker': { id: 'archetype-groove-seeker', displayName: 'Bounce' },
  'archetype-culture-curator': { id: 'archetype-culture-curator', displayName: 'Root' },
  'archetype-eclectic': { id: 'archetype-eclectic', displayName: 'Prism' },
  'archetype-uncharted': { id: 'archetype-uncharted', displayName: 'Compass' },
})

export function getArchetypeDisplayName(id: string): string {
  return ARCHETYPE_NAMES[id]?.displayName ?? id
}

export function getArchetypeEtymology(id: string): string | undefined {
  return ARCHETYPE_NAMES[id]?.etymology
}
```

A build-time test (R9.4) asserts:

- `Object.keys(ARCHETYPE_NAMES).length === ARCHETYPE_CATALOG.length`.
- Every catalog `id` has an entry.
- Every entry's `displayName` is 3-8 characters and matches `/^[A-Z][a-z]+$/` (R9.1).

Every consumer-facing surface that today renders `archetype.name` switches to `getArchetypeDisplayName(archetype.id)`. The `archetype.name` field on the catalog is **not removed** — admin tools still show it (R9.7). Removing it would create the migration burden R9.2 was built to avoid.

R9.13's "no per-locale override" rule is enforced at the type level by the function signature: `getArchetypeDisplayName` takes only an `id` and a future locale parameter cannot be added without a code review touching this central module. If a future i18n requirement asks for a localised name, the answer is "translate the description in R9.11, not the display name."

### Frontend: R8 Archetype glyph as the live-map node

The previous design overlaid a small glyph on a category-coloured node-core circle. The new design retires that core circle entirely: the glyph itself is the marker. Halo + popping ripple stay because they are the Pulse_State channel; the glyph carries identity (which archetype the venue is catering to right now) and the category channel (silhouette colour).

New component `apps/web/src/components/ArchetypeGlyph.tsx`:

```tsx
interface ArchetypeGlyphProps {
  archetypeId: string
  pulseState: NodeState
  category: NodeCategory
  size?: number // defaults to 32px; clamped to a floor of 8px
}
```

Behaviour:

- Looks up `iconId` from `ARCHETYPE_CATALOG` (the `id`→`iconId` map is stable per R9.3).
- Uses the shared glyph registry `packages/shared/constants/archetype-glyphs.tsx` exporting a `Record<iconId, ReactNode>` of inline SVGs that all paint with `fill="currentColor"`.
- Falls back to a generic dot SVG if `iconId` is not in the registry (R8.7), and logs once per session in dev builds (R8.8).
- Opacity rule (R8.3, R8.4): `dormant → 0.55`, all other states → `1.0`. The dormant level was lifted from 0.4 in the previous design because the glyph is no longer composited against a coloured core background — its visual recession comes from the wrapper opacity scaling the silhouette + outline pair against the basemap, not from collapsing the contrast against a sibling fill.
- Inherits the existing breathe / pulse animation by being mounted inside the marker's `glyph-wrapper` element, which owns the per-state animation. The halo runs the same animation in parallel so the two scale curves stay within 16ms of each other (R8.5).
- On `archetypeId` prop change, transitions opacity in two phases via CSS — fade in the new glyph from 0.99 → 1.0 while keeping the previous frame for 400ms, then unmount the old. This sidesteps the R8.6 "no intermediate frame at 0% opacity" trap.
- Contrast is enforced by stacking the glyph SVG twice: a stroked outline pass underneath in `dynamicContrastForCategory(category)`'s colour, and a fill pass on top in the venue's category colour from `getCategoryColour(category)`. Each registered SVG paints with `fill="currentColor"`, so the wrapper sets `color` per layer and the global CSS rule `.archetype-glyph-outline svg { paint-order: stroke; stroke: currentColor; ... }` adds the stroke for the outline pass. The R10.10 property test asserts ≥ 3:1 silhouette/outline contrast across the cross-product (15 archetypes × 5 pulse states × 6 categories = 450 cells); pulse_state does not enter the contrast formula because both layers render at 1.0 opacity inside the SVG and the wrapper's CSS opacity scales them together.

The Node renderer (`apps/web/src/hooks/useMapMarkers.ts`) drops the legacy core / ring / inner-ring layers and renders one `glyph-wrapper` element instead. The wrapper carries the per-state animation, the category-coloured `drop-shadow` filter, and the click target. `<ArchetypeGlyph archetypeId={archetypeId} pulseState={state} category={category} />` mounts inside the wrapper. The `archetypeId` comes from `useMapStore((s) => s.archetypeIds[nodeId] ?? node.defaultArchetypeId ?? 'archetype-eclectic')` and renders unconditionally — the `live_vibe_on_map` flag only gates the live `node:archetype_change` socket subscription, not the glyph itself.

### Frontend: archetype reveal modal (R9.11, R9.12)

The first-time archetype reveal happens today on the consumer onboarding screen. Two changes:

- The existing reveal component (a single screen in `apps/web/src/screens/`) renders `getArchetypeDisplayName(archetype.id)` instead of `archetype.name`, plus the catalog `description` (R9.11).
- If `getArchetypeEtymology(archetype.id)` returns a string, a small italicised line is rendered beneath the display name (R9.12). Currently this only fires for `archetype-township-royal` → Kasi.

The same component is also reachable from the consumer profile screen for re-reading (R9.11 last sentence).

### Backend: R11 live archetype delivery

New socket event mirrors the existing `node:state_change`:

```ts
'node:archetype_change': (payload: {
  nodeId: string
  liveArchetypeId: string
  branch: LiveArchetypeBranch
}) => void
```

`branch` is included for observability — it's the same `branch` the resolver returned, and it lets the consumer client emit a debug log without a round-trip to backend logs. In production this field is dropped from the payload by a build flag if we ever want to slim it.

The 60s EventBridge rule + `schedule-transition-tick` Lambda is the only new infra. The Lambda:

- Reads the `MusicSchedules` GSI `ByNextTransition` for `nextTransitionAt` in `[now, now + 60s]`.
- For each venue, computes the new Live_Archetype, compares to `lastArchetypeId` cached on the Node, and emits if different (R11.2). Coalescing within 10s windows (R11.3) is handled by the Lambda's in-memory dedupe — Lambdas reuse warm contexts, and the schedule-transition-tick is single-tenant, so a `Map<nodeId, lastEmit>` works.
- The R11.4 budget is one DynamoDB GetItem (the schedule, already in hand from the GSI query) plus one Query (recent CheckIns) per venue per Evaluation_Tick. No more.
- R11.5: skip the socket emit when `io.in(cityRoom(citySlug)).fetchSockets().length === 0`. Update the cache regardless.

The web client adds a new `useNodeArchetype(token)` hook that mirrors the existing `useNodePulse` (lines from `packages/shared/hooks/useNodePulse.ts`):

```ts
socket.on('node:archetype_change', (p) => {
  setArchetypeId(p.nodeId, p.liveArchetypeId)
})
```

On reconnect (R11.7), the next live nodes payload includes every visible Node's current `liveArchetypeId` and replaces the cached values. The 5-minute cache retention (R11.6) is a `setTimeout` per nodeId reset on each update.

### Frontend: R4 Schedule_Editor

New screen `apps/business/src/screens/MusicSchedulePanel.tsx`. The Business_Portal's existing nav (`apps/business/src/screens/BusinessDashboard.tsx`) gets one new tab: "Music Schedule".

Layout:

- A horizontal week view with 7 day columns (MON-SUN), each showing a 24-hour timeline (00:00-23:59).
- Schedule_Slots render as coloured bands stacked on the timeline, one band per slot.
- A Cross_Midnight_Pair renders as a single band that visually spans the day boundary (R4.13). The implementation: detect pairs at render time using the deriving rule from R3.12, and draw one band with a styled "wraps to next day" indicator.
- An "Add slot" floating button opens a slot editor sheet.

Slot editor sheet:

- Day-of-week, start time (HH:mm), end time (HH:mm), mode toggle (`blanket`/`lineup`), genre picker (multi-select from the existing `MusicGenre` enum), or a lineup builder for `lineup` mode.
- The `blanket → lineup` transition pre-seeds one LineupEntry at the slot's start time with the blanket genres (R4.4). This is also what makes the first-entry-aligned-with-slot-start rule (R3.7) easy to honour by default.
- Cross-midnight detection: if the operator types `endTime < startTime` (e.g. `22:00 → 04:00`), the editor accepts it in the UI but visually splits it on save (R4.13).
- Inline validation on every field; save button disabled while any error is present (R4.5, R4.9).
- Delete requires confirmation (R4.6); on API failure the slot stays in the UI and a retry affordance appears (R4.8).

The editor uses the same `schedule-validator.ts` module the backend uses — single source of truth.

### Feature flag (R12)

`packages/shared/lib/featureGating.ts` already supports key-value flags read from a backend-served config. Add a `live_vibe_on_map` boolean flag.

Reads on both the web and the backend:

```ts
const enabled = useFeatureFlag('live_vibe_on_map', false)
```

The default `false` (R12.2) and the unreachable-store fallback `false` (R12.3) are existing semantics of `useFeatureFlag`. No new infra.

While `live_vibe_on_map === false`:

- `MapControls` no longer renders the legacy permanent City_Pulse glass card under any flag state; the City_Pulse readout lives on the once-per-session toast and ships un-flagged (R2.7, R12.4).
- `VenueNode` always renders the `ArchetypeGlyph` (using `defaultArchetypeId` or `archetype-eclectic` while the flag is off — R12.4). The flag only gates the live `node:archetype_change` socket subscription, so glyph values stay on the venue's default until the flag flips and the live deltas start arriving.
- The Schedule_Editor remains reachable in Business_Portal (R12.5) so operators can prep schedules before launch.
- The `live-archetype-evaluator` Lambda short-circuits at the start: if the flag is `false`, return immediately without DynamoDB reads or socket emits (R12.5).

Flipping `false → true` (R12.6) recovers within one socket reconnect cycle because the next `live_nodes` payload carries `liveArchetypeId` for every visible Node.

The R1 sidebar fixes are not behind the flag (R12.7).

## Data Models

### MusicSchedules table

Already specified above. One important note for IaC: this table's GSI on `nextTransitionAt` is sparse — only schedules with at least one slot have a `nextTransitionAt` attribute. PAY_PER_REQUEST means we are not paying for empty rows in the GSI.

### Existing tables touched

- **CheckIns**: no schema change. The Lambda Queries by `(nodeId, createdAt)` over the 90-min window. The existing GSI on `(nodeId, createdAt)` covers this.
- **Nodes**: one new attribute `lastArchetypeId` (String, optional) and `defaultArchetypeId` (String, optional). Both are nullable; absent values fall through to `archetype-eclectic` per R7.8.

### Type additions

In `packages/shared/types/index.ts`:

```ts
export interface ScheduleSlot {
  slotId: string
  dayOfWeek: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
  startTime: string // HH:mm
  endTime: string // HH:mm
  startTimeMin: number // 0..1439, for ordering
  endTimeMin: number // 0..1439
  mode: 'blanket' | 'lineup'
  genres?: MusicGenre[] // present iff mode === 'blanket'
  lineup?: LineupEntry[] // present iff mode === 'lineup'
}

export interface LineupEntry {
  startTime: string // HH:mm, must equal slot.startTime for index 0
  startTimeMin: number
  djName?: string
  genres: MusicGenre[]
}

export interface MusicSchedule {
  businessId: string
  scheduleId: string
  timezone: string // IANA
  slots: ScheduleSlot[]
  updatedAt: string // ISO-8601 ms
  schemaVersion: 1
}

export interface ServerToClientEvents {
  // ... existing events ...
  'node:archetype_change': (payload: { nodeId: string; liveArchetypeId: string; branch: LiveArchetypeBranch }) => void
}

export type LiveArchetypeBranch =
  | 'schedule_lineup'
  | 'schedule_blanket'
  | 'checkin_mode'
  | 'default'
  | 'eclectic_fallback'
```

## Error Handling

| Surface                                        | Failure mode                                             | Behaviour                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Schedule_Editor save                           | Server validation failure                                | Show inline field errors, keep dirty state (R4.5, R4.9)                                                          |
| Schedule_Editor delete                         | API failure                                              | Keep slot in UI, show retry affordance (R4.8)                                                                    |
| `resolveLiveArchetype`                         | Active_Slot in lineup mode but no entry covers timestamp | Throw `LiveArchetypeInternalError`; Lambda catches and falls through to check-in branch; logs `error` (R7.4)     |
| `live-archetype-evaluator`                     | DynamoDB Query timeout >500ms                            | Pass empty `recentCheckIns` to resolver; resolver falls to `default` or `eclectic_fallback` (R7.10)              |
| `schedule-transition-tick`                     | Per-venue exception                                      | Catch, log, continue with the next venue. One bad row never poisons the whole tick                               |
| Live socket disconnected                       | —                                                        | Web client keeps cached `archetypeIds` for ≤5 min (R11.6). On reconnect, full payload replaces the cache (R11.7) |
| Glyph asset missing                            | —                                                        | Fall back to generic dot glyph (R8.7); log once per session in dev (R8.8)                                        |
| Compass / Recenter tap on `loaded() === false` | —                                                        | Silent early-out + at-most-one debug log per ignored tap (R1.6)                                                  |

## Testing Strategy

The R10 property test surface is the heart of this. Existing fast-check setup in `packages/shared/lib/__tests__/archetypeResolver.test.ts` is the pattern to follow.

### New property test files

- `packages/shared/lib/__tests__/scheduleResolver.test.ts`
  - At-most-one Active_Slot (R10.1).
  - Active_Slot's interval contains the timestamp (R10.2).
  - Idempotence (R10.3).
  - Lineup-active slot always returns a LineupEntry — the unreachable-fallback property.
  - Round-trip through serialize/parse (R10.5).
  - Validator rejects bad intervals, duplicate LineupEntry start times, lineup with first entry not aligned with slot start, and overlapping slots (R10.8).

- `packages/shared/lib/__tests__/genreToArchetype.test.ts`
  - Order-independence over permutations (R10.4).

- `packages/shared/lib/__tests__/liveArchetype.test.ts`
  - Returns one catalog Archetype (R10.6).
  - Idempotence (R10.7).

- `apps/web/src/components/__tests__/ArchetypeGlyph.contrast.test.tsx`
  - The R10.10 cross-product: (15 archetypes × 5 pulse states × 6 categories = 450) at the smallest supported glyph size. Asserts ≥ 3:1 contrast between the glyph silhouette colour (category hex) and the outline colour (`dynamicContrastForCategory(category)`) using a colour-pair contrast helper. Both layers render at 1.0 opacity inside the SVG, so the silhouette / outline pair stays in lockstep at every Pulse_State and the gamma-space compositing trap from the previous design no longer applies.

### Backend integration tests

- `backend/src/features/music-schedule/__tests__/handler.test.ts`
  - Round-trip CRUD with each validation failure path returning the correct 4xx + structured error.
  - Cross-midnight save split into a Cross_Midnight_Pair, verified by the deriving rule.
  - JWT claims missing the venue's `businessId` → 403 with no DynamoDB I/O.

- `backend/src/features/music-schedule/__tests__/transitionTick.test.ts`
  - 100-venue fanout simulation; assert ≤1 GetItem and ≤1 Query per venue.
  - No-subscribers branch skips socket emit but updates `lastArchetypeId`.
  - Coalesce within 10s window.

### Frontend tests

- `apps/web/src/hooks/__tests__/useMapInit.r1.test.ts`
  - Compass tap with bearing > 1 → easeTo bearing:0.
  - Compass tap with bearing within ±1 → no-op, no log.
  - Recenter tap with stale position → disabled affordance, no fly-to.
  - Recenter tap with fresh position → flyTo.
  - Both tap with `loaded() === false` → silent early-out.
  - Double-tap within 250ms → debounced.

- `apps/web/src/components/__tests__/MapControls.r1.test.tsx`
  - data-testids present.
  - Disabled aria/cursor state when no fresh position.

- `packages/shared/hooks/__tests__/useCityPulseToast.test.ts`
  - Once per session by default.
  - Re-surface on cross from <60 to ≥60.
  - Suppressed on totalPulse === 0.
  - prefers-reduced-motion respected.

## Observability

- `live-archetype-evaluator` emits one structured `info` log per Evaluation_Tick: `{ venueId, timestamp, archetypeId, branch }`. Sampled at 1-in-100 in prod (R7.11). The same log line goes to CloudWatch Metrics as a custom metric with `branch` as a dimension, so the on-call dashboard can show the distribution of branches over time.
- `schedule-transition-tick` emits a tick-level metric: number of venues evaluated, number of changes emitted, p99 evaluator latency. Goes to the existing CloudWatch dashboard.
- `node:archetype_change` socket events are sampled at 1-in-1000 to a debug stream so a support engineer can answer "what archetype was venue X showing at 22:14 last night?" without re-running the resolver.
- Glyph fallback events (R8.7) emit a single dev-only `console.warn` per session. In production the registry is enforced complete by a build-time check, so production users should never hit this branch.
- City Pulse toast suppression on totalPulse === 0 (R2.9) does not log; this is normal expected behaviour.

## Correctness Properties

The properties below are the design-level invariants that survive across implementation churn. They are tested in code per the Testing Strategy section but stated here so a reviewer can audit the design without reading the test suite.

### Property 1: Schedule resolver returns at most one Active_Slot

**Validates: Requirements 5.1, 10.1.**
**Holds because** `resolveActiveSlot` is a pure function in `scheduleResolver.ts` and the validator's anti-overlap rule (R3.9) means at most one slot can match a given `(dayOfWeek, minutesSinceMidnight)` pair.

### Property 2: Active_Slot interval contains the timestamp

**Validates: Requirements 5.4, 10.2.**
**Holds because** the resolver compares `slot.startTimeMin ≤ localMinutes(t) < slot.endTimeMin` directly. Comparing minutes-since-midnight rather than `HH:mm` strings eliminates the lexicographic-vs-chronological footgun.

### Property 3: Schedule resolver idempotence

**Validates: Requirements 5.9, 10.3.**
**Holds because** `resolveActiveSlot` performs no I/O, reads no globals, and takes the timestamp as a parameter. Two consecutive calls with deep-equal inputs produce deep-equal outputs.

### Property 4: Lineup-active slot always returns exactly one LineupEntry

**Validates: Requirements 3.7, 5.7.**
**Holds because** R3.7 requires the first LineupEntry's `startTimeMin` to equal the slot's, and requires LineupEntry start times within a slot to be strictly unique. Together these make the "no LineupEntry covers the timestamp" branch unreachable when the slot is active.

### Property 5: Genre→Archetype order-independence

**Validates: Requirements 6.6, 10.4.**
**Holds because** `computeDimensionScores` averages weights across the input genres, and addition is commutative. Downstream `resolveArchetype` is pure, so two permutations of the same set produce identical archetype `id`s.

### Property 6: Music_Schedule round-trip

**Validates: Requirements 10.5.**
**Holds because** `parse(serialize(schedule))` round-trips through a single Zod schema and `startTimeMin`/`endTimeMin` are derived deterministically from `startTime`/`endTime` on parse, so the redundant fields cannot drift.

### Property 7: Live_Archetype returns exactly one catalog Archetype

**Validates: Requirements 7.1, 10.6.**
**Holds because** the branch table covers the input space exhaustively (active slot present, active slot absent with check-ins, active slot absent with default, active slot absent without default). The final fallback is `archetype-eclectic` which is always present in the catalog.

### Property 8: Live_Archetype idempotence

**Validates: Requirements 7.9, 10.7.**
**Holds because** `resolveLiveArchetype` is pure. Catalog version is a stable input; for fixed inputs and fixed catalog version, two consecutive calls produce the same Archetype `id`.

### Property 9: Schedule validator rejects bad intervals and preserves prior state

**Validates: Requirements 3.5, 3.7, 3.9, 10.8.**
**Holds because** all validation runs server-side in a single `schedule-validator.ts` module before any DynamoDB write. Rejected operations short-circuit before the write, so prior persisted state is untouched.

### Property 10: Archetype_Glyph silhouette ≥ 3:1 against its outline

**Validates: Requirements 8.9, 10.10.**
**Holds because** every glyph is drawn twice stacked: a stroked outline pass underneath in `dynamicContrastForCategory(category)`'s colour, and a fill pass on top in the venue's category colour from `getCategoryColour(category)`. The R10.10 property test enumerates every (archetype × pulse_state × category) triple at the smallest supported glyph size and asserts the silhouette/outline contrast ratio is ≥ 3:1. Pulse_State does not enter the formula because both layers render at 1.0 opacity inside the SVG; the wrapper's CSS opacity for R8.3/R8.4 scales them together against the basemap, so the silhouette/outline pair stays in lockstep at every Pulse_State and the gamma-space compositing trap from the previous design (when the glyph was overlaid on a coloured node-core circle) no longer applies.

### Property 11: Every catalog Archetype has exactly one rename entry

**Validates: Requirements 9.4.**
**Holds because** a build-time test asserts `Object.keys(ARCHETYPE_NAMES).length === ARCHETYPE_CATALOG.length`, every catalog `id` has an entry, and every entry's `displayName` matches the 3-8 character Title Case constraint.

### Property 12: Display name is locale-invariant

**Validates: Requirements 9.13.**
**Holds because** `getArchetypeDisplayName(id)` takes only an `id` and returns a single string. The function signature does not accept a locale, and the rename module is the single source of truth — adding a locale parameter would require touching this central module, which is gated by code review.

### Property 13: Evaluator stays inside the DynamoDB read budget

**Validates: Requirements 11.4.**
**Holds because** the `live-archetype-evaluator` Lambda fetches the schedule once via the GSI query that wakes it (no additional GetItem) and queries the recent CheckIns once per Evaluation_Tick. An integration test asserts the read count is ≤ 2 per venue per tick.

### Property 14: Live delivery defers when no subscribers and recovers on reconnect

**Validates: Requirements 11.5, 12.6.**
**Holds because** the evaluator checks `io.in(cityRoom(citySlug)).fetchSockets().length === 0` before emitting, and updates the `lastArchetypeId` cache regardless. On reconnect, the next live nodes payload carries every visible Node's current `liveArchetypeId`, so the client recovers within one cycle.

### Property 15: The R9 rename does not require a DynamoDB migration

**Validates: Requirements 9.2, 9.3.**
**Holds because** the rename only adds a new `displayName` lookup keyed by the existing `id`. The catalog `id` and `iconId` fields are preserved unchanged, the catalog `name` field stays for admin tools, and no consumer-facing database row references `name` — they all reference `id`.

## Rollout and Rollback

### Rollout

1. Ship R1 sidebar fixes un-flagged (R12.7). Pure bug fixes, no feature flag dependency.
2. Ship R9 archetype rename module + display-name swaps **before** the flag flips on. The rename is id-stable per R9.2, so it can ship alone — the new names just appear next to the old archetype assignment logic.
3. Ship R3-R5 schedule data layer + Schedule_Editor with the flag still `false`. Operators can prep schedules; nothing reads them yet (R12.5).
4. Ship R7-R8 + R11 with the flag still `false`. Lambda is deployed but short-circuits.
5. Flip `live_vibe_on_map === true` for a 5% canary cohort.
6. Watch the CloudWatch dashboard for: Lambda error rate, p99 evaluator latency, branch distribution, socket emit volume, frontend glyph fallback rate.
7. Roll forward to 100% when stable.

### Rollback

Flip `live_vibe_on_map === false`. Within one socket reconnect cycle (≤10s per R12.6 read in reverse), the live archetype subscriber tears down and the evaluator Lambda short-circuits. Existing nodes stay rendered as their `defaultArchetypeId` (or `archetype-eclectic`) glyphs — the marker layout doesn't revert, only the live deltas stop arriving. The City_Pulse_Toast remains because R2 ships un-flagged.

The Schedule_Editor stays reachable so any in-flight operator work isn't lost (R12.5).

The schedule data in DynamoDB is preserved — rollback is a UI-and-evaluator rollback, not a data rollback. That means re-enabling the flag picks up exactly where the previous flip left off.

### Migration safety

The R9 rename is id-stable. No DynamoDB rows change. No glyph assets are re-keyed. The single risk is a code path that reads `archetype.name` as a string identifier (rather than as a display label). A grep audit before merge confirms no such code exists; the type system helps because `name` is `string` and so is `id`, but the catalog file is the only place either appears.

## Open Questions and Deferrals

These are the calls that need product input before tasks are written:

1. **Kasi etymology copy.** The R9.12 etymology line lives in the rename module. Final wording — "isiZulu and isiXhosa for township; a word of pride, born in South Africa." — needs a native-speaker review pass. The technical surface is in place either way.
2. **Default archetype assignment for existing venues.** When R7.7 fires, the Node needs a `defaultArchetypeId`. Existing venues don't have one. The deferral is: do we backfill from the venue's category (e.g. nightlife → `archetype-festival-spirit`), leave it null and let everything fall through to `archetype-eclectic` (Prism), or expose a Business_Portal field so operators set it explicitly? The current design assumes "leave null, fall through to Prism, expose the field in a follow-up." Worth flagging.
3. **Cross_Midnight_Pair visual editor.** R4.13 says the editor renders the pair as a single band. Whether that band is draggable as a unit (drag from 22:00 to 23:00 → both halves shift, both keep abutting at midnight) is left as a polish task. The minimum viable version is: pair detection on render, single visual band, but edits go through the per-half flow.
4. **Live_Archetype evaluator concurrency.** At 100 venues × 60s tick, current scale is fine. At 10,000 venues we'd need to either shard the GSI scan or move to per-venue scheduling. The transition Lambda is written so the sharding layer can be inserted later without changing the per-venue logic.
5. **Glyph SVG inventory.** R8.2 references a glyph registry. The 15 SVGs need to be designed (or their existing assets in `packages/shared/assets/archetypes/` audited). This is a design-team dependency, not a code dependency. The fallback dot glyph (R8.7) means the system is shippable even if some SVGs are pending — the fallback just looks generic.
