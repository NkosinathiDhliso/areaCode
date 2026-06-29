# Requirements Document

## Introduction

The live map renders each venue's current vibe as an Archetype_Glyph riding a pulse-driven beam. The glyph identity is resolved by the existing pure resolver `resolveLiveArchetype` (`packages/shared/lib/liveArchetype.ts`) with the precedence shipped in the **live-vibe-on-map** spec: (1) the owner's declared Music_Schedule slot, (2) crowd mode (most common archetype among recent honest check-ins inside the 90-minute Lookback_Window), (3) the Node default, (4) the eclectic fallback. Live deltas already flow over the `node:archetype_change` socket event into `mapStore.archetypeIds`.

Two gaps remain.

**Gap 1 — no visible declaration flow.** A business operator can edit a Music*Schedule in the Business_Portal (`apps/business`, `MusicSchedulePanel`), but nowhere in the product does a venue actually \_declare* "this is the vibe / what's on the menu right now" in a way that any of the three parties can see and reason about. Operators, staff, and consumers each need a surface: the operator/staff need to declare and confirm tonight's vibe; the consumer needs to see what was declared and how it compares to who is actually in the room.

**Gap 2 — the declaration can lie, and nothing self-corrects.** Today an Active*Slot in the Music_Schedule \_always* beats the crowd while it is live, so an operator can declare a false vibe ("amapiano night") to pull a crowd that does not match the room, and the map will keep showing the false glyph for as long as the slot runs. The only correction available is a manual Area Code administrator override. This violates the honest-presence principle: every live signal must reflect reality.

**Live Vibe Declaration** closes both gaps without forking the existing resolver, stores, socket events, or schedule editor. It (a) surfaces the declaration flow for operators, staff, and consumers; (b) keeps **taste-on-intent** — the declared vibe creates pull on an empty map before any crowd arrives; (c) adds a **crowd-as-auditor** reconciliation rule so that once honest presence crosses a confidence threshold and the crowd diverges from the declaration beyond a margin, the live glyph auto-shifts toward **taste-on-presence** (crowd-truth) with no human in the loop; (d) maintains a per-venue declaration-accuracy / trust score that auto-down-weights chronic over-claimers' future declarations and feeds Venue Intelligence; and (e) lets consumers confirm or deny the declared vibe, with the aggregate majority contributing to crowd-truth.

This feature reuses and extends existing concepts rather than duplicating them. It references the **live-vibe-on-map**, **presence-integrity**, and **venue-intelligence-reports** specs and treats their glossary terms (Music_Schedule, Active_Slot, Live_Archetype, Lookback_Window, Live_Presence_Count, Dwell_Time, Report) as authoritative.

All persistence stays on DynamoDB `PAY_PER_REQUEST`. All compute runs in existing Lambdas (the live-archetype-evaluator and the EventBridge schedule-transition tick) — no new always-on resources. No SMS, no phone-OTP, no phone-number identifiers are introduced anywhere. Presence and confirmation data stay aggregate and anonymised: only the archetype mode and aggregate confirm/deny counts are used, never an individual identity and never a per-user location trail (POPIA).

### Existing implementation this builds on (context, not requirements)

- `resolveLiveArchetype` (`packages/shared/lib/liveArchetype.ts`) is observably pure and returns `{ archetype, branch }` with `branch ∈ { schedule_lineup, schedule_blanket, checkin_mode, default, eclectic_fallback }`. Its current precedence puts the schedule branches unconditionally above the check-in mode.
- The live-archetype-evaluator Lambda (`backend/src/workers/live-archetype-evaluator.ts`) processes one venue per Evaluation_Tick, joins recent check-ins to user archetypes, calls the resolver, and emits at most one `node:archetype_change` event (`{ nodeId, liveArchetypeId, branch }`).
- A single EventBridge rule fires every 60 seconds and invokes the schedule-transition tick (`backend/src/workers/schedule-transition-tick.ts`), which emits Evaluation_Ticks for venues whose Active_Slot is changing.
- Honest presence is delivered by the **presence-integrity** spec: `Live_Presence_Count` is the count of `present` Presence_Records (check-in minus check-out minus expiry), broadcast over `node:presence_update` (`{ nodeId, livePresenceCount, cause }`) and reflected in `mapStore.checkInCounts`. Presence expires; the count is never a cumulative tally.
- The consumer node detail sheet already shows a `CrowdVibeSection` fed by `GET /v1/nodes/:nodeId/crowd-vibe` returning a `CrowdVibeSnapshot` with `archetypePercentages`, `genreCounts`, and `totalCheckedIn`.
- The Business_Portal music declaration UI is `apps/business/src/screens/MusicSchedulePanel.tsx`. The consumer web app is `apps/web`; a staff app exists at `apps/staff`.
- Archetype display names (e.g. Blaze, Prism) come from the shared Archetype_Rename_Map (live-vibe-on-map Requirement 9). Venue Intelligence Reports are produced by the EventBridge-triggered Report_Generator (venue-intelligence-reports spec).

