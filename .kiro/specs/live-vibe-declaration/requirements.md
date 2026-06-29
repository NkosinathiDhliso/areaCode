# Requirements Document

## Introduction

The live map renders each venue's current vibe as an Archetype_Glyph riding a pulse-driven beam. The glyph identity is resolved by the existing pure resolver `resolveLiveArchetype` (`packages/shared/lib/liveArchetype.ts`), and live deltas already flow over the `node:archetype_change` socket event into `mapStore.archetypeIds`.

Two gaps remain, and this spec closes both with a single, deliberately minimal rule.

**Gap 1 — no visible declaration flow.** Nowhere in the product does a venue actually _declare_ its vibe in a way the three parties (operator, staff, consumer) can see and reason about.

**Gap 2 — the declaration can lie.** Today an Active*Slot in the Music_Schedule \_always* beats the crowd while it is live, so an operator can declare a false vibe to pull a crowd that does not match the room, and the map keeps showing the false glyph for as long as the slot runs.

### The single core rule

**Presence is the truth. A venue's declaration is only a promise about a room that is not yet full. The instant honest presence crosses a small floor, the glyph becomes the crowd's actual vibe.**

Everything in this spec derives from that one rule. There is no trust score, no divergence margin, no confirm/deny voting, no reconciliation hysteresis machine, and no routine administrator override. Those were considered and deliberately cut: they exist only to answer "is the owner lying?", and that question disappears once a declaration is forbidden from claiming the present tense.

- **Below the Presence_Floor** the venue's declared vibe is shown as a **promise** (taste-on-intent). This creates pull on a cold, empty map. The operator cannot lie about the present because the declaration is never presented as the present.
- **At or above the Presence_Floor** the glyph follows the **Crowd_Vibe** (taste-on-presence) — the archetype mode of the people honestly checked in right now. The declaration stops being the present-tense signal. A false declaration simply cannot reach the screen once the room is real.

The handoff is a single decision keyed on the honest `Live_Presence_Count` (from the **presence-integrity** spec) crossing the Presence_Floor.

### Why this is robust in real life (risks the founder did not name)

- **Gaming via fake check-ins** is already handled by **presence-integrity** (proximity-verified check-in plus automatic expiry). This feature adds **no** new anti-fraud machinery because honest presence already guarantees the substrate.
- **Cold start / empty map** is handled by the declared promise — that is its whole job.
- **Flicker at the boundary** (the count hovering exactly at the floor) is handled by one small presence-grace: once the crowd reading engages it persists until presence drops slightly _below_ the floor. This is a presence margin, not a divergence hysteresis.

This feature reuses and extends existing concepts rather than duplicating them. It references the **live-vibe-on-map**, **presence-integrity**, and **venue-intelligence-reports** specs and treats their glossary terms (Music_Schedule, Active_Slot, Live_Archetype, Lookback_Window, Live_Presence_Count) as authoritative. All persistence stays on DynamoDB `PAY_PER_REQUEST`; all compute runs in the existing live-archetype-evaluator Lambda and the 60-second EventBridge tick (no always-on resources). No SMS, no phone-OTP, no phone-number identifiers are introduced. Presence and crowd data stay aggregate and anonymised (POPIA).

## Glossary

