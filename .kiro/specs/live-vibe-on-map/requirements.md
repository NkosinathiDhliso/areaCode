# Requirements Document

## Introduction

The live map is the front door of Area Code. Today it shows category-coloured pulse dots and a glass "City Pulse" card pinned to the right edge, but five problems are dulling the signal:

1. The compass and recenter buttons in the right-side `MapControls` cluster do not behave reliably for end users — at least one of the two actions does not move the map.
2. The City Pulse card sits permanently over the map and reads as visual clutter.
3. Businesses can already manage their listing in the business portal, but they cannot tell the platform what music they will be playing — which means the live map cannot show what kind of crowd a venue is currently catering to.
4. Map markers are only colour-coded by category (food / coffee / nightlife / retail / fitness / arts). They do not surface the **archetype** the venue is currently catering to, which is the single most distinctive concept in the product.
5. The current archetype display names ("The Festival Spirit", "The Midnight Philosopher", etc.) are descriptive but not memorable enough to become identity labels the way astrology signs are.

This feature, **Live Vibe on Map**, fixes the broken sidebar buttons, moves the City Pulse to a dismissible toast, lets businesses publish a music schedule (blanket genre tag or detailed DJ lineup), renders an **archetype glyph** on every node so users can see at a glance what crowd a venue is catering to right now, and renames the archetype catalog to short, evocative labels while keeping the underlying IDs stable for backwards compatibility.

All persistence stays on DynamoDB PAY_PER_REQUEST. No new always-on resources. No SMS, no phone-OTP. POPIA stays intact — no new user-location persistence is introduced.

## Glossary

- **Map_Sidebar**: the floating glass control cluster anchored to the right edge of the map (`apps/web/src/components/MapControls.tsx`) containing the 3D toggle, compass (reset-north) button, and recenter button.
- **Compass_Button**: the button in Map_Sidebar that snaps the map bearing back to 0° (north up).
- **Recenter_Button**: the button in Map_Sidebar that flies the map to the user's Last_Known_Position.
- **Last_Known_Position**: the consumer's most recent successful browser-geolocation result during the current session, held in client memory only. It is never persisted server-side, never written to local storage, and is discarded on tab close. The 60-second freshness window in R1.3/R1.4 reflects typical urban GPS drift: a position older than one minute is materially likely to be wrong on foot, so we degrade to the disabled state rather than fly the map to a stale fix.
- **City_Pulse**: the aggregate live readout of all visible nodes' pulse scores. Currently rendered as a permanent glass card in Map_Sidebar.
- **City_Pulse_Toast**: the new dismissible toast/banner presentation of City_Pulse on the map tab.
- **Toast_System**: the existing in-app toast surface (`apps/web/src/components/ToastOverlay.tsx`, `packages/shared/stores/toastStore.ts`) used for live announcements.
- **Node**: a venue marker on the live map, currently rendered as multi-layered HTML circles coloured by category and animated by pulse state.
- **Pulse_State**: one of `dormant`, `quiet`, `active`, `buzzing`, `popping` — derived from a venue's pulse score by `getNodeState`.
- **Archetype**: a music personality classification (e.g. `archetype-festival-spirit`). Defined in `packages/shared/constants/archetype-catalog.ts`. Has a stable string `id`, an `iconId`, a display `name`, and a `priority`.
- **Archetype_Glyph**: a small icon overlaid on a Node that represents the archetype the venue is currently catering to.
- **Music_Schedule**: a per-venue, time-banded record of what music will be played, owned by the business that operates the venue.
- **Schedule_Slot**: a single entry in a Music_Schedule, defined by a day-of-week and a `[startTime, endTime)` half-open interval in the venue's local time. `startTime` and `endTime` are stored on disk as `HH:mm` strings but compared and ordered as **minutes-since-midnight** integers (0-1439), so any change to the on-disk format (seconds, non-padded values) cannot silently corrupt ordering.
- **Cross_Midnight_Pair**: a logical pairing of two physical Schedule_Slots (one ending at `23:59` on day N, one starting at `00:00` on day N+1, both with the same `mode` and matching genres or matching lineup tail/head) that together represent a single venue night spanning midnight. The data model only ever stores two same-day slots; the Cross_Midnight_Pair concept lives in the editor and the read model.
- **Blanket_Mode**: a Schedule_Slot mode where the business declares one or more genres for the slot but no per-set lineup.
- **Lineup_Mode**: a Schedule_Slot mode where the business declares an ordered list of `LineupEntry` records, each with a sub-slot start time, optional DJ name, and one or more genres.
- **LineupEntry**: a single item inside a Lineup_Mode Schedule_Slot — `{ startTime, djName?, genres[] }`.
- **Active_Slot**: the unique Schedule_Slot whose interval contains the current local time for a given venue. If no slot covers the current time, the venue has no Active_Slot.
- **Live_Archetype**: the archetype currently associated with a venue, resolved in this priority order: (a) Active_Slot's genres → archetype mapping, (b) recent check-in archetype mode within the lookback window, (c) the venue's default archetype if configured, otherwise the `archetype-eclectic` fallback.
- **Lookback_Window**: the trailing 90-minute window used when computing the check-in-based fallback for Live_Archetype. 90 minutes is chosen so a single set or DJ slot (typically 60-120 minutes in this market) is visible end-to-end on the map without check-ins from the previous night bleeding into tonight's vibe.
- **Evaluation_Tick**: a single invocation of the Live_Archetype computation for one venue. An Evaluation_Tick is triggered by exactly one of: (a) a new live-channel subscription for the venue, (b) an Active_Slot transition emitted by the schedule transition scheduler in R11.5, or (c) a check-in event landing inside the Lookback_Window for the venue. Each Evaluation_Tick is the unit at which the R11.4 DynamoDB read budget applies.
- **Schedule_Resolver**: the deterministic function that, given a venue's Music_Schedule and a timestamp, returns at most one Active_Slot.
- **Genre_To_Archetype_Mapping**: the deterministic function that, given a non-empty set of genres, returns the highest-priority matching archetype using the existing `resolveArchetype` logic against synthesised dimension scores.
- **Business_Portal**: the operator-facing app at `apps/business`.
- **Schedule_Editor**: the new screen in Business_Portal where operators create and edit a Music_Schedule.
- **Archetype_Display_Name**: the human-readable label shown to users (e.g. "Blaze") that maps 1:1 to a stable Archetype `id` (e.g. `archetype-festival-spirit`).
- **Archetype_Rename_Map**: the constant mapping from Archetype `id` to the new short Archetype_Display_Name.

