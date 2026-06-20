# Requirements Document

## Introduction

Area Code's whole product is trust in a live signal. The map promises "this venue is alive, with your kind of crowd." Today that promise is only half-kept: the live count is a decayed, accumulating tally of everyone who recently checked in, not a count of who is actually present now. There is no way to leave a venue — no check-out — and no bounded expiry of stale presence, so a venue can read as "buzzing" hours after the room emptied. One trip to a venue the app said was busy that turns out dead, and the user reverts to convenience permanently.

**Presence Integrity** is the foundation that makes the live signal honest. It introduces a manual **check-out** action, **bounded presence expiry** done serverlessly, and an **honest current-presence count** per venue that the live map reflects. Honest check-in plus check-out also yields **dwell time** — how long people actually stay — which becomes new, sellable venue intelligence and the substrate the discovery "pull" magnets (belonging, momentum) will later sit on.

This spec delivers the honest **data foundation only**. The discovery "pull" UI magnets (taste-match copy, "your crowd is here", anticipation, momentum framing) are a separate later spec and are explicitly out of scope here. Distance-based **automatic** check-out is also out of scope and is captured only as a flagged, consent-gated future requirement so the foundation never depends on it.

All persistence stays on DynamoDB `PAY_PER_REQUEST`. Expiry is done serverlessly (DynamoDB TTL and/or an EventBridge-scheduled Lambda) — never a long-running process. No SMS, no phone-OTP, no phone-number identifiers are introduced anywhere. Presence is aggregate and anonymised; no per-user location history is created and proximity is evaluated then discarded, in keeping with the project's POPIA posture.

### Existing implementation this builds on (context, not requirements)

- Check-ins carry `type: 'presence' | 'reward'` with a 1-hour presence cooldown and a 4-hour reward cooldown, stored as KV TTL keys.
- A `CheckIn` record today is `{ checkInId, userId, nodeId, neighbourhoodId?, type, checkedInAt }`. There is **no** `checkedOutAt` and **no** dwell field.
- "Aliveness" today is pulse-score **decay only**: an EventBridge Lambda (`backend/src/workers/pulse-decay.ts`) runs every 5 minutes and multiplies each node's pulse score by `0.90` off-peak and `0.95` during SAST peak (18:00–23:59), flooring at 0. There is no concept of "currently inside".
- The live count surfaced to clients is `checkInCount` carried on the `node:pulse_update` socket event (`backend/src/shared/socket/events.ts` → `emitPulseUpdate`), fed to `mapStore.checkInCounts` via `useNodePulse`. Today that value is the day's accumulating check-in tally (`checkin:today:<nodeId>` incremented with a 24-hour TTL), not true presence.
- The consumer check-in pipeline order is: JWT verify (`requireAuth('consumer')`) → rate limit (`{ key: 'check-in', max: 10, windowSeconds: 60 }`) → Zod body validation → service (account/node/proximity-or-QR/abuse/cooldown checks) → DB insert → counter + pulse update → best-effort socket emit → return.
- Backend is a Fastify monolith on Lambda (`arm64`), API Gateway HTTP + WebSocket, DynamoDB tables (users, nodes, checkins, rewards, businesses, app-data). Privacy helpers `canEmitIdentity` and `sanitizeForBusiness` already exist.

## Glossary

