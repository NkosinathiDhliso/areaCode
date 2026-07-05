# Implementation Plan: Event & Offer Gets

## Overview

Convert the design into a series of incremental, test-backed coding steps for the existing rewards feature. Each task builds on the previous ones and ends wired into a real surface — no orphaned code. The plan goes bottom-up: pure lifecycle/validation module first (with its property tests), then the type/schema extensions, then the repository, then the service (create/feed/claim), then the API routes, then the business-portal UI, and finally the monetization-protection regression guard.

The implementation language is **TypeScript** for backend and frontend, matching the repo (Zod schemas, AWS SDK v3, `fast-check`, Vitest). Everything stays inside the existing rewards routes on the existing API Lambda (`arm64`) and the existing `AppData_Table` (`PAY_PER_REQUEST`). No new always-on resources. No SMS / phone-OTP. No new free reach surface.

## Tasks

- [x] 1. Build the pure lifecycle and validation module
  - [x] 1.1 Create `backend/src/features/rewards/lifecycle.ts`
    - Export `classifyLifecycle(startsAt: string, endsAt: string, nowMs: number): 'upcoming' | 'live' | 'ended'` with half-open boundaries (`startsAt` → `live`, `endsAt` → `ended`)
    - Export `validateWindow(startsAt: string, endsAt: string, nowMs: number): { ok: true } | { ok: false; code: 'invalid_window' | 'window_too_long' | 'starts_in_past' }` enforcing `startsAt < endsAt`, `endsAt - startsAt <= 30 days`, and `startsAt >= nowMs - 5min`
    - Export `isClaimEligible(input): { eligible: true } | { eligible: false; code: 'check_in_required' | 'not_live' }` implementing the R4/R8.4 truth table; `loyalty` is always eligible at this gate
    - All three functions MUST be observably pure — no `Date.now()`, no I/O, no globals — so property tests can run them hundreds of times
    - _Requirements: 1.3, 1.6, 2.4, 3.1, 3.5, 4.1, 4.2, 4.3, 4.5, 8.4_

  - [x] 1.2 Write property tests for the pure module
    - **Property 1: Lifecycle partition** — `backend/src/features/rewards/__tests__/lifecycle.property.test.ts`. For arbitrary `(startsAt < endsAt, nowMs)`, assert exactly one of `upcoming`/`live`/`ended`, contiguous non-overlapping regions, and half-open boundaries. (R3.1, R3.5)
    - **Property 2: Window validation** — same file or a sibling. For arbitrary `(startsAt, endsAt, nowMs)`, assert `validateWindow` accepts iff `startsAt < endsAt` AND `endsAt - startsAt <= 30 days` AND `startsAt >= nowMs - 5min`, and returns the correct rejection code otherwise. (R1.3, R1.6, R2.4)
    - **Property 3: Claim eligibility truth table** — `backend/src/features/rewards/__tests__/claim-eligibility.property.test.ts`. Enumerate the full cross product of `(getCategory, claimRequiresCheckIn, lifecycle, hasQualifyingCheckIn)` and assert `isClaimEligible` matches the R4/R8.4 table exactly. (R4.1–R4.5, R8.4)

- [x] 2. Extend types and Zod schemas
  - [x] 2.1 Extend `backend/src/features/rewards/types.ts`
    - Add `getCategory?: 'loyalty' | 'event' | 'offer'`, `startsAt?: string`, `endsAt?: string`, `claimRequiresCheckIn?: boolean` to the `Reward` interface (all optional on disk per R1.1)
    - Extend `createRewardBodySchema`: add optional `getCategory`, optional `startsAt`/`endsAt` (`z.string().datetime()`), optional `claimRequiresCheckIn`; make `type` optional; add a `.superRefine` that, when `getCategory ∈ {event, offer}`, requires a valid window via the R1/R2 rules (delegating numeric checks to `validateWindow` semantics) and otherwise preserves today's loyalty contract
    - Extend `updateRewardBodySchema` with optional `startsAt`/`endsAt`/`claimRequiresCheckIn` and the same refinement when the target is an event/offer
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.1, 7.2_

