# Requirements Document

## Introduction

Win-Back Campaigns is Area Code's **activation layer** — the feature that turns Venue Intelligence Report insights into customer-reaching actions that drive foot traffic. Today the platform diagnoses ("your repeat visitor rate dropped 14 points; 15 regulars haven't returned") but stops short of treatment. A venue owner can see who lapsed but has no in-product way to reach them.

This feature lets a business owner build a targeted campaign against a segment of their **own past visitors** (lapsed customers, first-timers who never returned, loyal regulars, or all past visitors), attach an optional reward, and deliver a message through the platform's existing **email (SES)** and **push (Expo / Web Push)** rails. A "retention" recommendation in a Venue Intelligence Report becomes a one-tap "Create win-back campaign" action, closing the loop between insight and action.

Delivery is **email and push only**. This feature MUST NOT introduce any SMS or phone-number-based messaging path, per `.kiro/steering/no-sms-no-phone-auth.md`. The entire feature runs on pay-per-use serverless infrastructure (Lambda, SQS, DynamoDB PAY_PER_REQUEST, EventBridge, SES, existing WebSocket/push) per `.kiro/steering/serverless-only.md` — no new always-on resources.

The feature is gated by business tier: growth and pro tiers can create and send campaigns (with per-tier monthly send quotas), while starter and payg tiers see a teaser with an upgrade call-to-action.

## Glossary

- **Campaign**: A business-authored message targeting a defined audience segment of the business's past visitors, delivered once (immediately or scheduled) through email and/or push. Stored as a document in the app-data DynamoDB table.
- **Campaign_Service**: The service-layer module under `backend/src/features/campaigns/service.ts` that creates, validates, schedules, and manages campaigns.
- **Campaign_API**: The Fastify API routes under `/v1/business/me/campaigns` that serve campaign management to the business dashboard.
- **Segment**: A rule that resolves to a set of the business's past visitors based on their check-in history and loyalty tier. The four supported segments are `lapsed`, `first_timers`, `regulars`, and `all_past_visitors`.
- **Segment_Resolver**: The module that converts a Segment definition plus the business's nodes into a deduplicated set of target consumer userIds, using existing check-in data only.
- **Lapsed_Visitor**: A consumer who checked in at one of the business's nodes at least once before a configurable cutoff but has not checked in within the campaign's `lapsedWindowDays` (default 21 days).
- **Campaign_Dispatcher**: The Lambda that, when a campaign is sent, resolves the segment, applies consent and frequency-cap filtering, and fans out one SQS message per recipient batch.
- **Campaign_Sender**: The SQS-triggered Lambda worker that delivers a campaign to a batch of recipients via push (using the existing `sendNotification`) and/or email (using the existing SES module), and records per-recipient send outcomes.
- **Campaign_Send_Record**: A per-recipient record of a delivery attempt (channel, outcome, timestamp), keyed by anonymized recipient token, used for analytics and frequency capping.
- **Attributed_Return_Visit**: A check-in by a recipient at one of the campaign's nodes within the `attributionWindowDays` (default 14 days) after the campaign was sent to them. This is the campaign's primary ROI metric.
- **Marketing_Consent**: A consumer's explicit opt-in to receive promotional messages from businesses they have visited. Distinct from transactional/operational notifications. Required by POPIA for promotional sends.
- **Frequency_Cap**: A platform-wide limit on how many campaign messages a single consumer may receive across all businesses within a rolling window, to protect the consumer experience and email deliverability.
- **Send_Quota**: A per-business, per-calendar-month maximum number of campaign recipients, determined by the business's subscription tier.
- **Business_Tier**: The subscription level of a business account (starter, growth, pro, payg) that determines feature access and Send_Quota.
- **Dashboard_UI**: The React/Vite business dashboard `CampaignsPanel` component that creates, sends, and reviews campaigns.
- **POPIA**: Protection of Personal Information Act — South African data-privacy legislation. Promotional messaging requires opt-in consent and a working opt-out, and analytics must be anonymized/aggregated.
- **Anonymized_Token**: A one-way hash of a consumer userId (salted, rotated per campaign) used to store send records and compute analytics without persisting consumer identifiers in campaign documents.

## Constraints (binding, from steering)

