# Requirements Document

## Introduction

Boosters are the per-venue, time-boxed visibility purchases sold separately from the monthly business plans. Today they ship as a flat const in `backend/src/features/business/types.ts` (`BOOST_PRICING['2hr']=2500`, `['6hr']=5000`, `['24hr']=15000` cents) and are sold via `purchaseBoost` in `backend/src/features/business/service.ts`, which creates a Yoco checkout with `metadata.type === 'boost'`.

The 17 May 2026 go-live audit (`docs/GO_LIVE_AUDIT.md` §11) confirmed two gaps:

1. `processYocoWebhook → handlePaymentSucceeded` only acts on `metadata.plan` for subscription tiers. A `metadata.type === 'boost'` event is processed for idempotency but produces **no** persisted record. There is no `BoosterPurchase` row in `app_data`, no dedicated booster table, and a `grep` for `BoosterPurchase|booster_purchase|boost.*audit|boostHistory|recordBoost` returns zero matches across `backend/`.
2. There is no server-side minimum-price floor on booster checkout creation. Today the price IS the constant, so the gap is latent — but the moment pricing becomes dynamic (or the moment the price moves to the client), there is no guard.

This feature, **Booster Pricing Floor and Audit**, closes both gaps before any future dynamic-pricing work:

- It persists a `BoosterPurchase` row on every successful booster payment, idempotent on `yocoCheckoutId`, capturing enough context (`tier` snapshot, `neighbourhoodId` snapshot from the node, `paidAt`) that a future demand-based pricing engine can train on it without backfill.
- It enforces a server-side minimum-price floor at checkout-creation time, configurable per-duration via the admin console (no redeploy), with a change audit trail.
- It exposes a recent-purchases panel to the business operator and a cross-business query to admin for refund/dispute support.

Out of scope for this spec: refund and chargeback flows (Yoco handles them; we only need the audit table to be queryable when ops decides to refund), the actual dynamic pricing engine, pulse-impact reporting on individual boosts (that is a `venue-intelligence-reports` concern), and per-business spending caps (separate fraud-prevention spec).

All persistence stays on DynamoDB `PAY_PER_REQUEST`. No new always-on resources. No SMS, no phone-OTP. POPIA stays intact.

## Glossary

- **AppData_Table**: the existing shared single-table DynamoDB instance referenced as `TableNames.appData` in `backend/src/shared/db/dynamodb.js`. Already hosts `WEBHOOK#<eventId>` idempotency rows and `BIZ_CHECKIN#…` cache rows. Billing mode is `PAY_PER_REQUEST`.
- **Booster_Service**: the booster path inside `backend/src/features/business/service.ts`, comprising `purchaseBoost` (checkout creation) and the `metadata.type === 'boost'` branch of `handlePaymentSucceeded` (this spec adds that branch).
- **Yoco_Webhook_Handler**: `processYocoWebhook` and its `handlePaymentSucceeded` / `handlePaymentFailed` helpers in the same file. Already idempotent on the Yoco `eventId` via `findWebhookEvent` / `createWebhookEvent`.
- **Boost_Duration**: one of `2hr`, `6hr`, `24hr` — the keys of the existing `BOOST_PRICING` const.
- **Boost_Metadata**: the metadata object Booster_Service attaches to a Yoco checkout: `{ businessId, nodeId, duration, type: 'boost' }`. The webhook receives it back on `payment.succeeded`.
- **BoosterPurchase**: a single audit row written exactly once per successful booster payment.
- **BoosterPurchase_Pk**: the DynamoDB partition key for a BoosterPurchase row, of the form `BOOST#<businessId>`.
- **BoosterPurchase_Sk**: the DynamoDB sort key for a BoosterPurchase row, of the form `BOOST#<paidAt_iso>#<yocoCheckoutId>` so rows for one business sort newest-last by chronological time and a `Yoco_Checkout_Id` collision still produces a unique sort key.
- **Yoco_Checkout_Id**: the `id` returned by `POST /api/checkouts` on Yoco and quoted back inside the webhook payload's `metadata` (or top-level `checkoutId`). Treated as opaque; uniqueness across all merchants is asserted by Yoco.
- **Idempotency_Marker**: a secondary row written under partition key `BOOST_CHECKOUT#<yocoCheckoutId>`, sort key the same, used to detect double-writes of the same Yoco_Checkout_Id even if the BoosterPurchase_Pk / BoosterPurchase_Sk pair would otherwise allow it. Also enables `GetItem` lookup by Yoco_Checkout_Id without a scan.
- **Tier_Snapshot**: the value of the business's effective tier (`getEffectiveTier(biz)`: `starter`, `growth`, `pro`, or `payg`) at the moment the BoosterPurchase row is written. Snapshotted, not joined at read time, so historical analysis is reproducible after a tier change.
- **Neighbourhood_Snapshot**: the node's neighbourhood identifier at the moment the BoosterPurchase row is written. Source of truth is the existing `nodes` table column `neighbourhoodId` (or `null` if unset). Snapshotted, not joined at read time. Used as a feature for future demand-based pricing.
- **Boost_Price_Floor**: a per-duration minimum-cents-amount that a booster checkout must meet or exceed.
- **BoostFloor_Row**: the persisted row in AppData_Table that holds the current Boost_Price_Floor for one Boost_Duration. Partition key `BOOST_FLOOR`, sort key `<duration>` (one of `2hr`, `6hr`, `24hr`).
- **Floor_Change_Audit_Row**: a persisted row written on every change to a BoostFloor_Row, capturing who changed it, the previous and new amount, and when.
- **Floor_Editor**: the admin-portal screen used to read and update Boost_Price_Floor values. Lives in `apps/admin/src/screens/`.
- **Operator_Boost_Panel**: a new section in the existing business portal that lists the authenticated business's own BoosterPurchase rows.
- **Admin_Boost_Report**: a new admin-portal screen that lists BoosterPurchase rows across all businesses for ops, refund, and dispute support.
- **POPIA_Retention_Period**: 7 years from `paidAt`. Selected to match the South African Companies Act / SARS retention requirement for financial records, which subsumes the POPIA minimum.