## Glossary

- **Declared_Vibe**: the archetype a venue's operator or staff has declared as the intended vibe for the current local time, resolved from the Active_Slot of the venue's existing Music_Schedule via Genre_To_Archetype_Mapping. This is the **taste-on-intent** signal — it exists and creates pull even when the room is empty. It reuses the live-vibe-on-map schedule branches; this spec adds no second declaration store.
- **Crowd_Vibe**: the archetype mode (most frequent `archetypeId`, with the live-vibe-on-map R7.6 tie-break) computed from honest present check-ins inside the Lookback_Window, optionally adjusted by Vibe_Confirmation per Requirement 8. This is the **taste-on-presence** signal — the glyph "full of people who are actually here".
- **Live_Archetype**: the archetype the map ultimately renders for a venue, produced by the Live_Archetype_Resolver. Defined in live-vibe-on-map; this spec changes only the precedence between Declared_Vibe and Crowd_Vibe.
- **Live_Archetype_Resolver**: the existing `resolveLiveArchetype` function, extended by this spec to accept a Presence_Confidence input and a Trust_Weight input while remaining observably pure.
- **Lookback_Window**: the trailing 90-minute window used for Crowd_Vibe, identical to the live-vibe-on-map definition.
- **Live_Presence_Count**: the honest count of `present` Presence_Records for a venue, defined by the presence-integrity spec. The substrate for Presence_Confidence.
- **Presence_Confidence**: a per-venue measure of whether enough honest, recent presence exists to trust the Crowd_Vibe as a real reading of the room. Derived only from honest present check-ins inside the Lookback_Window that carry a catalog `archetypeId`. Below the Confidence_Threshold the crowd is treated as not yet a reliable auditor.
- **Confidence_Threshold**: the minimum number of distinct honest present check-ins inside the Lookback_Window carrying a catalog `archetypeId` at which Presence_Confidence is considered met. A founder-decision value (Requirement 14).
- **Divergence_Margin**: the threshold on how far the Crowd_Vibe must diverge from the Declared_Vibe before the Live_Archetype auto-shifts to Crowd_Vibe. A founder-decision value (Requirement 14).
- **Reconciliation**: the deterministic decision, made on each Evaluation_Tick once Presence_Confidence is met, of whether the Live_Archetype follows the Declared_Vibe (taste-on-intent) or auto-shifts to the Crowd_Vibe (taste-on-presence) because the crowd diverges beyond the Divergence_Margin.
- **Reconciliation_Branch**: the branch label recorded for an Evaluation_Tick, extending the live-vibe-on-map branch set with `declared_confirmed` (declaration upheld by a confident crowd), `crowd_override` (declaration overridden by a divergent confident crowd), and `declared_unconfirmed` (declaration shown because the crowd is not yet confident).
- **Declaration_Accuracy_Score** (a.k.a. **Trust_Score**): a per-venue rolling score in `[0, 1]` measuring how often a venue's Declared_Vibe agreed with the confident Crowd_Vibe at Reconciliation time. High means the venue declares honestly; low means it chronically over-claims.
- **Trust_Weight**: the multiplier derived from the Declaration_Accuracy_Score that the Live_Archetype_Resolver applies to a venue's taste-on-intent precedence. A chronic over-claimer's declaration is down-weighted so the crowd audits it sooner (effectively a lower Confidence_Threshold / smaller Divergence_Margin for that venue).
- **Over_Claim**: a Reconciliation outcome in which the confident Crowd_Vibe diverged from the Declared_Vibe beyond the Divergence_Margin (the venue declared a vibe the room did not match).
- **Vibe_Confirmation**: an aggregate, anonymised consumer signal — a confirm ("yes, this is the vibe") or deny ("no, it isn't") on a venue's currently displayed Declared_Vibe — that contributes to Crowd_Vibe and to Reconciliation. Stored only as aggregate counts within the Lookback_Window; never as individual identity or location.
- **Declaration_Surface**: the operator-facing UI in the Business_Portal (`apps/business`) where the operator declares and reviews the venue's vibe and sees Declared_Vs_Actual. Reuses `MusicSchedulePanel`.
- **Staff_Declaration_Surface**: the staff-facing UI in the staff app (`apps/staff`) for setting or confirming the venue's vibe for the current shift, scoped to the staff member's assigned venue.
- **Consumer_Vibe_Panel**: the consumer-facing presentation in the node detail sheet (`apps/web`) that shows the Declared_Vibe, the Crowd_Vibe, which one the map is currently following, and the Vibe_Confirmation control. Reuses `CrowdVibeSection`.
- **Declared_Vs_Actual**: a presentation, available to each party, that shows the Declared_Vibe and the Crowd_Vibe side by side together with the current Reconciliation_Branch.
- **Admin_Override**: an Area Code administrator action (in `apps/admin`) that pins or suppresses a venue's Live_Archetype for genuinely adversarial cases, reserved as a last resort and never required for routine self-correction.
- **Genre_To_Archetype_Mapping**: the existing deterministic mapping from genres to an archetype, defined in live-vibe-on-map.
- **POPIA**: the Protection of Personal Information Act (South Africa). Here: Crowd_Vibe and Vibe_Confirmation are aggregate and anonymised, carry no `userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`, or raw coordinates, and build no per-user location trail.

