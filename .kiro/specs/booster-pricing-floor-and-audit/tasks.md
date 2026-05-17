# Implementation Plan: Booster Pricing Floor and Audit

## Overview

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

This plan implements the booster floor and audit feature bottom-up: types and Zod schemas first, then the repository layer (the only DynamoDB-aware module), then the pure floor-check function with its property test, then the webhook persistence path, then the admin floor service and the operator/admin query services, then the API Gateway routes, then the existing-cleanup-worker extension, then the three frontend surfaces (operator panel on `/boost`, admin floor editor, admin boost report), and finally the Terraform seed of `BoostFloor_Row` defaults plus the two CloudWatch alarms wired to the existing alarm topic. Everything stays inside the existing `business-handler` Lambda (`arm64`), the existing single-table `AppData_Table` (`PAY_PER_REQUEST`), and the existing `cleanup` worker. No SMS, no phone-OTP, no new always-on resources.

The implementation language is **TypeScript** for backend and frontends, matching the design (Zod schemas, AWS SDK v3, `fast-check`) and the rest of the repo.

## Tasks

- [x] 1. Define types, constants, and Zod schemas for the booster floor and audit rows
  - [x] 1.1 Extend `backend/src/features/business/types.ts` with floor + audit constants and row types
    - Add `BOOST_FLOOR_DEFAULTS: Record<BoostDuration, number>` populated from the existing `BOOST_PRICING` const so `2hr=2500, 6hr=5000, 24hr=15000` (R3.5)
    - Add `BOOST_FLOOR_MIN_CENTS = 1`, `BOOST_FLOOR_MAX_CENTS = 1_000_000`, `ADMIN_BOOST_REPORT_MAX_RANGE_DAYS = 367`
    - Add the `BOOST_LOG_BRANCHES` exhaustive union type with literal members `'floor_loaded_from_dynamo' | 'floor_loaded_from_const_fallback' | 'floor_violation_rejected' | 'purchase_audit_written' | 'purchase_audit_duplicate_yoco_checkout_id' | 'purchase_audit_duplicate_event_id'` so a missing branch is a TypeScript error (R9.3)
    - Export `boosterPurchaseRowSchema`, `boostFloorRowSchema`, `floorChangeAuditRowSchema`, and `boosterCheckoutMarkerRowSchema` Zod schemas matching the field tables in the Data Models section, plus inferred types `BoosterPurchaseRow`, `BoostFloorRow`, `FloorChangeAuditRow`, `BoosterCheckoutMarkerRow`
    - Export the API-response view types `BoosterPurchaseView`, `AdminBoosterPurchaseView`, `BoostFloorView`, `FloorChangeAuditView` and a Zod-derived schema for each so serialize/deserialize is symmetric
    - Leave the existing `BOOST_PRICING` const untouched as the price source-of-truth (R9.2)
    - _Requirements: 1.2, 1.7, 1.8, 2.1, 3.5, 3.6, 4.1, 5.1, 8.4, 8.5, 9.2, 9.3_