- **Presence_Record**: the durable record that a specific consumer is currently present at a specific venue, created by a presence check-in and ended by check-out or expiry. Keyed by `(userId, nodeId)` so a consumer holds at most one open Presence_Record per venue at a time. Carries `checkedInAt`, an `expiresAt` timestamp, and a `presenceState` of `present`, `checked_out`, or `expired`.
- **Presence_State**: the lifecycle state of a Presence_Record — one of `present`, `checked_out`, `expired`. (The consumer-device condition `offline` is a client/transport state, not a Presence_Record state; see Offline.)
- **Live_Presence_Count**: the honest count, per venue, of Presence_Records currently in state `present` — i.e. people who checked in, have not checked out, and have not expired. This is the number the live map reflects. It is never a cumulative tally of everyone who ever checked in.
- **Check_In_Service**: the existing consumer check-in pipeline (`backend/src/features/check-in`), extended by this feature to open a Presence_Record and increment Live_Presence_Count.
- **Check_Out_Service**: the new consumer-facing operation ("I'm leaving") that ends a consumer's open Presence_Record at a venue, decrements Live_Presence_Count, and records Dwell_Time.
- **Presence_Expiry**: the serverless mechanism (DynamoDB TTL and/or an EventBridge-scheduled Lambda) that transitions a `present` Presence_Record to `expired` once it passes its `expiresAt`, decrementing Live_Presence_Count, so a check-in with no check-out cannot keep a person present forever.
- **Expiry_Window**: the bounded duration from `checkedInAt` after which a Presence_Record with no check-out expires. May differ for SAST peak (18:00–23:59) versus off-peak, mirroring the existing pulse-decay peak definition. Exact values require founder confirmation (see Requirement 13).
- **Dwell_Time**: the elapsed duration between a Presence_Record's `checkedInAt` and the moment it ends, recorded on check-out (true dwell) or on expiry (bounded/estimated dwell, flagged as expiry-terminated).
- **Presence_Event**: a realtime broadcast emitted when Live_Presence_Count changes for a venue, caused by a check-in, a check-out, or an expiry.
- **Pulse_Decay_Worker**: the existing EventBridge Lambda (`backend/src/workers/pulse-decay.ts`) that decays pulse score every 5 minutes.
- **Pulse_Score**: the existing weighted "aliveness" score per venue, distinct from Live_Presence_Count (a raw headcount).
- **POPIA**: the Protection of Personal Information Act (South Africa). Here it means presence and dwell data are aggregated and anonymised, no per-user location trail is stored, and proximity is evaluated then discarded.
- **Anonymised_Aggregate**: data reduced to group-level counts, percentages, or distributions containing no `userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`, or raw coordinates.
- **Auto_Check_Out** (out of scope): a future, mobile-only, explicitly consent-gated capability that ends a Presence_Record when the device leaves the venue's vicinity. Deferred to a later spec; captured here only as a flagged future requirement (Requirement 11).

## Requirements

### Requirement 1: Manual check-out action

**User Story:** As a consumer who has left a venue, I want to tap "I'm leaving" to check out, so that the live map stops counting me as present and the signal stays honest.

#### Acceptance Criteria

1. THE Check_Out_Service SHALL expose an authenticated endpoint `POST /v1/check-out` that ends the authenticated consumer's open Presence_Record at the venue identified by a `nodeId` field of length 1-128.
2. WHEN a consumer submits a check-out AND the consumer holds a Presence_Record in state `present` for that `nodeId`, THE Check_Out_Service SHALL transition that Presence_Record to state `checked_out`, set its end timestamp to the server's current time, and record Dwell_Time.
3. WHEN the Check_Out_Service transitions a Presence_Record to `checked_out`, THE Check_Out_Service SHALL decrement that venue's Live_Presence_Count by exactly 1.
4. WHEN a check-out succeeds, THE Check_Out_Service SHALL return a success response containing the venue `nodeId`, the resulting `presenceState` (`checked_out`), and the recorded Dwell_Time in whole seconds.
5. THE Check_Out_Service SHALL persist all Presence_Record state in DynamoDB tables using `billing_mode = "PAY_PER_REQUEST"`.

### Requirement 2: Check-out authentication, authorization, validation, and rate limiting

**User Story:** As the platform, I want check-out to enforce the same gate ordering as check-in, so that the new action is as safe and abuse-resistant as the existing one.

#### Acceptance Criteria

