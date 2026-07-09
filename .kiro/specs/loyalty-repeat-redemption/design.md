# Design Document: Loyalty Repeat Redemption

## Overview

This feature turns the accidental repeat behaviour of loyalty gets into an explicit, business-controlled `repeatPolicy`, anchored to staff-validated redemptions, and fixes the qualification and abuse-control cracks the repeat mechanic would otherwise amplify. It is an additive change layered onto the existing rewards feature, the Reward_Evaluator worker, the check-in abuse module, and the staff redeem path. No new tables, no new endpoints, no new discovery surface.

The central design move: the Claim_Guard row (`REWARD_CLAIM#{rewardId}#{userId}`) becomes the single record of a consumer's claim lifecycle for a reward. It already gates minting; it now also records redemption history, so one conditional write can decide "may a new code be minted right now" for both policies without extra reads and without races.

### Goals

- `repeatPolicy: 'once' | 'per_visit'` on loyalty `nth_checkin` gets, default `once`.
- Re-mint gated on the previous redemption plus a 4-hour Repeat_Window (or unredeemed expiry).
- Evaluator honours the grandfathered Effective_Threshold; one shared Qualifying_Visit definition.
- Reward_Drain counts mints, not check-ins; never blocks presence; cannot be bypassed by omitting the fingerprint.
- Staff redeem fails closed; codes go to 8 characters.

### Non-Goals

- No change to event/offer get claim semantics (window-gated, never repeat).
- No per-business configurable cadence; the Repeat_Window is fixed at 4 hours (matches `REWARD_COOLDOWN`). Add a knob only when a real second caller exists.
- No change to the guest-claim First-Get token flow.
- No fix for the QR-token sharing window (15 to 30 minutes, not location-bound). The redemption anchor contains its blast radius; a location-bound QR is a separate spec.
- No index/perf rework of `findRedemptionByCode` beyond what R5 requires; a code GSI is a follow-up when volume demands it.

## Architecture

```
apps/business (get create/edit UI)            R6: repeatPolicy control, slot copy
        |  POST/PUT /v1/business/rewards
        v
features/rewards/handler.ts                   R1: extended Zod-validated routes
        |
        v
features/rewards/service.ts                   R1, R5: policy validation; redeem hardening
        |   \-- repeat-policy.ts (NEW, pure)  R2.5: mint decision truth table
        v
features/rewards/repository.ts + dynamodb-repository.ts
        |                                     R2.4: redeem stamps the Claim_Guard
        v
workers/reward-evaluator.ts                   R2, R3, R4, R8: guarded mint, effective
workers/reward-evaluator-repository.ts             threshold, drain-on-mint
        |
        v
app-data table (DynamoDB, PAY_PER_REQUEST)    Claim_Guard rows, additive attributes
```

## Data Models

### Reward row (extended)

| Attribute      | Type                    | Notes                                                                                               |
| -------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `repeatPolicy` | `'once' \| 'per_visit'` | Absent reads as `once` (R1.1). Valid only on `getCategory = loyalty` + `type = nth_checkin` (R1.3). |

### Claim_Guard row (extended)

Key stays `pk = sk = REWARD_CLAIM#{rewardId}#{userId}`.

| Attribute         | Type       | Meaning                                                                                                      |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `redemptionId`    | string     | The current (most recent) minted code's redemption row id.                                                   |
| `codeExpiresAt`   | ISO string | Expiry of the current code. Existing field.                                                                  |
| `redeemedAt`      | ISO string | Set by the redeem path when the CURRENT code is validated. Absent while the current code is live-unredeemed. |
| `lastRedeemedAt`  | ISO string | Carried forward at mint time: the redemption time of the previous cycle, preserved across mints.             |
| `redemptionCount` | number     | Count of mints for this `(consumer, reward)`. Powers R8.1 logs and R4.3 evidence.                            |

Guard state is a tiny state machine per `(consumer, reward)`:

```
(no row) --mint--> LIVE(codeExpiresAt) --staff redeem--> REDEEMED(redeemedAt)
                        |                                     |
                        | code expires unredeemed             | Repeat_Window elapses (per_visit only)
                        v                                     v
                    EXPIRED_UNREDEEMED --mint--> LIVE     eligible --mint--> LIVE
```

