# Design Document

## Overview

### Goals

- Make the prod payment pipeline deliverable end to end: secret provisioned,
  webhook verified, activation correct, expiry real, renewal possible.
- Give every rand a durable audit row and every purchase a real product
  effect (subscription window, boost window).
- Collapse tier resolution to one resolver for feature gating, with storage
  demotion as the single map-removal mechanism.
- Make the business portal tell the truth about billing state, before, during,
  and after a checkout.
- Deliver report-ready notifications on the one live path and delete the dead
  queue.

### Non-Goals (out of scope)

- Tokenised recurring billing (card vault, auto-charge). V1 renewal is a
  manual re-checkout, prompted by email and by the portal.
- Refunds, chargebacks, invoicing PDFs, VAT handling.
- Dynamic boost pricing (covered by `booster-pricing-floor-and-audit`).
- Consumer offline check-in retry (platform audit C4).
- Building CloudFront+WAF (decision recorded, build gated on founder cost
  approval, R11).

### Architectural Constraints (binding)

- Serverless only. All new state is attributes on existing DynamoDB tables or
  rows in `AppData_Table` (`PAY_PER_REQUEST`). No new queues, workers, or
  always-on resources; one queue is deleted.
- Handler to service to repository layering. Webhook logic stays in
  `Billing_Service`; DynamoDB stays in the repositories.
- No fallbacks, no legacy: the dev-key `??` chain, the dead `yocoCustomerId`
  concept, and the consumer-less `push-sender` queue are deleted, not kept.
- Discovery DNA and honest presence: a boost may never outrank taste or
  aliveness and may never fake activity. Boost participates only at the
  existing level-3 tier signal and the Constellation cap tiebreak.
- No SMS, no phone-OTP anywhere in this spec.

## Architecture

### Component map

```
Yoco ── payment.succeeded ──> webhook Lambda ──> processYocoWebhook
                                                    │
                     ┌──────────────────────────────┼─────────────────────────┐
                     ▼                              ▼                         ▼
        subscription branch                 boost branch (exists)      payment.failed
        - update Business_Row               - BoosterPurchase row      - grace (exists)
          tier/paidUntil/paidInterval,      - Sub of this spec:
          clear trial + grace                 set node Boost_Window
        - Subscription_Payment_Row
          + Sub_Checkout_Marker

cleanup worker (daily, exists)
  └─ Lapse_Sweep: paidUntil lapsed  -> set Grace_Window + renewal email
     grace lapsed (exists)          -> deactivateForNonPayment

trial-reminder worker (exists)
  └─ extended: renewal reminder at Paid_Until - 7d (monthly/yearly)

reports generator (exists)
  └─ Report_Ready_Notification via web push / SES (queue enqueue removed)

business portal
  ├─ PlansPanel: billing status, return-status poll, renew CTA, payg weekly,
  │              payment history
  └─ BoostPanel: return-status poll, active Boost_Window display

consumer web
  └─ vibeRank level 3 consumes boostActive; markers/beams per constraints
```

### Request flows

**Flow 1: subscription activation.** Yoco posts `payment.succeeded` with
`metadata { businessId, plan, interval, type: 'subscription' }`. After the
existing signature and eventId idempotency gates, the subscription branch:

1. Shape-validates plan and interval (throw = non-2xx = Yoco retry).
2. Writes Sub_Checkout_Marker (`attribute_not_exists`); duplicate marker means
   an already-processed checkout, return without touching state.
3. Writes Subscription_Payment_Row (same two-step choreography, compensating
   delete on non-conditional failure, as BoosterPurchase).
4. Computes Paid_Until from `max(now, existing paidUntil)` plus the interval
   (calendar-month/year arithmetic clamped to month end).
5. Updates Business_Row in one `UpdateItem`: `tier`, `paidUntil`,
   `paidInterval`, `trialEndsAt = null`, `paymentGraceUntil = null`.

