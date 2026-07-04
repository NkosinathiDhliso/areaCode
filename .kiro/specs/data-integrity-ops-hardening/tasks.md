# Implementation Plan: Data Integrity Ops Hardening

## Overview

Harden four paths that fail silently: paginate admin dashboard counts (H5); make POPIA
erasure complete across checkins, websocket-connections, app-data, the users row, and the
Cognito account, with pagination and complete-only-when-clear (H7); narrow the
reward-evaluator catch so transient faults retry instead of dropping earned rewards (M5); and
make `BUSINESS_APP_URL` / `YOCO_WEBHOOK_SECRET` fail fast (L1, L2). Each item is independent,
so they can proceed in parallel after a shared pagination helper lands.

## Tasks

- [x] 1. Accurate admin dashboard counts (H5)
  - [x] 1.1 Add a paginated `countAll(params)` helper and use it for every count in `getDashboardMetrics`
    - Loop over `LastEvaluatedKey`, sum per-page `Count`; cache the complete result (keep 60s TTL).
    - _Requirements: 1.1, 1.2, 1.4_
  - [x]\* 1.2 Unit test multi-page counting
    - Stub `documentClient` to return `LastEvaluatedKey` across pages; assert summed total.
    - _Requirements: 1.1, 1.2_

- [x] 2. Complete POPIA erasure (H7)
  - [x] 2.1 Resolve Cognito username before deleting the user row
    - Read email/username from the user row (or erasure request) first.
    - _Requirements: 2.2a_
  - [x] 2.2 Delete the user's `checkins` rows (paginated)
    - Query by `userId` (GSI if present) or paginated scan-and-delete filtered on `userId`.
    - _Requirements: 2.1, 2.3_
  - [x] 2.3 Delete `websocket-connections` rows for the user (paginated)
    - _Requirements: 2.2, 2.3_
  - [x] 2.4 Anchor + paginate the app-data lookup
    - Prefer `begins_with(pk, 'USER#'+id)` / GSI over unanchored `contains()`; paginate.
    - _Requirements: 2.3, 2.4_
  - [x] 2.5 Delete the Cognito account
    - `deleteUserByUsername('consumer', username)` (idempotent on not-found).
    - _Requirements: 2.2a_
  - [x] 2.6 Mark completed only after all tables + Cognito are cleared
    - On any failure, log and leave pending for the next run.
    - _Requirements: 2.5, 2.6_
  - [x]\* 2.7 Unit test erasure completeness and pagination
    - All target stores deleted; Cognito called; completed only on full success; pending on failure; scans paginate.
    - _Requirements: 2.1, 2.2, 2.2a, 2.3, 2.5, 2.6_

- [x] 3. Reward-evaluator does not lose earned rewards (M5)
  - [x] 3.1 Narrow the `createRedemption` catch to conditional-check failures
    - Reuse `isConditionalCheckFailedError`; conditional → continue (already claimed); other error → log + propagate so SQS retries.
    - _Requirements: 3.1, 3.2, 3.3_
  - [x]\* 3.2 Unit test both branches
    - Conditional → continue; non-conditional → propagates.
    - _Requirements: 3.1, 3.2_

- [x] 4. Fail-fast required config (L1, L2)
  - [x] 4.1 Require `BUSINESS_APP_URL` in `getBusinessAppUrl` (remove Amplify fallback)
    - Use the `requireEnv` pattern.
    - _Requirements: 4.1, 4.3_
  - [x] 4.2 Require `YOCO_WEBHOOK_SECRET`; reject verification when absent (fail closed)
    - No dev-secret / empty-string fallback; do not HMAC over an empty secret.
    - _Requirements: 4.2, 4.3, 4.4_
  - [x]\* 4.3 Update webhook signature tests for fail-closed behavior
    - _Requirements: 4.2, 4.4_

- [x] 5. Final checkpoint — verify
  - `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm guard:serverless`.
  - _Requirements: 5.1, 5.2_

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "2.1", "3.1", "4.1", "4.2"],
      "description": "Pagination helper + counts; erasure prerequisites; independent M5/config fixes"
    },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "2.5"], "description": "Erasure deletions across all stores + Cognito" },
    { "id": 2, "tasks": ["2.6"], "description": "Mark completed only after full clearance" },
    { "id": 3, "tasks": ["1.2", "2.7", "3.2", "4.3"], "description": "Tests" },
    { "id": 4, "tasks": ["5"], "description": "Full verification sweep" }
  ]
}
```

## Notes

- `*` tasks are optional tests; the erasure completeness test (2.7) and webhook fail-closed test (4.3) are strongly recommended because they cover compliance/payment paths.
- H5's paginated count is acceptable at current scale as a cold, cached admin read; maintained write-time counters are a documented later option, not required now.
- No new tables; a `userId` GSI on `checkins` is an optional later optimization for erasure, not required for correctness.
- Erasure ordering matters: resolve the Cognito username before deleting the user row, and mark completed only after every store is clear (`no-fallbacks-no-legacy.md`, POPIA).