## Requirements

### Requirement 1: BoosterPurchase audit row persistence

**User Story:** As an Area Code operator, I want every successful booster payment to leave a durable audit row, so that we can reconcile against Yoco, support refunds, and feed future dynamic-pricing work without re-deriving prices from constants.

#### Acceptance Criteria

1. WHEN Yoco_Webhook_Handler receives a `payment.succeeded` event with `metadata.type === 'boost'` AND a non-empty `metadata.businessId`, `metadata.nodeId`, `metadata.duration` in `{ '2hr', '6hr', '24hr' }`, AND the payload's `amount` is a positive integer, THE Booster_Service SHALL persist exactly one BoosterPurchase row in AppData_Table with the field set defined in criterion 2.
2. EACH BoosterPurchase row SHALL contain the following fields with the listed types:
   - `pk`: string, value `BOOST#<businessId>`
   - `sk`: string, value `BOOST#<paidAt_iso>#<yocoCheckoutId>`
   - `gsi1pk`: string, value `BOOST_BY_TIME` (used by Admin_Boost_Report)
   - `gsi1sk`: string, value equal to `paidAt_iso` (millisecond-precision ISO 8601 with `Z` suffix)
   - `businessId`: string, length 1-64
   - `nodeId`: string, length 1-64
   - `duration`: string, one of `2hr`, `6hr`, `24hr`
   - `amountCents`: integer, value greater than 0
   - `currency`: string, value `ZAR`
   - `yocoCheckoutId`: string, length 1-128
   - `paidAt`: string, ISO 8601 millisecond-precision UTC, equal to `gsi1sk`
   - `tierSnapshot`: string, one of `starter`, `growth`, `pro`, `payg`
   - `neighbourhoodIdSnapshot`: string of length 1-64 OR `null`
   - `floorAtPurchaseCents`: integer, equal to the Boost_Price_Floor for that `duration` at the moment the row was written, copied so the snapshot is reproducible after a floor change
   - `createdAt`: string, ISO 8601 millisecond-precision UTC, equal to the moment the row was written (may differ from `paidAt`)