- [x] 2. Implement the DynamoDB repository layer for booster rows
  - [x] 2.1 Add `putBoosterPurchaseWithMarker` to `backend/src/features/business/repository.ts`
    - Encode the two-step idempotency choreography from Flow 2 of the design: `PutItem` the marker first with `ConditionExpression: 'attribute_not_exists(pk)'`, then `PutItem` the BoosterPurchase row with the same condition
    - Return `{ result: 'duplicate' }` when the marker `PutItem` raises `ConditionalCheckFailedException` (R2.3)
    - Return `{ result: 'duplicate' }` when the purchase `PutItem` raises `ConditionalCheckFailedException` after the marker just succeeded (R1.6)
    - On any non-conditional failure of the purchase `PutItem`, attempt a best-effort `DeleteItem` of the marker and re-throw the original error (R1.5, R2.4); if the compensating delete itself fails, log and re-throw the original error anyway
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.6_

  - [x] 2.2 Add floor read functions `getBoostFloor` and `listBoostFloors` to `backend/src/features/business/repository.ts`
    - `getBoostFloor(duration)` issues a single `GetItem` on `pk='BOOST_FLOOR' sk=<duration>` and Zod-parses the result or returns `null`
    - `listBoostFloors()` issues a single `BatchGetItem` for the three duration keys (`2hr`, `6hr`, `24hr`) and returns the Zod-parsed rows present (no Scan, no Query)
    - _Requirements: 3.1, 4.1, 4.2_

  - [x] 2.3 Add `writeFloorAuditThenUpdateFloor` and `queryFloorChangeAudit` to `backend/src/features/business/repository.ts`
    - `writeFloorAuditThenUpdateFloor` writes the `Floor_Change_Audit_Row` first; only if that `PutItem` succeeds does it issue the `BoostFloor_Row` `PutItem` with refreshed `updatedAt` / `updatedBy` (R5.2)
    - If the audit write fails, throw and do not attempt the floor write so the BoostFloor_Row stays unchanged (R5.3)
    - `queryFloorChangeAudit(duration, cursor, limit)` issues a `Query` on `pk='BOOST_FLOOR_AUDIT#<duration>'` with `ScanIndexForward=false`, returns Zod-parsed rows newest-first plus a `nextCursor` derived from `LastEvaluatedKey`
    - _Requirements: 4.4, 4.7, 5.1, 5.2, 5.3, 5.5_

  - [x] 2.4 Add booster-purchase query functions to `backend/src/features/business/repository.ts`
    - `queryBoosterPurchasesForBusiness(businessId, cursor, limit)` issues a `Query` on `pk='BOOST#<businessId>'` with `ScanIndexForward=false` and returns Zod-parsed rows newest-first plus a `nextCursor`; reject a malformed cursor by throwing a tagged error so the handler can return 400 (R6.4)
    - `queryBoosterPurchasesByTimeRange(fromIso, toIso, cursor, limit)` issues a `Query` on GSI1 with `gsi1pk='BOOST_BY_TIME'` and `gsi1sk BETWEEN :from AND :to`, returning Zod-parsed rows plus a `nextCursor` (R7.2)
    - `getBoosterCheckoutMarker(yocoCheckoutId)` issues a single `GetItem` on `pk='BOOST_CHECKOUT#<yocoCheckoutId>'` and returns the Zod-parsed marker or `null`; the caller then performs a follow-up `GetItem` of the BoosterPurchase row using the marker's `boostPk` / `boostSk` (R7.2 single-payment mode)
    - _Requirements: 6.2, 6.4, 7.2_

  - [x] 2.5 Write property test for booster-purchase JSON round-trip
    - **Property 3: BoosterPurchase JSON round-trip**
    - **Validates: Requirements 1.2, 1.7, 1.8, 8.4, 8.5, 10.4**
    - Create `backend/src/features/business/__tests__/booster-purchase-roundtrip.property.test.ts`
    - Use `fast-check` to generate valid `BoosterPurchaseRow` values (custom arbitraries for `BoostDuration`, ISO 8601 millisecond-precision UTC timestamps, integer cents, optional `neighbourhoodIdSnapshot`), assert that `boosterPurchaseRowSchema.parse(JSON.parse(JSON.stringify(row)))` is deeply equal to `row`, and assert no generated row carries a `ttl` attribute or any phone-number / SMS-delivery field

