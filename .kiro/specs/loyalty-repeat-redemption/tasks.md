# Implementation Plan: Loyalty Repeat Redemption

## Overview

Incremental, test-backed steps over the existing rewards feature, the Reward_Evaluator worker, the check-in abuse module, and the staff/business portals. Bottom-up: the pure mint-decision module first (with its property tests), then qualification correctness, then the Claim_Guard rework, then redeem hardening, then abuse realignment, then schemas/routes, then the portal UI.

TypeScript throughout (Zod, AWS SDK v3, fast-check, Vitest). Everything stays on the existing API Lambda, the existing SQS worker, and the existing DynamoDB tables (`PAY_PER_REQUEST`). No new always-on resources. No SMS / phone-OTP. No new discovery surface.

## Tasks

- [x] 1. Build the pure repeat-policy module
  - [x] 1.1 Create `backend/src/features/rewards/repeat-policy.ts`
    - Export `RepeatPolicy`, `GuardState`, `REPEAT_WINDOW_MS` (4h), and `decideMint(policy, guard, nowMs)` implementing the design truth table
    - Observably pure: no `Date.now()`, no I/O, no globals
    - Cover the trap case explicitly: `per_visit` with an expired code AND a redemption inside the window must NOT mint
    - _Requirements: 2.2, 2.3, 2.5_

  - [x] 1.2 Write property tests for the pure module
    - **Property 1: Mint decision truth table** in `backend/src/features/rewards/__tests__/repeat-policy.property.test.ts`: full cross product of `(policy, guard state, nowMs)`; assert no mint with a live unredeemed code, `once` never mints after any redemption, `per_visit` respects the Repeat_Window even past `codeExpiresAt`. (R2.1, R2.2, R2.3, R2.5)
    - **Property 2: Redemption spacing** in the same file: generate admissible event sequences (mint, redeem, expire, clock advance) and assert `per_visit` redemptions are >= 4h apart and `once` allows at most one redemption. (R2.2, R2.3, R2.4)

- [x] 2. Fix qualification correctness
  - [x] 2.1 Create the shared Qualifying_Visit counter
    - One repository function `countQualifyingVisits(userId, nodeId)` counting `type = 'reward'` check-ins at the node with a bounded query (node- or time-scoped, not a full-history fetch)
    - Replace `countUserCheckInsAtNode` in `backend/src/workers/reward-evaluator-repository.ts` and the all-types count in `getRewardEligibility` (`backend/src/features/rewards/dynamodb-repository.ts`) with it
    - _Requirements: 3.2, 3.5_

  - [x] 2.2 Enforce the Effective_Threshold at mint time
    - In `backend/src/workers/reward-evaluator.ts` `checkQualification` (`nth_checkin` branch), qualify against `getEffectiveThreshold(userId, rewardId)` from `threshold-lock.ts` instead of raw `reward.triggerValue`
    - _Requirements: 3.1, 3.4_

  - [x] 2.3 Gate Threshold_Lock advancement on Qualifying_Visits
    - `processCheckInRewardLocks` advances only for `type = 'reward'` check-ins (gate at the call site in `check-in/service.ts` or inside the function with the check-in type threaded through)
    - _Requirements: 3.3_

  - [x] 2.4 Write the qualification-agreement property test
    - **Property 3: Qualification agreement** in `backend/src/features/rewards/__tests__/qualification-agreement.property.test.ts`: arbitrary store state (mixed check-in types, optional lock, threshold), assert evaluator decision == progress-endpoint eligibility, both honouring `min(lockedThreshold, triggerValue)`. (R3.1, R3.2, R3.4)

- [x] 3. Rework the Claim_Guard for policy-aware minting
  - [x] 3.1 Extend the guard write in `backend/src/workers/reward-evaluator-repository.ts`
    - Replace the blind guard `PutCommand` with the design's `UpdateCommand`: policy-specific `ConditionExpression` (`once` vs `per_visit` per design), carry `lastRedeemedAt` forward, `REMOVE redeemedAt`, increment `redemptionCount`
    - The worker resolves `repeatPolicy` (absent = `once`) and passes it through; `ConditionalCheckFailedException` keeps its skip semantics
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.5, 2.7_

  - [x] 3.2 Stamp the guard on staff redemption
    - `markRedeemed` path (`features/rewards/repository.ts` / `dynamodb-repository.ts`): after the redemption row flips, update the guard with `SET redeemedAt = :t` conditioned on `redemptionId = :rid AND attribute_not_exists(redeemedAt)`; log loudly on stamp failure and do not roll back the redemption (fails toward the business)
    - Requires the guard to store `redemptionId` (written by 3.1) and the redeem path to know `rewardId` + `userId` (both on the redemption row)
    - _Requirements: 2.4_

  - [x] 3.3 Convert the slot-full rollback to expire-in-place
    - `deleteRedemption`: delete the redemption row, then update the guard (`SET codeExpiresAt = :now`, decrement `redemptionCount`) conditioned on `redemptionId = :rid`, instead of deleting the guard
    - _Requirements: 2.6_

  - [x] 3.4 Extend the idempotency and legacy-compat tests
    - Update `backend/src/features/rewards/__tests__/idempotency.test.ts` for the new conditions: one live code invariant, `once` blocks after redemption, `per_visit` re-mints after window, legacy guard rows (no stamps) behave per R2.7
    - **Property 5: Backwards compatibility** additions in `legacy-reward-compat.property.test.ts`: missing `repeatPolicy` reads as `once`. (R1.1, R2.7, R7.1)