- **Declared_Vibe**: the archetype an operator or staff member has declared as the venue's intended vibe for the current local time, resolved from the Active_Slot of the venue's existing Music_Schedule via the existing Genre_To_Archetype_Mapping. The **taste-on-intent** signal. Reuses the live-vibe-on-map schedule branches; this spec adds no second declaration store.
- **Crowd_Vibe**: the archetype mode (most frequent catalog `archetypeId`, with the live-vibe-on-map R7.6 tie-break) of honest present check-ins inside the Lookback_Window. The **taste-on-presence** signal — the existing `checkin_mode` branch.
- **Live_Presence_Count**: the honest count of `present` Presence_Records for a venue, defined by the presence-integrity spec (check-in minus check-out minus expiry; never a cumulative tally).
- **Presence_Floor**: the minimum Live_Presence_Count (counting only honest present check-ins inside the Lookback_Window that carry a catalog `archetypeId`) at which the room is considered a real reading and the glyph switches from Declared_Vibe to Crowd_Vibe. A founder-decision value (Requirement 8).
- **Presence_Grace**: a small count below the Presence_Floor; once the glyph is following the Crowd_Vibe it keeps following it until presence falls below `Presence_Floor − Presence_Grace`, preventing boundary oscillation. A founder-decision value (Requirement 8).
- **Live_Archetype**: the archetype the map ultimately renders, produced by the Live_Archetype_Resolver. Defined in live-vibe-on-map; this spec changes only the precedence between Declared_Vibe and Crowd_Vibe relative to the Presence_Floor.
- **Live_Archetype_Resolver**: the existing `resolveLiveArchetype` function, extended by this spec to accept Live_Presence_Count and the Presence_Floor while remaining observably pure.
- **Resolution_Branch**: the branch label recorded for a resolution. This spec uses `declared_promise` (below floor, showing intent) and `crowd_live` (at/above floor, showing the real crowd); below floor with nothing declared it falls through to the existing `default` then `eclectic_fallback` branches.
- **Declaration_Surface**: the operator-facing UI in the Business_Portal (`apps/business`) where the operator declares the promise and sees whether the map is currently showing the promise or the live crowd. Reuses `MusicSchedulePanel`.
- **Staff_Declaration_Surface**: the staff-facing UI in the staff app (`apps/staff`) for setting the promise for the current shift, scoped to the staff member's assigned venue, writing through the same Music_Schedule API.
- **Consumer_Vibe_Panel**: the consumer-facing presentation in the node detail sheet (`apps/web`) showing the live glyph and an honest label distinguishing "expected tonight" (below floor) from "in the room now" (at/above floor). Reuses `CrowdVibeSection`.
- **Genre_To_Archetype_Mapping**: the existing deterministic mapping from genres to an archetype, defined in live-vibe-on-map.
- **POPIA**: the Protection of Personal Information Act (South Africa). Here: Crowd_Vibe is aggregate and anonymised, carries no `userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`, or raw coordinates, and builds no per-user location trail.

## Requirements

### Requirement 1: Declaration is a promise, never a present-tense claim

**User Story:** As a consumer who trusts the map, I want a venue's declared vibe to be shown only as an expectation until real people are there, so that an owner can never make the map claim a crowd that does not exist.

#### Acceptance Criteria

1. WHILE the venue's qualifying Live_Presence_Count is below the Presence_Floor AND the venue has an Active_Slot, THE Live_Archetype_Resolver SHALL return the Declared_Vibe AND SHALL record the Resolution_Branch `declared_promise`.
2. WHILE the venue's qualifying Live_Presence_Count is below the Presence_Floor AND the venue has no Active_Slot, THE Live_Archetype_Resolver SHALL fall through to the existing `default` then `eclectic_fallback` precedence unchanged from live-vibe-on-map.
3. WHEN the Resolution_Branch is `declared_promise`, every surface that presents the vibe SHALL label it as an expectation or intent (for example "on tonight" / "expected") AND SHALL NOT assert it as the crowd currently in the room.
4. THE Declared_Vibe SHALL be derived solely from the venue's existing Music_Schedule via Genre_To_Archetype_Mapping AND this spec SHALL NOT introduce a second declaration data store.

### Requirement 2: Presence is the truth above the floor

**User Story:** As a consumer, I want the glyph to reflect the people actually in the room once there are enough of them, so that the live vibe is honest.

#### Acceptance Criteria

