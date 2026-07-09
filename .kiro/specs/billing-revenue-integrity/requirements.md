# Requirements Document

## Introduction

The 9 July 2026 go-live re-audit verified the platform core (auth, check-in,
rewards, staff, reports, real-time) as healthy: all verification gates pass and
the 5 July prod go-live check is green. What is not healthy is the money path
and the operational surfaces around it. This spec, **Billing and Revenue
Integrity**, closes every verified gap between "a business clicks Subscribe"
and "Area Code reliably collects and honours that payment", plus the adjacent
logical-operation gaps found in the same audit.

Verified defects this spec fixes:

1. **Webhook secret is unset in prod as declared.** `yoco_webhook_secret`
   defaults to `""` in `infra/environments/prod/main.tf`, is absent from
   `terraform.tfvars`, and `scripts/deploy-serverless.ps1` injects no
   `TF_VAR_` for it. `processYocoWebhook` correctly fails closed, so every
   payment webhook is rejected and no payment ever lands.
2. **A paying business is silently downgraded 14 days after signup.**
   `handlePaymentSucceeded` sets the tier but never clears `trialEndsAt`, and
   the `yocoCustomerId` escape hatch in `getEffectiveTier` is dead code
   (`setYocoCustomerId` has zero callers). Once `trialEndsAt` passes, staff
   capacity, reward multipliers, and campaign quotas clamp a paid business to
   starter.
3. **There is no month 2.** A Yoco checkout is one-time. No `paidUntil` exists
   anywhere, nothing expires a paid tier, nothing renews it, and a R99
   Pay-as-you-go day pass grants the tier forever. Pilot checklist §1.3's pass
   condition ("Pro · paid until ...") references data and UI that do not exist.
4. **A paid boost does nothing.** The webhook writes the audit row (per
   `booster-pricing-floor-and-audit`) but no boost state is ever written to the
   node, nothing in ranking or presentation consumes a boost, and the boost
   never expires because it never starts.
5. **Tier resolution is split-brained.** Staff caps, rewards, and campaigns use
   `getEffectiveTier`; reports (`reports/handler.ts`) and the consumer map
   (`nodes/repository.ts`, `nodes/service.ts`) use the raw stored tier. The
   same business can be growth on one read path and starter on another.
6. **Checkout returns into a void.** Yoco redirects back to
   `/plans?status=success` and `/boost?status=...`, but `PlansPanel` and
   `BoostPanel` never read the param. The payer sees the same static screen
   with no confirmation, no activation state, no failure message.
7. **Report-ready notifications vanish.** `reports/generator.ts` enqueues to
   the `push-sender` SQS queue, which has no consumer. Businesses are never
   told their intelligence report exists.
8. **`createYocoCheckout` falls back to the dev key** (`YOCO_PROD_SECRET_KEY ??
YOCO_DEV_SECRET_KEY ?? ''`), a masking default banned by
   `no-fallbacks-no-legacy.md`.
9. **Compliance and copy drift**: POPIA close-out items (churn-defences 23.x)
   are unsigned, PRIVACY.md lacks the tier-permanence clause, and
   `SALES_PITCH.md` sells Pay-as-you-go as a "low daily rate" while the code
   charges R99/day.

Out of scope: the consumer offline check-in retry queue (platform audit C4,
separate spec), dynamic boost pricing, tokenised recurring billing via a card
vault (v1 renewal is a manual re-checkout), refund and chargeback flows, and
the Live Vibe canary. All persistence stays on DynamoDB `PAY_PER_REQUEST`, all
compute stays on existing Lambdas, no SMS, no phone-OTP.

## Glossary

- **Billing_Service**: the subscription and boost path inside
  `backend/src/features/business/service.ts` (`createCheckoutSession`,
  `purchaseBoost`, `processYocoWebhook`, `handlePaymentSucceeded`,
  `handlePaymentFailed`, `getEffectiveTier`, `enforceLapsedPayments`,
  `downgradeToFree`).
- **Business_Row**: the business record in the businesses table, addressed via
  `backend/src/features/business/repository.ts`.
- **Paid_Until**: new ISO 8601 UTC attribute on Business_Row recording when the
  currently paid subscription window ends. Null or absent means no paid window.