1. WHEN a request reaches `POST /v1/check-out`, THE Check_Out_Service SHALL apply, in order: JWT verification for the `consumer` role, rate limiting, request-body validation, then service processing.
2. IF the request lacks a valid consumer JWT, THEN THE Check_Out_Service SHALL reject the request with an unauthorized error and SHALL NOT alter any Presence_Record or Live_Presence_Count.
3. IF the authenticated consumer's account is disabled, THEN THE Check_Out_Service SHALL reject the request with a forbidden error and SHALL NOT alter any Presence_Record or Live_Presence_Count.
4. THE Check_Out_Service SHALL validate the request body against a schema requiring a `nodeId` string of length 1-128, and SHALL reject any request whose body fails validation with a validation error before any service processing.
5. THE Check_Out_Service SHALL enforce a rate limit of at most 10 check-out requests per 60-second window per consumer, consistent with the existing check-in rate limit.
6. IF a consumer exceeds the check-out rate limit, THEN THE Check_Out_Service SHALL reject the request with a too-many-requests error and SHALL NOT alter any Presence_Record or Live_Presence_Count.
7. THE Check_Out_Service SHALL NOT require, read, or persist any phone number, and SHALL NOT depend on SMS or phone-OTP for any part of the check-out flow.

### Requirement 3: Check-out idempotency and absent-prior-presence handling

**User Story:** As a consumer on a flaky mobile connection, I want a repeated or stray check-out to behave predictably, so that I am never double-counted out and the count never goes wrong.

#### Acceptance Criteria

1. WHEN a consumer submits a check-out for a venue where the consumer holds no Presence_Record in state `present` (never checked in, or already checked out, or already expired), THE Check_Out_Service SHALL treat the request as a successful no-op, return a success response indicating no active presence was ended, and SHALL NOT change Live_Presence_Count.
2. WHEN two check-out requests for the same consumer and the same `nodeId` are processed concurrently, THE Check_Out_Service SHALL end the Presence_Record at most once and SHALL decrement Live_Presence_Count by at most 1 across both requests.
3. WHEN a Presence_Record has already been transitioned to `expired` by Presence_Expiry AND a check-out for the same consumer and venue is then processed, THE Check_Out_Service SHALL treat the request as a successful no-op and SHALL NOT decrement Live_Presence_Count again.
4. THE Live_Presence_Count for any venue SHALL never be less than 0 under any sequence or interleaving of check-in, check-out, and expiry operations.
5. WHEN a Presence_Record ends, THE Dwell_Time SHALL be recorded exactly once for that Presence_Record regardless of how many duplicate check-out requests are received.

### Requirement 4: Presence increment on check-in

**User Story:** As a consumer checking in, I want my arrival to be counted as current presence, so that the venue reads as alive while I am actually there.

#### Acceptance Criteria

1. WHEN a presence check-in (`type = 'presence'`) succeeds for a consumer at a venue where that consumer holds no open Presence_Record, THE Check_In_Service SHALL create a Presence_Record in state `present`, set `checkedInAt` to the server's current time, set `expiresAt` per the applicable Expiry_Window, and increment that venue's Live_Presence_Count by exactly 1.
2. WHEN a presence check-in succeeds for a consumer who already holds a Presence_Record in state `present` for the same venue, THE Check_In_Service SHALL refresh that Presence_Record's `expiresAt` per the applicable Expiry_Window and SHALL NOT increment Live_Presence_Count a second time (a consumer counts at most once per venue).
3. WHERE a check-in has `type = 'reward'`, THE Check_In_Service SHALL apply the same Presence_Record creation and Live_Presence_Count increment rules as a presence check-in, so reward check-ins also reflect honest presence.
4. THE Check_In_Service SHALL create or refresh the Presence_Record only after the existing check-in validations (account status, node existence, proximity-or-QR, abuse, cooldown) have passed.
5. IF Presence_Record creation or the Live_Presence_Count increment fails after the check-in has otherwise succeeded, THEN THE Check_In_Service SHALL log the failure and SHALL still return a successful check-in response, AND the orphaned check-in SHALL be reconciled by Presence_Expiry rather than leaving a permanent over-count.

### Requirement 5: Presence expiry semantics

**User Story:** As a consumer relying on the map, I want people who never checked out to stop counting after a bounded time, so that a venue cannot stay falsely alive overnight.