## Pure module: `repeat-policy.ts` (NEW)

`backend/src/features/rewards/repeat-policy.ts`, deterministic, no I/O, no `Date.now()` (R2.5):

```ts
export type RepeatPolicy = 'once' | 'per_visit'

export interface GuardState {
  codeExpiresAt: string // ISO
  redeemedAt?: string // ISO; absent while current code unredeemed
}

export const REPEAT_WINDOW_MS = 4 * 60 * 60 * 1000

export function decideMint(
  policy: RepeatPolicy,
  guard: GuardState | null,
  nowMs: number,
): { mint: true } | { mint: false; code: 'live_code_exists' | 'already_redeemed' | 'repeat_window' }
```

Truth table (the accept set the DynamoDB condition must mirror exactly):

| policy      | guard state                        | decision               |
| ----------- | ---------------------------------- | ---------------------- |
| any         | no guard row                       | mint                   |
| any         | current code live, unredeemed      | no: `live_code_exists` |
| `once`      | current code redeemed (any time)   | no: `already_redeemed` |
| `once`      | code expired, never redeemed       | mint                   |
| `per_visit` | redeemed, `redeemedAt <= now - 4h` | mint                   |
| `per_visit` | redeemed, `redeemedAt > now - 4h`  | no: `repeat_window`    |
| `per_visit` | code expired, never redeemed       | mint                   |

Note the trap this table closes: for `per_visit`, "code expired" alone is NOT sufficient once a redemption exists. A consumer who redeems at hour 23 of a 24-hour code must still wait the full Repeat_Window past the redemption, not merely for `codeExpiresAt` (R2.3).

## Claim_Guard conditional writes

### Mint (Reward_Evaluator)

The current blind `PutCommand` becomes an `UpdateCommand` on the guard key so redemption history is carried forward, with a policy-specific `ConditionExpression`:

- `once`:
  `attribute_not_exists(pk) OR (attribute_not_exists(redeemedAt) AND codeExpiresAt < :now)`
  The condition does NOT test `lastRedeemedAt`: the carry-forward below writes an epoch sentinel into it on the first mint, so gating on its absence would permanently block the R2.2 re-mint after an unredeemed expiry. Blocking after a redemption is carried by `redeemedAt`, which only a successful mint clears, and a mint under `once` is only reachable while no redemption has ever occurred.
- `per_visit`:
  `attribute_not_exists(pk) OR (attribute_not_exists(redeemedAt) AND codeExpiresAt < :now) OR (attribute_exists(redeemedAt) AND redeemedAt <= :cutoff)`
  with `:cutoff = ISO(now - REPEAT_WINDOW_MS)`.

Update expression on success:

```
SET codeExpiresAt = :exp, redemptionId = :rid, createdAt = :now,
    lastRedeemedAt = if_not_exists(redeemedAt, if_not_exists(lastRedeemedAt, :epoch)),
    redemptionCount = if_not_exists(redemptionCount, :zero) + :one
REMOVE redeemedAt
```

DynamoDB evaluates expressions against the pre-update item, so `lastRedeemedAt = if_not_exists(redeemedAt, ...)` correctly carries the just-cleared stamp forward. `ConditionalCheckFailedException` keeps its existing meaning in the worker loop: skip this reward silently (debug log per R8.2).

ISO-8601 UTC strings compare correctly lexicographically, so string comparison in the condition is sound (existing convention).

### Redeem stamp (staff validation, R2.4)

`markRedeemed` gains a second write after the redemption row flips: update the guard row with
`SET redeemedAt = :t` conditioned on `redemptionId = :rid AND attribute_not_exists(redeemedAt)`, so a stamp can never attach to a newer cycle's code. Ordering: redemption row first (it is the authoritative double-redeem gate), guard stamp second. A failed stamp is logged loudly; the consumer stays blocked until code expiry, which fails toward the business (R2.4).

### Rollback (slot-full, R2.6)