- **C1 — No SMS / no phone.** This feature MUST NOT add any SMS integration, phone-number input, or phone-based identifier. Delivery channels are limited to email (SES) and push (Expo / Web Push). See `.kiro/steering/no-sms-no-phone-auth.md`.
- **C2 — Serverless-only.** This feature MUST run entirely on Lambda, SQS, DynamoDB (`PAY_PER_REQUEST`), EventBridge, SES, and the existing WebSocket/push rails. No ECS, RDS, ElastiCache, ALB, or NAT Gateway. No new always-on resources. Lambdas use `arm64`. See `.kiro/steering/serverless-only.md`.
- **C3 — Reuse existing rails.** Delivery MUST reuse `backend/src/features/notifications` (`sendNotification`) for push and `backend/src/shared/email/ses.ts` for email. No new notification or email subsystem.
- **C4 — Single-table storage.** Campaign data MUST be stored in the existing `app-data` table using the established `pk`/`sk` + `gsi1` pattern. No new DynamoDB tables or GSIs.

## Requirements

### Requirement 1: Campaign Creation

**User Story:** As a business owner, I want to create a campaign targeting a segment of my past visitors with a message and an optional reward, so that I can proactively bring customers back.

#### Acceptance Criteria

1. THE Campaign_API SHALL expose `POST /v1/business/me/campaigns` that creates a Campaign in `draft` status for the authenticated business.
2. THE Campaign_Service SHALL require each Campaign to specify: a `segment` (one of `lapsed`, `first_timers`, `regulars`, `all_past_visitors`), a `title` (max 80 chars), a `body` (max 500 chars), at least one delivery `channel` (`push`, `email`, or both), and the set of `nodeIds` the campaign targets (all owned by the business).
3. THE Campaign_Service SHALL allow an optional `rewardId` to be attached to a Campaign, and SHALL reject creation IF the referenced reward does not belong to the authenticated business.
4. WHEN the `segment` is `lapsed`, THE Campaign_Service SHALL accept an optional `lapsedWindowDays` integer between 7 and 90 inclusive, defaulting to 21.
5. IF any `nodeId` in the request is not owned by the authenticated business, THEN THE Campaign_Service SHALL reject the request with a 403 error and create no Campaign.
6. THE Campaign_Service SHALL persist each Campaign to the app-data table with partition key `CAMPAIGN#<businessId>` and sort key `CAMPAIGN#<createdAt>#<campaignId>`.

### Requirement 2: Win-Back (Lapsed) Segment Resolution

**User Story:** As a business owner, I want a campaign to automatically find customers who used to visit but have stopped, so that I do not have to identify them manually.

#### Acceptance Criteria

1. THE Segment_Resolver SHALL resolve the `lapsed` Segment to the set of consumer userIds who checked in at any of the campaign's `nodeIds` at least once before the cutoff AND have no check-in at any of those nodes within the most recent `lapsedWindowDays`.
2. THE Segment_Resolver SHALL deduplicate recipients by userId so that a consumer who lapsed at multiple of the business's nodes is counted once.
3. THE Segment_Resolver SHALL exclude any consumer who has checked in at any of the campaign's `nodeIds` within the `lapsedWindowDays` (i.e., currently-active customers are never in the win-back segment).
4. THE Segment_Resolver SHALL use only existing check-in data accessed through the existing check-in repository and SHALL NOT use phone numbers as an identifier.

### Requirement 3: Additional Audience Segments

**User Story:** As a business owner, I want to target other meaningful groups beyond lapsed customers, so that I can run different kinds of campaigns.

#### Acceptance Criteria

1. THE Segment_Resolver SHALL resolve the `first_timers` Segment to consumers who checked in at the campaign's `nodeIds` exactly once, ever.
2. THE Segment_Resolver SHALL resolve the `regulars` Segment to consumers whose loyalty tier at the business is `regular` or higher (regular, fixture, institution, legend).
3. THE Segment_Resolver SHALL resolve the `all_past_visitors` Segment to every consumer who has checked in at any of the campaign's `nodeIds` at least once.
4. FOR ALL segments, THE Segment_Resolver SHALL return a deduplicated set of userIds and SHALL produce no individual identifiers in any stored Campaign document.

### Requirement 4: One-Tap From Report Recommendation

**User Story:** As a business owner, when my intelligence report tells me my repeat-visitor rate dropped, I want to launch a win-back campaign in one tap, so that insight turns into action immediately.

#### Acceptance Criteria

1. WHEN a Venue Intelligence Report contains a recommendation of type `retention`, THE Dashboard_UI SHALL display a "Create win-back campaign" call-to-action alongside that recommendation.
2. WHEN the business owner activates that call-to-action, THE Dashboard_UI SHALL open the campaign composer pre-filled with the `lapsed` segment, the report's `nodeIds`, and a suggested message referencing the dropped repeat-visitor rate.
3. THE Campaign_Service SHALL record the originating `reportId` on any Campaign created from a report recommendation, for attribution.
4. WHILE the business is on the starter or payg tier, THE Dashboard_UI SHALL replace the call-to-action with an upgrade prompt (consistent with Requirement 9).

### Requirement 5: Delivery Channels (Email and Push Only)