- [x] 3. Implement the pure floor-check function and integrate it into `purchaseBoost`
  - [x] 3.1 Add the pure `checkBoostFloor` function to `backend/src/features/business/service.ts`
    - Export `checkBoostFloor(computedPriceCents: number, floorCents: number): { decision: 'accept' } | { decision: 'reject'; code: 'BOOST_BELOW_FLOOR' }`
    - The function MUST be observably pure — no I/O, no `Date.now()`, no globals — so the property test can run it 100+ times against arbitrary inputs
    - Return `accept` if and only if `computedPriceCents >= floorCents`
    - _Requirements: 3.3, 3.4, 10.1_

  - [x] 3.2 Write property test for the floor decision and metric emission contract
    - **Property 1: Floor decision is exact and rejection emits metric**
    - **Validates: Requirements 3.3, 3.4, 9.5, 10.1**
    - Create `backend/src/features/business/__tests__/floor-check.property.test.ts`
    - Use `fast-check` with `numRuns: 100` to generate `(duration ∈ {'2hr','6hr','24hr'}, computedPriceCents ∈ [0, 10_000_000], floorCents ∈ [1, 1_000_000])` triples and assert `checkBoostFloor` returns `accept` iff `computedPriceCents >= floorCents`
    - Add a second property using a fake CloudWatch client that asserts a `BoostFloorViolation` `PutMetricData` call is issued exactly once if and only if the decision is `reject`, and that the rejection still occurs when the metric emission throws

  - [x] 3.3 Extend `purchaseBoost` in `backend/src/features/business/service.ts` to consult the floor before creating the Yoco checkout
    - Compute `amountCents = BOOST_PRICING[duration]` as today (R9.2)
    - Call `getBoostFloor(duration)`; on hit, log `branch=floor_loaded_from_dynamo` (R9.3); on miss, fall back to `BOOST_PRICING[duration]` and emit a single `warn`-level log per cold-start with `branch=floor_loaded_from_const_fallback` (R3.2, R9.3)
    - If `checkBoostFloor(amountCents, effectiveFloor).decision === 'reject'`, emit a `BoostFloorViolation` CloudWatch metric with dimensions `{ duration, businessId }`, log `branch=floor_violation_rejected`, and throw an `AppError` with `status=400`, `code='BOOST_BELOW_FLOOR'`, message `"Booster price is below the configured floor for this duration"` (R3.3, R9.5)
    - On metric-emission failure, log the error and still throw the 400 — the rejection MUST NOT be conditional on the metric succeeding (R9.5)
    - On accept, proceed to `createYocoCheckout(...)` exactly as today; preserve the existing `DEV_MODE` short-circuit so dev fixtures and the existing API contract stay unchanged when the floor equals the const (R9.1, R9.4)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 4. Implement the webhook BoosterPurchase persistence branch
  - [x] 4.1 Add `persistBoosterPurchase` to `backend/src/features/business/service.ts`
    - Add a branch inside the existing `handlePaymentSucceeded` for `metadata.type === 'boost'` that validates the payload (`metadata.businessId` non-empty, `metadata.nodeId` non-empty, `metadata.duration ∈ {'2hr','6hr','24hr'}`, `payload.amount` is a positive integer); if any validation fails, log and skip the booster write (matches existing webhook behaviour for unrecognised metadata, R1.1 prerequisite) without raising
    - Snapshot `tierSnapshot` from `getEffectiveTier(biz)` and `neighbourhoodIdSnapshot` from the node's `neighbourhoodId` at write time (R1.2)
    - Snapshot `floorAtPurchaseCents` by calling `getBoostFloor(duration)` and falling back to the const if missing — same fallback as `purchaseBoost` so the value persisted on the row reflects the effective floor at the moment of write (R1.2)
    - Build the `BoosterPurchaseRow` (`pk='BOOST#<businessId>'`, `sk='BOOST#<paidAt>#<yocoCheckoutId>'`, `gsi1pk='BOOST_BY_TIME'`, `gsi1sk=paidAt`, etc.) and the matching `Idempotency_Marker` (`pk=sk='BOOST_CHECKOUT#<yocoCheckoutId>'`, copying `boostPk` / `boostSk`); call `putBoosterPurchaseWithMarker`
    - On `result==='duplicate'`, log `branch=purchase_audit_duplicate_yoco_checkout_id` and return without raising (R2.3, R2.6, R1.6)
    - On `result==='written'`, log `branch=purchase_audit_written` (R9.3)
    - On a non-conditional failure, emit a `BoostPurchaseAuditMissing` CloudWatch metric with `{ duration }` dimension and re-throw so the webhook returns non-2xx and Yoco retries (R1.5, R9.6)
    - Preserve the existing outer `WEBHOOK#<eventId>` idempotency layer; `branch=purchase_audit_duplicate_event_id` is logged when that outer layer detects the duplicate (R2.5)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.4, 8.5, 9.3, 9.6_

  - [x] 4.2 Write property test for webhook idempotence with failure injection
    - **Property 2: Webhook idempotence on yocoCheckoutId**
    - **Validates: Requirements 1.1, 1.5, 1.6, 2.3, 2.4, 2.6, 9.6, 10.2, 10.3**
    - Create `backend/src/features/business/__tests__/webhook-idempotence.property.test.ts`
    - Build an in-memory map-backed `DynamoDBDocumentClient` test double that models `PutCommand` with `ConditionExpression: 'attribute_not_exists(pk)'`, `GetCommand`, `DeleteCommand`, and a per-call failure-rate parameter for non-conditional `ProvisionedThroughputExceededException`
    - Use `fast-check` with `numRuns: 250` to generate sequences of `payment.succeeded` events with `metadata.type === 'boost'`, including arbitrary repeats of the same `yocoCheckoutId`, fresh `eventId`s for redeliveries of the same payment, and arbitrarily-injected non-conditional failures with subsequent retries
    - Assert the multiset of persisted `BoosterPurchase` rows equals the multiset of distinct `yocoCheckoutId` values successfully delivered, AND for each persisted `BoosterPurchase` there is exactly one `Idempotency_Marker` sharing the same `yocoCheckoutId`