3. WHEN the BoosterPurchase row is written, THE Booster_Service SHALL also write the Idempotency_Marker described in R2.
4. THE BoosterPurchase row SHALL be written using a `PutItem` with `ConditionExpression: 'attribute_not_exists(pk)'` so a write collision on the BoosterPurchase_Pk / BoosterPurchase_Sk pair surfaces as a `ConditionalCheckFailedException` rather than silently overwriting an existing row.
5. IF the BoosterPurchase row write fails for any reason other than a `ConditionalCheckFailedException`, THEN THE Booster_Service SHALL re-throw the error so the Yoco_Webhook_Handler returns a non-2xx response and Yoco retries the delivery.
6. IF the BoosterPurchase row write fails with `ConditionalCheckFailedException` AND the Idempotency_Marker (R2) confirms the same `yocoCheckoutId` was already written, THEN THE Booster_Service SHALL treat the event as a duplicate and SHALL NOT raise an error.
7. THE BoosterPurchase row SHALL NOT carry a DynamoDB `ttl` attribute, since POPIA_Retention_Period is 7 years and far exceeds DynamoDB's 1-year practical TTL window. Retention is managed by the existing `cleanup` worker per R7.
8. THE BoosterPurchase row SHALL NOT carry any phone-number or SMS-delivery fields, in line with the no-SMS rule in `.kiro/steering/no-sms-no-phone-auth.md`.

### Requirement 2: Webhook idempotency on yocoCheckoutId

**User Story:** As a backend operator, I want booster webhook retries to be safe even if Yoco delivers a fresh `eventId` carrying a previously-seen `yocoCheckoutId`, so that we never write two BoosterPurchase rows for the same payment.

#### Acceptance Criteria

1. THE Booster_Service SHALL persist an Idempotency_Marker row in AppData_Table for every BoosterPurchase row it writes. EACH Idempotency_Marker SHALL contain:
   - `pk`: string, value `BOOST_CHECKOUT#<yocoCheckoutId>`
   - `sk`: string, value `BOOST_CHECKOUT#<yocoCheckoutId>`
   - `businessId`: string, copied from the BoosterPurchase row
   - `boostPk`: string, copied from the BoosterPurchase row's `pk`
   - `boostSk`: string, copied from the BoosterPurchase row's `sk`
   - `createdAt`: string, ISO 8601 millisecond-precision UTC
2. THE Idempotency_Marker SHALL be written using a `PutItem` with `ConditionExpression: 'attribute_not_exists(pk)'`.
3. WHEN Booster_Service receives a `payment.succeeded` event for a Yoco_Checkout_Id whose Idempotency_Marker already exists, THE Booster_Service SHALL skip the BoosterPurchase write AND SHALL return without raising an error.
4. IF the Idempotency_Marker write succeeds but the subsequent BoosterPurchase row write fails with anything other than `ConditionalCheckFailedException`, THEN THE Booster_Service SHALL delete the Idempotency_Marker before re-throwing, so a retry can re-attempt cleanly. This compensating delete SHALL itself be best-effort: if it fails, the original error SHALL still be re-thrown.
5. THE existing `WEBHOOK#<eventId>` idempotency in Yoco_Webhook_Handler SHALL remain in place. The Idempotency_Marker described here is a **second** layer keyed on `yocoCheckoutId`, defending against the case where Yoco issues a new `eventId` for a re-delivery of the same payment.
6. WHEN the same `yocoCheckoutId` is presented twice in any sequence of `payment.succeeded` events, THE total count of BoosterPurchase rows in AppData_Table for that `yocoCheckoutId` SHALL be exactly one.

### Requirement 3: Server-side price-floor enforcement on checkout creation

**User Story:** As an Area Code operator, I want the server to refuse to mint a Yoco checkout for a booster price below the configured floor, so that no future dynamic-pricing bug or client-tampered request can sell a booster below the agreed minimum.

#### Acceptance Criteria

