# Design Document: Event & Offer Gets

## Overview

This feature extends the existing `Reward` ("get") model with two new categories — `event` and `offer` — that carry a time window and claim-on-check-in semantics, without introducing any new free reach surface. It is deliberately a **thin, additive** change layered onto the existing rewards feature (`backend/src/features/rewards`), the existing single table (`AppData_Table`, `PAY_PER_REQUEST`), and the existing API Lambda. The commercial model is untouched: reach beyond proximity is still bought through the existing boost flow.

The guiding architectural principle is the monetization invariant from Requirement 5: **a get is a free engagement tool; reach is the paid product.** Every design decision below preserves that line. Concretely, that means we add no new query path that returns events independent of the existing `proximity × pulseScore` ranking. Events and offers ride the _same_ read paths as loyalty gets and the _same_ node visibility (boost-aware) as everything else.

### Goals

- Make `event` and `offer` first-class get categories with a `[startsAt, endsAt)` window.
- Gate event/offer claims on a live check-in by default, so promotion drives pulse.
- Keep existing rewards, consumers, and DEV_MODE fixtures working with zero migration.
- Add **no** new free city-wide reach; boosts remain the paid amplifier.

### Non-Goals

- No new DynamoDB table, GSI, or always-on resource.
- No global "what's on" events feed (explicitly forbidden by R5.2).
- No change to `BOOST_PRICING`, the boost-floor mechanic, or tier constants.
- No change to the staff redemption flow.
- No SMS / phone-OTP / phone-number identifiers (steering rule).

## Architecture

The change touches four layers, all existing:

```
apps/web (business get-management UI)        ← R6: category picker, window inputs, boost prompt
        │  POST/PUT /v1/business/rewards
        ▼
backend/src/features/rewards/handler.ts      ← R2: extended Zod-validated routes
        │
        ▼
backend/src/features/rewards/service.ts      ← R1-R4,R7,R8: validation, lifecycle, claim gating
        │  ┌─ lifecycle.ts (NEW, pure)        ← R3.5, R4.5: pure classifiers + claim-eligibility
        ▼  └─ check-in lookup (existing repo)
backend/src/features/rewards/repository.ts   ← persist/read getCategory + window fields
backend/src/features/rewards/dynamodb-repository.ts
        │
        ▼
AppData_Table (DynamoDB, PAY_PER_REQUEST)    ← R1.7: same table, additive attributes
```

There is **no** new endpoint that lists events globally. The only consumer read path remains `GET /v1/rewards/near-me`, which already filters by proximity; we add a lifecycle filter inside it (R3.2).

## Data Models

### Reward row (extended)

The `Reward` interface in `backend/src/features/rewards/types.ts` gains four optional attributes. All are optional on disk so existing rows (which lack them) deserialize cleanly and are interpreted as loyalty gets (R1.1, R7.1).

| Attribute              | Type                              | Notes                                                                      |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `getCategory`          | `'loyalty' \| 'event' \| 'offer'` | Absent → treated as `loyalty`. (R1.1)                                      |
| `startsAt`             | ISO-8601 UTC ms string            | Required iff `event`/`offer`. (R1.3)                                       |
| `endsAt`               | ISO-8601 UTC ms string            | Required iff `event`/`offer`; `> startsAt`, window ≤ 30 days. (R1.3, R1.6) |
| `claimRequiresCheckIn` | boolean                           | Defaults `true` for `event`/`offer`. (R1.5)                                |

`type` remains required on disk for all rows. For event/offer gets where the operator omits `type`, the service stores `type = getCategory` (i.e. `'event'` or `'offer'`) so existing non-null `type` consumers keep working (R1.4).

No `ttl`, no phone/SMS/PII attributes are added (R1.8). Ended events are filtered at read time (R3.4) rather than deleted, so historical gets remain visible to the operator (R3.6) and to existing cleanup/retention behaviour.

### Zod schema changes (`types.ts`)

`createRewardBodySchema` becomes a discriminated-by-`getCategory` shape using a refinement (not a hard `discriminatedUnion`, to keep the field optional-defaulting-to-loyalty contract):