- [x] 5. Implement the admin floor management service
  - [x] 5.1 Add `getBoostFloors`, `updateBoostFloor`, and `listFloorChangeAudit` to `backend/src/features/business/service.ts`
    - `getBoostFloors()` calls `listBoostFloors()` and returns a `BoostFloorView[]` of length 3, one entry per duration; for any duration whose row is missing, return a `BoostFloorView` populated from `BOOST_FLOOR_DEFAULTS[duration]` flagged `isDefault: true` so the editor can render the "default — never edited" label (R4.8)
    - `updateBoostFloor(duration, floorCents, changeReason, admin)` validates `duration ∈ {'2hr','6hr','24hr'}` (else throw 400, R4.6), validates `floorCents` is an integer in `[1, 1_000_000]` (else throw 400, R4.3), reads the previous floor (if any) for the audit row's `previousFloorCents`, builds the `Floor_Change_Audit_Row` with a fresh UUID v4 as `changeId`, and calls `writeFloorAuditThenUpdateFloor` so the audit row is durable before the floor row is written (R5.2)
    - On audit-write failure, propagate the error so the handler returns 500 with no floor change (R5.3)
    - `listFloorChangeAudit(duration, cursor, limit)` thin-wraps `queryFloorChangeAudit` and projects rows to `FloorChangeAuditView`
    - _Requirements: 4.1, 4.3, 4.4, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.5_

  - [x] 5.2 Write property test for floor update convergence and audit-first ordering
    - **Property 4: Floor update convergence with audit-first ordering**
    - **Validates: Requirements 4.4, 4.7, 5.2, 5.3, 10.5**
    - Create `backend/src/features/business/__tests__/floor-update.property.test.ts`
    - Use `fast-check` with `numRuns: 100` to generate sequences of in-range admin floor updates with arbitrary `(duration, floorCents, admin)` tuples
    - Run the sequence against the in-memory test double and an in-memory model; assert the final `BoostFloor_Row` per touched duration equals the last accepted update, the count of `Floor_Change_Audit_Row` rows per duration equals the count of accepted updates, and on injected audit-write failures no `BoostFloor_Row` update occurs for that attempt

  - [x] 5.3 Write property test for floor input-validation accept count
    - **Property 5: Floor input-validation accept count**
    - **Validates: Requirements 4.3, 4.6, 10.6**
    - Create `backend/src/features/business/__tests__/floor-input.property.test.ts`
    - Use `fast-check` to generate sequences of `floorCents` values from a distribution mixing in-range integers (`[1, 1_000_000]`) with out-of-range values (negatives, zero, fractional, > 1_000_000) and bad durations
    - Assert accepted-count equals in-range integer requests with valid durations, rejected-count equals the rest, and no `BoostFloor_Row` or `Floor_Change_Audit_Row` is written for a rejected request