1. WHILE the venue's qualifying Live_Presence_Count is at or above the Presence_Floor, THE Live_Archetype_Resolver SHALL return the Crowd_Vibe AND SHALL record the Resolution_Branch `crowd_live`, regardless of any Declared_Vibe or Active_Slot.
2. THE Crowd_Vibe SHALL be computed by the existing `checkin_mode` branch (archetype mode of honest present check-ins inside the Lookback_Window with the existing tie-break), reusing the live-vibe-on-map computation without duplication.
3. THE qualifying Live_Presence_Count SHALL count only honest present check-ins inside the Lookback_Window that carry a catalog `archetypeId`, using Live_Presence_Count semantics from presence-integrity, AND SHALL NOT be derived from a cumulative or decayed historical tally.
4. WHEN presence expires such that the qualifying count falls below the floor (subject to Requirement 3), THE Live_Archetype_Resolver SHALL stop returning `crowd_live` on the next Evaluation_Tick and revert to the Declared_Vibe promise or the default/eclectic fall-through.

### Requirement 3: Presence-grace prevents boundary flicker

**User Story:** As a consumer, I want the glyph to stay stable when the headcount hovers around the threshold, so that the map does not flip back and forth.

#### Acceptance Criteria

1. WHEN the Resolution_Branch transitions to `crowd_live`, THE Live_Archetype_Resolver SHALL continue to return `crowd_live` until the qualifying Live_Presence_Count falls below `Presence_Floor − Presence_Grace`.
2. THE Presence_Grace SHALL be applied only to the downward transition out of `crowd_live`; the upward transition into `crowd_live` SHALL occur at the Presence_Floor exactly.
3. THE Presence_Grace behaviour SHALL be deterministic: identical ordered presence inputs SHALL produce an identical sequence of Resolution_Branch values.

### Requirement 4: Resolver stays pure and reuses existing delivery

**User Story:** As a developer, I want the precedence change contained in the existing pure resolver and delivered over the existing socket channel, so that no parallel implementation drifts out of sync.

#### Acceptance Criteria

1. THE Live_Archetype_Resolver SHALL accept, in addition to its existing inputs, the venue's qualifying Live_Presence_Count and the Presence_Floor, AND SHALL remain observably pure: identical inputs SHALL produce an identical `{ archetype, branch }` result with no `Date.now()`, globals, or I/O.
2. WHEN the Live_Archetype changes as a result of crossing the floor (or its grace boundary), THE backend SHALL emit a single `node:archetype_change` delta carrying the new `liveArchetypeId` and the Resolution_Branch, reusing the existing socket event and the live-vibe-on-map coalescing rule (at most one delta per venue per 10000ms window).
3. THE Resolution decision SHALL change only the glyph identity AND SHALL NOT alter beam brightness, beam height, beam animation speed, or any aliveness visual, which remain a function of pulse only per constellation-mode.

### Requirement 5: Operator and staff declaration surfaces

**User Story:** As an operator or staff member, I want a clear place to set tonight's promised vibe and to see whether the map is showing my promise or the live crowd, so that I understand when the room has taken over.

#### Acceptance Criteria

1. THE Declaration_Surface SHALL be presented within the existing `MusicSchedulePanel` in the Business_Portal AND SHALL declare the promise through the venue's existing Music_Schedule.
2. THE Declaration_Surface SHALL display whether the venue's Live_Archetype is currently a `declared_promise` (the map is showing the operator's intent) or `crowd_live` (the crowd in the room has taken over), and in the `crowd_live` case SHALL display the Crowd_Vibe the map is showing.
3. WHILE the venue has no Active_Slot, THE Declaration_Surface SHALL display an empty-promise state with a one-tap action to declare the current vibe, reusing the existing Music_Schedule slot creation flow.
4. THE Staff_Declaration_Surface SHALL be reachable in the staff app (`apps/staff`) for the venue to which the authenticated staff member is assigned AND SHALL persist the promise through the same Music_Schedule API the operator uses, so the Declared_Vibe has a single source of truth.
5. THE Declaration_Surface SHALL render only when the authenticated operator's JWT claims include the venue's `businessId`, and THE Staff_Declaration_Surface SHALL render only for a staff session scoped to the venue's `businessId` or `nodeId`; otherwise each SHALL render a denial state AND SHALL NOT issue any declaration API request.
6. THE declaration surfaces SHALL NOT require, read, or persist any phone number AND SHALL NOT depend on SMS or phone-OTP for any part of the flow.

