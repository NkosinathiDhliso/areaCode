# Implementation Plan: Billing and Revenue Integrity

## Overview

Bottom-up: pure date arithmetic and schemas first, then the repository layer,
then the webhook activation path with its idempotency choreography, then the
lifecycle workers, then the read paths (tier resolver unification, boost
exposure), then the three frontend surfaces, then infra/scripts, then docs and
compliance close-out. Everything stays inside the existing Lambdas and tables.
The `push-sender` queue is deleted, not deprecated. No SMS, no phone-OTP, no
new always-on resources.

Order matters at the seams: R1 (secret provisioning) is independent and can
ship first on its own; nothing else in this spec is observable in prod until
it does.

## Tasks

- [x] 1. Provision and guard payment configuration (R1)
  - [x] 1.1 Add `yoco_webhook_secret` to prod provisioning and document it
    - Add the tfvars entry (value supplied out-of-band), document source and
      rotation in `docs/DEPLOY.md`
    - _Requirements: 1.1_
  - [x] 1.2 Add Payment_Config_Guard and remove the dev-key fallback
    - Startup throw in prod when `YOCO_WEBHOOK_SECRET` is empty, in the module
      that reads it (API Lambda and webhook Lambda paths)
    - `createYocoCheckout`: explicit env branch, prod reads only
      `YOCO_PROD_SECRET_KEY`, no `??` chain
    - Unit tests: prod-missing throws at startup, dev path unaffected
    - _Requirements: 1.2, 1.3_
  - [x] 1.3 Extend `scripts/go-live-check.ps1` with secret-presence checks
    - `lambda get-function-configuration` assertions for
      `YOCO_WEBHOOK_SECRET` and `YOCO_PROD_SECRET_KEY`, FAIL when empty
    - _Requirements: 1.4, 10.1_

- [x] 2. Types, schemas, and pure date arithmetic (R2)
  - [x] 2.1 Extend `backend/src/features/business/types.ts`
    - `subscriptionPaymentRowSchema`, `subCheckoutMarkerRowSchema`, view
      types, `PAID_INTERVALS`, `SUBSCRIPTION_GRACE_DAYS = 7`
    - Pure `addPaidInterval(fromIso, interval)` with calendar clamping
    - Remove `yocoCustomerId` from the auth business type
    - _Requirements: 2.2, 2.3, 4.1_
  - [x] 2.2 Write property test for Paid_Until arithmetic
    - Property 1: total, monotone, month-end clamped, renewal never shortens
    - _Requirements: 2.3_

- [x] 3. Repository layer (R2, R3, R5)
  - [x] 3.1 Subscription payment rows in `repository.ts`
    - `putSubscriptionPaymentWithMarker` (mirror booster choreography:
      marker-first conditional puts, compensating delete, duplicate result)
    - `getSubCheckoutMarker`, `querySubscriptionPaymentsForBusiness`,
      `querySubscriptionPaymentsByTimeRange`
    - Delete `setYocoCustomerId`
    - _Requirements: 2.2, 2.4, 4.1, 7.5, 8.1_
  - [x] 3.2 Business activation and lapse queries
    - `activateSubscriptionOnBusiness` single UpdateItem (tier, paidUntil,
      paidInterval, trialEndsAt null, paymentGraceUntil null)
    - `listBusinessesWithLapsedPaidUntil` (paid tier, lapsed, no grace set)
    - `GET /v1/business/me` repository read includes the new fields
    - _Requirements: 2.1, 2.6, 3.1_
  - [x] 3.3 `setNodeBoostWindow` on the nodes repository
    - `UpdateItem` with max-merge semantics on `boostUntil`
    - _Requirements: 5.1_
  - [x] 3.4 Write property test for subscription row JSON round-trip
    - Property 6: round-trip equality, no TTL/phone/SMS fields
    - _Requirements: 2.2_

- [x] 4. Webhook subscription activation (R2)
  - [x] 4.1 Rewrite the subscription branch of `handlePaymentSucceeded`
    - Shape-validate plan and interval, throw on malformed (Yoco retries)
    - Marker, audit row with `paidUntilProduced`, then
      `activateSubscriptionOnBusiness`, with the replay reconciliation branch
      from design Flow 1
    - _Requirements: 2.1, 2.2, 2.4, 2.5_
  - [x] 4.2 Unit tests for activation
    - Happy path, duplicate checkout replay, malformed metadata, crash
      injection between marker, row, and business update
    - _Requirements: 2.4, 2.5_
  - [x] 4.3 Write property test for activation idempotence
    - Property 2: one row, one window, under arbitrary re-delivery schedules
    - _Requirements: 2.4_

- [x] 5. Tier resolver unification (R4)
  - [x] 5.1 Extend `getEffectiveTier` to the window algebra
    - trial OR paidUntil OR grace active resolves the stored paid tier;
      otherwise starter; delete the `yocoCustomerId` check
    - Update all existing call sites for the signature; reports handler
      switches from raw tier to the resolver
    - Add the R4.3 design-note comments at the two stored-tier map filter
      sites
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 5.2 Write property test for the resolver window algebra
    - Property 3
    - _Requirements: 4.1_