1. WHEN `purchaseBoost` is invoked with a valid `(businessId, nodeId, duration)` triple, THE Booster_Service SHALL compute the price in cents AND SHALL load the current Boost_Price_Floor for that `duration` from the BoostFloor_Row.
2. IF the BoostFloor_Row for the requested `duration` is missing from AppData_Table, THEN THE Booster_Service SHALL fall back to the value in the existing `BOOST_PRICING` const for that `duration` AS the effective floor, AND SHALL emit a single `warn`-level log entry per cold-start identifying the missing row.
3. IF the computed price in cents is less than the effective floor, THEN THE Booster_Service SHALL return a `400 Bad Request` AppError with code `BOOST_BELOW_FLOOR`, message `"Booster price is below the configured floor for this duration"`, AND SHALL NOT call the Yoco checkout API.
4. WHEN the computed price in cents is greater than or equal to the effective floor, THE Booster_Service SHALL proceed to create the Yoco checkout as it does today.
5. THE initial seed value of EACH BoostFloor_Row SHALL equal the corresponding entry in the existing `BOOST_PRICING` const at the moment the spec is implemented (`2hr`=2500, `6hr`=5000, `24hr`=15000), so launch behaviour is unchanged.
6. THE `currency` field of a BoostFloor_Row SHALL be `ZAR`. IF a future Boost_Duration is added with a non-ZAR currency, the floor enforcement SHALL be extended in a follow-up spec; this spec does not handle multi-currency.
7. THE price-floor enforcement SHALL run inside the existing `business-handler` Lambda. No new always-on resources are introduced.

### Requirement 4: Boost price floor data model and admin editor

**User Story:** As an admin, I want to change the booster price floor per duration without redeploying code, so that we can react to market signals or a Yoco fee change inside an hour.

#### Acceptance Criteria

1. EACH BoostFloor_Row SHALL contain the following fields with the listed types:
   - `pk`: string, value `BOOST_FLOOR`
   - `sk`: string, one of `2hr`, `6hr`, `24hr`
   - `duration`: string, equal to `sk`
   - `floorCents`: integer, value greater than 0
   - `currency`: string, value `ZAR`
   - `updatedAt`: string, ISO 8601 millisecond-precision UTC
   - `updatedBy`: string, the admin's Cognito sub at the time of the update
2. THE Floor_Editor SHALL render the three durations and their current `floorCents` values, fetched via an authenticated admin endpoint that returns the BoostFloor_Rows.
3. WHEN the admin submits an update via the Floor_Editor, THE admin endpoint SHALL validate that the requested `floorCents` is an integer in the inclusive range `[1, 1000000]` (i.e. between 0.01 ZAR and 10000.00 ZAR). IF the value is outside this range or not an integer, THEN THE endpoint SHALL return `400 Bad Request` AND SHALL NOT persist the change.
4. WHEN the admin endpoint accepts an update, THE admin endpoint SHALL write the updated BoostFloor_Row, refresh `updatedAt` and `updatedBy`, AND SHALL write a Floor_Change_Audit_Row per R5 in the same operation, ordered such that the audit row is durable before the operator-facing read sees the new value (sequential write of audit row, then BoostFloor_Row).
5. THE admin endpoint SHALL require a JWT whose claims map to an admin role; non-admin requests SHALL be rejected with `403 Forbidden`.
6. WHEN the admin endpoint is called with a `duration` outside `{ '2hr', '6hr', '24hr' }`, THE endpoint SHALL return `400 Bad Request` AND SHALL NOT persist anything.
7. THE Floor_Editor SHALL display the change-audit history (R5) alongside the current floor for each duration, sorted newest-first.
8. WHILE the BoostFloor_Row for a duration has not been seeded yet, THE Floor_Editor SHALL render the `BOOST_PRICING` const value as the effective floor AND SHALL label it as "default — never edited" so the admin understands the row is implicit.

### Requirement 5: Floor change audit trail

**User Story:** As an admin, I want every floor change recorded with who, what, and when, so that disputes about historical pricing can be settled from the audit row alone.

#### Acceptance Criteria

1. EACH Floor_Change_Audit_Row SHALL contain the following fields with the listed types:
   - `pk`: string, value `BOOST_FLOOR_AUDIT#<duration>`
   - `sk`: string, value `<changedAt_iso>#<changeId>` where `changeId` is a UUID v4
   - `duration`: string, copied from the BoostFloor_Row
   - `previousFloorCents`: integer OR `null` if this is the first time the floor has been set
   - `newFloorCents`: integer
   - `currency`: string, value `ZAR`
   - `changedBy`: string, the admin's Cognito sub
   - `changedByEmail`: string, the admin's email address at the time of the change, length 3-254
   - `changedAt`: string, ISO 8601 millisecond-precision UTC
   - `changeReason`: string of length 1-280 OR `null` (a free-text reason the admin may optionally provide)