- **Paid_Interval**: new attribute on Business_Row, one of `monthly`, `yearly`,
  `daily`, `weekly`, recording what the last successful payment bought.
- **Grace_Window**: the existing `paymentGraceUntil` attribute, a 7-day window
  after Paid_Until lapses during which the tier is retained and the business is
  prompted to renew before demotion.
- **Tier_Resolver**: the single function answering "what tier is this business
  entitled to right now": `getEffectiveTier`, extended per R4 and used by every
  feature-gating read path.
- **Subscription_Payment_Row**: a durable audit row written exactly once per
  successful subscription payment, mirroring the BoosterPurchase pattern from
  `booster-pricing-floor-and-audit`. Pk `SUB#<businessId>`, sk
  `SUB#<paidAt_iso>#<yocoCheckoutId>`, gsi1pk `SUB_BY_TIME`.
- **Sub_Checkout_Marker**: idempotency row `SUB_CHECKOUT#<yocoCheckoutId>`
  preventing double activation when Yoco re-delivers with a fresh eventId.
- **Renewal_Checkout**: a normal `createCheckoutSession` call made while the
  business already holds the plan; on success Paid_Until extends from
  `max(now, current Paid_Until)`.
- **Boost_Window**: new `boostUntil` ISO attribute on the node record, set on
  boost payment success to `paidAt + duration`. A node is Boost_Active while
  `boostUntil > now`, computed at read time, no worker.
- **Checkout_Return_Status**: the `status` query parameter (`success`,
  `cancelled`, `failed`) that `createYocoCheckout` already appends to the
  business-portal return URLs `/plans` and `/boost`.
- **Payment_Config_Guard**: startup validation that crashes the prod Lambda
  loudly when a required payment secret is missing, per the
  config-defaults-ban in `no-fallbacks-no-legacy.md`.
- **Billing_Panel**: the business-portal surfaces in
  `apps/business/src/screens/panels/PlansPanel.tsx` and `BoostPanel.tsx`.
- **Report_Ready_Notification**: the notification emitted when a weekly or
  monthly venue intelligence report is generated
  (`backend/src/features/reports/generator.ts`).
- **Lapse_Sweep**: the daily cleanup-worker pass that moves businesses through
  Paid_Until lapse, Grace_Window, and demotion.

## Requirements

### Requirement 1: Payment configuration is provisioned and fail-loud

**User Story:** As the founder, I want prod payment configuration to be
impossible to deploy half-set, so that a missing secret is a crashed deploy,
never a silently dead billing pipeline.

#### Acceptance Criteria

1. THE prod Terraform configuration SHALL receive a non-empty
   `yoco_webhook_secret`, provisioned the same way as the other payment
   secrets (terraform.tfvars or documented `TF_VAR_` in the deploy script),
   and `docs/DEPLOY.md` SHALL document where it comes from and how to rotate
   it.
2. WHEN the API Lambda or the Yoco webhook Lambda cold-starts with
   `AREA_CODE_ENV != 'dev'` AND `YOCO_WEBHOOK_SECRET` is empty or unset, THE
   Payment_Config_Guard SHALL throw at startup so the misconfiguration
   surfaces as a deploy failure, not a runtime 401 stream.
3. WHEN `createYocoCheckout` runs with `AREA_CODE_ENV != 'dev'`, THE
   Billing_Service SHALL read only `YOCO_PROD_SECRET_KEY` and SHALL throw
   `serviceUnavailable` when it is unset. THE dev-key fallback chain
   (`?? YOCO_DEV_SECRET_KEY ?? ''`) SHALL be removed; dev mode SHALL select
   the dev key by an explicit environment branch.
4. THE go-live check script SHALL assert (via
   `lambda get-function-configuration`) that `YOCO_WEBHOOK_SECRET` and
   `YOCO_PROD_SECRET_KEY` are set non-empty on the relevant prod Lambdas, and
   SHALL report FAIL when either is missing.

### Requirement 2: Subscription payment activates the right state

**User Story:** As a venue owner who just paid, I want my payment to buy a
defined period of the plan I chose, so that what I paid for is what I have.