- [x] 6. Implement the operator and admin booster-purchase query services
  - [x] 6.1 Add `listBoosterPurchasesForBusiness` to `backend/src/features/business/service.ts`
    - Wrap `queryBoosterPurchasesForBusiness(businessId, cursor, limit=25)` and project rows to the operator-facing `BoosterPurchaseView` so `tierSnapshot`, `neighbourhoodIdSnapshot`, and `floorAtPurchaseCents` are NOT included in the response (R6.6)
    - Surface a malformed-cursor error as a tagged validation error the handler can map to 400 (R6.4)
    - _Requirements: 6.2, 6.4, 6.6_

  - [x] 6.2 Add `listBoosterPurchasesByDateRange` and `getBoosterPurchaseByYocoCheckoutId` to `backend/src/features/business/service.ts`
    - `listBoosterPurchasesByDateRange(fromIso, toIso, cursor, limit=25)` validates `fromIso <= toIso` and `(toIso - fromIso) <= 367 days` BEFORE issuing any DynamoDB call; if either check fails, throw a tagged 400 error (R7.5); on success, call `queryBoosterPurchasesByTimeRange` and project rows to `AdminBoosterPurchaseView` including `businessId`, `tierSnapshot`, `neighbourhoodIdSnapshot`, `floorAtPurchaseCents`, and `yocoCheckoutId` (R7.6)
    - `getBoosterPurchaseByYocoCheckoutId(yocoCheckoutId)` calls `getBoosterCheckoutMarker(yocoCheckoutId)`; if no marker, return `null`; otherwise issue a follow-up `GetItem` for the `BoosterPurchase` row using the marker's stored `boostPk` and `boostSk` and project to `AdminBoosterPurchaseView` (R7.2)
    - _Requirements: 7.2, 7.5, 7.6_

  - [x] 6.3 Write property test for the admin date-range query result-set with range-validation gate
    - **Property 6: Admin date-range query result-set with range-validation gate**
    - **Validates: Requirements 7.2, 7.4, 7.5**
    - Create `backend/src/features/business/__tests__/admin-date-range.property.test.ts`
    - Use `fast-check` to seed the test double with arbitrary sets of `BoosterPurchase` rows (varying `paidAt`) and to generate `(from, to)` ISO-8601 pairs spanning valid, inverted, and >367-day cases
    - Assert: (a) the service rejects with the 400 error when `from > to` or `(to - from) > 367 days` AND issues no DynamoDB call (verified by spying on the test double); otherwise (b) the union of paginated results equals exactly the set of rows whose `paidAt ∈ [from, to]`

  - [x] 6.4 Write property test for operator pagination round-trip
    - **Property 7: Operator pagination round-trip preserves order and identity**
    - **Validates: Requirements 6.2, 6.4**
    - Create `backend/src/features/business/__tests__/operator-pagination.property.test.ts`
    - Use `fast-check` to seed the test double with arbitrary sets of `BoosterPurchase` rows for one `businessId` and to traverse `listBoosterPurchasesForBusiness` page by page at `limit=25` until `nextCursor` is `null`
    - Assert each row appears exactly once across the union of pages, the union is `paidAt`-descending, and a malformed cursor is rejected with the 400-mapped error

