# Requirements Document

## Introduction

This feature hardens operational and compliance-critical paths where correctness currently
degrades silently at scale or on failure: admin dashboard counts that undercount past one
DynamoDB Scan page, POPIA data-erasure that leaves check-in history behind and does not
paginate, a reward-evaluator that swallows all mint errors (losing earned rewards), and two
config fallbacks that mask misconfiguration in production.

The unifying rule (`no-fallbacks-no-legacy.md`): required configuration fails fast, failures
surface loudly instead of substituting silent defaults, and aggregations reflect complete
data, not a single scanned page. `honest-presence.md` and POPIA obligations require that a
"completed" erasure actually removes all personal data.

Covers audit findings H5, H7, M5, L1, L2 from `docs/DATA_INTEGRITY_AUDIT.md`.

## Glossary

- **Dashboard_Metrics**: The admin overview counts from `admin/repository.ts` `getDashboardMetrics` (consumers, businesses, check-ins all-time/today, active rewards, pending reports, pending erasures, unreviewed abuse flags).
- **Paginated_Count**: A DynamoDB count that loops over `LastEvaluatedKey` until exhausted, summing per-page `Count`, so it reflects the whole table/filter.
- **Erasure_Processor**: The `workers/cleanup.ts` logic that processes `ERASURE#` requests older than 30 days.
- **Checkins_Table**: The dedicated DynamoDB `checkins` table (separate from `app-data`).
- **Reward_Evaluator**: `workers/reward-evaluator.ts`, which mints redemptions for qualifying check-ins.
- **Conditional_Check_Failure**: A DynamoDB `ConditionalCheckFailedException`, the legitimate "already claimed" signal.
- **Required_Config**: Environment variables that must be present in production (e.g. `BUSINESS_APP_URL`, `YOCO_WEBHOOK_SECRET`).

## Requirements

### Requirement 1: Accurate admin dashboard counts (H5)

**User Story:** As an admin, I want dashboard totals to be accurate at scale, so that I do not under-read growth, compliance backlog, or safety backlog.

#### Acceptance Criteria

1. WHEN `getDashboardMetrics` computes any count, THE system SHALL use a Paginated_Count (loop over `LastEvaluatedKey`) or a maintained incremental counter, never a single-page `Scan` `Count`.
2. THE `pendingErasures` and `unreviewedAbuseFlags` counts SHALL reflect the complete matching set regardless of table size.
3. IF a maintained counter approach is used, THEN it SHALL be updated on the relevant write paths so it cannot drift from the source of truth.
4. THE metrics cache MAY remain, but SHALL cache a complete (paginated) result, not a partial one.

### Requirement 2: Complete POPIA erasure (H7)

**User Story:** As a user who requested deletion, I want all my personal data removed, so that "completed" means my data is actually gone.

#### Acceptance Criteria

1. WHEN the Erasure_Processor processes a request, THE system SHALL delete the user's rows from the Checkins_Table in addition to the `users` table and `app-data`.
2. THE Erasure_Processor SHALL delete the user's `websocket-connections` rows (and any other table keyed by `userId`) so no personal data survives across tables.
   2a. THE Erasure_Processor SHALL delete the user's Cognito account (whose email is personal data under POPIA) via the existing `deleteUserByUsername('consumer', <email/username>)` helper (`shared/cognito/client.ts`), which is idempotent on "user not found". The erasure request or user row SHALL carry the Cognito username/email needed for this call; IF it is unavailable, THE processor SHALL resolve it from the user row before deleting the user row.
3. THE Erasure_Processor SHALL paginate both the pending-request scan and the per-user data lookup over `LastEvaluatedKey`, so no pending request or user row is missed due to page limits.
4. WHERE feasible, THE per-user lookup SHALL be anchored on real keys (e.g. `USER#{id}` prefix or a GSI) rather than an unanchored `contains()` full-table scan.
5. THE system SHALL mark an erasure request `completed` ONLY after all targeted tables are confirmed cleared for that user.
6. IF any table's deletion fails, THEN THE request SHALL remain not-completed and the failure SHALL be logged for retry on the next run.

### Requirement 3: Reward evaluator does not lose earned rewards (M5)

**User Story:** As a consumer, I want a reward I qualified for to be minted reliably, so that a transient backend error does not silently drop it.

#### Acceptance Criteria

1. WHEN `createRedemption` throws a Conditional_Check_Failure, THE Reward_Evaluator SHALL treat it as "already claimed" and continue.
2. WHEN `createRedemption` throws any non-conditional error, THE Reward_Evaluator SHALL NOT silently `continue`; it SHALL log the error and allow the SQS message to fail so it is retried.
3. THE Reward_Evaluator SHALL reuse the existing conditional-check detection helper pattern rather than a bare `catch { continue }`.

### Requirement 4: Fail-fast required configuration (L1, L2)

**User Story:** As an operator, I want misconfiguration to fail loudly, so that customers are never silently sent to the wrong URL or payments verified against the wrong secret.

#### Acceptance Criteria

1. THE system SHALL require `BUSINESS_APP_URL` in production and SHALL NOT fall back to a hardcoded Amplify domain for checkout redirect URLs.
2. THE system SHALL require `YOCO_WEBHOOK_SECRET` in production for webhook signature verification and SHALL NOT fall back to the dev secret or an empty string.
3. IF a Required_Config value is missing in production, THEN the affected path SHALL fail fast (startup crash or explicit error) rather than proceed with a masking default.
4. Webhook signature verification SHALL reject when the configured secret is absent, rather than computing an HMAC over an empty-string secret.

### Requirement 5: Verification

**User Story:** As an engineer, I want the hardening changes verified by the standard suite and new tests, so that the fixes are proven and cannot silently regress.

#### Acceptance Criteria

1. THE change SHALL pass `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm guard:serverless`.
2. New behavior SHALL be covered by tests: paginated counts, erasure across tables, reward-evaluator error branch, and fail-fast config.