#### Acceptance Criteria

1. WHEN Billing_Service handles `payment.succeeded` with
   `metadata.type === 'subscription'` and a valid plan, THE Billing_Service
   SHALL atomically update the Business_Row with: `tier = plan`,
   `trialEndsAt = null`, `paymentGraceUntil = null`,
   `paidInterval = metadata.interval`, and `paidUntil` computed per criterion 3.
2. THE Billing_Service SHALL persist exactly one Subscription_Payment_Row per
   successful subscription payment, idempotent on `yocoCheckoutId` via a
   Sub_Checkout_Marker, following the same write choreography, condition
   expressions, retry semantics, and 7-year retention as the BoosterPurchase
   rows in `booster-pricing-floor-and-audit`.
3. THE Paid_Until arithmetic SHALL be: `monthly` = +1 calendar month (clamped
   to the last day of the target month), `yearly` = +1 calendar year, `daily`
   = +1 day, `weekly` = +7 days, applied to `max(now, existing Paid_Until)` so
   a Renewal_Checkout extends rather than resets the window.
4. WHEN the same `yocoCheckoutId` is re-delivered under a fresh eventId, THE
   Billing_Service SHALL NOT extend Paid_Until a second time and SHALL NOT
   write a second Subscription_Payment_Row.
5. WHEN `metadata.plan` or `metadata.interval` fails shape validation, THE
   Billing_Service SHALL throw so the webhook returns non-2xx and Yoco
   retries, rather than activating an undefined plan.
6. THE `GET /v1/business/me` response SHALL include `paidUntil` and
   `paidInterval` so portals can render billing state.

### Requirement 3: Paid tiers expire, grace, remind, and renew

**User Story:** As the founder, I want lapsed subscriptions to wind down
predictably and politely, so that revenue is real month after month and no
venue is yanked off the map without warning.

#### Acceptance Criteria

1. WHEN the Lapse_Sweep (daily cleanup worker) finds a Business_Row with a
   paid tier, a Paid_Until in the past, no active trial, and no Grace_Window
   set, THE Lapse_Sweep SHALL set `paymentGraceUntil = now + 7 days` and send
   one renewal-reminder email via the existing SES module.
2. WHILE either the trial window, the Paid_Until window, or the Grace_Window
   is active, THE Tier_Resolver SHALL return the stored paid tier.
3. WHEN the Grace_Window lapses, THE existing `enforceLapsedPayments` path
   SHALL demote the business via `deactivateForNonPayment` (tier to free,
   business and nodes inactive, off the map), unchanged as the single home for
   removal.
4. THE trial-reminder worker pattern SHALL additionally send a
   renewal-reminder email 7 days before Paid_Until lapses for `monthly` and
   `yearly` intervals (no pre-lapse reminder for `daily` / `weekly`).
5. WHEN a business in Grace_Window completes a Renewal_Checkout, THE
   Billing_Service SHALL clear the Grace_Window and extend Paid_Until per
   R2.3, with no demotion.
6. A `payg` purchase SHALL follow the same lifecycle with its 1-day or 7-day
   Paid_Until, so a day pass ends after a day.

### Requirement 4: One tier resolver on every read path

**User Story:** As a paying business, I want every feature to agree on what
tier I hold, so that I never see growth limits on one screen and starter
limits on another.

#### Acceptance Criteria

1. THE Tier_Resolver SHALL be extended to: return `starter` for free/starter;
   return the stored tier while trial, Paid_Until, or Grace_Window is active;
   return `starter` otherwise. THE dead `yocoCustomerId` check, the unused
   `setYocoCustomerId` repository function, and the `yocoCustomerId` field on
   the auth business type SHALL be deleted per `no-fallbacks-no-legacy.md`.
2. THE reports handler (`backend/src/features/reports/handler.ts`) SHALL gate
   report content by the Tier_Resolver, not the raw stored tier.
3. THE consumer map read paths (`nodes/repository.ts getNodesByCitySlug`,
   `nodes/service.ts`) SHALL keep filtering on the stored tier plus
   `isActive`, with storage demotion (R3.3) as the only removal mechanism.
   This split (feature gating = Tier_Resolver, map membership = stored state)
   SHALL be recorded in a code comment at both sites so it reads as designed,
   not drifted.