- [x] 7. Wire API Gateway routes in the existing `business-handler` Lambda
  - [x] 7.1 Add the operator route `GET /v1/business/:businessId/boost-purchases` to `backend/src/features/business/handler.ts`
    - Authenticate with the existing business JWT middleware; reject with 403 if the JWT `businessId` claim does not equal the path `businessId` (R6.3)
    - Zod-validate the optional `cursor` query param; on parse failure return 400 (R6.4)
    - Call `listBoosterPurchasesForBusiness` and return `{ items, nextCursor }`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

  - [x] 7.2 Add the admin floor-editor routes to `backend/src/features/business/handler.ts`
    - `GET /v1/admin/boost-floors` — admin-JWT-guarded, returns `BoostFloorView[]` from `getBoostFloors`; non-admin → 403 (R4.5)
    - `PUT /v1/admin/boost-floors/:duration` — admin-JWT-guarded; Zod-validates `:duration ∈ {'2hr','6hr','24hr'}` (else 400, R4.6) and body `{ floorCents: integer in [1, 1_000_000], changeReason?: string of 1..280 }` (else 400, R4.3); on audit-write failure return 500 (R5.3); on success return the refreshed `BoostFloorView`
    - `GET /v1/admin/boost-floors/:duration/audit?cursor=...` — admin-JWT-guarded; returns the most-recent 25 `FloorChangeAuditView` rows newest-first plus `nextCursor` for pagination (R4.7, R5.5)
    - _Requirements: 4.2, 4.3, 4.5, 4.6, 4.7, 5.3, 5.5_

  - [x] 7.3 Add the admin boost-purchase report route `GET /v1/admin/boost-purchases` to `backend/src/features/business/handler.ts`
    - Admin-JWT-guarded; non-admin → 403 (R7.3)
    - When `from` and `to` are present: validate the range first (R7.5); if both `from` and `to` are present and valid, enter date-range mode and ignore `yocoCheckoutId`; if the range is malformed return 400 with no fallback to single-payment mode (R7.4)
    - When `from` and `to` are absent and `yocoCheckoutId` is present, enter single-payment mode by calling `getBoosterPurchaseByYocoCheckoutId` and return at most one row (or empty result if no marker exists)
    - When neither `from`/`to` nor `yocoCheckoutId` is present, return 400
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 8. Checkpoint — backend services and routes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Extend the existing cleanup worker for 7-year POPIA retention
  - [x] 9.1 Extend `backend/src/workers/cleanup.ts` to delete booster rows older than 7 years
    - Add a paged `Scan` filtered by `attribute_exists(paidAt)` on `BoosterPurchase` rows; for each row whose `paidAt` is older than `now - 7 years`, batch-delete (R8.3)
    - Add the same pattern for `Floor_Change_Audit_Row` rows filtered by `attribute_exists(changedAt)` deleting where `changedAt` is older than `now - 7 years` (R8.3)
    - Add the same pattern for `Idempotency_Marker` rows filtered by `pk` prefix `BOOST_CHECKOUT#` deleting where `createdAt` is older than `now - 7 years` (R8.6)
    - Bound the per-invocation delete budget the same way the existing worker does (paged batches, max-per-run)
    - These rows MUST NOT be given a DynamoDB `ttl` attribute (R1.7, R5.4, R8.2)
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [x] 9.2 Write property test for retention cleanup boundary
    - **Property 9: Retention cleanup boundary**
    - **Validates: Requirements 8.3, 8.6**
    - Create `backend/src/workers/__tests__/cleanup-boost-retention.property.test.ts`
    - Use `fast-check` to generate a mixed corpus of `BoosterPurchase`, `Idempotency_Marker`, and `Floor_Change_Audit_Row` rows with arbitrary timestamps and a `now` clock value
    - Assert each row is deleted by the cleanup worker if and only if `(now - reference_timestamp) > 7 years`, where `reference_timestamp` is `paidAt` for `BoosterPurchase`, `createdAt` for `Idempotency_Marker`, and `changedAt` for `Floor_Change_Audit_Row`