### Requirement 6: Consumer sees promise versus now, honestly labelled

**User Story:** As a consumer, I want to see whether a venue's glyph is what it expects tonight or what the crowd actually is right now, so that I can trust the map.

#### Acceptance Criteria

1. WHEN the consumer opens a venue's node detail sheet, THE Consumer_Vibe_Panel SHALL display the Live_Archetype the map is rendering as the Archetype_Display_Name and Archetype_Glyph, reusing the existing `CrowdVibeSection` data.
2. WHILE the Resolution_Branch is `declared_promise`, THE Consumer_Vibe_Panel SHALL present the vibe as the venue's expectation (for example "expected tonight") AND SHALL use honest low-presence copy rather than assert a crowd reading.
3. WHILE the Resolution_Branch is `crowd_live`, THE Consumer_Vibe_Panel SHALL present the vibe as the crowd that is in the room now.
4. THE Consumer_Vibe_Panel SHALL NOT display any individual consumer identity, count of named individuals, or location trail, AND SHALL NOT present a confirm/deny control.

### Requirement 7: Presence verification must not be weakened (rewards-safe)

**User Story:** As a product owner, I want the presence this feature relies on to stay genuinely verified, so that a future reward for showing up can never be farmed by faking presence.

#### Acceptance Criteria

1. THE feature SHALL consume only honest, presence-integrity-verified presence (proximity-verified check-in subject to expiry) for the Live_Presence_Count and Crowd_Vibe AND SHALL NOT introduce any unverified or self-asserted presence signal.
2. THE feature SHALL NOT relax, bypass, or alter any presence verification or expiry rule defined by the presence-integrity spec.
3. Any rewarding of presence SHALL be out of scope for this spec and SHALL be handled by a separate spec built on the existing rewards/guest-claim rails; this spec SHALL leave the verified-presence substrate intact for that future work.

### Requirement 8: Founder-decision values

**User Story:** As the founder, I want the single open number called out with a candidate, so that I confirm it before design bakes it in.

#### Acceptance Criteria

1. THE spec SHALL treat the Presence*Floor as requiring founder confirmation. \_Candidate:* 3 qualifying honest present check-ins inside the 90-minute Lookback_Window. WHEN the founder confirms or amends this value, THE confirmed value SHALL govern Requirements 1, 2, and 3.
2. THE spec SHALL treat the Presence*Grace as requiring founder confirmation. \_Candidate:* 1 (the glyph reverts from `crowd_live` only once the count drops to `Presence_Floor − 1`). WHEN the founder confirms or amends this value, THE confirmed value SHALL govern Requirement 3.

### Requirement 9: Serverless and reuse

**User Story:** As the platform operator, I want the precedence change to run on existing serverless resources, so that honest self-correction costs nothing when idle.

#### Acceptance Criteria

1. THE precedence decision SHALL run inside the existing live-archetype-evaluator Lambda on an Evaluation_Tick AND SHALL NOT introduce any always-on process, container, load balancer, relational database, or managed cache.
2. THE Evaluation_Ticks SHALL be produced by the existing 60-second EventBridge schedule-transition tick, live-channel subscriptions, and check-in / check-out / expiry events inside the Lookback_Window, reusing the live-vibe-on-map Evaluation_Tick mechanism.
3. ANY Lambda extended by this feature SHALL use `arm64` architecture AND ANY new DynamoDB table SHALL use `billing_mode = "PAY_PER_REQUEST"`.
4. THE feature SHALL reuse the existing resolver, stores (`mapStore`), `node:archetype_change` socket event, `MusicSchedulePanel`, and `CrowdVibeSection` rather than duplicating them.