**User Story:** As a product owner, I want campaigns delivered only through email and push, so that we never depend on SMS and stay compliant with the permanent no-SMS architecture decision.

#### Acceptance Criteria

1. THE Campaign_Sender SHALL deliver push messages exclusively through the existing `sendNotification` function in `backend/src/features/notifications`.
2. THE Campaign_Sender SHALL deliver email messages exclusively through the existing SES module in `backend/src/shared/email`.
3. THE Campaign_Service SHALL reject any Campaign whose `channel` set contains a value other than `push` or `email`.
4. THE Campaign feature SHALL NOT read, store, transmit, or require a consumer phone number for any purpose.
5. WHEN a recipient has no active push token AND the channel set includes `push` but not `email`, THE Campaign_Sender SHALL record the outcome as `no_channel` and SHALL NOT attempt any other channel.

### Requirement 6: Marketing Consent (POPIA)

**User Story:** As a product owner, I want promotional campaigns sent only to consumers who opted in, so that the platform complies with POPIA.

#### Acceptance Criteria

1. THE Campaign_Dispatcher SHALL exclude from every campaign any consumer who has not granted Marketing_Consent.
2. THE Campaign_Dispatcher SHALL exclude any consumer who has opted out of campaigns from the specific business OR globally.
3. THE Campaign feature SHALL treat Marketing_Consent as distinct from transactional notification preferences — a consumer who receives operational notifications (e.g., reward codes) is NOT automatically a campaign recipient.
4. WHEN a consumer has never set a Marketing_Consent value, THE Campaign_Dispatcher SHALL treat consent as not granted (opt-in default, not opt-out).

### Requirement 7: Frequency Capping

**User Story:** As a product owner, I want a platform-wide limit on how many campaign messages a consumer receives, so that consumers are not spammed and email deliverability is protected.

#### Acceptance Criteria

1. THE Campaign_Dispatcher SHALL exclude any consumer who has already received the Frequency_Cap maximum number of campaign messages within the rolling window (default: 4 messages per 7 days, across all businesses).
2. THE Campaign_Dispatcher SHALL count a campaign message toward a consumer's Frequency_Cap only when at least one channel delivery is attempted for that consumer.
3. THE Frequency_Cap counter SHALL be stored in the existing DynamoDB key-value store with a TTL equal to the rolling window, so counters expire automatically with no cleanup job.
4. THE Frequency_Cap SHALL be applied consistently regardless of which business sends the campaign.

### Requirement 8: Campaign Lifecycle

**User Story:** As a business owner, I want to draft, send or schedule, and cancel campaigns, so that I have control over what goes out and when.

#### Acceptance Criteria

1. THE Campaign_Service SHALL model each Campaign with a status of `draft`, `scheduled`, `sending`, `sent`, `cancelled`, or `failed`.
2. THE Campaign_API SHALL expose `POST /v1/business/me/campaigns/:campaignId/send` that transitions a `draft` Campaign to `sending` (immediate) or `scheduled` (when a future `scheduledAt` is provided).
3. WHEN a Campaign is `scheduled`, THE Campaign_Dispatcher SHALL begin delivery within 5 minutes after `scheduledAt` is reached, triggered by an EventBridge schedule.
4. THE Campaign_API SHALL expose `POST /v1/business/me/campaigns/:campaignId/cancel` that transitions a `draft` or `scheduled` Campaign to `cancelled`; a Campaign already in `sending` or `sent` SHALL NOT be cancellable.
5. WHEN delivery completes, THE Campaign_Service SHALL transition the Campaign to `sent` and record final send counts.
6. THE Campaign_Service SHALL prevent a Campaign from being sent more than once (a `sent` or `sending` Campaign SHALL reject a second send request).

### Requirement 9: Tier Gating and Send Quotas

**User Story:** As a product owner, I want campaigns gated by tier with monthly send quotas, so that the activation layer is a value driver for paid plans and our send costs stay bounded.

#### Acceptance Criteria

1. WHILE a business is on the growth or pro tier, THE Campaign_API SHALL permit campaign creation and sending.
2. WHILE a business is on the starter or payg tier, THE Campaign_API SHALL reject campaign sending with a 402-style upgrade-required response, and the Dashboard_UI SHALL show a teaser with an upgrade call-to-action.
3. THE Campaign_Service SHALL enforce a per-calendar-month Send_Quota of recipients per tier (growth: 2000 recipients/month; pro: 10000 recipients/month) and SHALL reject a send that would exceed the remaining quota.
4. WHEN a send would partially exceed the remaining Send_Quota, THE Campaign_Service SHALL reject the send entirely and report the remaining quota, rather than sending a truncated campaign.
5. THE Campaign_Service SHALL require the `manage_campaigns` permission for campaign creation, sending, and cancellation, and SHALL grant `manage_campaigns` to the `owner` and `manager` roles only.