Ordering note: marker and audit row precede the Business_Row update. A crash
between steps 3 and 5 is healed by the Yoco retry: the marker read detects the
duplicate, and a small reconciliation branch re-asserts the Business_Row state
idempotently (same target values, no second window extension, because
Paid_Until is recomputed from the audit row's own `paidAt`, not from `now`).
The audit row therefore stores `paidUntilProduced` so replays are exact.

**Flow 2: boost activation.** Inside the existing boost audit branch, after
the audit row lands: `UpdateItem` on the node sets
`boostUntil = max(existing boostUntil, paidAt + duration)`. Idempotent because
`max` is; safe under re-delivery because the audit path already dedupes.

**Flow 3: lapse.** Daily cleanup worker runs the Lapse_Sweep before the
existing `enforceLapsedPayments`:

- Select businesses with paid tier, `paidUntil < now`, no active trial, and
  `paymentGraceUntil` absent. Set `paymentGraceUntil = now + 7d`, send one
  renewal email (SES module), log.
- The existing `listBusinessesWithLapsedGrace` then demotes anyone whose grace
  has passed, via `deactivateForNonPayment`. No new demotion code.

**Flow 4: checkout return.** Portal reads Checkout_Return_Status on mount.
`success` enters an activating state: poll every 2s, up to 60s, until
`/v1/business/me` shows the expected tier and a `paidUntil >= now` (plans), or
the newest boost purchase row shows the checkout (boost). Then a confirmed
banner. Timeout shows an honest pending message. `cancelled` / `failed` show
their messages. The param is stripped with `history.replaceState` so refresh
does not replay.

### Why this shape

- Reusing the booster audit choreography keeps one idempotency idiom in the
  codebase instead of two subtly different ones.
- Paid_Until on the Business_Row (not a separate subscription entity) matches
  the single-table access pattern: every gate already loads the business row.
- Grace reuses `paymentGraceUntil` and the existing demotion sweep, so
  "business leaves the map" keeps exactly one home.
- Boost expiry computed at read time needs no worker, cannot drift, and scales
  to zero.
- Manual renewal first: it needs zero new Yoco capability, and the reminder
  email plus portal CTA is the smallest honest lifecycle. A card vault can
  replace the reminder later without schema change (Paid_Until stays).

## Components and Interfaces

### Backend: `backend/src/features/business/`

- `types.ts`: `subscriptionPaymentRowSchema`, `subCheckoutMarkerRowSchema`,
  view types, `PAID_INTERVALS` union, `addPaidInterval(fromIso, interval)`
  pure date arithmetic, `SUBSCRIPTION_GRACE_DAYS = 7`.
- `repository.ts`: `putSubscriptionPaymentWithMarker` (mirror of the booster
  function), `getSubCheckoutMarker`, `querySubscriptionPaymentsForBusiness`,
  `querySubscriptionPaymentsByTimeRange`, `activateSubscriptionOnBusiness`
  (single UpdateItem from Flow 1 step 5), `listBusinessesWithLapsedPaidUntil`,
  `setNodeBoostWindow`. Delete `setYocoCustomerId`.
- `service.ts`: subscription branch of `handlePaymentSucceeded` per Flow 1;
  `getEffectiveTier(biz, nowMs?)` extended per R4.1; `startLapseSweep`
  composed into the cleanup worker entry; Payment_Config_Guard on the module
  that reads `YOCO_WEBHOOK_SECRET`; `createYocoCheckout` prod/dev key branch.
- `handler.ts`: `GET /v1/business/me` includes `paidUntil` / `paidInterval`;
  `GET /v1/business/subscription-payments` (business scope);
  `GET /v1/admin/subscription-payments?from&to` (admin scope) following the
  admin boost report handler.

### Backend: other features

- `reports/handler.ts`: swap raw tier for Tier_Resolver.
- `reports/generator.ts`: replace SQS enqueue with the existing web-push and
  SES email modules; failures logged, never fatal to report persistence.
- `nodes/`: expose `boostUntil` and computed `boostActive` on venue payloads;
  add the R4.3 design-note comments at both stored-tier filter sites.
- `workers/`: cleanup worker calls `startLapseSweep` before
  `enforceLapsedPayments`; trial-reminder worker gains the renewal-reminder
  query (paid tier, `paidUntil` within 7 days, interval monthly/yearly, one
  send per window recorded on the row as `renewalReminderSentFor = paidUntil`).

### Frontend

- `packages/shared/types`: Node gains `boostUntil?` / `boostActive?`;
  business profile type gains `paidUntil` / `paidInterval`.
- `apps/web/src/lib/carouselRanking.ts`: level-3 comparator becomes
  `(boostActive desc, tierWeight desc)`; property tests extended to assert a
  boost can never cross level 1 or 2.
- `apps/web` markers/beams: Boost may only join the cap tiebreak at
  Constellation zoom, no visual change driven by boost.
- `apps/business/PlansPanel.tsx`: billing status header (paid-until, grace,
  trial), return-status poll, renew CTA, payg weekly button, honest cancel
  copy, payment history section (pattern: `BoostPurchasesPanel`). If the panel
  exceeds component limits, extract `BillingStatusBanner` and
  `SubscriptionHistoryPanel` components.
- `apps/business/BoostPanel.tsx`: return-status poll and "Boost active until"
  state per node.
- `apps/admin`: subscription payments report screen next to the boost report.

### Infra and scripts

- `infra/environments/prod`: provision `yoco_webhook_secret` (tfvars entry,
  documented rotation in DEPLOY.md). Remove `module.sqs_push_sender`, its IAM
  statements, env vars, DLQ alarm, and outputs. Delete the ALB association in
  `infra/modules/waf`.
- `scripts/go-live-check.ps1`: secret-presence checks (R1.4), unsigned-POST
  401 probe (R10.2), drop the push-sender DLQ line.

## Data Models

### `Subscription_Payment_Row` (AppData_Table)

| field             | type   | value                                        |
| ----------------- | ------ | -------------------------------------------- |
| pk                | string | `SUB#<businessId>`                           |
| sk                | string | `SUB#<paidAt_iso>#<yocoCheckoutId>`          |
| gsi1pk            | string | `SUB_BY_TIME`                                |
| gsi1sk            | string | `paidAt_iso`                                 |
| businessId        | string | 1-64                                         |
| plan              | string | `growth` \| `pro` \| `payg`                  |
| interval          | string | `monthly` \| `yearly` \| `daily` \| `weekly` |
| amountCents       | int    | > 0                                          |
| currency          | string | `ZAR`                                        |
| yocoCheckoutId    | string | 1-128                                        |
| paidAt            | string | ISO 8601 ms UTC                              |
| paidUntilProduced | string | ISO 8601 ms UTC (window end this row bought) |
| createdAt         | string | ISO 8601 ms UTC                              |

No TTL (7-year financial retention, cleanup worker manages, same as boosts).
No phone or SMS fields.

### `Sub_Checkout_Marker` (AppData_Table)

`pk = sk = SUB_CHECKOUT#<yocoCheckoutId>`, plus `subPk` / `subSk` back-pointers
and `createdAt`. Same semantics as `BOOST_CHECKOUT#`.

### Business_Row additions

`paidUntil?: string|null`, `paidInterval?: string|null`,
`renewalReminderSentFor?: string|null`. `paymentGraceUntil` unchanged.
`yocoCustomerId` removed from the type.

### Node addition

`boostUntil?: string|null`. Read paths compute
`boostActive = boostUntil > nowIso`.

### Access patterns

- Business history: Query `pk = SUB#<businessId>`, newest first.
- Admin range: Query GSI1 `gsi1pk = SUB_BY_TIME`, `gsi1sk BETWEEN`.
- Checkout lookup: GetItem `SUB_CHECKOUT#<id>` then GetItem the row.
- Lapse_Sweep: reuses the existing paginated scan shape of
  `listBusinessesWithLapsedGrace` for `paidUntil < now AND
attribute_not_exists(paymentGraceUntil)` on paid tiers. Business volume is
  small; the scan matches the existing pattern and stays PAY_PER_REQUEST.

## Correctness Properties

### Property 1: Paid_Until arithmetic is total and monotone

For all valid `(fromIso, interval)`, `addPaidInterval` returns a valid ISO
instant strictly greater than `fromIso`; month arithmetic clamps (31 Jan +
monthly = 28/29 Feb); renewal from `max(now, paidUntil)` never shortens an
existing window. Property test, min 100 runs.

### Property 2: Activation idempotence

For any sequence of deliveries of the same `yocoCheckoutId` (fresh eventIds,
interleaved crashes injected between marker, row, and business update),
exactly one Subscription_Payment_Row exists and Paid_Until equals the single
`paidUntilProduced`. Mirrors booster Property 2.

### Property 3: Tier_Resolver window algebra

For all combinations of `tier`, `trialEndsAt`, `paidUntil`,
`paymentGraceUntil` relative to `now`: paid tier is returned iff at least one
window is active; free/starter always resolves starter; expired everything
resolves starter. No input throws.

### Property 4: Boost never crosses ranking levels

For all venue pairs where A beats B on taste or aliveness, no assignment of
`boostActive` to B reorders the pair. Within equal level-1 and level-2
signals, `boostActive` orders ahead of tier. Extends the existing vibeRank
property suite.

### Property 5: Boost window read model

For all `(boostUntil, now)`, `boostActive` is true iff `boostUntil > now`;
`max`-merge of overlapping purchases never shortens a window.

### Property 6: Subscription row JSON round-trip

Zod parse of `JSON.parse(JSON.stringify(row))` is deeply equal; no row carries
TTL, phone, or SMS fields.

## Testing Strategy

- Vitest unit tests for the webhook subscription branch (happy, replay,
  malformed metadata, crash-injection reconciliation), Lapse_Sweep phases, and
  renewal-reminder selection.
- Property tests as listed, tagged `Feature: billing-revenue-integrity,
Property N`, min 100 runs, block-statement predicates.
- Component tests (jsdom) for PlansPanel return-status states (activating,
  confirmed, timeout, cancelled, failed) with mocked api module.
- go-live-check additions verified against dev before prod.
- Manual gate retained: pilot checklist §1.3 test-card run on launch morning.
