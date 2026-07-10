# Implementation Plan: Audit Gap Closure

## Overview

Six independent streams closing the July 2026 audit gaps: fail-fast security config, the
City_Nodes_Read and Room_Fanout scaling fixes, consented usage instrumentation, enforced code
limits, CI supply-chain and load checks, and decision records plus founder-run verifications.

Prerequisite (in flight in separate sessions, do not re-implement here): the DynamoDB
`Limit` + `FilterExpression` false-miss fixes, the admin consent partition-key fix, and the
staff digest opt-out phantom-row fix. Rebase on those before starting streams that touch the
same files (R5 hygiene touches `rewards/dynamodb-repository.ts`).

## Tasks

- [x] 1. Fail-fast security config (R1)
  - [x] 1.1 `qrHmacSecret()` accessor via `requireEnv`; adopt in check-in, business, and music services
    - Remove every `?? ''`; DEV_MODE keeps a dev default.
    - _Requirements: 1.1, 1.2, 1.7_
  - [x] 1.2 Drop the hardcoded unsubscribe fallback secret; fail fast outside DEV_MODE
    - _Requirements: 1.3, 1.7_
  - [x] 1.3 Switch QR signature comparison to `timingSafeEqual`
    - _Requirements: 1.4_
  - [x] 1.4 `currentConsentVersion()` requires `AREA_CODE_CONSENT_VERSION` outside DEV_MODE
    - Remove the `LEGAL_CLAUSES_VERSION` fallback; add the key to startup config validation.
    - _Requirements: 1.5_
  - [x] 1.5 Decision_Record for the remaining prod-default env vars (FROM_EMAIL, business URL, unsub base URL): keep with rationale or convert to fail-fast
    - _Requirements: 1.6_
  - [x] 1.6 Unit tests: each accessor throws when unset outside DEV_MODE, dev default in DEV_MODE, verify fails closed
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. City_Nodes_Read scaling (R2)
  - [x] 2.1 Terraform: `CityIndex` GSI on the nodes table (dev + prod), fmt + validate
    - _Requirements: 2.1, 2.5_
  - [x] 2.2 `getNodesByCitySlug`: Scan -> paginated Query on `CityIndex`
    - _Requirements: 2.1, 2.6_
  - [x] 2.3 Batch the pulse reads (BatchGet, chunked at 100) replacing the per-node `kvGet` loop
    - _Requirements: 2.2_
  - [x] 2.4 KV-cache the assembled city payload, TTL 45s, key `nodes:city:{slug}`
    - _Requirements: 2.3, 2.4_
  - [-] 2.5 Unit tests: pagination, batch chunking, cache hit/miss/TTL, unchanged response shape
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

- [ ] 3. Room_Fanout robustness (R3)
  - [~] 3.1 Paginate `broadcastToRoom` / `broadcastToUser` connection queries
    - Shared `queryAllConnections` helper.
    - _Requirements: 3.1_
  - [~] 3.2 Bounded-concurrency `allSettled` fan-out; per-broadcast summary log; reached-count = successes
    - GoneException handling unchanged.
    - _Requirements: 3.2, 3.3, 3.4, 3.5_
  - [~] 3.3 Property test: reached-count equals successful posts for arbitrary success/failure vectors
    - _Requirements: 3.2, 3.5_

- [ ] 4. Consented usage instrumentation (R4)
  - [~] 4.1 `packages/shared/lib/usageEvents.ts` beacon: buffer, flush, hard opt-in gate, swallow failures
    - _Requirements: 4.1, 4.2, 4.3, 4.7_
  - [~] 4.2 Backend `features/events/`: POST /v1/events with JWT, Zod allowlist validation, rate limit, EMF emit
    - _Requirements: 4.2, 4.4, 4.5_
  - [~] 4.3 Wire the ten events at their existing seams (auth landing, selection store, check-in success, beam tap, zoom commit, First-Get screens)
    - _Requirements: 4.1_
  - [~] 4.4 RUNBOOK funnel-readout section (Constellation Funnel + signup funnel queries)
    - _Requirements: 4.6_
  - [~] 4.5 Unit tests: opt-in gating (no consent -> zero requests), allowlist rejection, batch limits, EMF line shape
    - _Requirements: 4.2, 4.3, 4.5_

- [ ] 5. Architecture limits and hygiene (R5)
  - [~] 5.1 ESLint `max-lines` 400 with generated Lines_Baseline; ratchet script fails CI on growth
    - _Requirements: 5.1, 5.2_
  - [~] 5.2 Fix the `nodes/repository.ts` map-membership comment to match the task 7.1 decision
    - _Requirements: 5.3_
  - [~] 5.3 Delete dead export `getRedemptionByRewardAndUser` (after the in-flight Limit+Filter session lands)
    - _Requirements: 5.4_
  - [~] 5.4 Log row keys in the corrupt-JSON catches (reports, campaigns repositories)
    - _Requirements: 5.5_

- [ ] 6. CI supply-chain and load checks (R6)
  - [~] 6.1 `pnpm audit --audit-level high` step in the quality gate with committed ignore file
    - _Requirements: 6.1_
  - [~] 6.2 `scripts/load-smoke.js` (k6): nodes read + check-in burst, thresholds, DEPLOY.md docs, workflow_dispatch job
    - _Requirements: 6.2, 6.3_
  - [~] 6.3 Run the first load smoke against dev; record results in GO_LIVE_CHECK_RESULT.md (founder-run, needs dev access)
    - _Requirements: 6.4_

- [ ] 7. Decision records (R7)
  - [~] 7.1 `docs/decisions/map-membership.md`: paid-only map vs alternatives; reconcile `rules/product.md` and code comments to the choice
    - Behaviour change, if chosen, is a follow-up spec.
    - _Requirements: 7.1, 7.2_
  - [~] 7.2 `docs/decisions/digest-email-sent-field.md` and implement the chosen option (flip-after-send or remove field)
    - _Requirements: 7.3_
  - [~] 7.3 `docs/decisions/api-region.md` with a measured us-east-1 vs af-south-1 latency comparison
    - _Requirements: 7.4_

- [ ] 8. Ops verifications (R8, founder-run live steps)
  - [~] 8.1 Verify rate-limiter client IP in prod logs; record evidence; fix identifier extraction if constant
    - _Requirements: 8.1_
  - [~] 8.2 PITR restore rehearsal on a dev table; record the procedure in RUNBOOK.md
    - _Requirements: 8.2, 8.3_

- [ ] 9. Verification (R9)
  - [~] 9.1 `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm guard:serverless` all green; terraform fmt + validate
    - _Requirements: 9.1, 9.3_