### Requirement 10: Asynchronous Delivery (Serverless Fan-Out)

**User Story:** As a developer, I want campaign delivery to run asynchronously in bounded batches, so that large campaigns never block an API request and we stay within Lambda limits.

#### Acceptance Criteria

1. WHEN a Campaign is sent, THE Campaign_Dispatcher SHALL resolve and filter recipients, then publish SQS messages each containing a batch of at most 100 recipient tokens.
2. THE Campaign_Sender SHALL process each SQS batch independently, delivering to each recipient and recording a Campaign_Send_Record per recipient.
3. IF a single recipient delivery fails, THEN THE Campaign_Sender SHALL record that recipient's outcome as `failed` and continue with the remaining recipients in the batch.
4. IF a Campaign_Sender invocation fails entirely, THEN the SQS message SHALL be retried up to 2 times before moving to a dead-letter queue, and other batches SHALL be unaffected.
5. THE Campaign_Dispatcher and Campaign_Sender SHALL run as `arm64` Lambdas with no dependency on any always-on resource.

### Requirement 11: Campaign Analytics and Attributed Return Visits

**User Story:** As a business owner, I want to see how a campaign performed, including how many recipients actually came back, so that I can judge its ROI.

#### Acceptance Criteria

1. THE Campaign_Service SHALL compute and expose, per Campaign: recipients targeted, recipients filtered out (by consent and by frequency cap), messages attempted, delivered by channel, and failed.
2. THE Campaign_Service SHALL compute Attributed_Return_Visits as the count of recipients who checked in at one of the Campaign's `nodeIds` within `attributionWindowDays` (default 14) after the Campaign was sent to them.
3. THE Campaign_API SHALL expose `GET /v1/business/me/campaigns/:campaignId` returning the Campaign with its current analytics, and `GET /v1/business/me/campaigns` returning a paginated list sorted by date descending.
4. THE Campaign_Service SHALL express analytics using only aggregated counts and Anonymized_Tokens — no individual consumer identifiers appear in any analytics response.
5. WHEN computing Attributed_Return_Visits, THE Campaign_Service SHALL count each returning recipient at most once per Campaign.

### Requirement 12: Opt-Out and Unsubscribe

**User Story:** As a consumer, I want to stop receiving campaigns from a business or from all businesses, so that I stay in control of promotional messaging.

#### Acceptance Criteria

1. THE Campaign feature SHALL provide a consumer-accessible mechanism to opt out of campaigns from a specific business and to opt out of all campaigns globally.
2. THE Campaign feature SHALL include an unsubscribe link in every campaign email and an in-app opt-out affordance for every campaign push.
3. WHEN a consumer opts out, THE Campaign_Dispatcher SHALL exclude that consumer from all subsequent matching campaigns starting with the next dispatch.
4. THE opt-out mechanism SHALL function without requiring the consumer to provide a phone number or to re-authenticate via SMS.

### Requirement 13: Dashboard Campaigns Panel

**User Story:** As a business owner, I want to manage campaigns from my dashboard, so that the whole flow lives in one place.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL add a "Campaigns" panel to the business dashboard navigation, visible only to roles holding the `manage_campaigns` permission.
2. THE Dashboard_UI SHALL provide a composer to choose a segment, write a title and body, select channels, optionally attach a reward, and preview the estimated recipient count before sending.
3. THE Dashboard_UI SHALL display a list of past campaigns with their status and headline analytics (recipients, delivered, attributed return visits).
4. WHILE the business is on the starter or payg tier, THE Dashboard_UI SHALL render the panel as a teaser with locked controls and an upgrade prompt.
5. THE Dashboard_UI SHALL show the estimated recipient count after consent and frequency-cap filtering, so the owner sees the realistic reach before sending.

### Requirement 14: Cost Guardrails and Data Retention

**User Story:** As a product owner, I want campaign data bounded and cheap to store, so that the feature fits our pay-per-use budget.

#### Acceptance Criteria

1. THE Campaign feature SHALL store all data in the existing `app-data` table (`PAY_PER_REQUEST`) and SHALL NOT create any new DynamoDB table, GSI, or always-on resource.
2. THE Campaign_Send_Records SHALL carry a DynamoDB TTL of 120 days from send, after which they expire automatically.
3. THE Campaign documents SHALL be retained for 13 months from creation via a TTL attribute, preserving roughly one year of campaign history for reporting.
4. THE Segment_Resolver SHALL bound a single resolution to at most the most-recent 10000 check-ins per node, falling back to a documented cap to keep DynamoDB read cost predictable.