#### Acceptance Criteria

1. WHILE a Presence_Record is in state `present` AND the server's current time is at or past the record's `expiresAt`, THE Presence_Expiry SHALL transition the record to state `expired`.
2. WHEN Presence_Expiry transitions a Presence_Record to `expired`, THE Presence_Expiry SHALL decrement that venue's Live_Presence_Count by exactly 1 and SHALL record a Dwell_Time for the record flagged as expiry-terminated.
3. THE Expiry_Window SHALL be a bounded duration measured from `checkedInAt`, and a Presence_Record SHALL never remain in state `present` longer than the maximum Expiry_Window plus one Presence_Expiry processing cycle.
4. THE Presence_Expiry SHALL apply a peak Expiry_Window during SAST 18:00–23:59 and an off-peak Expiry_Window otherwise, using the same peak-hour boundary as the Pulse_Decay_Worker, so presence longevity matches realistic dwell at those times. (Exact durations require founder confirmation per Requirement 13.)
5. WHEN a consumer who has a `present` Presence_Record checks in again at the same venue before expiry, THE Presence_Expiry SHALL extend the effective expiry to reflect the refreshed `expiresAt` from Requirement 4.2.
6. THE Presence_Expiry SHALL NOT transition a Presence_Record that is already in state `checked_out` or `expired`.

### Requirement 6: Serverless expiry mechanism

**User Story:** As the platform operator, I want expiry to run without any always-on resource, so that honest presence costs nothing when idle.

#### Acceptance Criteria

1. THE Presence_Expiry SHALL be implemented using only serverless, scale-to-zero resources: DynamoDB TTL and/or an EventBridge-scheduled Lambda. THE Presence_Expiry SHALL NOT use any always-on process, container, load balancer, relational database, or managed cache.
2. WHERE Presence_Expiry uses DynamoDB TTL for record cleanup, THE Presence_Expiry SHALL NOT rely on TTL deletion timing for Live_Presence_Count correctness, because DynamoDB TTL deletion is best-effort and may lag by minutes to hours; the authoritative `present`/`expired` decision SHALL be based on comparing `expiresAt` to the current time.
3. WHERE Presence_Expiry uses an EventBridge-scheduled Lambda, THE schedule interval SHALL be chosen so that no `present` Presence_Record persists beyond its Expiry_Window by more than one schedule interval, and the interval SHALL align with or be a divisor of the existing 5-minute pulse-decay cadence where practical.
4. WHEN the live read model is queried for a venue's Live_Presence_Count, THE read model SHALL exclude any Presence_Record whose `expiresAt` is in the past even if Presence_Expiry has not yet physically transitioned that record, so a stale background run never inflates the honest count.
5. THE DynamoDB tables backing Presence_Records SHALL use `billing_mode = "PAY_PER_REQUEST"` and any Lambda introduced SHALL use `arm64` architecture.

### Requirement 7: Honest live-count read model and realtime broadcast

**User Story:** As a consumer watching the map, I want the live count to reflect who is there now and to update when people arrive or leave, so that the signal is trustworthy in real time.

#### Acceptance Criteria

1. THE live map read model SHALL source each venue's displayed live count from Live_Presence_Count (current `present` Presence_Records), not from a cumulative count of historical check-ins.
2. WHEN a check-in increments, a check-out decrements, or an expiry decrements a venue's Live_Presence_Count, THE platform SHALL emit a Presence_Event for that venue carrying the venue `nodeId` and the new Live_Presence_Count.
3. THE Presence_Event SHALL be delivered over the existing WebSocket channel and SHALL be consumable by the existing client store that backs `mapStore.checkInCounts`, so the map updates without a new transport.
4. THE Presence_Event payload SHALL contain only the venue `nodeId`, the new Live_Presence_Count, and a cause indicator of `check_in`, `check_out`, or `expiry`, and SHALL contain no consumer identity fields.
5. IF Presence_Event emission fails, THEN THE platform SHALL log the failure and SHALL NOT fail or roll back the underlying check-in, check-out, or expiry, consistent with the existing best-effort fan-out behaviour.
6. WHEN a consumer requests a venue's live count via the read API, THE read model SHALL return the same Live_Presence_Count value that the most recent Presence_Event for that venue conveyed, except for records whose `expiresAt` has since passed (which SHALL be excluded per Requirement 6.4).
7. WHEN Live_Presence_Count for a venue is 0, THE read model SHALL report 0 honestly and SHALL NOT substitute a decayed or historical value to make the venue appear occupied.