`deleteRedemption` currently deletes the guard row, which would erase redemption history. It becomes: delete the redemption row, then update the guard with `SET codeExpiresAt = :now` conditioned on `redemptionId = :rid` (expire in place, history intact, `redemptionCount` decremented by 1).

### Legacy guard rows (R2.7)

Rows written before deploy have `codeExpiresAt` only. Both conditions treat them as "expired unredeemed" once `codeExpiresAt` passes, which matches today's behaviour for at most one more cycle; the next redemption stamps them. Bounded by the 24-hour TTL, no backfill.

## Reward_Evaluator changes (R3, R4, R8)

1. **Effective_Threshold at mint time (R3.1).** `checkQualification` for `nth_checkin` calls the shared threshold helper (`getEffectiveThreshold`, already exported by `threshold-lock.ts`) instead of raw `reward.triggerValue`. One extra guard-table read per nth_checkin reward per evaluation; acceptable at current volume.
2. **One Qualifying_Visit counter (R3.2, R3.5).** A single repository function `countQualifyingVisits(userId, nodeId)` (reward-type check-ins at the node, bounded query) replaces both the evaluator's `countUserCheckInsAtNode` and the all-types count inside `getRewardEligibility`.
3. **Lock advancement gate (R3.3).** `processCheckInRewardLocks` is invoked (or internally gated) only for `type = 'reward'` check-ins.
4. **Policy resolution.** The worker resolves `repeatPolicy` (absent = `once`) and passes the matching condition to the guard mint. `decideMint` is the tested source of truth; the condition expression is its transcription.
5. **Drain-on-mint (R4.1, R4.3).** After a successful mint, the worker increments `abuse:drain:{userId}:{nodeId}` (24h TTL). Above 3, it writes the high-priority abuse flag with mint timestamps as evidence. No blocking.
6. **Repeat mint log (R8.1).** On a mint where `redemptionCount > 1` and policy is `per_visit`, emit the structured info log.

## Check-in abuse module changes (R4)

In `abuse.ts`: remove the check-in-side `reward_drain` counter and its hard block entirely (its replacement lives at the mint site, where an actual claim exists). `device_velocity` and `new_account_velocity` stay as they are. Net effect: presence check-ins can never trip a reward-abuse block (R4.2), and dropping `fingerprintHash` no longer bypasses drain detection because the mint-site counter keys on `userId` (R4.4).

## Staff redeem hardening (R5)

In `redeemReward` (`features/rewards/service.ts`):

1. Resolve the reward and its node before any redemption write. IF unresolvable, reject 400 `invalid_code` (R5.1). The staff-ownership check then always runs when a `staffId` is present.
2. IF `reward.isActive === false`, reject 400 `reward_inactive` (R5.2).
3. `generateRedemptionCode` goes to 8 characters (same 32-character alphabet, ~1.1e12 space); `redeemBodySchema` becomes `z.string().length(8)`; the staff validator input in `apps/staff` accepts 8 characters (R5.4, R5.5).
4. Wallet read filters out items whose reward is deleted or inactive (R5.3). The wallet already enriches items; the filter reuses that lookup.

## Business portal (R6)

Get create/edit form, loyalty `nth_checkin` only: a two-option Repeat_Policy control, default "One per customer", alternative "Repeats each visit", with the exact-behaviour copy from R6.1 and the slot-semantics line from R6.2 when `totalSlots` is set. Hidden entirely for event/offer categories. Styling per code-style rules (CSS variables, `rounded-xl` inputs, 44px touch targets).

## Correctness Properties

### Property 1: Mint decision truth table

Over the full cross product of `(repeatPolicy, guard state, nowMs)`, `decideMint` matches the table above exactly; in particular, no state with a live unredeemed code ever mints, `once` never mints after any redemption, and `per_visit` never mints within the Repeat_Window of a redemption even when `codeExpiresAt` has passed.
**Validates: Requirements 2.1, 2.2, 2.3, 2.5**

### Property 2: Redemption spacing

For any sequence of mint/redeem/expiry events admitted by `decideMint` plus the redeem stamp, any two redemptions of the same `(consumer, reward)` under `per_visit` are at least 4 hours apart, and under `once` at most one redemption ever occurs.
**Validates: Requirements 2.2, 2.3, 2.4**