## Requirements

### Requirement 1: Operator declaration and review surface

**User Story:** As a business operator, I want a clear place in my portal to declare my venue's vibe for right now and to see how it compares to who is actually in the room, so that I can create pull on an empty map and understand when the crowd has taken over.

#### Acceptance Criteria

1. THE Declaration_Surface SHALL be presented within the existing `MusicSchedulePanel` in the Business_Portal AND SHALL NOT introduce a second, separate declaration data store; the Declared_Vibe SHALL be derived from the venue's existing Music_Schedule.
2. WHEN the operator opens the Declaration_Surface AND the venue has an Active_Slot, THE Declaration_Surface SHALL display the current Declared_Vibe as the resolved Archetype_Display_Name and Archetype_Glyph.
3. WHILE the venue has no Active_Slot, THE Declaration_Surface SHALL display an empty-declaration state with a one-tap action to declare the current vibe, reusing the existing Music_Schedule slot creation flow.
4. THE Declaration_Surface SHALL display the Declared_Vs_Actual view containing the Declared_Vibe, the Crowd_Vibe, and the current Reconciliation_Branch.
5. WHILE Presence_Confidence for the venue is not met, THE Declaration_Surface SHALL label the Crowd_Vibe as not yet confident rather than display a misleading crowd reading.
6. WHEN the Live_Archetype for the venue is following the Crowd_Vibe because of a `crowd_override`, THE Declaration_Surface SHALL display that the crowd has taken over the vibe AND SHALL display the Crowd_Vibe that the map is showing.
7. THE Declaration_Surface SHALL render only when the authenticated business operator's JWT claims include the venue's `businessId`, consistent with the existing `MusicSchedulePanel` authorization.
8. IF the JWT claims do not include the venue's `businessId`, THEN THE Declaration_Surface SHALL render a denial state AND SHALL NOT issue any declaration or schedule API request.

### Requirement 2: Staff declaration surface

**User Story:** As a venue staff member, I want to set or confirm tonight's vibe from the staff app, so that the declaration reflects what is actually happening on the floor without waiting for the owner.

#### Acceptance Criteria

1. THE Staff_Declaration_Surface SHALL be reachable in the staff app (`apps/staff`) for the venue to which the authenticated staff member is assigned.
2. WHEN a staff member sets or updates the current vibe, THE Staff_Declaration_Surface SHALL persist the change through the same Music_Schedule API the operator uses, so the Declared_Vibe has a single source of truth.
3. THE Staff_Declaration_Surface SHALL display the current Declared_Vibe and the Crowd_Vibe in the Declared_Vs_Actual view.
4. THE Staff_Declaration_Surface SHALL render only for a staff member whose authenticated session is scoped to the venue's `businessId` or `nodeId`.
5. IF the staff member's session is not scoped to the venue, THEN THE Staff_Declaration_Surface SHALL render a denial state AND SHALL NOT issue any declaration API request.
6. THE Staff_Declaration_Surface SHALL NOT require, read, or persist any phone number AND SHALL NOT depend on SMS or phone-OTP for any part of the declaration flow.

### Requirement 3: Consumer visibility of declared versus actual vibe

**User Story:** As a consumer, I want to see what a venue declared its vibe to be and how it compares to the crowd that is actually there, so that I can trust the glyph on the map.

#### Acceptance Criteria