### Requirement 10: Feature flag and backwards compatibility

**User Story:** As an operator rolling this out, I want a safe path back to the prior declaration-always-wins behaviour, so that a regression does not corrupt the live map.

#### Acceptance Criteria

1. THE presence-is-truth precedence SHALL be gated behind a single feature flag `live_vibe_declaration` readable by both the web app and the backend, defaulting to `false` in every environment.
2. IF the feature flag store is unreachable when `live_vibe_declaration` is read, THEN the read SHALL fall back to `false`.
3. WHILE `live_vibe_declaration` is `false`, THE Live_Archetype_Resolver SHALL retain the existing live-vibe-on-map precedence in which the Declared_Vibe unconditionally beats the Crowd_Vibe during an Active_Slot, AND the declaration surfaces SHALL still render and still allow declaring the vibe.
4. WHEN `live_vibe_declaration` flips from `false` to `true`, THE map SHALL begin applying the presence-is-truth precedence for visible venues within one socket reconnect cycle (≤ 10000ms).

### Requirement 11: POPIA and privacy

**User Story:** As a product owner accountable under POPIA, I want crowd and presence handling to stay aggregate and anonymised, so that the honest signal never becomes surveillance.

#### Acceptance Criteria

1. THE Crowd_Vibe and any stored or exposed presence-derived value SHALL contain no `userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`, or raw coordinates.
2. THE platform SHALL NOT construct or persist a per-user location history or movement trail from check-in or resolution events.
3. THE `node:archetype_change` delta emitted on a precedence change SHALL carry only the venue `nodeId`, the `liveArchetypeId`, and the Resolution_Branch, AND SHALL carry no consumer identity.
4. THE feature SHALL NOT require, read, or persist any phone number, AND SHALL NOT depend on SMS or phone-OTP.

### Requirement 12: Property-based correctness

**User Story:** As a developer, I want property-based tests for the extended resolver, so that the precedence switch is correct across the input space.

#### Acceptance Criteria

1. WHEN the Live_Archetype_Resolver is invoked with valid inputs, THE return value SHALL be exactly one Archetype from the active catalog, for any Live_Presence_Count and Presence_Floor.
2. WHEN the resolver is invoked twice with the same valid inputs and no intervening state change, THE two results SHALL have the same Archetype `id` and the same Resolution_Branch (idempotence).
3. WHILE the qualifying Live_Presence_Count is below the Presence_Floor (and not held by Presence_Grace), THE resolver SHALL never return `crowd_live`.
4. WHILE the qualifying Live_Presence_Count is at or above the Presence_Floor AND a qualifying Crowd_Vibe exists, THE resolver SHALL never return `declared_promise`.
5. WHEN presence is held within the Presence_Grace band after engaging `crowd_live`, THE Resolution_Branch SHALL NOT flip back, demonstrating no boundary oscillation.

## Validated Correctness Properties

| Property                               | For all…                                                               | Holds when                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Resolver returns one catalog Archetype | valid inputs, any Live_Presence_Count and Presence_Floor               | Live_Archetype_Resolver is invoked                                         |
| Resolver idempotence                   | valid inputs, no intervening state change                              | Two consecutive calls return the same Archetype `id` and Resolution_Branch |
| No crowd_live below floor              | qualifying count below Presence_Floor and not held by grace            | Resolution_Branch is never `crowd_live`                                    |
| No declared_promise above floor        | qualifying count ≥ Presence_Floor and a qualifying Crowd_Vibe exists   | Resolution_Branch is never `declared_promise`                              |
| Presence-grace prevents oscillation    | presence held within the Presence_Grace band after engaging crowd_live | Resolution_Branch does not flip back tick to tick                          |