## Requirements

### Requirement 1: Map sidebar button correctness

**User Story:** As a consumer using the live map, I want the compass and recenter buttons to behave the way the icons advertise, so that I can quickly orient and find myself without fighting the UI.

#### Acceptance Criteria

1. WHEN the user taps Compass_Button AND the current map bearing is greater than 1° from 0°, THE Map_Sidebar SHALL animate the map bearing back to 0° within 1000ms ± 50ms.
2. WHEN the user taps Compass_Button AND the current map bearing is within ±1° of 0°, THE Map_Sidebar SHALL treat the tap as a successful no-op (no animation, no error log).
3. WHEN the user taps Recenter_Button AND a Last_Known_Position is available AND that position is no older than 60000ms, THE Map_Sidebar SHALL fly the map to that position within 1500ms ± 50ms.
4. WHILE no Last_Known_Position is available OR the most recent Last_Known_Position is older than 60000ms (chosen as the typical bound on urban GPS staleness; older fixes are likely to send the map to where the user no longer is), THE Recenter_Button SHALL render with reduced opacity, a non-interactive cursor, and `aria-disabled="true"`, AND a tap on it SHALL NOT trigger any fly-to action.
5. WHEN the user taps Compass_Button OR Recenter_Button, THE Map_Sidebar SHALL pause the idle bearing-drift rotation for at least 4000ms after the tap.
6. IF the underlying Mapbox map instance reports `loaded() === false` when the user taps Compass_Button or Recenter_Button, THEN THE Map_Sidebar SHALL ignore the tap, SHALL NOT raise an unhandled exception, and SHALL emit at most one debug-level log entry per ignored tap.
7. THE Compass_Button SHALL expose `data-testid="map-sidebar-compass"` and THE Recenter_Button SHALL expose `data-testid="map-sidebar-recenter"`.
8. WHEN the user double-taps the same button within 250ms, THE Map_Sidebar SHALL debounce the input and treat it as a single tap.

### Requirement 2: City Pulse becomes a toast on the map tab

**User Story:** As a consumer browsing the map, I want the city pulse readout to appear as a non-intrusive toast rather than a permanent card, so that the map itself stays the focus.

#### Acceptance Criteria

1. WHEN the consumer first opens the map tab in a session AND the map's tiles are loaded and the canvas is interactive, THE City_Pulse_Toast SHALL appear via the existing Toast_System within 2000ms.
2. THE City_Pulse_Toast SHALL display the same total pulse value (an integer in [0, 9999]) and the same hottest-state tone (one of `dormant`, `quiet`, `active`, `buzzing`, `popping`) that the legacy City_Pulse card displayed.
3. WHEN the consumer dismisses the City_Pulse_Toast (tap-to-close or swipe), THE Toast_System SHALL not re-show the City_Pulse_Toast for the remainder of the current session, except as allowed by criterion 6.
4. THE City_Pulse_Toast SHALL auto-dismiss 6000ms after it appears if the consumer takes no action.
5. WHILE the consumer is on a tab other than the map, THE City_Pulse_Toast SHALL not render.
6. WHEN the City_Pulse total pulse value crosses from below 60 to at or above 60 (the lower bound of the `buzzing` Pulse_State, chosen so the toast resurfaces only when the city is materially livelier than when the user dismissed it) AND the City_Pulse_Toast has been previously dismissed in this session, THE City_Pulse_Toast SHALL re-surface exactly once for that session.
7. THE Map_Sidebar SHALL no longer render the legacy permanent City_Pulse glass card.
8. WHERE the user has the `prefers-reduced-motion` media query set, THE City_Pulse_Toast SHALL appear without entrance animation but SHALL still respect the 6000ms auto-dismiss timer.
9. IF the City_Pulse total pulse value is 0, THEN THE City_Pulse_Toast SHALL not surface, AND this suppression SHALL NOT consume the once-per-session show slot.
10. IF the data needed to compute the City_Pulse total pulse value cannot be retrieved, THEN THE City_Pulse_Toast SHALL not surface and THE Map_Sidebar SHALL render no error UI for this case.