### Requirement 8: Reconciliation with existing pulse decay

**User Story:** As a developer maintaining the aliveness signals, I want presence and pulse decay to be coherent rather than duplicative, so that the two numbers never contradict each other.

#### Acceptance Criteria

1. THE Live_Presence_Count (raw current headcount) and the Pulse_Score (weighted aliveness) SHALL remain distinct values with distinct meanings, and this spec SHALL NOT remove the Pulse_Decay_Worker.
2. THE Live_Presence_Count SHALL be governed solely by check-in, check-out, and expiry, and SHALL NOT be subject to the multiplicative pulse decay applied to Pulse_Score.
3. WHEN Live_Presence_Count reaches 0 for a venue through check-outs and expiries, THE platform SHALL allow the venue's reported live count to read 0 even while a residual decaying Pulse_Score is still nonzero, and the live count SHALL take precedence in any surface that claims "people are here now".
4. THE platform SHALL document, in the design phase, whether the `node:pulse_update` event's `checkInCount` field is repurposed to carry Live_Presence_Count or whether a dedicated field/event is added, so no consumer of that event silently keeps reading the old cumulative tally.

### Requirement 9: Dwell-time capture

**User Story:** As the business side of the platform, I want how long people actually stay to be captured, so that dwell time becomes sellable venue intelligence.

#### Acceptance Criteria

1. WHEN a Presence_Record ends by check-out, THE platform SHALL record a Dwell_Time equal to the whole-second difference between the record's `checkedInAt` and the check-out time, attributed to the venue, and marked as `checkout_terminated`.
2. WHEN a Presence_Record ends by expiry, THE platform SHALL record a Dwell_Time for that record marked as `expiry_terminated`, with the recorded duration bounded by the applicable Expiry_Window.
3. THE recorded Dwell_Time SHALL be a non-negative integer number of seconds.
4. THE Dwell_Time records SHALL be persisted in a form suitable for later aggregation per venue and per time band, using DynamoDB `PAY_PER_REQUEST` storage.
5. THE Dwell_Time records SHALL contain no raw coordinates and no per-user location trail; a Dwell_Time record SHALL reference the venue and the duration, and SHALL only retain a consumer reference to the extent required for the at-most-once and anonymised-aggregation guarantees elsewhere in this document.

### Requirement 10: POPIA and privacy constraints

**User Story:** As a product owner accountable under POPIA, I want presence and dwell handling to stay aggregate and anonymised, so that the honest signal never becomes surveillance.

#### Acceptance Criteria

1. THE platform SHALL evaluate proximity for check-in verification and SHALL discard the supplied coordinates immediately after the proximity decision, persisting no latitude or longitude on any Presence_Record or Dwell_Time record, consistent with the existing check-in behaviour.
2. THE platform SHALL NOT construct or persist a per-user location history or movement trail from check-in, check-out, or expiry events.
3. WHEN presence or dwell data is exposed to any business-facing or analytics surface, THE platform SHALL expose only Anonymised_Aggregate data containing no `userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`, or raw coordinates.
4. THE Presence_Event broadcast SHALL carry no consumer identity, so live count changes cannot be attributed to an individual by an observer.
5. WHERE identity is shown for social features (e.g. friend toasts), THE platform SHALL gate it through the existing identity-consent check (`canEmitIdentity`) and SHALL NOT introduce any new identity exposure through presence or dwell data.

### Requirement 11: Platform reality and deferred automatic check-out (FLAGGED — FUTURE)