- [x] 10. Build the operator-facing recent-purchases panel
  - [x] 10.1 Add the "Recent purchases" section to the existing `/boost` route in `apps/web/`
    - Add a new component (e.g. `apps/web/src/components/BoostPurchasesPanel.tsx`) rendered beneath the existing buy-a-boost form (R6.1)
    - Fetch `GET /v1/business/:businessId/boost-purchases` with the existing business JWT helper, paginate at 25 rows per page following `nextCursor` (R6.4)
    - Render each row as `paidAt` formatted `YYYY-MM-DD HH:mm` in `Africa/Johannesburg`, `nodeId` resolved to the human-readable node name via the existing nodes lookup, `duration`, and `amountCents` formatted as `R<X>.<YY>` (R6.5)
    - Do NOT render `tierSnapshot`, `neighbourhoodIdSnapshot`, or `floorAtPurchaseCents` (R6.6)
    - Do NOT render any pulse-impact or check-in-impact metrics (R6.7)
    - When the response has zero items, render the empty-state copy `"No booster purchases yet."` (R6.8)
    - _Requirements: 6.1, 6.2, 6.5, 6.6, 6.7, 6.8_

  - [x] 10.2 Write property test for operator-side render visibility
    - **Property 8: Render visibility — operator hides snapshots**
    - **Validates: Requirements 6.6, 7.6**
    - Create `apps/web/src/__tests__/operator-boost-render.property.test.ts` using Vitest + Testing Library + `fast-check`
    - Use `fast-check` to generate arbitrary `BoosterPurchaseView` rows; render the operator panel with each row and assert the rendered DOM text contains no occurrence of the strings `tierSnapshot`, `neighbourhoodIdSnapshot`, `floorAtPurchaseCents` (neither label nor value)

- [x] 11. Build the admin floor editor screen
  - [x] 11.1 Create `apps/admin/src/screens/BoostFloorEditor.tsx`
    - Render three duration cards (`2hr`, `6hr`, `24hr`) showing current `floorCents`, `updatedAt`, and `updatedBy`, fetched from `GET /v1/admin/boost-floors` (R4.2)
    - Each card has an inline cents-integer edit field bounded by `[1, 1_000_000]` and an optional `changeReason` textarea capped at 280 characters; submit calls `PUT /v1/admin/boost-floors/:duration` (R4.3)
    - When a duration's row is missing (`isDefault: true`), render the `BOOST_PRICING` const value as the effective floor and label it `"default — never edited"` (R4.8)
    - Below each card, render the most recent 25 `Floor_Change_Audit_Row` entries newest-first by calling `GET /v1/admin/boost-floors/:duration/audit` with paginated `nextCursor` follow-through (R4.7, R5.5)
    - Wire the screen into the existing admin dashboard nav
    - _Requirements: 4.2, 4.3, 4.7, 4.8, 5.5_