4. All existing Tier_Resolver call sites (staff capacity, reward multiplier,
   campaign quota and dispatch, boost tier snapshot) SHALL continue to
   compile and pass against the extended resolver signature.

### Requirement 5: A paid boost has a real, honest, expiring effect

**User Story:** As a venue owner who paid for a 6-hour boost, I want my venue
visibly boosted for exactly 6 hours, so that the product I bought exists.

#### Acceptance Criteria

1. WHEN Billing_Service persists a boost purchase (existing audit branch), THE
   Billing_Service SHALL also set the node's Boost_Window to
   `paidAt + duration`, overwriting only if the new window ends later than any
   existing one.
2. THE nodes read paths SHALL expose a computed `boostActive` boolean (and
   `boostUntil`) on venue payloads consumed by the consumer web app, derived
   at read time from Boost_Window, with no expiry worker.
3. THE consumer ranking (`apps/web/src/lib/carouselRanking.ts` vibeRank) SHALL
   consume `boostActive` inside the existing level-3 tier signal (ordering
   within that level: boost first, then tier), and SHALL NOT let a boost
   outrank taste-match or aliveness, per
   `discovery-dna-vibe-over-convenience.md`.
4. At Constellation zoom, a boost MAY affect only which beams survive the
   visibility cap (tiebreak among equally-alive venues) and SHALL NOT change
   beam brightness, height, or animation, per `constellation-mode.md`.
5. WHEN the Boost_Window passes, THE boosted treatment SHALL end with no
   residue: `boostActive` reads false and ranking reverts, within one data
   refresh.
6. THE business portal boost surface SHALL show the active Boost_Window state
   ("Boost active until HH:MM") on the boosted node, driven by the same field.

### Requirement 6: Checkout return lands on a truthful screen

**User Story:** As a venue owner returning from Yoco, I want the portal to
tell me what happened to my payment and my account, so that I am never staring
at a static pricing page wondering if my card was charged.

#### Acceptance Criteria

1. WHEN the Billing_Panel mounts with Checkout_Return_Status `success`, THE
   Billing_Panel SHALL show an activating state and poll the relevant read
   (`/v1/business/me` for plans, the boost purchases list for boosts) every 2
   seconds for up to 60 seconds until the new state (tier + Paid_Until, or
   BoosterPurchase row) is visible, then show a confirmed state.
2. IF the 60-second poll window ends without the state landing, THEN THE
   Billing_Panel SHALL show an honest pending message naming support, not a
   false success and not a spinner forever.
3. WHEN Checkout_Return_Status is `cancelled` or `failed`, THE Billing_Panel
   SHALL show the matching non-alarming message and clear the param from the
   URL so refresh does not replay it.
4. THE Billing_Panel SHALL disable purchase buttons while a poll is in flight,
   per the buttons-disabled-during-API-calls code rule.

### Requirement 7: The billing surface tells the whole truth

**User Story:** As a venue owner, I want to see what I am on, until when, what
I have paid, and what cancelling really does, so that billing never surprises
me.

#### Acceptance Criteria