```text
createRewardBodySchema = base.extend({
  getCategory: z.enum(['loyalty','event','offer']).optional(),   // default applied in service
  type: existing enum, made .optional() when getCategory ∈ {event,offer}
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  claimRequiresCheckIn: z.boolean().optional(),
}).superRefine(...)   // window required + ordered + ≤30d when event/offer; not-in-past (R2.4)
```

`updateRewardBodySchema` gains optional `startsAt`, `endsAt`, `claimRequiresCheckIn` with the same refinements applied only when the row is (or becomes) an event/offer.

## Pure modules

### `lifecycle.ts` (NEW) — deterministic, no I/O

Two pure functions, both unit-testable without mocks (R3.5, R4.5):

```text
classifyLifecycle(startsAt: string, endsAt: string, nowMs: number)
  → 'upcoming' | 'live' | 'ended'
  // 'upcoming'  when nowMs < Date.parse(startsAt)
  // 'live'      when start <= nowMs < end
  // 'ended'     when nowMs >= Date.parse(endsAt)

isClaimEligible(input: {
  getCategory: 'loyalty'|'event'|'offer'
  claimRequiresCheckIn: boolean
  lifecycle: 'upcoming'|'live'|'ended'   // for loyalty, pass 'live'
  hasQualifyingCheckIn: boolean
}) → { eligible: true } | { eligible: false; code: 'check_in_required' | 'not_live' }
  // loyalty            → eligible (existing rules apply elsewhere)
  // event/offer + not live           → { eligible:false, code:'not_live' }   (R8.4)
  // event/offer + live + requiresCI + !hasCI → { eligible:false, code:'check_in_required' } (R4.2)
  // event/offer + live + (!requiresCI or hasCI) → eligible (R4.1, R4.3)
```

Window validation (`startsAt < endsAt`, `≤ 30 days`, not-in-past beyond 5-min skew) lives as a pure `validateWindow(startsAt, endsAt, nowMs)` helper reused by both the create and update service paths and the Zod refinement.

## Service layer changes (`service.ts`)

### `createReward`

1. Resolve `getCategory` (default `loyalty`).
2. Node ownership + Tier_Get_Cap checks run **unchanged** (R2.2, R2.3) — event/offer gets count against `countActiveRewardsForBusiness` exactly like loyalty gets.
3. If `event`/`offer`: run `validateWindow`; reject 400 on failure (R1.3, R1.6, R2.4). Default `claimRequiresCheckIn` to `true` (R1.5). If `type` omitted, set `type = getCategory` (R1.4).
4. First-Get uniqueness check is unchanged and independent of category (R2.6).
5. Persist via `repo.createReward` with the new attributes.
6. Emit the R8.1 structured log.
7. Fire `notifyNewRewardConsumers` exactly as today (R2.7).

### `getRewardsNearMe`

After the existing proximity query returns rows, apply a lifecycle filter: keep a row if it is a loyalty get OR (`event`/`offer` AND `classifyLifecycle(...) === 'live'`) (R3.2, R3.3). `nowMs` is `Date.now()`. This is the **only** consumer read change, and it stays inside the existing proximity-gated endpoint (R5.1, R5.2).

DEV_MODE fixtures gain one Event_Get (`live`) and one Offer_Get (`live`) so dev surfaces exercise the category (R7.3).

### `listBusinessRewards` (operator read)

The operator-facing get list returns all of the business's gets annotated with `lifecycle` (`upcoming`/`live`/`ended`) so the portal can show scheduled and past happenings (R3.6, R6.3). If no such endpoint exists yet, add a thin `GET /v1/business/rewards` returning the business's gets with lifecycle; otherwise extend the existing one.

### Claim path (event/offer) — the `reward-evaluator` worker