2. THE Floor_Change_Audit_Row SHALL be written before the BoostFloor_Row update is acknowledged to the caller, so the audit precedes any reader observation of the new floor.
3. IF the Floor_Change_Audit_Row write fails, THEN THE BoostFloor_Row update SHALL NOT be performed AND the admin endpoint SHALL return `500 Internal Server Error`.
4. THE Floor_Change_Audit_Row SHALL be retained for the POPIA_Retention_Period and SHALL NOT carry a DynamoDB `ttl` attribute.
5. WHEN the admin loads the Floor_Editor, THE editor SHALL display the most recent 25 Floor_Change_Audit_Row entries per duration, paginated.

### Requirement 6: Operator-facing recent boost purchases panel

**User Story:** As a business operator, I want to see what I have spent on boosters and when, so that I can reconcile my own books against Yoco without contacting support.

#### Acceptance Criteria

1. THE Operator_Boost_Panel SHALL be reachable from the existing business portal `/boost` route as a "Recent purchases" section beneath the existing buy-a-boost form.
2. THE Operator_Boost_Panel SHALL fetch the authenticated business's BoosterPurchase rows via an authenticated business endpoint that queries by `pk = BOOST#<businessId>` and returns rows sorted by `paidAt` descending.
3. THE business endpoint SHALL require a JWT whose `businessId` claim equals the path-level `businessId`. IF the JWT claim does not match the path-level `businessId`, THEN THE endpoint SHALL return `403 Forbidden` AND SHALL NOT return any rows.
4. THE business endpoint SHALL paginate at 25 rows per page and SHALL return a `nextCursor` derived from the last row's `sk`. IF the requested cursor is malformed, THEN the endpoint SHALL return `400 Bad Request`.
5. THE Operator_Boost_Panel SHALL render each row as: `paidAt` (formatted `YYYY-MM-DD HH:mm` in `Africa/Johannesburg`), `nodeId` resolved to the human-readable node name via the existing nodes lookup, `duration`, and `amountCents` formatted as `R<X>.<YY>`.
6. THE Operator_Boost_Panel SHALL NOT display the `floorAtPurchaseCents` snapshot, the `tierSnapshot`, or the `neighbourhoodIdSnapshot` to the operator. These fields exist for ops and future-pricing use only.
7. THE Operator_Boost_Panel SHALL NOT display pulse-impact or check-in-impact metrics for individual boosters in this spec; that capability belongs to the `venue-intelligence-reports` feature.
8. WHILE a business has zero BoosterPurchase rows, THE Operator_Boost_Panel SHALL render an empty-state with the copy "No booster purchases yet."

### Requirement 7: Admin cross-business booster report

**User Story:** As an Area Code admin handling a refund or dispute, I want to query booster purchases across all businesses by date range and by `yocoCheckoutId`, so that I can find a specific payment in seconds.

#### Acceptance Criteria

1. THE Admin_Boost_Report SHALL be a new screen under `apps/admin/src/screens/` reachable from the admin dashboard nav.
2. THE Admin_Boost_Report SHALL fetch BoosterPurchase rows via an authenticated admin endpoint that supports two query modes:
   - Date-range mode: `?from=<iso8601>&to=<iso8601>` issued as a `Query` against GSI1 with `gsi1pk = 'BOOST_BY_TIME'` and a `gsi1sk BETWEEN :from AND :to` condition.
   - Single-payment mode: `?yocoCheckoutId=<id>` issued as a `GetItem` against the Idempotency_Marker (`pk = BOOST_CHECKOUT#<id>`), then a follow-up `GetItem` for the BoosterPurchase row using the marker's stored `boostPk` and `boostSk`.