1. THE PlansPanel SHALL render the current plan with Paid_Until ("Growth ·
   paid until 9 August 2026") when a paid window is active, the Grace_Window
   state with a renew CTA when in grace, and the trial countdown when on
   trial, replacing the current trial-only banner.
2. THE PlansPanel trial banner copy SHALL stop referencing "add a payment
   method" (no card vault exists) and SHALL instead point at choosing a plan
   before the trial ends.
3. THE cancel-subscription confirmation SHALL state the real consequences
   implemented by `downgradeToFree`: immediate downgrade AND venues removed
   from the consumer map.
4. THE PlansPanel SHALL offer both `daily` and `weekly` Pay-as-you-go
   purchases (the weekly price is displayed today but not purchasable).
5. THE business portal SHALL list past subscription payments (date, plan,
   interval, amount, paid-until produced) from Subscription_Payment_Rows,
   following the existing BoostPurchasesPanel pattern.
6. WHEN a renewal is possible (paid window active or in grace), THE PlansPanel
   SHALL render a renew action that starts a Renewal_Checkout for the current
   plan and interval.

### Requirement 8: Admin can see subscription money

**User Story:** As an admin, I want a cross-business view of subscription
payments, so that support, refunds, and revenue reconciliation do not require
DynamoDB console spelunking.

#### Acceptance Criteria

1. THE admin portal SHALL list Subscription_Payment_Rows across businesses by
   date range via the `SUB_BY_TIME` GSI partition, mirroring the existing
   admin boost report (same pagination, same range validation).
2. THE endpoint SHALL be gated by `requireAuth('admin')` and SHALL expose no
   consumer PII (rows carry business identifiers and amounts only).

### Requirement 9: Report-ready notifications actually deliver

**User Story:** As a venue owner on a paid plan, I want to be told when my
weekly intelligence report is ready, so that the flagship paid feature gets
seen.

#### Acceptance Criteria

1. THE report generator SHALL deliver Report_Ready_Notifications through the
   existing delivered channels (web push via the existing push module and/or
   SES email), replacing the enqueue to the consumer-less `push-sender` SQS
   queue.
2. THE `push-sender` SQS queue, its DLQ, IAM statements, env vars, DLQ alarm,
   and the go-live-check DLQ line SHALL be removed in the same change, per
   `no-fallbacks-no-legacy.md` (one delivery path, no dead infrastructure).
3. IF notification delivery fails, THEN THE generator SHALL log the failure
   and still complete report persistence (a missed notification never loses a
   report).

### Requirement 10: Go-live check covers billing

**User Story:** As the founder running the launch-morning script, I want the
billing pipeline checked by the same script as everything else, so that a dead
webhook cannot hide behind a green run.

#### Acceptance Criteria

1. THE go-live check SHALL include the R1.4 secret-presence assertions.
2. THE go-live check SHALL verify the webhook route responds 401 (not 5xx,
   not 2xx) to an unsigned POST, proving the signature gate is alive.
3. THE PILOT_LAUNCH_CHECKLIST §1.3 manual gate SHALL be updated to match the
   implemented UI ("plan badge plus paid-until date within 60 seconds") and
   SHALL stay a manual launch-day gate.

### Requirement 11: Edge protection decision is closed, not floating

**User Story:** As the founder, I want the WAF question answered and recorded,
so that the May audit item stops rolling forward unresolved.

#### Acceptance Criteria

1. GIVEN AWS WAFv2 cannot associate with API Gateway v2 HTTP APIs, THE spec
   decision SHALL be recorded as: WAF requires a CloudFront distribution in
   front of `api.areacode.co.za` (allowed by `serverless-only.md`, roughly
   $5-15/month plus request fees).
2. THE default for this spec SHALL be to defer the CloudFront+WAF build until
   founder approval of the cost, recorded in `docs/GO_LIVE_AUDIT.md`
   follow-ups with the compensating controls named (app-level rate limits,
   Cognito auth on every business/admin route, fail-closed webhook signature).
3. THE `infra/modules/waf` ALB association SHALL be deleted (ALBs are
   forbidden infrastructure; the association can never be used).

### Requirement 12: Compliance and sales copy match the product

**User Story:** As the founder, I want the legal and sales surfaces to say
what the code does, so that launch does not open with a compliance gap or an
overclaim.

#### Acceptance Criteria

1. THE POPIA close-out checks from churn-defences tasks 23.1, 23.2, 23.3
   SHALL be executed and recorded (threshold lock stores only userId,
   guest-claim data deletion window, proximity nudge persists no coordinates
   server-side).
2. THE tier-permanence clause SHALL be added to `docs/PRIVACY.md` per
   churn-defences task 3.1.
3. `SALES_PITCH.md` SHALL describe Pay-as-you-go with its real price posture
   (R99/day, R199/week premium day-pass) and SHALL align the report examples
   with what launch-scale data can honestly produce.
4. `docs/PILOT_LAUNCH_CHECKLIST.md` and `docs/GO_LIVE_CHECK_RESULT.md`
   follow-ups SHALL be updated to reflect the shipped billing lifecycle.