### Property 3: Qualification agreement

Given an arbitrary store state (check-ins of mixed types, an optional Threshold_Lock, a `triggerValue`), the evaluator's qualification decision and the progress endpoint's `eligible` flag are identical, and both honour `min(lockedThreshold, triggerValue)`.
**Validates: Requirements 3.1, 3.2, 3.4**

### Property 4: Drain counting

The drain counter equals the number of successful mints; presence check-ins and rejected mint attempts never change it.
**Validates: Requirements 4.1, 4.2**

### Property 5: Backwards compatibility

A `Reward` row without `repeatPolicy` behaves as `once`, and a Claim_Guard row without redemption stamps behaves per R2.7.
**Validates: Requirements 1.1, 2.7, 7.1**

### Property 6: Code format

Every generated Redemption_Code is exactly 8 characters drawn from the 32-character alphabet, and `redeemBodySchema` accepts exactly that shape.
**Validates: Requirements 5.4**

## Error Handling

| Condition                                             | Status | Code                   |
| ----------------------------------------------------- | ------ | ---------------------- |
| `repeatPolicy = per_visit` on non-loyalty/non-nth get | 400    | `repeat_not_supported` |
| redeem: reward or node unresolvable                   | 400    | `invalid_code`         |
| redeem: reward inactive or deleted                    | 400    | `reward_inactive`      |
| redeem: code already redeemed (incl. concurrent)      | 400    | `already_redeemed`     |
| redeem: code expired                                  | 400    | `expired_code`         |
| redeem: staff from another business / removed         | 403    | (existing)             |
| mint skipped (guard condition)                        | n/a    | debug log only (R8.2)  |

All through the existing `AppError` machinery.

## Testing Strategy

Property tests use `fast-check`, min 100 runs, block-statement predicates, tagged `Feature: loyalty-repeat-redemption, Property N: <desc>`, per repo convention.

- **Property 1** `repeat-policy.property.test.ts`: full truth-table cross product against `decideMint`.
- **Property 2** same file or sibling: event-sequence model (mint, redeem, expire, clock advance) asserting redemption spacing and the once-cap.
- **Property 3** `qualification-agreement.property.test.ts`: mocked store, evaluator decision vs progress read.
- **Property 4** unit tests on the mint-site drain increment (presence never counts; rejected mints never count).
- **Property 5** extend `legacy-reward-compat.property.test.ts` and `idempotency.test.ts` for the missing-attribute defaults and the new guard conditions.
- **Property 6** unit test on `generateRedemptionCode` and the schema.
- Unit tests: redeem hardening branches (unresolvable, inactive, stamp ordering), rollback expire-in-place, Zod refinement for R1.3.

## Deployment & Rollback

Additive attributes only; no Terraform change; no feature flag (R7.4). Ships via the standard deploy (`deploy-serverless.ps1`). Two deliberate behaviour changes to call out in the deploy notes:

1. Existing loyalty gets stop repeating on the 24-hour guard expiry (they become `once`, R1.2). Businesses that want repeats opt in per get.
2. Redemption codes become 8 characters; live 6-character codes at deploy are rejected by the new schema and expire within 24 hours, and remain re-earnable afterwards.

Rollback is a deploy revert: `repeatPolicy`, `lastRedeemedAt`, and `redemptionCount` attributes are ignored by reverted code; guard rows remain readable (the old blind Put overwrites them on the next mint).

## Steering Compliance

- **Serverless-only:** existing Lambda + SQS worker + DynamoDB `PAY_PER_REQUEST`; nothing always-on.
- **No SMS / no phone-OTP:** untouched.
- **No fallbacks / no legacy:** one mint decision function, one visit definition, no dual code-length window, the obsolete check-in-side drain counter is deleted rather than kept beside its replacement.
- **Gets product rules:** no new discovery or reach surface; the wallet stays a utility in Profile.
- **Honest presence / honest copy:** the portal states exactly what a `per_visit` get costs; the wallet never shows a code the validator will refuse.