3. THE admin endpoint SHALL require a JWT whose claims map to an admin role; non-admin requests SHALL be rejected with `403 Forbidden`.
4. WHEN both `from`/`to` and `yocoCheckoutId` are supplied, THE admin endpoint SHALL first validate the date range against R7.5, AND IF the date range is valid (or both `from` and `to` are absent), THEN THE endpoint SHALL fall back to single-payment mode using `yocoCheckoutId` and return at most one row. IF the date range is malformed per R7.5, THEN THE endpoint SHALL return `400 Bad Request` AND SHALL NOT fall back to single-payment mode, so a malformed query never silently masquerades as a single-payment lookup.
5. WHEN the date range mode receives a `from` later than `to` OR a `to` more than 367 days after `from`, THE admin endpoint SHALL return `400 Bad Request` immediately AND SHALL NOT issue a DynamoDB Query, regardless of whether the underlying query would have produced results. The 367-day cap reflects the cost of a single GSI Query and is intentionally one full year plus a day to allow exact year-on-year comparisons.
6. THE Admin_Boost_Report SHALL render each row with the same fields as the Operator_Boost_Panel plus `businessId`, `tierSnapshot`, `neighbourhoodIdSnapshot`, `floorAtPurchaseCents`, AND `yocoCheckoutId`.
7. THE Admin_Boost_Report SHALL provide a one-click action to copy `yocoCheckoutId` to the clipboard so an admin can paste it into the Yoco merchant dashboard for refund.

### Requirement 8: Retention and POPIA alignment

**User Story:** As the platform's data steward, I want booster audit data retained for the same period as other financial records, so that we satisfy SARS, the Companies Act, and POPIA without ad-hoc decisions per table.

#### Acceptance Criteria

1. THE POPIA_Retention_Period for BoosterPurchase rows AND Floor_Change_Audit_Rows SHALL be 7 years from `paidAt` (for BoosterPurchase) or `changedAt` (for Floor_Change_Audit_Rows).
2. THE BoosterPurchase row and the Floor_Change_Audit_Row SHALL NOT carry a DynamoDB `ttl` attribute, since DynamoDB TTL targets short-lived data and would risk premature deletion of legally-required records under clock skew or attribute-name drift.
3. THE existing `cleanup` worker (`backend/src/workers/cleanup.ts`) SHALL be extended in implementation to delete BoosterPurchase rows whose `paidAt` is older than the POPIA_Retention_Period AND Floor_Change_Audit_Rows whose `changedAt` is older than the POPIA_Retention_Period. This is a future-scheduled deletion path; the first deletions will not run for at least 7 years.
4. NO BoosterPurchase row SHALL ever contain a phone number, SMS opt-in flag, or any other field that would re-introduce a phone-based identifier.
5. NO BoosterPurchase row SHALL contain consumer-level personal data. The audit captures merchant-side commercial data only (business → Area Code transaction).
6. THE Idempotency_Marker rows SHALL be retained for the POPIA_Retention_Period for the same reason as BoosterPurchase rows.

### Requirement 9: Backwards compatibility, rollout, and observability

**User Story:** As an operator rolling this out before launch, I want a safe staged path that does not break existing booster purchases on day one, so that we can ship the audit and the floor without coupling them to dynamic pricing.

#### Acceptance Criteria

1. THE existing `purchaseBoost` API contract SHALL be unchanged when the floor equals the corresponding `BOOST_PRICING` const value. Existing clients SHALL continue to receive the same `checkoutUrl`, `amountCents`, `currency`, and `metadata` fields they do today.
2. THE existing `BOOST_PRICING` const in `backend/src/features/business/types.ts` SHALL remain in place as the source of truth for the **price** during this spec. The Boost_Price_Floor introduced here SHALL gate **only** the lower bound and SHALL NOT replace `BOOST_PRICING` as the price source.
3. WHEN Booster_Service emits a structured log, THE log entry SHALL include a `branch` field with one of these values: `floor_loaded_from_dynamo`, `floor_loaded_from_const_fallback`, `floor_violation_rejected`, `purchase_audit_written`, `purchase_audit_duplicate_yoco_checkout_id`, `purchase_audit_duplicate_event_id`. The log entry SHALL be sampled at no less than 1 in 100 in production so an operator can answer "why did this booster checkout get rejected" without re-running the request locally.
4. THE feature SHALL ship without a separate runtime feature flag. The audit-write path is purely additive (no existing code path observes its absence) and the floor enforcement is seeded equal to `BOOST_PRICING` so the rejection branch never fires on day one. Rollback SHALL be performed by reverting the deploy.
5. THE Booster_Service SHALL emit a CloudWatch metric named `BoostFloorViolation` with dimensions `{ duration, businessId }` whenever a checkout is rejected for being below the floor. The metric SHALL be emitted only on actual violations; no zero-count "heartbeat" emission SHALL be added. IF the metric emission itself fails (e.g. CloudWatch API error), THEN THE Booster_Service SHALL still reject the checkout per R3.3 — the rejection SHALL NOT be conditional on metric emission succeeding. The existing CloudWatch alarm wiring SHALL be extended to alert on a non-zero count over a 5-minute window, since a non-zero count under static-pricing assumptions implies either client tampering or a misconfigured floor.
6. THE Booster_Service SHALL emit a CloudWatch metric named `BoostPurchaseAuditMissing` with dimensions `{ duration }` whenever a `payment.succeeded` event with `metadata.type === 'boost'` is observed but the BoosterPurchase write fails (counts the re-throw branch in R1.5). This metric SHALL alert on a non-zero count over a 5-minute window.
7. THE existing CloudWatch alarm topic SHALL be the destination for both alarms above, consistent with the rest of the backend's alarm wiring.