- [x] 4. Harden staff redemption
  - [x] 4.1 Fail closed in `redeemReward` (`features/rewards/service.ts`)
    - Resolve reward + node before any write; unresolvable -> 400 `invalid_code`; `isActive === false` or deleted -> 400 `reward_inactive`; staff-ownership check always runs when `staffId` present
    - _Requirements: 5.1, 5.2_

  - [x] 4.2 Move Redemption_Codes to 8 characters
    - `generateRedemptionCode` in `reward-evaluator.ts` to 8 chars (same alphabet); `redeemBodySchema` to `z.string().length(8)`; update the staff validator input in `apps/staff` for 8-char entry
    - No dual-length acceptance; deploy note covers the 24h transition (design, Deployment section)
    - _Requirements: 5.4, 5.5_

  - [x] 4.3 Filter dead rewards out of the wallet
    - `getUnclaimedRewards` (`features/rewards/repository.ts`): exclude items whose reward is deleted or `isActive === false`, reusing the existing enrichment lookup
    - _Requirements: 5.3_

  - [x] 4.4 Unit tests for redeem hardening
    - Branches: unresolvable reward/node, inactive reward, stamp ordering (redemption row first), 8-char schema acceptance/rejection, wallet filter
    - **Property 6: Code format** unit test on `generateRedemptionCode`. (R5.1, R5.2, R5.3, R5.4)

- [x] 5. Realign abuse controls
  - [x] 5.1 Delete the check-in-side `reward_drain` counter
    - Remove the drain counter and its hard block from `backend/src/features/check-in/abuse.ts`; `device_velocity` and `new_account_velocity` unchanged
    - _Requirements: 4.2, 4.5_

  - [x] 5.2 Add drain-on-mint in the Reward_Evaluator
    - After a successful mint: increment `abuse:drain:{userId}:{nodeId}` (24h TTL); above 3, write the high-priority abuse flag (existing `ABUSE_QUEUE` shape) with mint timestamps as evidence; never block
    - Include `fingerprintHash` in evidence when the triggering check-in carried one (thread through the SQS message if needed)
    - _Requirements: 4.1, 4.3, 4.4, 8.3_

  - [x] 5.3 Tests for drain counting
    - **Property 4: Drain counting** (unit-level): presence check-ins never change the counter; rejected mints never change it; the flag payload carries timestamps. (R4.1, R4.2, R4.3)

- [x] 6. Extend types, schemas, and routes
  - [x] 6.1 Extend `backend/src/features/rewards/types.ts`
    - `Reward` gains `repeatPolicy?: 'once' | 'per_visit'`; `createRewardBodySchema` / `updateRewardBodySchema` gain the optional field with a refinement rejecting `per_visit` unless `getCategory` resolves to `loyalty` AND `type = nth_checkin` (400 `repeat_not_supported`)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6_

  - [x] 6.2 Thread `repeatPolicy` through service and repositories
    - `createReward` / `updateReward` in `service.ts` and both repositories persist the field; read mappers surface absent as `once`; responses stay supersets of today's shapes
    - Extend `DEV_MODE` fixtures with one `per_visit` loyalty get
    - Structured info log on repeat mints (`redemptionCount > 1`, `per_visit`) in the worker
    - _Requirements: 1.1, 1.2, 7.1, 7.2, 7.3, 8.1, 8.2_

- [x] 7. Business portal UI
  - [x] 7.1 Repeat_Policy control on the get create/edit form (`apps/business`)
    - Two-option control, loyalty `nth_checkin` only, default "One per customer"; alternative copy: "Regulars can earn this again each visit, at least 4 hours after their last redemption"; hidden for event/offer
    - When `totalSlots` is set on `per_visit`, show the slots-count-total-redemptions line
    - Threshold-edit grandfather confirm flow untouched; styling per code-style rules
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 8. Final checkpoint
  - Run `pnpm typecheck`, `pnpm test`, `pnpm lint`; build backend Lambda bundles and the affected app bundles. Confirm both deliberate behaviour changes (once-by-default, 8-char codes) are in the deploy notes. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional; none here are, all are core.
- Each task references specific requirements clauses for traceability.
- Property tests follow repo convention: fast-check, min 100 runs, block-statement predicates, tagged `Feature: loyalty-repeat-redemption, Property N: <desc>`.
- Two deliberate behaviour changes ship with this plan and must be in the deploy notes: existing loyalty gets stop repeating implicitly (default `once`, R1.2), and redemption codes become 8 characters (R5.4, 24h transition bounded by the code TTL).
- The obsolete check-in-side drain counter is deleted, not kept beside its mint-site replacement (`no-fallbacks-no-legacy.md`).
- No new endpoint, feed, or discovery surface is added; the wallet stays a utility in Profile (`product.md` gets rules).
- All compute stays on the existing API Lambda and SQS worker (`arm64`); all persistence stays in existing tables (`PAY_PER_REQUEST`), per `serverless-only.md`.
- No SMS, no phone-OTP, no phone identifiers, per `no-sms-no-phone-auth.md`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "6.2"] },
    { "id": 3, "tasks": ["2.4", "3.2", "3.3", "5.1"] },
    { "id": 4, "tasks": ["3.4", "4.1", "4.2", "4.3", "5.2"] },
    { "id": 5, "tasks": ["4.4", "5.3", "7.1"] },
    { "id": 6, "tasks": ["8"] }
  ]
}
```