Consumer claiming is **not** a synchronous endpoint. In the current architecture a code is minted asynchronously by the SQS-driven **`reward-evaluator` worker** (`backend/src/workers/reward-evaluator.ts`): a `type: 'reward'` check-in (`backend/src/features/check-in/service.ts`) enqueues a message; the worker loops the node's active rewards, checks slots, calls `generateRedemptionCode()` → `repo.createRedemption(...)` → `incrementClaimedCount(...)` → `emitClaimEvents(...)`. There is also `processCheckInRewardLocks` (`rewards/threshold-lock.js`) for locked rewards and `guest-claim.ts` for the walk-in token flow.

The architecturally important consequence: **the only standard claim path is already check-in-triggered.** So for an event/offer get, the eligibility gate lives inside the `reward-evaluator` worker's per-reward loop, and the check-in precondition of R4.1 is satisfied _structurally_ — the worker only runs because a check-in happened for `(userId, nodeId)`, and the evaluation timestamp is that check-in's time.

The gate added to the worker loop is therefore a **lifecycle filter**: for a candidate reward where `getCategory ∈ {event, offer}`, skip it (mint no code) unless `classifyLifecycle(startsAt, endsAt, nowMs) === 'live'`. When a code _is_ minted, the check-in fell inside the live window, so R4.1 holds without a separate lookup. `not_live` (R8.4) here means "skip silently with a `debug` log" rather than an HTTP 400, because the worker has no HTTP response to return.