### Requirement 10: Property-based correctness for floor enforcement and idempotency

**User Story:** As a developer, I want property-based tests for the floor check, the audit write, and the webhook idempotency, so that the launch promises hold across the input space rather than just on the examples I happened to think of.

#### Acceptance Criteria

1. WHEN the floor-check function is invoked with any `(duration, computedPriceCents, floorCents)` triple where `duration ∈ { '2hr', '6hr', '24hr' }`, `computedPriceCents` is an integer in `[0, 10_000_000]`, and `floorCents` is an integer in `[1, 1_000_000]`, THE function SHALL return "accept" if and only if `computedPriceCents >= floorCents`.
2. WHEN the BoosterPurchase write function is invoked twice with the same `yocoCheckoutId` against the same DynamoDB state, THE total count of BoosterPurchase rows for that `yocoCheckoutId` SHALL be exactly one regardless of write order, and the second invocation SHALL return without raising.
3. WHEN any sequence of `payment.succeeded` events with `metadata.type === 'boost'` is replayed through the Yoco_Webhook_Handler, the multiset of BoosterPurchase rows in AppData_Table SHALL equal the multiset of distinct `yocoCheckoutId` values in the input sequence.
4. WHEN a BoosterPurchase row is round-tripped through `serialize(deserialize(row))` via the JSON shape used for the API response, THE result SHALL be deeply equal to the input row.
5. WHEN any sequence of admin floor updates is replayed through the admin endpoint with arbitrary distinct `(duration, floorCents)` pairs, THE final BoostFloor_Row for each touched duration SHALL equal the last requested value AND THE Floor_Change_Audit_Row count for that duration SHALL equal the number of accepted updates for that duration.
6. WHEN the admin endpoint receives a sequence of update requests with `floorCents` values both inside and outside the inclusive `[1, 1_000_000]` range, THE accepted count of changes SHALL equal the count of in-range requests AND THE rejected count SHALL equal the count of out-of-range requests.

## Validated Correctness Properties

| Property                                       | For all…                                                                                                                | Holds when                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Floor accepts iff `price >= floor`             | `(duration, computedPriceCents, floorCents)` with `computedPriceCents ∈ [0, 10_000_000]`, `floorCents ∈ [1, 1_000_000]` | Floor-check function returns "accept" iff `computedPriceCents >= floorCents`             |
| Webhook idempotence on `yocoCheckoutId`        | sequence of `payment.succeeded` events with `metadata.type === 'boost'`                                                 | BoosterPurchase rows in AppData_Table = distinct `yocoCheckoutId` values in input        |
| BoosterPurchase JSON round-trip                | valid BoosterPurchase row                                                                                               | `deserialize(serialize(row))` deeply equals `row`                                        |
| Floor update replays converge                  | sequence of admin floor updates with arbitrary `(duration, floorCents)` pairs                                           | Final BoostFloor_Row per touched duration equals last accepted value                     |
| Floor audit row count matches accepted updates | sequence of admin floor updates                                                                                         | Floor_Change_Audit_Row count per duration equals accepted update count for that duration |
| Floor input validation                         | sequence of update requests, in-range and out-of-range                                                                  | Accepted = in-range count, rejected = out-of-range count                                 |
