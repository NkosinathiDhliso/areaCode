# Requirements Document

## Introduction

A loyalty get ("free coffee on your 5th visit") qualifies on a cumulative lifetime count: once a consumer passes the threshold, every later reward check-in qualifies again, forever. The only thing limiting repeat redemptions today is a side effect of the claim guard, which blocks a re-mint until the previous code's 24-hour expiry passes. The result is behaviour no business chose and none can see: after 5 visits, a regular earns the get roughly once per day indefinitely, and redeeming a code early does not shorten or lengthen that cadence in any intentional way.

This feature, **Loyalty Repeat Redemption**, makes repeatability an explicit, business-controlled property of a loyalty get and closes the integrity cracks around it:

1. A new `repeatPolicy` on loyalty gets: `once` (default, at most one redemption per consumer, ever) or `per_visit` (a consumer past the threshold can earn the get again on a later visit, anchored to their previous staff-validated redemption plus a 4-hour repeat window). The 4-hour window matches the existing per-venue reward check-in cooldown, so one repeat maps to one real visit.
2. The repeat window is anchored to **redemption**, not minting. Staff validation at the counter is the moment a get costs the business money, so it is the clock that governs when the next one can be earned. This closes the same-sitting double redemption (mint, redeem late in the code's life, check in again, redeem again minutes later).
3. Qualification correctness fixes that the repeat mechanic amplifies: the mint-time evaluator must honour the grandfathered Threshold_Lock it currently ignores, and the progress shown to consumers must count the same visits the evaluator counts (today they disagree).
4. Abuse-control realignment so the `reward_drain` guard counts actual minted claims rather than check-in attempts, never punishes presence check-ins, and cannot be bypassed by omitting the device fingerprint.
5. Staff redemption hardening: fail closed when the code's reward or venue cannot be resolved, reject codes for deactivated rewards, and raise redemption-code entropy from 6 to 8 characters.

Everything stays on the existing serverless stack: the API Lambda, the SQS reward-evaluator worker, and DynamoDB `PAY_PER_REQUEST`. No new tables, no new always-on resources, no SMS, no phone identifiers. Gets remain a free engagement layer discovered vibe-first; this spec adds no new discovery surface.

## Glossary

- **Get**: the consumer-facing name for a reward (`backend/src/features/rewards`). A `Reward` row attached to a `Node`.
- **Loyalty_Get**: a get with `getCategory = loyalty` (the default), earned by check-in behaviour via `type` (`nth_checkin`, `daily_first`, `streak`, `milestone`).
- **Repeat_Policy**: the new per-get field, `once` or `per_visit`. Absent on disk reads as `once`.
- **Qualifying_Visit**: a check-in with `type = 'reward'` at the get's node. The single definition of "visit" used by qualification, progress display, and Threshold_Lock advancement.
- **Visit_Cooldown**: the existing 4-hour per-consumer, per-venue reward check-in cooldown (`REWARD_COOLDOWN` in `backend/src/features/check-in/service.ts`).
- **Repeat_Window**: the minimum interval between a consumer's staff-validated redemption of a `per_visit` get and the next time a new code for that get may be minted for them: 4 hours, equal to the Visit_Cooldown.
- **Claim_Guard**: the `REWARD_CLAIM#{rewardId}#{userId}` row in the app-data table whose conditional write makes minting idempotent (`backend/src/workers/reward-evaluator-repository.ts`).
- **Redemption_Code**: the short code shown in the consumer wallet and typed by staff into the validator (`POST /v1/rewards/:id/redeem`).
- **Threshold_Lock**: the grandfathering row that snapshots a consumer's threshold when they start progressing toward a reward (`backend/src/features/rewards/threshold-lock.ts`, Churn-defences Requirement 1).
- **Effective_Threshold**: `min(lockedThreshold, current triggerValue)` for a consumer with a lock, else the current `triggerValue`.
- **Reward_Evaluator**: the SQS-driven worker that mints redemption codes after a reward check-in (`backend/src/workers/reward-evaluator.ts`).
- **Reward_Drain**: the abuse flag for excessive claims at one venue (`backend/src/features/check-in/abuse.ts`).

## Requirements

### Requirement 1: Repeat_Policy data model

**User Story:** As a business operator, I want to choose whether a loyalty get is redeemable once per customer or repeatable per visit, so that I decide what my get costs me instead of inheriting an accidental daily giveaway.

#### Acceptance Criteria

1. THE `Reward` entity SHALL carry a `repeatPolicy` field with value in `{ once, per_visit }`. WHERE a `Reward` row is read that has no `repeatPolicy` attribute, THE read model SHALL treat it as `once`, with no backfill.
2. THE default of `once` is a deliberate behaviour change: rows created before this feature currently repeat implicitly on the 24-hour claim-guard expiry, and after this feature they SHALL stop repeating. THE change SHALL be called out in the deploy notes.
3. WHERE `repeatPolicy = per_visit` is supplied on create or update, THE operation SHALL be accepted only when `getCategory = loyalty` AND `type = nth_checkin`. IF supplied for any other category or type, THEN THE operation SHALL be rejected with a 400 `repeat_not_supported` error and SHALL NOT persist.
4. Event_Gets and Offer_Gets SHALL never repeat: their claim behaviour is governed by their Active_Window and is unchanged by this spec.
5. THE create and update Zod schemas (`createRewardBodySchema`, `updateRewardBodySchema`) SHALL accept the optional `repeatPolicy` field and enforce criterion 3 via refinement.
6. THE new fields SHALL persist in the existing tables with no new table, GSI, or TTL attribute, and SHALL NOT introduce any phone-number, SMS, or consumer-PII attribute.

### Requirement 2: Redemption-anchored Claim_Guard

**User Story:** As a business operator, I want a repeat customer to earn the get again only after a real, separate visit, so that one sitting can never produce two redemptions.

#### Acceptance Criteria

1. AT most one live Redemption_Code (unredeemed and unexpired) SHALL exist per `(consumer, reward)` at any time, preserved under concurrent mint attempts by the existing conditional-write semantics.
2. WHERE `repeatPolicy = once`: THE mint SHALL be allowed only when the consumer has never redeemed this reward. A code that expired unredeemed SHALL NOT consume the entitlement; a new code MAY be minted after such an expiry.
3. WHERE `repeatPolicy = per_visit`: a re-mint SHALL be allowed only when the consumer's previous code either (a) was redeemed at least 4 hours (the Repeat_Window) before the mint time, or (b) expired without ever being redeemed. A redemption inside the last 4 hours SHALL block the mint even when the previous code's `codeExpiresAt` has passed.
4. WHEN staff successfully validate a Redemption_Code, THE redeem path SHALL stamp the redemption time onto the Claim_Guard row for that `(consumer, reward)`, so criteria 2 and 3 are decidable by the guard's conditional write alone. IF the guard stamp fails after the redemption row is marked redeemed, THEN THE failure SHALL be logged loudly and the consumer SHALL remain blocked from re-minting until the previous code's expiry (fail toward the business, never toward a free extra mint).
5. THE mint decision SHALL be expressed as a deterministic pure function of `(repeatPolicy, guardState, nowMs)`, unit-testable without I/O, and THE DynamoDB condition expression SHALL implement exactly that function's accept set.
6. THE slot-cap rollback path (mint succeeded, `incrementClaimedCount` conditionally failed) SHALL expire the Claim_Guard in place rather than deleting it, so redemption history recorded on the guard survives a rollback.
7. Claim_Guard rows written before this feature carry no redemption stamp. SUCH rows SHALL behave as they do today (re-mint gated only by `codeExpiresAt`) until their next redemption stamps them. This transitional window is bounded by the 24-hour code TTL.

### Requirement 3: Qualification correctness

**User Story:** As a consumer, I want the progress the app shows me to be the progress the system actually honours, so that "5 of 5 visits" always means the get is earned.

#### Acceptance Criteria

1. THE Reward_Evaluator SHALL qualify `nth_checkin` gets against the consumer's Effective_Threshold (Threshold_Lock aware), not the raw `triggerValue`. A consumer whose lock says 5 SHALL qualify at 5 qualifying visits even after the venue raises the threshold to 10.
2. ONE shared repository function SHALL define and count Qualifying_Visits (`type = 'reward'` check-ins at the node), and BOTH the Reward_Evaluator's qualification and the consumer-facing progress read (`getRewardEligibility`) SHALL use it. The current progress read counts all check-in types and SHALL be corrected even where that lowers a displayed count.
3. `processCheckInRewardLocks` SHALL advance Threshold_Lock progress only on Qualifying_Visits, so lock progress, displayed progress, and mint-time qualification share one visit definition.
4. GIVEN identical stored state and clock, THE displayed eligibility and the evaluator's qualification decision SHALL agree.
5. THE Qualifying_Visit count read SHALL be bounded (query by node or time range), not an unbounded fetch of the consumer's full check-in history.

### Requirement 4: Abuse containment for repeats

**User Story:** As the platform operator, I want abuse controls that catch farming without punishing the loyal regulars this feature exists to reward.

#### Acceptance Criteria

1. THE Reward_Drain signal SHALL count minted redemptions per `(consumer, node)` per 24 hours, keyed by `userId` (with `fingerprintHash` as additional evidence when present), and SHALL be recorded at the mint site in the Reward_Evaluator.
2. Presence check-ins (`type = 'presence'`) SHALL never contribute to Reward_Drain, and Reward_Drain SHALL never block a check-in. A consumer checking in repeatedly for presence at their local venue SHALL NOT be rate-limited by the drain guard.
3. WHEN a consumer's mint count at one node exceeds 3 in 24 hours, THE system SHALL write a high-priority abuse flag to the existing admin abuse queue without blocking the mint; the structural ceiling under criterion R2.3 is 6 per day and staff in-person validation remains the cost gate.
4. Omitting `fingerprintHash` SHALL NOT disable any user-keyed abuse check. Checks keyed on `userId` SHALL always run.
5. THE existing `device_velocity` and `new_account_velocity` checks SHALL remain unchanged.

### Requirement 5: Staff redemption hardening

**User Story:** As a business owner, I want the validator to refuse any code it cannot fully verify, so that a code is never honoured against the wrong business or a dead get.

#### Acceptance Criteria

1. IF the reward or node behind a Redemption_Code cannot be resolved at redemption time, THEN THE redeem SHALL be rejected with 400 `invalid_code`. The current behaviour (skipping the staff-to-business ownership check when the lookup fails) SHALL be removed.
2. IF the code's reward has `isActive = false` or has been deleted, THEN THE redeem SHALL be rejected with 400 `reward_inactive`.
3. THE consumer wallet (`GET /v1/users/me/unclaimed-rewards`) SHALL exclude codes whose reward is deleted or deactivated, so the wallet never shows a code the validator will refuse.
4. Redemption_Codes SHALL be 8 characters from the existing 32-character alphabet (up from 6), and `redeemBodySchema` SHALL require exactly 8 characters. No dual-length acceptance window is added: any live 6-character codes at deploy expire within their 24-hour TTL and are re-earnable.
5. THE staff validator UI (`apps/staff`) SHALL accept the 8-character code format.
6. THE guest-claim First-Get token flow (`guest-claim.ts`, 8-character Crockford base32) is a separate path and SHALL NOT be modified.

### Requirement 6: Business portal controls and honest copy

**User Story:** As a business operator, I want to set and understand the repeat behaviour of my get in plain terms, so that I am never surprised by what it costs.

#### Acceptance Criteria

1. THE get create and edit UI SHALL expose the Repeat_Policy for loyalty `nth_checkin` gets as a choice defaulting to `once`, with copy stating the exact behaviour, for example: "One per customer" and "Regulars can earn this again each visit, at least 4 hours after their last redemption".
2. WHERE `totalSlots` is set on a `per_visit` get, THE UI SHALL state that slots count total redemptions including repeats, not distinct customers.
3. THE existing threshold-edit flow (grandfather-aware confirm with affected-customer count) SHALL be unaffected.
4. THE UI SHALL NOT present copy implying unlimited free redemptions and SHALL NOT expose Repeat_Policy controls on event or offer gets.

### Requirement 7: Backwards compatibility and migration safety

**User Story:** As a developer, I want this to ship with zero data migration and a clean rollback, so that hardening the gets system carries no data risk.

#### Acceptance Criteria

1. EVERY existing `Reward` row without a `repeatPolicy` attribute SHALL behave as `once` (R1.1, R1.2), with no backfill.
2. THE existing endpoint response shapes SHALL remain supersets of today's shapes: fields MAY be added, none SHALL be removed or change type.
3. THE `DEV_MODE` fixtures SHALL continue to return valid responses and SHALL include at least one `per_visit` loyalty get so dev surfaces exercise the new policy.
4. THE feature SHALL ship without a runtime feature flag. Rollback is a deploy revert; `repeatPolicy` attributes on disk are ignored by the reverted code.
5. THE feature SHALL NOT remove, revive, or modify any phone-OTP/SMS code path (`.kiro/steering/no-sms-no-phone-auth.md`).

### Requirement 8: Observability

**User Story:** As the platform operator, I want repeat activity to be visible, so that farming shows up in logs and the admin queue before a business complains.

#### Acceptance Criteria

1. WHEN a repeat mint occurs (`per_visit`, second or later code for a `(consumer, reward)`), THE Reward_Evaluator SHALL emit a structured info-level log with `rewardId`, `nodeId`, `userId`, the policy, and the running redemption count from the Claim_Guard.
2. WHEN a mint is skipped by the Repeat_Window or the `once` policy, THE Reward_Evaluator SHALL emit a debug-level log with the rejection code; it SHALL NOT raise an unhandled exception.
3. WHEN the R4.3 drain threshold trips, THE flag row SHALL carry the mint timestamps as evidence for admin review.