1. WHEN the consumer opens a venue's node detail sheet, THE Consumer_Vibe_Panel SHALL display the Live_Archetype that the map is currently rendering as the Archetype_Display_Name and Archetype_Glyph.
2. WHERE the venue has a Declared_Vibe, THE Consumer_Vibe_Panel SHALL display the Declared_Vibe alongside the Crowd_Vibe in the Declared_Vs_Actual view, reusing the existing `CrowdVibeSection` data.
3. WHILE Presence_Confidence for the venue is not met, THE Consumer_Vibe_Panel SHALL present the Declared_Vibe as the venue's intended vibe AND SHALL soften any crowd statement to honest low-confidence copy rather than assert a crowd reading.
4. WHEN the Live_Archetype is following the Crowd_Vibe because of a `crowd_override`, THE Consumer_Vibe_Panel SHALL indicate that the displayed vibe reflects the crowd in the room, not the venue's declaration.
5. THE Consumer_Vibe_Panel SHALL NOT display any individual consumer identity, count of named individuals, or location trail as part of the Declared_Vs_Actual view.

### Requirement 4: Consumer confirm or deny interaction

**User Story:** As a consumer at or viewing a venue, I want to confirm or deny the declared vibe, so that my honest read of the room contributes to the truth shown to everyone else.

#### Acceptance Criteria

1. THE Consumer_Vibe_Panel SHALL present a Vibe_Confirmation control allowing the authenticated consumer to confirm or deny the venue's currently Declared_Vibe.
2. WHEN an authenticated consumer submits a Vibe_Confirmation, THE Vibe_Declaration_Service SHALL record exactly one aggregate confirm or deny for that consumer, venue, and Declared_Vibe within the current Lookback_Window, replacing that consumer's prior Vibe_Confirmation for the same venue and window if one exists.
3. THE Vibe_Declaration_Service SHALL persist Vibe_Confirmation data as aggregate counts only, containing no `userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`, or raw coordinates in any business-facing or consumer-facing output.
4. THE Vibe_Declaration_Service SHALL count a Vibe_Confirmation toward Crowd_Vibe only while it falls inside the Lookback_Window, after which it SHALL expire and no longer influence Crowd_Vibe, consistent with honest-presence expiry.
5. WHERE a consumer confirms the Declared_Vibe, THE Vibe_Declaration_Service SHALL treat the confirmation as crowd agreement with the declaration; WHERE a consumer denies the Declared_Vibe, THE Vibe_Declaration_Service SHALL treat the denial as crowd divergence from the declaration, contributing to Reconciliation per Requirement 8.
6. THE Vibe_Declaration_Service SHALL apply a rate limit of at most 10 Vibe_Confirmation requests per 60-second window per consumer, consistent with the existing check-in rate limit.
7. IF a consumer exceeds the Vibe_Confirmation rate limit, THEN THE Vibe_Declaration_Service SHALL reject the request with a too-many-requests error AND SHALL NOT alter any aggregate count.

### Requirement 5: Presence confidence as the gate for crowd auditing

**User Story:** As the platform, I want the crowd to audit a declaration only once there is genuinely enough honest presence, so that a single early arrival or a stray deny cannot hijack the glyph.

#### Acceptance Criteria

1. THE Vibe_Declaration_Service SHALL derive Presence_Confidence solely from honest present check-ins inside the Lookback_Window that carry a catalog `archetypeId`, using Live_Presence_Count semantics from the presence-integrity spec, AND SHALL NOT derive it from a cumulative or decayed historical tally.
2. WHILE the number of qualifying honest present check-ins inside the Lookback_Window is below the Confidence_Threshold, THE Vibe_Declaration_Service SHALL report Presence_Confidence as not met.
3. WHEN the number of qualifying honest present check-ins inside the Lookback_Window is at or above the Confidence_Threshold, THE Vibe_Declaration_Service SHALL report Presence_Confidence as met.
4. WHEN presence expires such that the qualifying count falls back below the Confidence_Threshold, THE Vibe_Declaration_Service SHALL report Presence_Confidence as not met on the next Evaluation_Tick.
5. THE Presence_Confidence computation SHALL read presence and archetype data via at most one DynamoDB GetItem or Query per venue per Evaluation_Tick, consistent with the live-vibe-on-map read budget.

### Requirement 6: Crowd-as-auditor reconciliation precedence

**User Story:** As a consumer who trusts the map, I want a venue's declared vibe to be overridden automatically when the real crowd clearly differs, so that an owner cannot pull me in with a false vibe and the map stays honest with no admin in the loop.

#### Acceptance Criteria