### Requirement 3: Business music schedule data model

**User Story:** As a business operator, I want my venue to have a structured music schedule, so that the live map and the consumer experience can reflect what is actually being played at my venue right now.

#### Acceptance Criteria

1. THE Music_Schedule SHALL be persisted in a DynamoDB table with `billing_mode = "PAY_PER_REQUEST"`.
2. THE Music_Schedule SHALL be uniquely keyed by `(businessId, scheduleId)` where `businessId` and `scheduleId` are strings of length 1-64.
3. EACH Schedule_Slot SHALL declare a `mode` field with value `blanket` or `lineup`. IF a Schedule_Slot is created or updated with `mode` outside this set, THEN THE Schedule_Editor SHALL reject the operation and SHALL NOT persist the change.
4. EACH Schedule_Slot SHALL declare a `dayOfWeek` field with value in `{ MON, TUE, WED, THU, FRI, SAT, SUN }`. IF the value is outside this set, THEN THE Schedule_Editor SHALL reject the operation and SHALL NOT persist the change.
5. EACH Schedule_Slot SHALL declare `startTime` and `endTime` strings matching `^([01][0-9]|2[0-3]):[0-5][0-9]$`. THE Schedule_Editor and THE Schedule_Resolver SHALL compare these values as **minutes since 00:00** (an integer in `[0, 1439]`), and SHALL require `startTimeMinutes < endTimeMinutes`. IF either field is malformed or the minutes-since-midnight ordering is violated, THEN THE Schedule_Editor SHALL reject the operation and SHALL NOT persist the change. (Lexicographic comparison happens to agree with chronological for fixed-width zero-padded `HH:mm`, but the spec is written in terms of minutes-since-midnight so any future format change cannot silently corrupt ordering.)
6. WHERE a Schedule_Slot has `mode = blanket`, THE Schedule_Slot SHALL declare a `genres` array of length 1-5 of distinct genre IDs from the existing `MusicGenre` enum. IF this constraint is violated, THEN THE Schedule_Editor SHALL reject the operation and SHALL NOT persist the change.
7. WHERE a Schedule_Slot has `mode = lineup`, THE Schedule_Slot SHALL declare a `lineup` array of length 1-20 of LineupEntry records. EACH LineupEntry SHALL have a `startTime` matching the same `HH:mm` regex with `startTimeMinutes` falling in the half-open interval `[Schedule_Slot.startTimeMinutes, Schedule_Slot.endTimeMinutes)`, an optional `djName` of length 1-60 if present, and a `genres` array of length 1-5 of distinct genre IDs from `MusicGenre`. THE first LineupEntry SHALL have `startTimeMinutes == Schedule_Slot.startTimeMinutes` so that the slot is fully covered from its first second. THE LineupEntry `startTime` values within a single Schedule_Slot SHALL be strictly unique. THE Schedule_Slot SHALL NOT declare a top-level `genres` array when `mode = lineup`.
8. IF any LineupEntry violates its constraints in criterion 7, THEN THE Schedule_Editor SHALL reject the operation and SHALL NOT persist the change.
9. IF a created or updated Schedule_Slot's interval overlaps another existing Schedule_Slot for the same `(businessId, dayOfWeek)`, THEN THE Schedule_Editor SHALL reject the operation with a descriptive validation error and SHALL NOT persist the change.
10. THE Music_Schedule SHALL declare an `updatedAt` ISO-8601 timestamp at millisecond precision that is refreshed on every persisted mutation.
11. THE Music_Schedule SHALL declare a `timezone` field as a valid IANA identifier (e.g. `Africa/Johannesburg`). IF the field is missing or unknown to the ICU/IANA database used by the runtime, THEN THE Schedule_Editor SHALL reject the operation and SHALL NOT persist the change.
12. THE data model SHALL NOT allow a Schedule_Slot to wrap past midnight; cross-midnight nights SHALL be modelled as a Cross_Midnight_Pair of two same-day Schedule_Slots (one ending at `23:59` on day N, one starting at `00:00` on day N+1, both with the same `mode` and matching genres or matching lineup tail/head). The pairing relationship SHALL be derivable from the data alone (same `(businessId, mode)`, abutting times, no gap on either side), so no additional table or pointer is required to represent it.

### Requirement 4: Business music schedule editor UI

**User Story:** As a business operator, I want a Schedule_Editor in my business portal, so that I can declare blanket genres or full DJ lineups for my venue without contacting support.

#### Acceptance Criteria