- [x] 3. Persist and read the new attributes in the repository
  - [x] 3.1 Update `backend/src/features/rewards/repository.ts` and `dynamodb-repository.ts`
    - Thread `getCategory`, `startsAt`, `endsAt`, `claimRequiresCheckIn` through `createReward`, `updateReward`, and the read mappers
    - On read, when `getCategory` is absent, surface it as `'loyalty'` so callers never see `undefined` (R1.1, R7.1)
    - Do NOT add a `ttl` or any phone/SMS/PII attribute (R1.8)
    - Confirm no new table or GSI is introduced — same `AppData_Table`, `PAY_PER_REQUEST` (R1.7)
    - _Requirements: 1.1, 1.7, 1.8, 7.1_

- [x] 4. Wire the new behaviour into the rewards service
  - [x] 4.1 Extend `createReward` in `backend/src/features/rewards/service.ts`
    - Resolve `getCategory` (default `loyalty`); keep node-ownership and Tier_Get_Cap checks unchanged (R2.2, R2.3)
    - For `event`/`offer`: call `validateWindow(startsAt, endsAt, Date.now())`, reject with the mapped `AppError` 400 on failure (R1.3, R1.6, R2.4); default `claimRequiresCheckIn` to `true` (R1.5); if `type` omitted set `type = getCategory` (R1.4)
    - Preserve First-Get uniqueness independent of category (R2.6) and the fire-and-forget `notifyNewRewardConsumers` call (R2.7)
    - Emit the R8.1 structured `info` log
    - Return 201 with the full persisted get including the new fields (R2.5)
    - _Requirements: 1.4, 1.5, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 8.1_

  - [x] 4.2 Extend `updateReward` in `service.ts`
    - When the row is (or is being set to) `event`/`offer`, re-validate the window via `validateWindow` and reject on failure; never allow an update that leaves an event/offer without a valid window (R1.3, R1.6)
    - _Requirements: 1.3, 1.6_

  - [x] 4.3 Add the lifecycle filter to `getRewardsNearMe` in `service.ts`
    - After the existing proximity query, keep a row iff it is `loyalty` OR (`event`/`offer` AND `classifyLifecycle(startsAt, endsAt, Date.now()) === 'live'`) (R3.2, R3.3, R3.4)
    - Keep the change strictly inside this existing proximity-gated endpoint — add no new query path (R5.1, R5.2)
    - Extend the `DEV_MODE` `DEV_REWARDS` fixture with one `live` Event_Get and one `live` Offer_Get (R7.3)
    - _Requirements: 3.2, 3.3, 3.4, 5.1, 5.2, 7.3_

  - [x] 4.4 Gate the claim mint site (`reward-evaluator` worker) on `isClaimEligible`
    - The standard claim mint site is `backend/src/workers/reward-evaluator.ts` (SQS-driven, runs on a `type: 'reward'` check-in), NOT a synchronous endpoint. In its per-reward loop, for a candidate where `getCategory ∈ {event, offer}` call `isClaimEligible({ getCategory, claimRequiresCheckIn, lifecycle: classifyLifecycle(startsAt, endsAt, nowMs), hasQualifyingCheckIn: true })` and skip minting (no `createRedemption`, no `incrementClaimedCount`) when not eligible, emitting a `debug` log for the `not_live` case (R4.1, R4.2, R8.4)
    - Because the worker only runs off a check-in for `(userId, nodeId)` and the evaluation timestamp is that check-in's time, minting a code implies the check-in fell inside the live window — R4.1 is satisfied structurally with no extra lookup
    - Apply the same lifecycle skip in `rewards/threshold-lock.ts` (`processCheckInRewardLocks`) so a locked event/offer get cannot be claimed outside its window
    - Persist `claimRequiresCheckIn` but add NO new non-check-in claim path to honour the `false` branch (R5 reach invariant); leave that for a future deliberate spec
    - Leave the staff `redeem` flow (`POST /v1/rewards/:id/redeem`) untouched (R4.6)
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 8.4_

  - [x] 4.5 Write the feed and backwards-compatibility property tests
    - **Property 4: Feed lifecycle filter** — `backend/src/features/rewards/__tests__/feed-lifecycle.property.test.ts`. For arbitrary mixes of loyalty/event/offer rows and a clock, assert the filter returns every loyalty row and exactly the `live` event/offer rows. (R3.2, R3.3, R3.4)
    - **Property 5: Backwards compatibility** — `backend/src/features/rewards/__tests__/legacy-reward-compat.property.test.ts`. A row serialized without `getCategory` round-trips as `loyalty` and yields the same feed/claim decisions as a pre-feature row. (R1.1, R7.1, R7.2)

