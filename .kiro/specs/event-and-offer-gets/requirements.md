# Requirements Document

## Introduction

Today every "get" in Area Code is a loyalty reward. The `type` enum on a reward (`nth_checkin`, `daily_first`, `streak`, `milestone`) describes a check-in _trigger_: the consumer earns the get by repeating a behaviour. This is the right model for "5th visit = free coffee", but it has no way to express the two things businesses keep asking for:

1. A **free event** the venue is hosting ("Live amapiano set this Friday, free entry") that a business wants to put on the map for a bounded window.
2. A **special / offer** the venue is running right now ("2-for-1 cocktails tonight, 6pm–9pm") that is time-boxed rather than visit-count-triggered.

Both are announcements with a start and an end. Forcing them into a loyalty trigger is a hack, and leaving them out means businesses route around the platform (Instagram, posters) for exactly the moments when their venue is liveliest — the moments Area Code most wants on the map.

This feature, **Event & Offer Gets**, makes events and offers first-class get categories while protecting the single most important commercial invariant of the platform: **gets are a free engagement tool; reach is the paid product.** A business may create an event or offer get for free (within their tier's get cap). What it buys them by default is _proximity-gated_ visibility and a get that consumers claim **on check-in** — which drives the node's pulse and is exactly the rapidly-pulsing-node mechanic the founder wants. To be seen by users who are **not already nearby** (city-wide attention while the event is live), the business buys a **boost** through the existing `BOOST_PRICING` flow. Events and offers therefore _increase_ boost demand rather than competing with it.

All persistence stays on DynamoDB `PAY_PER_REQUEST` inside the existing `AppData_Table`. No new always-on resources. No SMS, no phone-OTP. POPIA stays intact — no new consumer-location persistence is introduced. The monetization model (node subscription tiers + boosts) is unchanged; this spec deliberately adds **no new free reach surface**.

## Glossary

- **Get**: the consumer-facing name for a reward (`backend/src/features/rewards`). A `Reward` row in the single table, attached to a `Node`.
- **Loyalty_Get**: the existing get behaviour — a `Reward` whose `type` is one of `nth_checkin`, `daily_first`, `streak`, `milestone`. Earned by repeated check-in behaviour. This is the default and remains unchanged.
- **Event_Get**: a new get category representing a time-boxed happening a venue is hosting (e.g. a live set, a launch, a market day). Has a `[startsAt, endsAt)` window.
- **Offer_Get**: a new get category representing a time-boxed special or promotion (e.g. a happy hour, a discount window). Has a `[startsAt, endsAt)` window.
- **Get_Category**: a new discriminator field on a `Reward` with value `loyalty`, `event`, or `offer`. Defaults to `loyalty`. `loyalty` preserves all existing behaviour.
- **Active_Window**: for an Event_Get or Offer_Get, the half-open UTC interval `[startsAt, endsAt)` during which the get is "live".
- **Claim_On_Check_In**: a property of a get (default `true` for Event_Get and Offer_Get) requiring the consumer to be checked in at the venue, inside the get's Active_Window, to claim it. This is the lever that converts an event/offer into pulse.
- **Node**: a venue marker on the live map (`backend/src/features/nodes`). Carries a `pulseScore` derived from check-ins.
- **Pulse_State**: one of `dormant`, `quiet`, `active`, `buzzing`, `popping`, derived from `pulseScore` by `getNodeState`.
- **Boost**: the existing paid amplification product (`BOOST_PRICING` = `2hr`/`6hr`/`24hr`). The only mechanism that grants a node visibility beyond proximity. Unchanged by this spec except for the cross-link in R7.
- **Proximity_Gated**: visible only to consumers whose query position is within the existing near-me radius of the node (see `getRewardsNearMe`, `findNodesNearby`). An unboosted get is Proximity_Gated.
- **Tier_Get_Cap**: the per-business active-get limit enforced by `TIER_REWARD_LIMITS` (`free`/`starter`/`payg` = 3, `growth` = 10, `pro` = unlimited). Event_Gets and Offer_Gets count against this cap exactly like Loyalty_Gets.
- **Get_Feed**: the consumer-facing "near me" gets list returned by `GET /v1/rewards/near-me`.
- **Business_Portal**: the operator-facing app (`apps/web` business surface) where operators create and manage gets.

## Requirements

### Requirement 1: Get category data model

**User Story:** As a business operator, I want a get to be typed as a loyalty reward, an event, or an offer, so that the platform can treat time-boxed happenings differently from visit-count rewards without breaking my existing rewards.

#### Acceptance Criteria

1. THE `Reward` entity SHALL carry a `getCategory` field with value in `{ loyalty, event, offer }`. WHERE a `Reward` row is read that has no `getCategory` attribute, THE read model SHALL treat it as `loyalty` so every existing row keeps its current behaviour without a backfill.
2. WHERE `getCategory = loyalty`, THE `Reward` SHALL retain its existing `type` field (`nth_checkin` | `daily_first` | `streak` | `milestone`) and all existing validation, and SHALL NOT require an Active_Window.
3. WHERE `getCategory = event` OR `getCategory = offer`, THE `Reward` SHALL declare `startsAt` and `endsAt` as ISO-8601 UTC timestamps at millisecond precision with `startsAt < endsAt`. IF this ordering is violated or either field is missing/malformed, THEN THE create/update operation SHALL be rejected with a 400 validation error and SHALL NOT persist.
4. WHERE `getCategory = event` OR `getCategory = offer`, THE create operation SHALL reject any value of `type` outside the set `{ nth_checkin, daily_first, streak, milestone }` only insofar as `type` is supplied; the `type` field SHALL be optional for event and offer gets and, when omitted, SHALL be stored as `event` or `offer` respectively so the existing non-null `type` consumers do not break.
5. WHERE `getCategory = event` OR `getCategory = offer`, THE `Reward` SHALL carry a `claimRequiresCheckIn` boolean defaulting to `true`. IF the field is omitted on create, THEN it SHALL be persisted as `true`.
6. THE maximum Active_Window width for an Event_Get or Offer_Get SHALL be 30 days. IF `endsAt - startsAt > 30 days`, THEN THE create/update operation SHALL be rejected with a 400 validation error and SHALL NOT persist.
7. THE `Reward` SHALL continue to persist in the existing `AppData_Table` with `billing_mode = "PAY_PER_REQUEST"`. No new table SHALL be introduced.
8. THE new fields SHALL NOT introduce any phone-number, SMS-delivery, or consumer-PII attribute on the `Reward` row.

### Requirement 2: Creating event and offer gets

**User Story:** As a business operator, I want to create an event or offer get from the business portal, so that my happening or special appears on the platform during its window.

#### Acceptance Criteria

1. THE create-get API (`POST /v1/business/rewards`) SHALL accept `getCategory`, `startsAt`, `endsAt`, and `claimRequiresCheckIn` in addition to the existing fields, validated by the extended Zod schema.
2. WHEN an operator creates an Event_Get or Offer_Get for a node, THE service SHALL verify the node belongs to the operator's business exactly as it does today (`node.businessId === businessId`); IF not, THEN it SHALL reject with 403 and SHALL NOT persist.
3. WHEN an operator creates any get (loyalty, event, or offer), THE service SHALL count it against the Tier_Get_Cap using the existing `countActiveRewardsForBusiness` logic; IF the cap is reached, THEN it SHALL reject with 403 `Active reward limit reached for your tier` and SHALL NOT persist.
4. WHERE `getCategory = event` OR `getCategory = offer` AND `startsAt` is in the past at create time by more than 5 minutes (clock-skew tolerance), THE service SHALL reject with 400 and SHALL NOT persist.
5. WHEN an Event_Get or Offer_Get is created successfully, THE service SHALL return 201 with the full persisted get including `getCategory`, `startsAt`, `endsAt`, and `claimRequiresCheckIn`.
6. THE existing First-Get uniqueness rule (`isFirstGet`) SHALL remain enforced and SHALL be independent of `getCategory`; an Event_Get or Offer_Get MAY also be flagged `isFirstGet` subject to the existing one-per-node constraint.
7. WHEN an Event_Get or Offer_Get is created, THE existing `notifyNewRewardConsumers` fire-and-forget notification SHALL run exactly as it does for loyalty gets, and SHALL NOT introduce any new notification channel.

### Requirement 3: Active-window lifecycle

**User Story:** As a consumer, I want events and offers to appear only while they are actually happening, so that the map and gets feed reflect reality.

#### Acceptance Criteria

1. THE read model SHALL classify an Event_Get or Offer_Get into exactly one lifecycle state at any timestamp `t`: `upcoming` WHEN `t < startsAt`, `live` WHEN `startsAt <= t < endsAt`, `ended` WHEN `t >= endsAt`.
2. THE Get_Feed (`GET /v1/rewards/near-me`) SHALL include an Event_Get or Offer_Get IF AND ONLY IF its lifecycle state is `live` at request time AND the get is otherwise active (`isActive = true`, slots remaining if `totalSlots` set).
3. THE Get_Feed SHALL continue to include Loyalty_Gets using the existing selection logic, unaffected by lifecycle state.
4. WHERE an Event_Get or Offer_Get is `ended`, THE read model SHALL exclude it from the Get_Feed and from claim eligibility, without requiring a write to flip `isActive`.
5. THE lifecycle classification SHALL be a deterministic pure function of `(startsAt, endsAt, t)` and SHALL be unit-testable without I/O.
6. WHERE an operator queries their own gets in the Business_Portal, THE response SHALL include `upcoming`, `live`, and `ended` gets with their lifecycle state, so the operator can see scheduled and past happenings.

### Requirement 4: Claim-on-check-in for events and offers

**User Story:** As the platform, I want event and offer claims to require a live check-in, so that promoting a happening drives the venue's pulse rather than handing out free reach.

#### Acceptance Criteria

1. WHERE an Event_Get or Offer_Get has `claimRequiresCheckIn = true`, THE claim path SHALL require an active check-in by the consumer at the get's node, recorded inside the get's Active_Window, before issuing a redemption code.
2. IF a consumer attempts to claim a `claimRequiresCheckIn = true` Event_Get or Offer_Get without a qualifying check-in, THEN THE claim SHALL be rejected with a 400 `check_in_required` error and SHALL NOT issue a redemption code.
3. WHERE an Event_Get or Offer_Get has `claimRequiresCheckIn = false`, THE claim path SHALL match the existing loyalty-get claim behaviour (no check-in precondition beyond what loyalty gets require today).
4. WHEN a qualifying check-in is recorded for a node that has a `live` Event_Get or Offer_Get, THE existing pulse mechanic SHALL apply unchanged; this spec SHALL NOT add a separate pulse boost for events beyond the check-in's normal contribution.
5. THE claim eligibility decision SHALL be a deterministic function of `(getCategory, claimRequiresCheckIn, lifecycle state, hasQualifyingCheckIn)` and SHALL be unit-testable.
6. THE redemption/redeem staff flow (`POST /v1/rewards/:id/redeem`) SHALL remain unchanged for all get categories; this spec SHALL NOT alter how staff validate a redemption code.

### Requirement 5: No new free reach — monetization protection

**User Story:** As the business owner of Area Code, I want events and offers to never grant city-wide visibility for free, so that boosts remain the only way to buy reach beyond proximity.

#### Acceptance Criteria

1. AN unboosted Event_Get or Offer_Get SHALL be **Proximity_Gated**: it SHALL only surface to consumers whose query position is within the existing near-me radius used by `getRewardsNearMe` / `findNodesNearby`. THIS feature SHALL NOT add any endpoint, feed, or map layer that lists events or offers city-wide irrespective of proximity.
2. THE feature SHALL NOT introduce a "what's on tonight" global events feed, an unbounded events search, or any surface that returns events ranked by anything other than the existing `proximity × pulseScore` ranking.
3. WHERE a node has an active boost (existing `BoosterPurchase` / boost-floor mechanic), THE node's existing boosted visibility SHALL apply to that node and therefore to its `live` Event_Gets and Offer_Gets transitively — i.e. a boost is the supported way to make an event visible beyond proximity.
4. THE feature SHALL NOT change `BOOST_PRICING`, the boost-floor mechanic, or any pricing/tier constant. The only commercial change is that more event/offer activity is expected to increase boost demand.
5. THE create-get flow SHALL NOT auto-purchase or auto-apply a boost; boosting remains an explicit, separately-paid operator action.

### Requirement 6: Operator dashboard for events and offers

**User Story:** As a business operator, I want to manage my events and offers and see when boosting would help, so that I can promote a happening and choose to pay for reach.

#### Acceptance Criteria

1. THE Business_Portal get-management UI SHALL let an operator choose `getCategory` (loyalty / event / offer) when creating a get, defaulting to `loyalty` so the existing flow is unchanged.
2. WHERE the operator selects `event` or `offer`, THE UI SHALL show `startsAt` / `endsAt` date-time inputs and a `claimRequiresCheckIn` toggle defaulting to on, and SHALL run R1/R2 validations inline before allowing save.
3. THE UI SHALL display each event/offer get's lifecycle state (`upcoming` / `live` / `ended`) per R3.6.
4. WHERE an Event_Get or Offer_Get is `live` OR `upcoming` AND the node has no active boost, THE UI SHALL surface a non-blocking prompt linking to the existing boost purchase flow (e.g. "Boost this so people across the city see it"). THIS prompt SHALL NOT auto-purchase a boost (R5.5).
5. THE UI SHALL NOT expose any field, toggle, or copy implying free city-wide promotion.
6. THE UI SHALL render only for an authenticated business operator whose JWT `businessId` matches the node's business, consistent with the existing get-management authorization.

### Requirement 7: Backwards compatibility and migration safety

**User Story:** As a developer, I want existing rewards and consumers to keep working with zero migration, so that shipping event/offer gets carries no data risk.

#### Acceptance Criteria

1. EVERY existing `Reward` row without a `getCategory` attribute SHALL behave as a Loyalty_Get with no backfill required (R1.1).
2. THE existing `GET /v1/rewards/near-me`, `GET /v1/users/me/unclaimed-rewards`, `POST /v1/business/rewards`, `PUT /v1/business/rewards/:id`, and `POST /v1/rewards/:id/redeem` response shapes SHALL remain a superset of today's shapes — fields MAY be added but no existing field SHALL be removed or change type.
3. THE `DEV_MODE` fixtures in `backend/src/features/rewards/service.ts` SHALL continue to return valid responses, extended to include at least one Event_Get and one Offer_Get example so the dev surfaces exercise the new category.
4. THE feature SHALL ship without a runtime feature flag: the additive `getCategory` field defaults to `loyalty`, so the change is inert for all existing data and the create flow only diverges when an operator explicitly selects `event` or `offer`. Rollback is a deploy revert.
5. THE feature SHALL NOT remove, revive, or modify any phone-OTP/SMS code path, consistent with `.kiro/steering/no-sms-no-phone-auth.md`.

### Requirement 8: Observability and abuse safety

**User Story:** As an operator of the platform, I want event/offer gets to be observable and bounded, so that they cannot be used to spam the map or farm claims.

#### Acceptance Criteria

1. WHEN an Event_Get or Offer_Get is created, THE service SHALL emit a structured `info`-level log entry containing `businessId`, `nodeId`, `getCategory`, `startsAt`, `endsAt`, and `claimRequiresCheckIn`.
2. THE existing reporting/abuse-flag surfaces for nodes and rewards SHALL apply to Event_Gets and Offer_Gets without modification; this spec SHALL NOT bypass any existing moderation gate.
3. THE Tier_Get_Cap (R2.3) SHALL be the binding limit on how many concurrent gets a business can have, so event/offer gets cannot be used to exceed the per-tier ceiling.
4. WHERE a consumer attempts to claim an `ended` or `upcoming` Event_Get or Offer_Get, THE claim SHALL be rejected with a 400 and SHALL emit a `debug`-level log; it SHALL NOT raise an unhandled exception.