1. THE Live_Archetype_Resolver SHALL accept, in addition to its existing inputs, a Presence_Confidence indicator and a Trust_Weight for the venue, AND SHALL remain observably pure: identical inputs SHALL produce an identical `{ archetype, branch }` result.
2. WHILE Presence_Confidence is not met AND the venue has an Active_Slot, THE Live_Archetype_Resolver SHALL return the Declared_Vibe AND SHALL record the Reconciliation_Branch `declared_unconfirmed` (taste-on-intent creates pull on a not-yet-confident room).
3. WHILE Presence_Confidence is met AND the venue has an Active_Slot AND the Crowd_Vibe does NOT diverge from the Declared_Vibe beyond the effective Divergence_Margin, THE Live_Archetype_Resolver SHALL return the Declared_Vibe AND SHALL record the Reconciliation_Branch `declared_confirmed`.
4. WHILE Presence_Confidence is met AND the venue has an Active_Slot AND the Crowd_Vibe diverges from the Declared_Vibe beyond the effective Divergence_Margin, THE Live_Archetype_Resolver SHALL return the Crowd_Vibe AND SHALL record the Reconciliation_Branch `crowd_override`.
5. THE effective Divergence_Margin and effective Confidence_Threshold for a venue SHALL be adjusted by the venue's Trust_Weight per Requirement 7, so a chronic over-claimer is audited sooner than an honest venue.
6. WHILE the venue has no Active_Slot, THE Live_Archetype_Resolver SHALL fall through to its existing precedence (check-in mode, then Node default, then eclectic fallback) unchanged from the live-vibe-on-map behaviour.
7. WHEN a Reconciliation decision would flip the Live_Archetype between `declared_confirmed` and `crowd_override` relative to the previous Evaluation_Tick, THE Vibe_Declaration_Service SHALL apply hysteresis so that a flip occurs only when the divergence crosses the margin by at least the Hysteresis_Buffer, so the glyph does not oscillate tick to tick. (The Hysteresis_Buffer is a founder-decision value per Requirement 14.)
8. WHEN the Live_Archetype changes as a result of Reconciliation, THE backend SHALL emit a single `node:archetype_change` delta carrying the new `liveArchetypeId` and the Reconciliation_Branch, reusing the existing socket event and the coalescing rules from live-vibe-on-map (at most one delta per venue per 10000ms window).
9. THE Reconciliation decision SHALL NOT alter beam brightness, beam height, beam animation speed, or any aliveness visual; per constellation-mode, those remain a function of pulse only, and Reconciliation changes only the glyph identity.

### Requirement 7: Per-venue declaration-accuracy trust score

**User Story:** As the platform, I want venues that chronically over-claim their vibe to have their future declarations trusted less, so that the system self-tunes its reputation loop without an administrator policing every venue.

#### Acceptance Criteria

1. THE Vibe_Declaration_Service SHALL maintain a Declaration_Accuracy_Score per venue in the range `[0, 1]`, persisted in a DynamoDB table with `billing_mode = "PAY_PER_REQUEST"`.
2. WHEN a venue is first evaluated and has no prior Declaration_Accuracy_Score, THE Vibe_Declaration_Service SHALL initialise the score to a neutral starting value (a founder-decision value per Requirement 14) so a new venue is neither presumed honest nor presumed adversarial.
3. WHEN a Reconciliation completes with Presence_Confidence met AND the outcome is `declared_confirmed`, THE Vibe_Declaration_Service SHALL adjust that venue's Declaration_Accuracy_Score upward using a bounded rolling update that never exceeds 1.
4. WHEN a Reconciliation completes with Presence_Confidence met AND the outcome is `crowd_override` (an Over_Claim), THE Vibe_Declaration_Service SHALL adjust that venue's Declaration_Accuracy_Score downward using a bounded rolling update that never falls below 0.
5. WHILE Presence_Confidence is not met, THE Vibe_Declaration_Service SHALL NOT adjust the Declaration_Accuracy_Score, so a venue is never penalised or rewarded for a room the crowd has not yet audited.
6. THE Vibe_Declaration_Service SHALL derive the Trust_Weight from the Declaration_Accuracy_Score such that a lower score yields a lower effective Confidence_Threshold and a smaller effective Divergence_Margin for that venue, so chronic over-claimers are overridden by the crowd sooner.
7. THE Declaration_Accuracy_Score update SHALL be deterministic: applying the same ordered sequence of Reconciliation outcomes to the same starting score SHALL always produce the same resulting score.
8. THE Declaration_Accuracy_Score and its updates SHALL contain no consumer identity fields and no raw coordinates.

### Requirement 8: Vibe confirmation contribution to crowd-truth