- [x] 6. Lifecycle workers (R3)
  - [x] 6.1 Lapse_Sweep in the cleanup worker
    - Phase 1: lapsed paidUntil sets grace and sends one SES renewal email;
      phase 2 stays the existing `enforceLapsedPayments`
    - Unit tests: phase transitions, idempotence, one email per lapse
    - _Requirements: 3.1, 3.2, 3.3, 3.6_
  - [x] 6.2 Renewal reminder in the trial-reminder worker
    - Paid tier, monthly/yearly, `paidUntil` within 7 days, dedupe via
      `renewalReminderSentFor`
    - _Requirements: 3.4_

- [x] 7. Boost activation end to end (R5)
  - [x] 7.1 Set Boost_Window from the boost webhook branch
    - Call `setNodeBoostWindow` after the audit row lands; idempotent under
      re-delivery
    - _Requirements: 5.1_
  - [x] 7.2 Expose `boostUntil` / computed `boostActive` on node reads
    - Nodes service and city payloads; shared Node type
    - _Requirements: 5.2, 5.5_
  - [x] 7.3 Consume `boostActive` in vibeRank level 3
    - Comparator `(boostActive desc, tierWeight desc)` within level 3 only;
      Constellation cap tiebreak only, no beam visual change
    - _Requirements: 5.3, 5.4_
  - [x] 7.4 Write property tests for boost ranking and window
    - Property 4 (never crosses levels) and Property 5 (read model)
    - _Requirements: 5.3, 5.5_

- [x] 8. Business API surface (R2, R7, R8)
  - [x] 8.1 `GET /v1/business/me` returns `paidUntil` and `paidInterval`
    - _Requirements: 2.6_
  - [x] 8.2 `GET /v1/business/subscription-payments` (business scope)
    - Pagination and shape per the boost purchases endpoint
    - _Requirements: 7.5_
  - [x] 8.3 `GET /v1/admin/subscription-payments?from&to` (admin scope)
    - `SUB_BY_TIME` range query, range validation, `requireAuth('admin')`
    - _Requirements: 8.1, 8.2_

- [x] 9. PlansPanel truth and return flow (R6, R7)
  - [x] 9.1 Billing status header
    - Paid-until, grace-with-renew-CTA, trial countdown; extract
      `BillingStatusBanner` if the panel exceeds component limits
    - _Requirements: 7.1, 7.6_
  - [x] 9.2 Checkout return handling
    - Read Checkout_Return_Status, activating poll (2s, max 60s), confirmed /
      honest-timeout / cancelled / failed states, strip the param, disable
      purchase buttons while polling
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 9.3 Copy and coverage fixes
    - Trial banner drops "add a payment method"; cancel modal states map
      removal; add the weekly payg purchase action
    - _Requirements: 7.2, 7.3, 7.4_
  - [x] 9.4 Subscription payment history section
    - `SubscriptionHistoryPanel` following `BoostPurchasesPanel`
    - _Requirements: 7.5_
  - [x] 9.5 Component tests (jsdom) for the return-status state machine
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 10. BoostPanel return flow and active state (R5, R6)
  - [x] 10.1 Return-status poll against the boost purchases list
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 10.2 "Boost active until" display per node from `boostUntil`
    - _Requirements: 5.6_

- [x] 11. Admin subscription payments screen (R8)
  - [x] 11.1 Screen next to the existing admin boost report, same pagination
    - _Requirements: 8.1, 8.2_

- [x] 12. Report-ready notifications on the live path (R9)
  - [x] 12.1 Replace the SQS enqueue in `reports/generator.ts`
    - Deliver via the existing web-push module and/or SES email; failures
      logged, report persistence unaffected
    - _Requirements: 9.1, 9.3_
  - [x] 12.2 Delete the `push-sender` queue and its attachments
    - Terraform module, IAM statements, env vars, DLQ alarm, outputs; drop the
      go-live-check DLQ line in the same change
    - _Requirements: 9.2_

- [x] 13. Go-live check billing coverage (R10)
  - [x] 13.1 Unsigned-POST probe against the webhook route expects 401
    - _Requirements: 10.2_
  - [x] 13.2 Update pilot checklist §1.3 to the shipped UI wording
    - _Requirements: 10.3_

- [x] 14. Edge-protection decision close-out (R11)
  - [x] 14.1 Delete the ALB association from `infra/modules/waf`
    - _Requirements: 11.3_
  - [x] 14.2 Record the CloudFront+WAF decision and compensating controls
    - `docs/GO_LIVE_AUDIT.md` follow-ups; build gated on founder cost approval
    - _Requirements: 11.1, 11.2_

- [x] 15. Compliance and copy alignment (R12)
  - [x] 15.1 Execute and record POPIA close-outs (churn-defences 23.1-23.3)
    - _Requirements: 12.1_
  - [x] 15.2 Add the tier-permanence clause to `docs/PRIVACY.md`
    - _Requirements: 12.2_
  - [x] 15.3 Fix `SALES_PITCH.md` payg posture and launch-scale report claims
    - _Requirements: 12.3_
  - [x] 15.4 Update `PILOT_LAUNCH_CHECKLIST.md` and go-live follow-ups
    - _Requirements: 12.4_

- [x] 16. End-to-end billing sweep
  - [x] 16.1 Playwright: plans page renders billing states; cancelled and
        failed return paths show their messages (mock return params)
  - [x] 16.2 Manual launch-morning gate: Yoco test card R1 checkout flips the
        dashboard to "plan badge plus paid-until" within 60 seconds (stays §1.3)