`isClaimEligible` (from `lifecycle.ts`) remains the single source of truth for the decision and is unit-tested against the full truth table; the worker calls it with `hasQualifyingCheckIn = true` (the worker's precondition) and the row's lifecycle. The staff `redeem` flow (`POST /v1/rewards/:id/redeem`) is untouched (R4.6).

> Note on `claimRequiresCheckIn = false`: the current architecture has **no** non-check-in claim path for standard gets, so `claimRequiresCheckIn = false` has no distinct runtime behaviour today — every standard claim is check-in-triggered. The flag is still persisted (R1.5) so a future non-check-in claim surface can honour it, and `isClaimEligible` already encodes the `false` branch. This is called out so no one wires a new free claim path to satisfy it; doing so would risk the R5 reach invariant and must be a deliberate, separately-specced decision.

## Monetization protection (R5) — how the invariant is enforced in code

- **No new query path.** The consumer only ever sees gets through `getRewardsNearMe`, which is proximity-bounded by `findNodesNearby`/`getRewardsNearMe`'s radius. Events inherit that bound (R5.1).
- **No global feed.** We add no route, no map layer, and no ranking that returns events independent of `proximity × pulseScore` (R5.2). This is enforced by _omission_ and asserted by a test that the rewards router exposes no new list endpoint beyond the operator-scoped one.
- **Boost is the amplifier.** Because a boosted node already ranks higher and surfaces wider through the existing boost mechanic, a `live` event on a boosted node is transitively visible beyond proximity — by paying (R5.3). No code in this feature reads or writes boost state; it simply doesn't suppress it.
- **No auto-boost.** `createReward` never touches the boost flow (R5.5). The portal only _links_ to the existing purchase flow (R6.4).
- **No pricing change.** No constant in `business/types.ts` is modified (R5.4).

## UI changes (`apps/web` business surface)

- Get-creation form gains a `getCategory` selector defaulting to `loyalty` (R6.1). Existing loyalty creation is visually unchanged when `loyalty` is selected.
- Selecting `event`/`offer` reveals `startsAt`/`endsAt` datetime inputs and a `claimRequiresCheckIn` toggle (default on), with inline R1/R2 validation (R6.2).
- The get list shows a lifecycle badge (`upcoming`/`live`/`ended`) (R6.3).
- For `live`/`upcoming` event/offer gets on a node **without** an active boost, render a non-blocking banner linking to the existing boost purchase route — copy: "Boost this so people across the city see it." It never auto-purchases (R6.4, R5.5).
- No UI copy implies free city-wide promotion (R6.5). Authorization matches existing get-management (R6.6).

## Components and Interfaces

### `lifecycle.ts` (new, pure) — `backend/src/features/rewards/lifecycle.ts`

```ts
export type Lifecycle = 'upcoming' | 'live' | 'ended'
export type GetCategory = 'loyalty' | 'event' | 'offer'

export function classifyLifecycle(startsAt: string, endsAt: string, nowMs: number): Lifecycle

export function validateWindow(
  startsAt: string,
  endsAt: string,
  nowMs: number,
): { ok: true } | { ok: false; code: 'invalid_window' | 'window_too_long' | 'starts_in_past' }

export function isClaimEligible(input: {
  getCategory: GetCategory
  claimRequiresCheckIn: boolean
  lifecycle: Lifecycle
  hasQualifyingCheckIn: boolean
}): { eligible: true } | { eligible: false; code: 'check_in_required' | 'not_live' }
```

### `types.ts` — extended `Reward` and Zod schemas

`Reward` gains `getCategory?`, `startsAt?`, `endsAt?`, `claimRequiresCheckIn?` (all optional on disk, R1.1). `createRewardBodySchema` / `updateRewardBodySchema` gain the matching optional fields plus a `.superRefine` that enforces the window rules when `getCategory ∈ {event, offer}`.

### `repository.ts` / `dynamodb-repository.ts` — persistence

`createReward(...)` and `updateReward(...)` thread the four new attributes through to `AppData_Table`. Read mappers normalise a missing `getCategory` to `'loyalty'`. No new table, GSI, or `ttl`.

### `service.ts` — orchestration (existing module, extended)

| Function                             | Change                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createReward`                       | resolve category, `validateWindow`, default `claimRequiresCheckIn=true`, default `type=getCategory`, R8.1 log; ownership/cap/First-Get/notify unchanged                                      |
| `updateReward`                       | re-`validateWindow` when row is event/offer                                                                                                                                                  |
| `getRewardsNearMe`                   | post-filter: keep loyalty + `live` event/offer; DEV fixtures gain one live event + one live offer                                                                                            |
| consumer claim site                  | the **`reward-evaluator` worker** (`backend/src/workers/reward-evaluator.ts`) loop gates event/offer candidates on `isClaimEligible` (lifecycle `live`); check-in precondition is structural |
| `listBusinessRewards` (new/extended) | return operator's gets annotated with `lifecycle`                                                                                                                                            |

### `handler.ts` — routes (existing, extended)

`POST /v1/business/rewards` and `PUT /v1/business/rewards/:id` accept the new fields via the extended schemas. A business-scoped `GET /v1/business/rewards` returns the operator's gets with `lifecycle`. **No** consumer-facing event list/search route is added (R5.1, R5.2).

### `apps/web` business get-management UI

Category selector (default `loyalty`), conditional window inputs + `claimRequiresCheckIn` toggle, lifecycle badge, and a non-blocking boost-prompt banner linking to the existing boost purchase route (never auto-purchases).

## Correctness Properties

These are the invariants the property tests in the Testing Strategy assert. Each maps 1:1 to a `fast-check` suite.

### Property 1: Lifecycle partition

For all `(startsAt < endsAt, nowMs)`, `classifyLifecycle` returns exactly one state; the `upcoming`/`live`/`ended` regions are contiguous, non-overlapping, and half-open (`startsAt` ∈ `live`, `endsAt` ∈ `ended`).
**Validates: Requirements 3.1, 3.5**

### Property 2: Window validation soundness

For all `(startsAt, endsAt, nowMs)`, `validateWindow` returns `ok` iff `startsAt < endsAt` AND `endsAt - startsAt ≤ 30 days` AND `startsAt ≥ nowMs - 5min`, with the correct rejection code otherwise.
**Validates: Requirements 1.3, 1.6, 2.4**

### Property 3: Claim-eligibility truth table

Over the full cross product of `(getCategory, claimRequiresCheckIn, lifecycle, hasQualifyingCheckIn)`, `isClaimEligible` matches the R4/R8.4 table exactly; loyalty is always eligible at this gate.
**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 8.4**

### Property 4: Feed lifecycle filter

For arbitrary mixes of loyalty/event/offer rows and a clock, the `getRewardsNearMe` post-filter returns every loyalty row and exactly the `live` event/offer rows.
**Validates: Requirements 3.2, 3.3, 3.4**

### Property 5: Backwards compatibility

A `Reward` serialized without `getCategory` round-trips as `loyalty` and yields the same feed/claim decisions as a pre-feature row.
**Validates: Requirements 1.1, 7.1, 7.2**

### Property 6: No new reach surface (structural)

The rewards router exposes no consumer-facing list/search route for events beyond the operator-scoped business route and the existing proximity-gated near-me route.
**Validates: Requirements 5.1, 5.2**

## Error Handling

| Condition                                           | Status | Code                |
| --------------------------------------------------- | ------ | ------------------- |
| `event`/`offer` missing/malformed/disordered window | 400    | `invalid_window`    |
| window > 30 days                                    | 400    | `window_too_long`   |
| `startsAt` in the past (> 5 min skew)               | 400    | `starts_in_past`    |
| Tier_Get_Cap reached                                | 403    | (existing message)  |
| node not owned by business                          | 403    | (existing)          |
| claim event/offer without required check-in         | 400    | `check_in_required` |
| claim event/offer not `live`                        | 400    | `not_live`          |

All map to the existing `AppError` machinery and the global handler; non-`AppError` throws still surface as 500.

## Testing Strategy

Property tests use `fast-check` (matching repo convention) and live beside the code they validate.

- **Property 1 — Lifecycle partition.** For arbitrary `(startsAt < endsAt, nowMs)`, `classifyLifecycle` returns exactly one of `upcoming`/`live`/`ended`, the three regions are contiguous and non-overlapping, and the boundaries are half-open (`startsAt` → `live`, `endsAt` → `ended`). (R3.1, R3.5)
- **Property 2 — Window validation.** For arbitrary `(startsAt, endsAt, nowMs)`, `validateWindow` accepts iff `startsAt < endsAt` AND `endsAt - startsAt ≤ 30 days` AND `startsAt ≥ nowMs - 5min`. (R1.3, R1.6, R2.4)
- **Property 3 — Claim eligibility truth table.** For the full cross product of `(getCategory, claimRequiresCheckIn, lifecycle, hasQualifyingCheckIn)`, `isClaimEligible` matches the R4/R8.4 truth table exactly. (R4.1–R4.5, R8.4)
- **Property 4 — Feed lifecycle filter.** For arbitrary mixes of loyalty/event/offer rows and a clock, `getRewardsNearMe`'s post-filter returns every loyalty row and exactly the event/offer rows that are `live`. (R3.2, R3.3, R3.4)
- **Property 5 — Backwards compatibility.** A `Reward` row serialized without `getCategory` round-trips through the read model as `loyalty` and produces the same feed/claim decisions as a pre-feature row. (R1.1, R7.1, R7.2)
- **Test — no new reach surface.** Assert the rewards Fastify router registers no consumer-facing list/search endpoint for events beyond the operator-scoped business route (guards R5.1, R5.2 against regression).

Unit tests cover the create/update validation branches and the DEV_MODE fixture additions.

## Deployment & Rollback

Purely additive, no feature flag (R7.4). New compute stays inside the existing rewards routes on the existing API Lambda (`arm64`); persistence stays in `AppData_Table` (`PAY_PER_REQUEST`). No Terraform change is required beyond what already exists. Rollback is a deploy revert; because every new attribute is optional and defaults to loyalty behaviour, reverting leaves any event/offer rows readable as loyalty gets (their window attributes are simply ignored), so there is no data cleanup on rollback.

## Steering Compliance

- **Serverless-only:** no new always-on resources; existing Lambda + DynamoDB `PAY_PER_REQUEST` only.
- **No SMS / no phone-OTP:** no auth, OTP, SMS, or phone-number code is touched or added; the R2.7 notification reuses the existing in-app/notification path with no new channel.
- **POPIA:** no new consumer-location or PII persistence; check-in lookup reuses existing records.