**User Story:** As a consumer, I want the confirm and deny signals from people in the room to count toward what the crowd's real vibe is, so that crowd-truth reflects honest human judgement, not only inferred archetypes.

#### Acceptance Criteria

1. THE Vibe_Declaration_Service SHALL combine, within the Lookback_Window, the archetype mode of honest present check-ins (the existing Crowd_Vibe input) with the aggregate Vibe_Confirmation confirm and deny counts to produce the Crowd_Vibe used in Reconciliation.
2. WHEN the aggregate Vibe_Confirmation for a venue's Declared_Vibe is majority-deny inside the Lookback_Window AND Presence_Confidence is met, THE Vibe_Declaration_Service SHALL treat the declaration as diverging from the crowd for the purpose of Requirement 6.4.
3. WHEN the aggregate Vibe_Confirmation for a venue's Declared_Vibe is majority-confirm inside the Lookback_Window, THE Vibe_Declaration_Service SHALL treat the confirmation as corroborating the Declared_Vibe for the purpose of Requirement 6.3.
4. THE Vibe_Confirmation majority SHALL be computed only from confirmations inside the Lookback_Window AND SHALL require at least the Confidence_Threshold number of confirmations before it can by itself trigger a `crowd_override`, so a handful of denies cannot override a declaration.
5. THE Crowd_Vibe combination of check-in mode and Vibe_Confirmation SHALL be deterministic for a fixed set of inputs.

### Requirement 9: Declared-versus-actual transparency for all parties

**User Story:** As any party — operator, staff, or consumer — I want to see both what was declared and what the crowd actually is, so that the override is transparent rather than a silent switch.

#### Acceptance Criteria

1. THE Declared_Vs_Actual view SHALL display the Declared_Vibe, the Crowd_Vibe, and the current Reconciliation_Branch for the venue.
2. WHEN the Reconciliation_Branch is `crowd_override`, THE Declared_Vs_Actual view SHALL make clear that the crowd reading is the one the map is currently following.
3. WHEN the Reconciliation_Branch is `declared_unconfirmed`, THE Declared_Vs_Actual view SHALL make clear that the declaration is shown because the crowd is not yet confident.
4. THE operator-facing and staff-facing Declared_Vs_Actual views MAY display the venue's own Declaration_Accuracy_Score trend, but the consumer-facing view SHALL NOT display another venue's Declaration_Accuracy_Score.
5. THE Declared_Vs_Actual view SHALL source its values from the same resolved Live_Archetype and `CrowdVibeSnapshot` data used elsewhere, with no recomputation that could disagree with the rendered glyph.

### Requirement 10: Serverless reconciliation and delivery

**User Story:** As the platform operator, I want reconciliation and trust scoring to run without any always-on resource, so that honest self-correction costs nothing when idle.

#### Acceptance Criteria

1. THE Reconciliation and Declaration_Accuracy_Score updates SHALL run inside the existing live-archetype-evaluator Lambda on an Evaluation_Tick AND SHALL NOT introduce any always-on process, container, load balancer, relational database, or managed cache.
2. THE Evaluation_Ticks driving Reconciliation SHALL be produced by the existing 60-second EventBridge schedule-transition tick, by new live-channel subscriptions, by check-in events landing inside the Lookback_Window, and by Vibe_Confirmation submissions, reusing the live-vibe-on-map Evaluation_Tick mechanism.
3. THE Reconciliation computation SHALL read scheduling, presence, confirmation, and trust data via at most a bounded number of DynamoDB GetItem or Query operations per venue per Evaluation_Tick, AND SHALL NOT re-send the full nodes payload when only the Live_Archetype changes.
4. ANY Lambda introduced or extended by this feature SHALL use `arm64` architecture, AND ALL new DynamoDB tables SHALL use `billing_mode = "PAY_PER_REQUEST"`.
5. WHILE no consumers are subscribed to a venue's live channel, THE backend SHALL defer Reconciliation for that venue until the next subscription or the next Active_Slot transition tick, whichever comes first, consistent with live-vibe-on-map.

### Requirement 11: Trust score feeds Venue Intelligence

**User Story:** As a business owner, I want my declaration accuracy reflected in my Venue Intelligence, so that honest declaration is rewarded and I can see how reliably my declared vibe matches my real crowd.

#### Acceptance Criteria

