# Design Document

## Overview

This spec hardens four operational/compliance paths that degrade silently: admin dashboard
counts that stop at one Scan page (H5), POPIA erasure that leaves check-in history and the
Cognito account behind and does not paginate (H7), a reward evaluator that swallows all mint
errors (M5), and two production config fallbacks that mask misconfiguration (L1, L2).

Binding rule throughout: `no-fallbacks-no-legacy.md` — required config fails fast, failures
surface loudly, and aggregations reflect complete data. POPIA requires a "completed" erasure
to actually remove all personal data across every store, including Cognito.

## Architecture

```
Admin dashboard  ── GET /v1/admin/dashboard ── getDashboardMetrics()  [H5: paginate counts]

cleanup worker (schedule)
  └─ erasure processor  [H7: + checkins table, + Cognito, + websocket-connections,
                              paginate both scans, anchored lookup, complete-only-when-clear]

check-in SQS ── reward-evaluator  [M5: narrow catch to ConditionalCheckFailed]

business service
  ├─ getBusinessAppUrl()      [L1: require BUSINESS_APP_URL]
  └─ processYocoWebhook()     [L2: require YOCO_WEBHOOK_SECRET]
```

## Components and Interfaces

### 1. Paginated admin counts (H5)

- In `admin/repository.ts` `getDashboardMetrics`, replace each single `ScanCommand({Select:'COUNT'})`
  with a helper that loops over `LastEvaluatedKey`, summing `Count` per page until exhausted.
- Helper: `async function countAll(params): Promise<number>` — same params, adds the
  pagination loop. Apply to all counts (consumers, businesses, all-time/today check-ins,
  active rewards, pending reports, pending erasures, unreviewed abuse flags).
- Keep the 60s cache, but cache the complete (paginated) result.
- Note the cost/latency: these are cold, cached, admin-only reads; full-table count scans are
  acceptable at current scale. A follow-up option (maintained counters on write paths) is
  noted in Requirement 1.3 but not required now.

### 2. Complete POPIA erasure (H7)

In `workers/cleanup.ts` erasure loop, per pending request (order matters):

1. Resolve the Cognito username/email from the user row **before** deleting it (or read it
   from the erasure request if stored there).
2. Delete the user's **checkins** rows: query the user's check-ins (by `userId` via a GSI if
   one exists, else a paginated scan-and-delete filtered on `userId`) and `DeleteItem` each,
   paginating over `LastEvaluatedKey`.
3. Delete **websocket-connections** rows keyed by `userId` (paginated).
4. Delete **app-data** rows for the user — prefer an anchored lookup (`begins_with(pk, 'USER#'+id)`
   / a GSI) over the current unanchored `contains()` full-table scan; paginate.
5. Delete the **users** row (`deleteUser`).
6. Delete the **Cognito** account: `deleteUserByUsername('consumer', username)` — idempotent
   on "user not found" (`shared/cognito/client.ts:215`).
7. Mark the request `completed` **only after** all of the above succeed. If any step throws,
   log and leave the request not-completed so the next run retries.

### 3. Reward-evaluator error handling (M5)

- In `workers/reward-evaluator.ts`, replace `catch { continue }` around `createRedemption`
  with: detect `ConditionalCheckFailedException` (reuse the `isConditionalCheckFailedError`
  pattern from `business/repository.ts`) → treat as "already claimed", `continue`. Any other
  error → log and rethrow (or let it propagate) so the SQS message fails and is retried, so a
  transient fault does not silently drop an earned reward.

### 4. Fail-fast config (L1, L2)

- `getBusinessAppUrl`: require `BUSINESS_APP_URL`; remove the hardcoded Amplify fallback.
  Use the existing `requireEnv` pattern (as `reports/generator.ts` does for the salt) so a
  missing value crashes at startup/first use rather than sending customers to a raw domain.
- `processYocoWebhook`: require `YOCO_WEBHOOK_SECRET`; do not fall back to the dev secret or
  `''`. If the secret is absent, reject verification (fail closed) rather than computing an
  HMAC over an empty string.

## Data Models

- No new tables. Erasure touches: `users`, `checkins`, `websocket-connections`, `app-data`,
  and the Cognito consumer pool. Admin counts read existing tables.
- If a `userId` GSI does not already exist on `checkins`, the interim approach is a paginated
  scan-and-delete filtered on `userId`; a GSI may be added later if erasure volume warrants
  it (flag in tasks, not required for correctness).

## Error Handling

- Erasure: fail-forward per step; the request stays pending on any failure so the next
  cleanup run retries. Never mark `completed` on partial success (Requirement 2.5, 2.6).
- Admin counts: a Scan failure surfaces as an error rather than a cached partial.
- Config: missing required config fails fast (crash or explicit error), never a masking default.
- Webhook: absent secret → reject (fail closed).

## Correctness Properties

### Property 1: Count completeness

`countAll` returns the total number of matching items across any number of pages; for a
dataset split into K pages, the result equals the sum of per-page counts (never just page 1).
**Validates: Requirements 1.1, 1.2**

### Property 2: Erasure completeness

After a `completed` erasure, no row keyed by that `userId` survives in `users`, `checkins`,
`websocket-connections`, or `app-data`, and the Cognito account is absent — for any number of
rows across pages.
**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Complete-only-when-clear

A request is marked `completed` iff every deletion step succeeded; if any step throws, the
request remains not-`completed`.
**Validates: Requirements 2.5, 2.6**

### Property 4: Reward-evaluator branch fidelity

A `ConditionalCheckFailedException` is treated as "already claimed" (continue); any other
error propagates (message retried) — a transient fault never results in a silently dropped,
un-minted reward.
**Validates: Requirements 3.1, 3.2**

### Property 5: Fail-closed config

With a required config value absent, the affected path fails (crash/error/rejection) and
never proceeds with a masking default or an HMAC over `''`.
**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

## Testing Strategy

- **Unit (Vitest, node):**
  - `countAll` sums across multiple pages (stub `documentClient` returning `LastEvaluatedKey`).
  - Erasure deletes from all target tables and calls `deleteUserByUsername`; marks completed
    only when all succeed; leaves pending when a step throws; paginates both scans.
  - Reward evaluator: conditional-check failure → continue (already claimed); other error →
    propagates (message retried); reuse of the shared detector.
  - Config: missing `BUSINESS_APP_URL` / `YOCO_WEBHOOK_SECRET` fails fast; webhook rejects on
    absent secret.
- **Existing suites:** `pnpm test` must stay green; Yoco webhook signature tests updated for
  the fail-closed behavior.
- Stub AWS clients; no live AWS calls (`serverless-only`, testing steering rules).