- [x] 12. Build the admin cross-business booster report screen
  - [x] 12.1 Create `apps/admin/src/screens/BoostPurchaseReport.tsx`
    - Two mutually-exclusive query forms: a date-range form (`from` and `to` date pickers; default to the last 7 days) and a `yocoCheckoutId` lookup input
    - Date-range submit calls `GET /v1/admin/boost-purchases?from=...&to=...`; `yocoCheckoutId` lookup calls `GET /v1/admin/boost-purchases?yocoCheckoutId=...` (R7.2)
    - Render results as a table with `paidAt`, `businessId`, `nodeId` (raw id is fine — this is an ops surface), `duration`, `amountCents`, `tierSnapshot`, `neighbourhoodIdSnapshot`, `floorAtPurchaseCents`, and `yocoCheckoutId` (R7.6)
    - Add a one-click **Copy** button per row that copies `yocoCheckoutId` to the clipboard for paste into the Yoco merchant dashboard (R7.7)
    - Surface 400 errors from the date-range gate (`from > to`, `(to - from) > 367 days`) as inline form errors so the admin understands the cap (R7.5)
    - Wire the screen into the existing admin dashboard nav (R7.1)
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7_

  - [x] 12.2 Write property test for admin-side render visibility
    - **Property 8: Render visibility — admin shows snapshots**
    - **Validates: Requirements 6.6, 7.6**
    - Create `apps/admin/src/__tests__/admin-boost-render.property.test.ts` using Vitest + Testing Library + `fast-check`
    - Use `fast-check` to generate arbitrary `AdminBoosterPurchaseView` rows; render the report row with each input and assert the rendered DOM text contains `businessId`, `tierSnapshot`, `neighbourhoodIdSnapshot`, `floorAtPurchaseCents`, AND `yocoCheckoutId` values

- [x] 13. Seed `BoostFloor_Row` defaults and wire CloudWatch alarms in Terraform
  - [x] 13.1 Add Terraform resources to seed the three `BoostFloor_Row` rows at deploy time
    - Add `aws_dynamodb_table_item` resources (one per duration) under `infra/environments/dev/main.tf` and `infra/environments/prod/main.tf` — or an equivalent one-shot deploy hook — that write `pk='BOOST_FLOOR' sk=<duration>` rows seeded with the corresponding `BOOST_PRICING` value (`2hr=2500, 6hr=5000, 24hr=15000`) so the rejection branch never fires on day one (R3.5, R9.4)
    - Use `lifecycle { ignore_changes = [item] }` on the seeds so subsequent admin-portal updates are not overwritten by Terraform
    - Confirm `billing_mode = "PAY_PER_REQUEST"` on the table is unchanged and no new always-on resources are introduced (R3.7, serverless steering)
    - _Requirements: 3.5, 3.7, 9.4_

  - [x] 13.2 Add the two CloudWatch alarms for `BoostFloorViolation` and `BoostPurchaseAuditMissing`
    - Add `aws_cloudwatch_metric_alarm` resources for both metrics with a 5-minute window and `>= 1` threshold; route both to the existing alarm SNS topic used by the rest of the backend (R9.5, R9.6, R9.7)
    - Confirm neither metric emits a zero-count heartbeat — emission is conditional on the actual event (R9.5)
    - _Requirements: 9.5, 9.6, 9.7_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. Core implementation tasks are never marked optional.
- Each task references specific requirements clauses for traceability.
- Property tests are placed close to the implementation they validate (catching errors early). Each correctness Property from the design has its own sub-task and is annotated with both its property number and the requirements clauses it validates.
- The feature ships without a runtime feature flag per R9.4: the audit path is purely additive and the floor seed equals `BOOST_PRICING` so the rejection branch never fires on day one. Rollback is a deploy revert.
- All new compute lives inside the existing `business-handler` Lambda (`arm64`), and all persistence lives inside the existing single-table `AppData_Table` (`PAY_PER_REQUEST`). No new always-on resources, per `.kiro/steering/serverless-only.md`.
- No SMS, no phone-OTP, no phone-number identifiers in any row, view, schema, or UI surface, per `.kiro/steering/no-sms-no-phone-auth.md` and R1.8 / R8.4.
- POPIA retention is 7 years, managed by the existing `cleanup` worker rather than DynamoDB TTL (R8.2). The first deletions will not run for at least 7 years from launch.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "3.1"] },
    { "id": 2, "tasks": ["2.5", "3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "5.1", "6.1", "6.2", "9.1", "13.1", "13.2"] },
    { "id": 4, "tasks": ["4.2", "5.2", "5.3", "6.3", "6.4", "9.2"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["10.1", "11.1", "12.1"] },
    { "id": 7, "tasks": ["10.2", "12.2"] }
  ]
}
```