1. THE Vibe_Declaration_Service SHALL expose the per-venue Declaration_Accuracy_Score and the count of `declared_confirmed` versus `crowd_override` outcomes over a Reporting_Period as Anonymised_Aggregate metrics for consumption by the Report_Generator.
2. WHEN a Report is generated for a venue, THE Report SHALL be able to include the venue's declaration-accuracy metrics without exposing any consumer identity field or raw coordinate.
3. WHEN fewer Reconciliation outcomes exist for a venue and period than a minimum sample threshold, THE declaration-accuracy metric SHALL be suppressed for that period and indicated as insufficient data rather than expose a figure derived from too few outcomes.
4. THE declaration-accuracy metrics SHALL be gated by Business_Tier consistent with the venue-intelligence-reports tier gating, so detailed accuracy breakdowns follow the same paid-plan rules as other Report sections.

### Requirement 12: Area Code override reserved for adversarial cases

**User Story:** As an Area Code administrator, I want a manual override available only for genuinely adversarial venues, so that the routine case self-corrects and I intervene only when automation is insufficient.

#### Acceptance Criteria

1. THE Admin_Override SHALL allow an Area Code administrator in `apps/admin` to pin a venue's Live_Archetype to a specific catalog archetype or to suppress the venue's Live_Archetype.
2. WHILE an Admin_Override is active for a venue, THE Live_Archetype_Resolver SHALL honour the override above both the Declared_Vibe and the Crowd_Vibe.
3. THE routine self-correction in Requirements 6, 7, and 8 SHALL NOT require any Admin_Override to function; an Admin_Override SHALL be an exceptional action, not part of the normal Reconciliation loop.
4. WHEN an administrator applies or clears an Admin_Override, THE platform SHALL record the action with the administrator's identity and a timestamp for auditability.
5. THE Admin_Override SHALL render only for an authenticated administrator session AND SHALL reject any override request lacking administrator authorization.

### Requirement 13: Feature flag and backwards compatibility

**User Story:** As an operator rolling this out, I want a safe path back to the prior declaration-always-wins behaviour, so that a regression in reconciliation does not corrupt the live map.

#### Acceptance Criteria

1. THE crowd-as-auditor Reconciliation behaviour SHALL be gated behind a single feature flag `live_vibe_declaration` readable by both the web app and the backend.
2. THE default value of `live_vibe_declaration` SHALL be `false` in every environment.
3. IF the feature flag store is unreachable when `live_vibe_declaration` is read, THEN the read SHALL fall back to the default value `false`.
4. WHILE `live_vibe_declaration` is `false`, THE Live_Archetype_Resolver SHALL retain the existing live-vibe-on-map precedence in which the Declared_Vibe (schedule branches) unconditionally beats the Crowd_Vibe during an Active_Slot, so behaviour is identical to today.
5. WHILE `live_vibe_declaration` is `false`, THE Declaration_Surface and Staff_Declaration_Surface SHALL still render and still allow declaring the vibe through the Music_Schedule, but the Reconciliation, Trust_Score, and Vibe_Confirmation contributions SHALL NOT run.
6. WHEN `live_vibe_declaration` flips from `false` to `true`, THE map SHALL begin applying Reconciliation for visible venues within one socket reconnect cycle (≤ 10000ms).

### Requirement 14: Founder-decision flags

**User Story:** As the founder, I want the open numeric decisions called out explicitly with candidate answers, so that I can confirm them before they are baked into design.

#### Acceptance Criteria

1. THE spec SHALL treat the Confidence*Threshold as requiring founder confirmation. \_Candidate:* at least 5 distinct honest present check-ins carrying a catalog `archetypeId` inside the 90-minute Lookback_Window. WHEN the founder confirms or amends this value, THE confirmed value SHALL govern Requirement 5.
2. THE spec SHALL treat the Divergence*Margin as requiring founder confirmation. \_Candidate:* the Live_Archetype auto-shifts to Crowd_Vibe when the Declared_Vibe's share of the confident crowd is at or below 35% AND a different archetype commands at least a 50% plurality. WHEN the founder confirms or amends this, THE confirmed value SHALL govern Requirement 6.4.
3. THE spec SHALL treat the Hysteresis*Buffer as requiring founder confirmation. \_Candidate:* a flip between `declared_confirmed` and `crowd_override` requires the divergence to cross the margin by at least 10 percentage points beyond the flip point. WHEN the founder confirms or amends this, THE confirmed value SHALL govern Requirement 6.7.
4. THE spec SHALL treat the Declaration*Accuracy_Score neutral starting value and its rolling-update rate as requiring founder confirmation. \_Candidate:* start at 0.7, with a bounded exponential update of rate 0.15 per confident Reconciliation outcome. WHEN the founder confirms or amends these, THE confirmed values SHALL govern Requirement 7.
5. THE spec SHALL treat the minimum sample threshold for surfacing declaration-accuracy in Venue Intelligence as requiring founder confirmation. _Candidate:_ at least 10 confident Reconciliation outcomes in the Reporting_Period. WHEN the founder confirms or amends this, THE confirmed value SHALL govern Requirement 11.3.