- [x] 5. Extend the API routes
  - [x] 5.1 Update `backend/src/features/rewards/handler.ts`
    - The existing `POST /v1/business/rewards` and `PUT /v1/business/rewards/:id` automatically accept the new fields via the extended schemas; confirm the 201/200 response shapes are a superset of today's (R7.2)
    - Add (or extend) a business-scoped `GET /v1/business/rewards` that returns the operator's gets annotated with `lifecycle` (`upcoming`/`live`/`ended`), authorized by the existing business JWT (R3.6, R6.3, R6.6)
    - Do NOT add any consumer-facing list/search endpoint for events (R5.1, R5.2)
    - _Requirements: 2.1, 3.6, 5.1, 5.2, 6.3, 6.6, 7.2_

  - [x] 5.2 Write the no-new-reach regression test
    - **Test: no new reach surface** — `backend/src/features/rewards/__tests__/no-global-events-feed.test.ts`. Build the Fastify app and assert the rewards router exposes no consumer-facing list/search route for events beyond the operator-scoped `GET /v1/business/rewards` and the existing proximity-gated `GET /v1/rewards/near-me`. (R5.1, R5.2)

- [x] 6. Build the business-portal UI for event/offer gets
  - [x] 6.1 Extend the get-creation UI in `apps/web` (business get-management surface)
    - Add a `getCategory` selector defaulting to `loyalty`; the existing loyalty flow stays visually unchanged when `loyalty` is selected (R6.1)
    - When `event`/`offer` is selected, reveal `startsAt`/`endsAt` datetime inputs and a `claimRequiresCheckIn` toggle (default on), with inline R1/R2 validation before save (R6.2)
    - Render a lifecycle badge (`upcoming`/`live`/`ended`) on each event/offer get in the list (R6.3)
    - Render the UI only for an operator whose JWT `businessId` matches the node's business (R6.6)
    - Add no field or copy implying free city-wide promotion (R6.5)
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_

  - [x] 6.2 Add the boost prompt (links to the existing flow, never auto-purchases)
    - For a `live` or `upcoming` event/offer get on a node with no active boost, render a non-blocking banner linking to the existing boost purchase route with copy "Boost this so people across the city see it" (R6.4)
    - The prompt MUST NOT auto-purchase or auto-apply a boost (R5.5)
    - _Requirements: 5.5, 6.4_

- [x] 7. Final checkpoint
  - Ensure all tests pass (`fast-check` property tests and unit tests). Build the backend and the `apps/web` bundle. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional; none here are — all are core.
- Each task references specific requirements clauses for traceability.
- Property tests sit beside the code they validate. Each correctness Property from the design has its own sub-task annotated with property number and requirements clauses.
- The feature ships without a runtime feature flag (R7.4): `getCategory` defaults to `loyalty`, so the change is inert for all existing data and only diverges when an operator explicitly picks `event`/`offer`. Rollback is a deploy revert.
- All compute stays inside the existing rewards routes on the existing API Lambda (`arm64`); all persistence stays in `AppData_Table` (`PAY_PER_REQUEST`). No new always-on resources, per `.kiro/steering/serverless-only.md`.
- No SMS, no phone-OTP, no phone-number identifiers in any row, schema, or UI surface, per `.kiro/steering/no-sms-no-phone-auth.md`.
- **Monetization invariant (R5):** this plan adds no consumer endpoint that lists events independent of `proximity × pulseScore`. Reach beyond proximity is bought through the existing boost flow. Task 5.2 is the regression guard that keeps it that way.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["4.5", "5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["7"] }
  ]
}
```