1. THE Schedule_Editor SHALL be reachable from the existing Business_Portal navigation as a tab labelled "Music Schedule".
2. THE Schedule_Editor SHALL render the seven days of the week (Monday through Sunday) as a horizontal week view with each Schedule_Slot drawn in its time band over a 24-hour timeline (00:00 to 23:59).
3. WHEN the operator creates a new Schedule_Slot, THE Schedule_Editor SHALL default `mode` to `blanket` AND SHALL allow toggling to `lineup` before save.
4. WHEN the operator switches a Schedule_Slot from `blanket` to `lineup`, THE Schedule_Editor SHALL pre-seed the `lineup` array with one LineupEntry whose `startTime` equals the Schedule_Slot's `startTime` and whose `genres` mirror the blanket genres.
5. WHEN the operator attempts to save a Schedule_Slot, THE Schedule_Editor SHALL run all R3 validations (time format, ordering using minutes-since-midnight, slot duration in [15 minutes, 23 hours 45 minutes — the largest single-day same-day-end interval, with cross-midnight handled via R4.13's Open late helper], mode-specific genre/lineup content including unique LineupEntry start times and the first-entry-aligned-with-slot-start rule, IANA timezone) and SHALL surface each failure inline before allowing save.
6. WHEN the operator deletes a Schedule_Slot, THE Schedule_Editor SHALL require a confirmation step before issuing the delete request.
7. WHEN the operator confirms a deletion, THE Schedule_Editor SHALL persist the deletion via the API.
8. IF the deletion API call fails, THEN THE Schedule_Editor SHALL keep the Schedule_Slot in the UI and SHALL surface a retry affordance.
9. IF a save attempt would create an overlap with another Schedule_Slot for the same `(businessId, dayOfWeek)`, THEN THE Schedule_Editor SHALL show the overlap conflict inline AND SHALL block the save until resolved.
10. WHILE the operator has not yet declared any Schedule_Slot for the venue, THE Schedule_Editor SHALL show an empty-state with a one-tap "Add first slot" action.
11. THE Schedule_Editor SHALL render only when the request's authenticated business operator JWT claims include the venue's `businessId`.
12. IF the JWT claims do not include the venue's `businessId`, THEN THE Schedule_Editor SHALL render a denial state and SHALL NOT issue any schedule API requests.
13. WHEN the operator creates a Schedule_Slot whose `endTime` would cross midnight (e.g. a club night declared as `22:00` to `04:00`), THE Schedule_Editor SHALL accept the single cross-midnight entry in the UI AND on save SHALL split it into a Cross_Midnight_Pair per R3.12 (one slot ending at `23:59` on the entered `dayOfWeek`, one slot starting at `00:00` on the next `dayOfWeek`) preserving the `mode`. For `blanket` mode the genres SHALL be copied to both slots. For `lineup` mode the LineupEntries before midnight SHALL stay on the first slot and the LineupEntries at or after `00:00` SHALL move to the second slot, with the second slot's first LineupEntry forced to `00:00` per R3.7. The Schedule_Editor SHALL render a Cross_Midnight_Pair as a single visual band that spans the dayOfWeek boundary so the operator does not have to think about the split.
14. WHEN the operator edits one half of a Cross_Midnight_Pair, THE Schedule_Editor SHALL apply the edit to the pair as a unit (renaming, deleting, or rescheduling both halves together), so the pair never drifts out of sync.

### Requirement 5: Schedule resolver correctness

**User Story:** As a developer rendering the live map, I want a deterministic Schedule_Resolver, so that the same Music_Schedule and timestamp always yield the same Active_Slot.

#### Acceptance Criteria

1. THE Schedule_Resolver SHALL accept a Music_Schedule and an RFC 3339 timestamp with explicit timezone offset and SHALL return at most one Active_Slot.
2. IF the input timestamp is not a valid RFC 3339 string, THEN THE Schedule_Resolver SHALL reject the input with a validation error and SHALL NOT return an Active_Slot.
3. IF the input Music_Schedule fails R3 validation, THEN THE Schedule_Resolver SHALL reject the input with a validation error and SHALL NOT return an Active_Slot.
4. WHEN the timestamp, after conversion to the Music_Schedule's `timezone`, falls inside the half-open interval `[startTime, endTime)` of exactly one Schedule_Slot for the matching `dayOfWeek`, THE Schedule_Resolver SHALL return that Schedule_Slot.
5. WHEN the timestamp falls outside every Schedule_Slot interval for that day, THE Schedule_Resolver SHALL return no Active_Slot and SHALL NOT raise an error.
6. IF the Music_Schedule contains overlapping Schedule_Slots on the same `dayOfWeek`, THEN THE Schedule_Resolver SHALL reject the Music_Schedule at validation time.
7. WHEN a Schedule_Slot is in `lineup` mode AND the timestamp falls inside that slot, THE Schedule_Resolver SHALL also return the LineupEntry whose `startTimeMinutes` is the greatest value not exceeding the timestamp's local minutes-since-midnight. Because R3.7 requires the first LineupEntry's `startTimeMinutes` to equal the Schedule_Slot's `startTimeMinutes` and requires unique `startTime` values within the slot, exactly one LineupEntry always matches when the slot is active.
8. (Reserved.) The "no LineupEntry covers the timestamp" branch is unreachable under R3.7's first-entry-aligned-with-slot-start rule. The Schedule_Resolver SHALL treat this state as a programmer error: it SHALL throw an internal validation error and SHALL emit an `error` log including the offending Schedule_Slot's id and the resolving timestamp. There is no on-disk fallback to a non-existent top-level `genres` array, because lineup-mode slots SHALL NOT carry one.
9. THE Schedule_Resolver SHALL be observably pure: for any fixed Music_Schedule and timestamp, two consecutive invocations SHALL produce results equal under deep structural comparison.
10. IF the Music_Schedule contains a Schedule_Slot whose `endTimeMinutes <= startTimeMinutes` (i.e. crosses or wraps midnight), THEN THE Schedule_Resolver SHALL reject the Music_Schedule at validation time, since cross-midnight slots SHALL be modelled as a Cross_Midnight_Pair per R3.12.
11. IF the Music_Schedule's `timezone` is not a valid IANA identifier known to the runtime, THEN THE Schedule_Resolver SHALL reject the Music_Schedule at validation time.

### Requirement 6: Genre-to-archetype mapping

**User Story:** As a developer, I want a deterministic Genre_To_Archetype_Mapping, so that any set of declared genres resolves to the same archetype for the same archetype catalog.

#### Acceptance Criteria

1. WHEN Genre_To_Archetype_Mapping is invoked with a non-empty set of `MusicGenre` values of size 1-50, THE Genre_To_Archetype_Mapping SHALL return exactly one Archetype.
2. WHEN Genre_To_Archetype_Mapping is invoked with a valid input set, THE Genre_To_Archetype_Mapping SHALL synthesise a `DimensionScoreVector` from the input genres using `computeDimensionScores` against `GENRE_WEIGHT_MATRIX` and SHALL pass that vector to `resolveArchetype`.
3. WHEN the input genre set is empty, THE Genre_To_Archetype_Mapping SHALL return the `archetype-uncharted` Archetype and SHALL NOT invoke `computeDimensionScores` or `resolveArchetype`.
4. IF any input value is not a known `MusicGenre` present in `GENRE_WEIGHT_MATRIX`, THEN THE Genre_To_Archetype_Mapping SHALL return the `archetype-uncharted` Archetype, SHALL surface an error indication to the caller, and SHALL NOT mutate the catalog.
5. IF the input is `null`, `undefined`, or not a Set/Array of `MusicGenre`, THEN THE Genre_To_Archetype_Mapping SHALL reject the call with a validation error AND SHALL NOT invoke `computeDimensionScores` or `resolveArchetype`.
6. WHEN Genre_To_Archetype_Mapping is invoked twice with two permutations of the same input genre set, THE Genre_To_Archetype_Mapping SHALL return Archetypes with the same `id`.
7. WHEN Genre_To_Archetype_Mapping is invoked twice in succession with the same input set against the same Archetype catalog version, THE Genre_To_Archetype_Mapping SHALL return Archetypes with the same `id`.

### Requirement 7: Live archetype resolver for map nodes

**User Story:** As a consumer, I want each map node to reflect the archetype the venue is currently catering to, so that I can spot a venue that matches my taste at a glance.

#### Acceptance Criteria

1. THE Live_Archetype resolver SHALL accept a Node, the venue's Music_Schedule (if any), the recent check-ins for that venue inside the 90-minute Lookback_Window, and an ISO-8601 UTC timestamp.
2. IF the venue has a Music_Schedule AND the timestamp converted to that schedule's timezone falls inside exactly one Schedule_Slot's `[startTime, endTime)` interval for the matching `dayOfWeek`, THEN that Schedule_Slot is the Active_Slot and THE Live_Archetype resolver SHALL return the Archetype produced by Genre_To_Archetype_Mapping over the Active_Slot's effective genres.
3. IF the Active_Slot is in `lineup` mode, THEN the effective genres SHALL be the genres of the LineupEntry returned by the Schedule_Resolver per R5.7. (R3.7 guarantees exactly one such LineupEntry exists whenever the slot is active.)
4. (Reserved.) The "Active_Slot is in lineup mode but no LineupEntry covers the timestamp" branch is unreachable under R3.7. THE Live_Archetype resolver SHALL surface this as an internal error and fall through to criteria 6, 7, 8 in order, while emitting an `error` log including the Node id, the schedule id, and the timestamp.
5. IF the Active_Slot is in `blanket` mode, THEN the effective genres SHALL be the Schedule_Slot's `genres`.
6. IF no Active_Slot exists AND there is at least one check-in within the Lookback_Window whose `archetypeId` is present in `ARCHETYPE_CATALOG`, THEN THE Live_Archetype resolver SHALL return the Archetype whose `id` is the mode (most frequent value) of those `archetypeId`s. Ties SHALL be broken first by lowest catalog `priority`, then by lexicographically smallest `id`.
7. IF no Active_Slot, no check-ins with a catalog `archetypeId` in the Lookback_Window, AND the Node has a configured `defaultArchetypeId` that is present in `ARCHETYPE_CATALOG`, THEN THE Live_Archetype resolver SHALL return that Archetype.
8. IF no Active_Slot, no check-ins with a catalog `archetypeId` in the Lookback_Window, AND no in-catalog `defaultArchetypeId`, THEN THE Live_Archetype resolver SHALL return the `archetype-eclectic` Archetype.
9. WHEN Live_Archetype resolver is invoked twice in succession with the same input values against the same catalog version, THE Live_Archetype resolver SHALL return Archetypes with the same `id`.
10. IF the Lookback_Window check-in lookup fails or exceeds 500ms, THEN THE Live_Archetype resolver SHALL fall through to criteria 7 and 8 without throwing.
11. WHENEVER THE Live_Archetype resolver returns an Archetype, THE resolver SHALL emit a structured `info`-level log entry (or equivalent metric dimension on the existing observability surface) containing the venue id, the resolving timestamp, the resolved Archetype `id`, and a single `branch` field with one of the values `schedule_lineup`, `schedule_blanket`, `checkin_mode`, `default`, or `eclectic_fallback`. The log entry SHALL be sampled at no less than 1 in 100 in production so an operator debugging "why is venue X showing Prism instead of Blaze" can see which branch fired without re-running the resolver locally.

### Requirement 8: Archetype glyph rendering on nodes

**User Story:** As a consumer, I want each pulse dot to wear a small glyph for its current archetype, so that I can read the map's vibe without opening every venue.

#### Acceptance Criteria

1. THE Node SHALL render an Archetype_Glyph centred (±1px) on its core layer.
2. THE Archetype_Glyph SHALL use the Archetype's `iconId` to look up an SVG glyph from a new shared glyph registry.
3. WHILE the Pulse_State is `dormant`, THE Archetype_Glyph SHALL render at 40% ± 2% opacity.
4. WHILE the Pulse_State is `quiet`, `active`, `buzzing`, or `popping`, THE Archetype_Glyph SHALL render at 100% opacity.
5. THE Archetype_Glyph SHALL inherit the existing per-state animation (breathe / pulse) so that its scale curve stays within 16ms of the halo's scale curve.
6. WHILE the Node is mounted, WHEN the Live_Archetype for the Node changes, THE Node SHALL crossfade the Archetype_Glyph over 400ms ± 20ms with linear easing AND no intermediate frame at 0% opacity.
7. IF the Archetype's `iconId` does not have a glyph asset registered, THEN THE Node SHALL fall back to a generic dot glyph that still satisfies criteria 3-6.
8. IF the Archetype's `iconId` does not have a glyph asset registered AND the build is a development build, THEN THE Node SHALL log the missing `iconId` once per session.
9. THE Archetype_Glyph SHALL render at no smaller than 8px and SHALL maintain a contrast ratio of at least 3:1 against the node core colour at every Pulse_State.
10. WHEN the user opens the node detail sheet, THE Archetype_Glyph and the resolved Archetype_Display_Name SHALL be visible without further interaction alongside the existing CrowdVibeSection.

### Requirement 9: Archetype display name rename

**User Story:** As a consumer, I want short, memorable archetype names, so that an archetype becomes an identity I can wear and share, the way astrology signs are.

#### Acceptance Criteria

1. EACH Archetype in the catalog SHALL have an Archetype_Display_Name that is one or two syllables, 3-8 characters long, and rendered in Title Case (first letter uppercase, remaining lowercase).
2. THE Archetype_Rename_Map SHALL preserve every existing Archetype `id` unchanged so all stored `archetypeId` references remain valid.
3. THE Archetype_Rename_Map SHALL preserve every existing Archetype `iconId` unchanged so existing glyph assets and admin tools keep working.
4. THE Archetype_Rename_Map SHALL contain exactly one entry per Archetype in `ARCHETYPE_CATALOG`, validated by a build-time count and membership check.
5. THE Archetype_Rename_Map SHALL use these display names:

   | Archetype `id`                   | Display name |
   | -------------------------------- | ------------ |
   | `archetype-festival-spirit`      | Blaze        |
   | `archetype-conscious-creative`   | Lumen        |
   | `archetype-township-royal`       | Kasi         |
   | `archetype-sacred-rebel`         | Hymn         |
   | `archetype-firecracker`          | Spark        |
   | `archetype-heritage-groover`     | Drum         |
   | `archetype-midnight-philosopher` | Noir         |
   | `archetype-street-poet`          | Verse        |
   | `archetype-soul-wanderer`        | Drift        |
   | `archetype-vibe-architect`       | Cipher       |
   | `archetype-smooth-operator`      | Velvet       |
   | `archetype-groove-seeker`        | Bounce       |
   | `archetype-culture-curator`      | Root         |
   | `archetype-eclectic`             | Prism        |
   | `archetype-uncharted`            | Compass      |

6. WHEN a consumer-facing surface (live map, node detail sheet, profile screen, archetype reveal modal) renders an Archetype label, THE surface SHALL render the Archetype_Display_Name AND SHALL NOT render the legacy "The X" form.
7. THE admin Archetype management screen SHALL render the `id` and the Archetype_Display_Name together in the same row (side-by-side or stacked), so admins can match against the legacy database keys.
8. WHERE the Archetype is `archetype-uncharted`, THE consumer profile screen SHALL also surface the existing helper copy ("Connect a streaming service or pick your genres") so the rename does not erase the call to action.
9. THE Archetype_Rename_Map SHALL be defined in a single shared constant module imported by every surface that displays an archetype.
10. IF a surface is asked to render an `archetypeId` that has no entry in the Archetype_Rename_Map, THEN THE surface SHALL render the raw `id` AND SHALL emit a non-blocking observability warning.
11. WHEN an Archetype is first assigned to a consumer (the archetype reveal moment), THE reveal modal SHALL surface the catalog `description` alongside the Archetype_Display_Name. The description SHALL be specific enough to read as personally recognisable (the astrology test: vague enough to feel true, specific enough to feel personal) AND SHALL NOT be replaced by generic copy across surfaces. The same `description` SHALL also be reachable from the consumer's profile screen so the user can re-read it.
12. WHERE an Archetype_Display_Name originates in a language other than English (currently `archetype-township-royal` → Kasi, an isiZulu/isiXhosa term for township), THE reveal modal SHALL include a one-line etymology copy beneath the Archetype_Display_Name (e.g. "Kasi — township pride, born in South Africa") so users in markets unfamiliar with the word learn the meaning rather than guess. The etymology copy SHALL live in the same shared constant module as the Archetype_Rename_Map so a single source of truth governs name, description, and etymology.
13. THE Archetype_Display_Name SHALL be the same string in every locale and every market. No per-locale, per-region, or per-market override of the Archetype_Display_Name SHALL be introduced. The shared social use case ("I'm a Blaze, what's yours?") depends on every user seeing the same label for the same `id`. Localisation MAY translate the `description` and the etymology copy in R9.12, but SHALL NOT translate the Archetype_Display_Name itself.

### Requirement 10: Property-based correctness for scheduling logic

**User Story:** As a developer, I want property-based tests for the Schedule_Resolver, Genre_To_Archetype_Mapping, and Live_Archetype resolver, so that scheduling and archetype resolution are correct across the input space, not just the examples I happened to think of.

#### Acceptance Criteria

1. WHEN the Schedule_Resolver is invoked with a valid Music_Schedule (per R3) and a valid RFC 3339 timestamp, THE Schedule_Resolver SHALL return at most one Active_Slot.
2. WHEN the Schedule_Resolver is invoked with a valid Music_Schedule and timestamp `t`, IF the Schedule_Resolver returns an Active_Slot `s`, THEN `s.startTime <= localTime(t, schedule.timezone, dayOfWeek(t)) < s.endTime` SHALL hold.
3. WHEN the Schedule_Resolver is invoked twice with the same valid inputs and no intervening state change, THE two return values SHALL be deeply-equal.
4. WHEN Genre_To_Archetype_Mapping is invoked twice with two permutations of the same non-empty genre set of size 1-50, THE two return values SHALL have the same `id`.
5. WHEN a valid Music_Schedule is round-tripped through `parse(serialize(schedule))`, THE result SHALL be deeply-equal to the original.
6. WHEN the Live_Archetype resolver is invoked with valid inputs (per R7), THE return value SHALL be exactly one Archetype from the active catalog.
7. WHEN the Live_Archetype resolver is invoked twice with the same valid inputs and no intervening state change, THE two return values SHALL have the same Archetype `id`.
8. IF a Music_Schedule contains a Schedule_Slot with `startTimeMinutes >= endTimeMinutes`, OR any pair of Schedule_Slots on the same `dayOfWeek` whose intervals overlap, OR a `lineup`-mode Schedule_Slot whose first LineupEntry's `startTimeMinutes` does not equal the Schedule_Slot's `startTimeMinutes`, OR a `lineup`-mode Schedule_Slot with two LineupEntries sharing a `startTime`, THEN the Music_Schedule validator SHALL reject the schedule and SHALL preserve any previously persisted state.
9. WHEN the Schedule_Resolver is invoked with a valid Music_Schedule and a timestamp that falls outside every Schedule_Slot interval for that day, THE Schedule_Resolver SHALL return no Active_Slot AND SHALL NOT raise an error.
10. WHEN an Archetype_Glyph is rendered against any (node-core colour × Pulse_State × category) combination from the live catalog at any supported display zoom, THE rendered glyph foreground SHALL maintain the R8.9 contrast ratio of at least 3:1. The property generator SHALL enumerate the cross-product (currently 15 archetypes × 5 pulse states × 6 categories) and assert the contrast at the smallest supported glyph size.

### Requirement 11: Map data delivery for live archetype

**User Story:** As a consumer, I want my map to receive the live archetype updates without burning my battery or my data plan, so that the experience stays cheap and snappy.

#### Acceptance Criteria

1. WHILE the consumer is on the map tab AND a Node intersects the current map viewport bounds, THE backend SHALL include that Node's current `liveArchetypeId` in the live nodes payload.
2. WHEN a venue's Live_Archetype changes (because of a new Active_Slot transition or a new check-in inside the Lookback_Window), THE backend SHALL emit a delta over the existing live socket channel within 5000ms rather than re-sending the full nodes payload.
3. WHEN multiple Live_Archetype changes for the same venue occur within a 10000ms window, THE backend SHALL coalesce them into a single delta containing the most recent value.
4. THE Live_Archetype computation SHALL run inside an existing Lambda (no new always-on resources) AND SHALL read scheduling data via at most one DynamoDB GetItem or Query per venue per Evaluation_Tick.
5. WHILE no consumers are subscribed to a venue's live channel, THE backend SHALL defer recomputation of that venue's Live_Archetype until the next subscription or the next Active_Slot transition tick, whichever comes first. THE "Active_Slot transition tick" SHALL be produced by a single EventBridge scheduled rule that fires every 60 seconds and invokes a transition Lambda; that Lambda SHALL identify venues whose Active_Slot is changing in the next minute (using the persisted Music_Schedule) and SHALL emit one Evaluation_Tick per such venue. No new always-on resources are introduced; the schedule is EventBridge plus on-demand Lambda.
6. IF the live socket connection is lost, THEN THE map SHALL keep showing the last known Live_Archetype for each Node for at most 5 minutes.
7. WHEN the live socket reconnects, THE map SHALL replace its cached Live_Archetype values for visible Nodes with the values from the next live nodes payload.
8. THE backend SHALL not persist any user location history, viewport history, or movement trace as part of this feature, in line with the existing POPIA stance.

### Requirement 12: Backwards compatibility and rollback

**User Story:** As an operator rolling this feature out, I want a safe path back to the previous behaviour, so that a regression does not block users from using the map.

#### Acceptance Criteria

1. THE feature SHALL be gated behind a single feature flag `live_vibe_on_map` readable by both the web app and the backend.
2. THE default value of `live_vibe_on_map` SHALL be `false` in every environment.
3. IF the feature flag store is unreachable when `live_vibe_on_map` is read, THEN the read SHALL fall back to the default value `false`.
4. WHILE `live_vibe_on_map` is `false`, THE Map_Sidebar SHALL keep rendering the legacy permanent City_Pulse glass card AND Nodes SHALL NOT render Archetype_Glyphs.
5. WHILE `live_vibe_on_map` is `false`, THE Schedule_Editor SHALL still be reachable in Business_Portal but the Live_Archetype delivery in Requirement 11 SHALL NOT run.
6. WHEN `live_vibe_on_map` flips from `false` to `true`, THE map SHALL recover live archetypes for visible Nodes within one socket reconnect cycle (≤ 10000ms).
7. THE Compass_Button and Recenter_Button correctness fixes in Requirement 1 SHALL ship un-flagged, since they are pure bug fixes with no rollback risk.

## Validated Correctness Properties

| Property                                                  | For all…                                                                                                                                                                                               | Holds when                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Schedule resolver returns at most one Active_Slot         | valid Music_Schedule and RFC 3339 timestamp                                                                                                                                                            | Schedule_Resolver is invoked                                                                                |
| Schedule resolver Active_Slot interval contains timestamp | valid Music_Schedule and timestamp `t` returning Active_Slot `s`                                                                                                                                       | `s.startTimeMinutes ≤ localMinutes(t) < s.endTimeMinutes`                                                   |
| Schedule resolver idempotence                             | valid Music_Schedule and timestamp, no intervening state change                                                                                                                                        | Two consecutive calls return deeply-equal results                                                           |
| Lineup-active slot always returns a LineupEntry           | valid Music_Schedule, lineup-mode Schedule_Slot active at `t`                                                                                                                                          | Schedule_Resolver returns exactly one matching LineupEntry (no top-level genres fallback path is reachable) |
| Genre→Archetype order-independence                        | non-empty `MusicGenre` set, size 1-50, any permutation                                                                                                                                                 | Two permutations return Archetypes with the same `id`                                                       |
| Music_Schedule serialize/parse round-trip                 | valid Music_Schedule                                                                                                                                                                                   | `parse(serialize(s))` deeply equals `s`                                                                     |
| Live_Archetype returns one catalog Archetype              | valid Node, schedule, check-ins, timestamp                                                                                                                                                             | Live_Archetype resolver is invoked                                                                          |
| Live_Archetype idempotence                                | valid inputs, no intervening state change, same catalog version                                                                                                                                        | Two consecutive calls return same Archetype `id`                                                            |
| Schedule validator rejects bad intervals                  | Music_Schedule with `startTimeMinutes ≥ endTimeMinutes`, overlapping slots on same `dayOfWeek`, lineup slot whose first entry's `startTimeMinutes` ≠ slot start, or duplicate LineupEntry `startTime`s | Validator raises a validation error and preserves prior state                                               |
| Archetype_Glyph contrast ≥ 3:1                            | every (archetype × Pulse_State × category) combination in the live catalog at the smallest supported glyph size                                                                                        | Glyph is rendered against the corresponding node-core colour                                                |