### Requirement 15: POPIA and privacy constraints

**User Story:** As a product owner accountable under POPIA, I want declaration, confirmation, and reconciliation handling to stay aggregate and anonymised, so that the honest signal never becomes surveillance.

#### Acceptance Criteria

1. THE Crowd_Vibe, Vibe_Confirmation aggregates, and Declaration_Accuracy_Score SHALL contain no `userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`, or raw coordinates in any stored or exposed form.
2. THE platform SHALL NOT construct or persist a per-user location history or movement trail from Vibe_Confirmation, check-in, or Reconciliation events.
3. THE `node:archetype_change` delta emitted on Reconciliation SHALL carry only the venue `nodeId`, the `liveArchetypeId`, and the Reconciliation_Branch, AND SHALL carry no consumer identity.
4. WHERE identity is shown for any social feature, THE platform SHALL gate it through the existing identity-consent check AND SHALL NOT introduce any new identity exposure through declaration, confirmation, or reconciliation data.
5. THE platform SHALL NOT require, read, or persist any phone number for declaration, confirmation, or reconciliation, AND SHALL NOT depend on SMS or phone-OTP for any part of this feature.

### Requirement 16: Property-based correctness for reconciliation and trust scoring

**User Story:** As a developer, I want property-based tests for the extended resolver, the reconciliation decision, and the trust-score update, so that self-correction is correct across the input space, not just the examples I happened to think of.

#### Acceptance Criteria

1. WHEN the Live_Archetype_Resolver is invoked with valid inputs, THE return value SHALL be exactly one Archetype from the active catalog, for any Presence_Confidence and Trust_Weight.
2. WHEN the Live_Archetype_Resolver is invoked twice with the same valid inputs and no intervening state change, THE two return values SHALL have the same Archetype `id` and the same Reconciliation_Branch (idempotence).
3. WHILE Presence_Confidence is not met, THE Live_Archetype_Resolver SHALL never return the Reconciliation_Branch `crowd_override`, for any crowd composition (the crowd cannot override an un-audited room).
4. WHILE Presence_Confidence is met AND the Crowd_Vibe equals the Declared_Vibe, THE Live_Archetype_Resolver SHALL never return `crowd_override`.
5. WHEN the Declaration_Accuracy_Score update is applied to any starting score in `[0, 1]` with any Reconciliation outcome, THE resulting score SHALL remain within `[0, 1]` (bounded invariant).
6. WHEN the same ordered sequence of Reconciliation outcomes is applied twice to the same starting Declaration_Accuracy_Score, THE two resulting scores SHALL be equal (determinism).
7. WHEN a Reconciliation decision is recomputed under hysteresis with the divergence held within the Hysteresis_Buffer of the previous flip point, THE Reconciliation_Branch SHALL NOT flip relative to the previous Evaluation_Tick (no oscillation).
8. FOR ALL valid Declaration_Accuracy_Score records, serialising to the stored form then parsing back SHALL produce an equivalent record (round-trip property).

## Validated Correctness Properties

| Property                               | For all…                                                            | Holds when                                                                     |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Resolver returns one catalog Archetype | valid resolver inputs, any Presence_Confidence and Trust_Weight     | Live_Archetype_Resolver is invoked                                             |
| Resolver idempotence                   | valid inputs, no intervening state change                           | Two consecutive calls return the same Archetype `id` and Reconciliation_Branch |
| No override without confidence         | any crowd composition while Presence_Confidence is not met          | Reconciliation_Branch is never `crowd_override`                                |
| No override when crowd agrees          | Presence_Confidence met and Crowd_Vibe equals Declared_Vibe         | Reconciliation_Branch is never `crowd_override`                                |
| Trust score bounded                    | any starting score in `[0, 1]` and any Reconciliation outcome       | Updated score stays within `[0, 1]`                                            |
| Trust score determinism                | same ordered sequence of outcomes, same starting score              | Two runs produce equal scores                                                  |
| Hysteresis prevents oscillation        | divergence held within Hysteresis_Buffer of the previous flip point | Reconciliation_Branch does not flip tick to tick                               |
| Trust score serialize/parse round-trip | valid Declaration_Accuracy_Score record                             | `parse(serialize(r))` deeply equals `r`                                        |
| Confirmation expiry                    | Vibe_Confirmations outside the Lookback_Window                      | They no longer influence Crowd_Vibe                                            |