**User Story:** As a consumer who forgets to check out, I want the system to be honest about what each platform can do, so that the foundation works on web today without promising background tracking it cannot deliver.

#### Acceptance Criteria

1. THE manual Check_Out_Service and Presence_Expiry SHALL be sufficient on their own to keep Live_Presence_Count honest on web/PWA, where background geolocation is unavailable and presence is a foreground-only concern.
2. THE foundation delivered by this spec SHALL NOT depend on Auto_Check_Out; honest presence SHALL hold with manual check-out plus expiry even if Auto_Check_Out is never built.
3. *(Deferred to a later spec — candidate criteria for founder review.)* WHERE Auto_Check_Out is later enabled, it SHALL be mobile-only and SHALL require explicit, revocable user consent to background ("Always") location before any automatic check-out occurs.
4. *(Deferred to a later spec — candidate criteria for founder review.)* WHERE Auto_Check_Out is enabled and consented, it SHALL evaluate device-to-venue distance to trigger an automatic check-out and SHALL discard the evaluated location immediately, persisting no location trail.
5. *(Deferred to a later spec — candidate criteria for founder review.)* WHERE a user has not consented to background location, THE platform SHALL rely solely on manual check-out and expiry for that user and SHALL NOT degrade their presence honesty relative to a consenting user.

### Requirement 12: Business-intelligence surface for dwell time

**User Story:** As a business owner, I want aggregated dwell-time insight for my venue, so that I can understand how long my crowd actually stays.

#### Acceptance Criteria

1. THE platform SHALL make per-venue Dwell_Time available as Anonymised_Aggregate metrics (for example average and median dwell, and a dwell distribution by time band) computed only from Dwell_Time records for that venue.
2. THE dwell-time aggregates SHALL distinguish `checkout_terminated` dwell from `expiry_terminated` dwell, so the business signal is not silently inflated or deflated by expiry estimates.
3. WHEN fewer dwell records exist for a venue and period than a minimum sample threshold, THE platform SHALL suppress the dwell aggregate for that period and indicate insufficient data rather than expose a figure derived from too few people.
4. THE dwell-time aggregate output SHALL contain no consumer identity fields and no raw coordinates.
5. *(Founder decision per Requirement 13.)* WHETHER dwell-time aggregates appear in business reports in this release or are captured-now / surfaced-later SHALL be confirmed before the dwell business surface is built; the underlying Dwell_Time capture (Requirement 9) SHALL proceed regardless.

### Requirement 13: Founder-decision flags

**User Story:** As the founder, I want the open product decisions called out explicitly with candidate answers, so that I can confirm them before they are baked into design.

#### Acceptance Criteria

1. THE spec SHALL treat the exact Expiry_Window durations as requiring founder confirmation. *Candidate:* off-peak Expiry_Window of 90 minutes and peak (SAST 18:00–23:59) Expiry_Window of 180 minutes, both measured from the most recent check-in for the venue. WHEN the founder confirms or amends these values, THE confirmed values SHALL govern Requirement 5.
2. THE spec SHALL treat whether a manual check-out grants a reward or trust nudge as requiring founder confirmation. *Candidate:* manual check-out grants no tangible reward in this release but is eligible for a future trust/streak signal, so honest leaving is encouraged without creating a farmable incentive. WHEN the founder confirms or amends this, THE confirmed decision SHALL govern any reward coupling in Check_Out_Service.
3. THE spec SHALL treat whether dwell-time aggregates surface in business reports now or later as requiring founder confirmation, as captured in Requirement 12.5. *Candidate:* capture Dwell_Time now (Requirement 9) and surface the business aggregate in a later reporting release. WHEN the founder confirms or amends this, THE confirmed decision SHALL govern Requirement 12.
4. THE spec SHALL treat whether the `node:pulse_update` `checkInCount` field is repurposed for Live_Presence_Count versus adding a dedicated presence field/event as requiring a documented decision in design, as captured in Requirement 8.4. *Candidate:* add an explicit presence value to the realtime payload so no existing consumer silently misreads the change.
