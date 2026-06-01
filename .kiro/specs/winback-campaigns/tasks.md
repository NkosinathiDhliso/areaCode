# Implementation Plan: Win-Back Campaigns

## Overview

This plan implements the activation layer that turns Venue Intelligence Report insights into customer-reaching campaigns delivered via the platform's existing email (SES) and push (Expo / Web Push) rails. Work is organized bottom-up: types and pure resolution/eligibility logic first (with property tests), then the async delivery pipeline (dispatcher + sender Lambdas), the service and API with tier gating and quotas, infrastructure (Terraform), and finally the dashboard panel plus the one-tap hook from the reports recommendation.

Binding constraints throughout: **no SMS / no phone** (`.kiro/steering/no-sms-no-phone-auth.md`) and **serverless-only** (`.kiro/steering/serverless-only.md`). Delivery reuses `backend/src/features/notifications/service.ts` (push) and `backend/src/shared/email/ses.ts` (email). Storage reuses the `app-data` table — no new tables or GSIs.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "4.1", "4.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.3"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["5.1", "5.3"] },
    { "id": 5, "tasks": ["5.2", "5.4"] },
    { "id": 6, "tasks": ["5.5"] },
    { "id": 7, "tasks": ["6"] },
    { "id": 8, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 9, "tasks": ["7.5", "8.1"] },
    { "id": 10, "tasks": ["8.2", "8.3"] },
    { "id": 11, "tasks": ["8.4"] },
    { "id": 12, "tasks": ["9"] },
    { "id": 13, "tasks": ["10.1", "10.2", "10.3", "10.4", "11.1", "11.2", "11.3"] },
    { "id": 14, "tasks": ["10.5"] },
    { "id": 15, "tasks": ["12"] }
  ]
}
```

## Tasks

- [x] 1. Define campaign types, Zod schemas, and tokenization utilities
  - [x] 1.1 Create campaign types and Zod schemas
    - Create `backend/src/features/campaigns/types.ts`
    - Define interfaces: `Campaign`, `CampaignStatus`, `Segment`, `CreateCampaignInput`, `CampaignSummary`, `CampaignWithAnalytics`, `CampaignAnalytics`, `RecipientEstimate`, `CampaignSendRecord`, `CampaignSendMessage`, `DispatchCampaignEvent`
    - Define Zod `createCampaignBodySchema`: `segment` enum (`lapsed`/`first_timers`/`regulars`/`all_past_visitors`), `title` ≤80, `body` ≤500, `channels` array with element enum **exactly** `['push','email']`, `nodeIds` non-empty, optional `rewardId`, optional `lapsedWindowDays` int 7–90, optional `reportId`
    - Define `sendCampaignBodySchema` (optional `scheduledAt` ISO) and pagination query schema
    - There MUST be no phone/SMS field anywhere in these types (Constraint C1)
    - _Requirements: 1.2, 1.4, 5.3, 5.4_

  - [x] 1.2 Create tokenization utility
    - Create `backend/src/features/campaigns/anonymize.ts`
    - Implement `recipientToken(userId, campaignId, campaignSalt): string` (SHA-256, no userId retained)
    - Implement `generateCampaignSalt(): string`
    - _Requirements: 11.4, C1_

  - [x]\* 1.3 Write property test for channel enum closure (no SMS)
    - **Property 4: Channel Enum Closure (No SMS)**
    - Create `backend/src/features/campaigns/__tests__/types.property.test.ts`
    - Generate random channel arrays including invalid values; assert only `{push,email}` subsets parse, and serialized campaigns contain no phone field
    - **Validates: Requirements 5.3, 5.4, C1**

- [x] 2. Implement segment resolver
  - [x] 2.1 Implement segment resolution
    - Create `backend/src/features/campaigns/segment-resolver.ts`
    - Implement `resolveSegment(input): Promise<string[]>` reusing `getCheckInsByNode` pagination (mirror `notifyNewRewardConsumers` pattern), capped at the most-recent 10000 check-ins per node
    - Build per-user `{count, lastCheckInMs}` merged across the campaign's nodes
    - Apply rules: `lapsed` (visited before cutoff AND last check-in older than `lapsedWindowDays`), `first_timers` (total count === 1), `regulars` (tier ≥ regular), `all_past_visitors` (any)
    - Return deduped userIds; surface `truncated` when the cap is hit
    - Never use phone as an identifier (C1)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 14.4_

  - [x]\* 2.2 Write property test for lapsed segment exclusivity
    - **Property 1: Lapsed Segment Exclusivity**
    - Create `backend/src/features/campaigns/__tests__/segment-resolver.property.test.ts`
    - Assert: lapsed set = users with a check-in before cutoff and none within window; no in-window user present
    - **Validates: Requirements 2.1, 2.3**

  - [x]\* 2.3 Write property tests for dedup and first-timers
    - **Property 2: Segment Deduplication** and **Property 3: First-Timers Correctness**
    - In the same test file as 2.2
    - Assert: userId appearing at multiple nodes counted once; `first_timers` = users with total count exactly 1
    - **Validates: Requirements 2.2, 3.1, 3.4**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement consent, opt-out, and frequency-cap eligibility
  - [x] 4.1 Implement eligibility filters
    - Create `backend/src/features/campaigns/eligibility.ts`
    - Implement `filterByConsentAndOptOut(userIds, businessId)`: exclude users without `marketingConsent` (absent = not granted) and users with a `COPTOUT#<userId>` row for the business or `ALL`
    - Implement `filterByFrequencyCap(userIds)` and `incrementFrequencyCap(userId)` using `kvGet`/`kvIncr` (key `campaign:freqcap:<userId>`, window 7 days, max 4)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 12.3_

  - [x] 4.2 Implement opt-out repository + marketing consent read
    - Create `backend/src/features/campaigns/repository.ts` (or extend) with `getOptOuts(userId)`, `putOptOut(userId, businessId|'ALL')`, and a helper to batch-read `marketingConsent` from the users table
    - Add `marketingConsent` read path (field on user record; default absent)
    - _Requirements: 6.1, 6.2, 6.4, 12.1, 12.3_

  - [x]\* 4.3 Write property tests for consent default, opt-out, and frequency cap
    - **Property 5: Consent Opt-In Default**, **Property 6: Opt-Out Honored**, **Property 7: Frequency Cap Bound**
    - Create `backend/src/features/campaigns/__tests__/eligibility.property.test.ts`
    - Assert: absent consent → excluded; global/per-business opt-out → excluded; cap never exceeded and capped users excluded
    - **Validates: Requirements 6.1, 6.2, 6.4, 7.1, 7.4, 12.3**

- [x] 5. Implement delivery pipeline (dispatcher + sender)
  - [x] 5.1 Implement campaign dispatcher Lambda
    - Create `backend/src/features/campaigns/dispatcher.ts`
    - Handle `DispatchCampaignEvent`; assert campaign is `sending` (send-now) or a due `scheduled`
    - Resolve segment → consent/opt-out filter → frequency-cap filter → quota assertion
    - Tokenize recipients; chunk into batches of ≤100; publish one SQS message per batch with `{ campaignId, businessId, recipients:[{token,userId}] }`
    - Persist targeted/filtered counts on the campaign run
    - _Requirements: 6.1, 6.2, 7.1, 9.3, 9.4, 10.1, 10.5_

  - [x]\* 5.2 Write property test for batch partitioning invariant
    - **Property 10: Batch Partitioning Invariant**
    - Create `backend/src/features/campaigns/__tests__/dispatcher.property.test.ts`
    - Assert: batches are disjoint, each ≤100, union equals eligible set exactly
    - **Validates: Requirements 10.1**

  - [x] 5.3 Add campaign email sender to SES module
    - Add `sendCampaignEmail(to, businessName, subject, bodyText, unsubscribeUrl)` to `backend/src/shared/email/ses.ts`
    - Include `List-Unsubscribe` header and a visible unsubscribe link in the body
    - _Requirements: 5.2, 12.2_

  - [x] 5.4 Implement campaign sender Lambda
    - Create `backend/src/features/campaigns/sender.ts`
    - Handle SQS `CampaignSendMessage`; per recipient deliver push via `sendNotification` (type `campaign`) and/or email via `sendCampaignEmail` (verified email resolved via Cognito)
    - Write one `Campaign_Send_Record` (`pk=CSEND#<campaignId>`, `sk=CSEND#<token>`, TTL 120 days) with outcome `delivered_push|delivered_email|delivered_both|no_channel|failed`
    - Increment frequency cap once per recipient when any attempt is made; continue on individual failure
    - _Requirements: 5.1, 5.2, 5.5, 7.2, 10.2, 10.3, 11.4, 14.2_

  - [x]\* 5.5 Write property test for send-record anonymity
    - **Property 11: Send-Record Anonymity**
    - Create `backend/src/features/campaigns/__tests__/sender.property.test.ts`
    - Assert: serialized send records / analytics contain no UUID userId, cognitoSub, email, or phone — only tokens and counts
    - **Validates: Requirements 11.4, 6, C1**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement campaign service (lifecycle, quotas, analytics)
  - [x] 7.1 Implement campaign persistence + lifecycle
    - In `service.ts` + `repository.ts`: `createCampaign` (status `draft`, `pk=CAMPAIGN#<businessId>`, GSI1 list keys, TTL 13 months), `listCampaigns`, `getCampaign`, `cancelCampaign` (only `draft`/`scheduled`)
    - `sendCampaign`: validate node ownership and optional `rewardId` ownership; transition `draft`→`sending` (now) or `scheduled` (future `scheduledAt`); reject re-send of `sending`/`sent`
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 8.1, 8.2, 8.4, 8.5, 8.6_

  - [x] 7.2 Implement send-quota enforcement
    - Implement per-business per-month recipient quota (growth 2000, pro 10000) via KV counter `campaign:quota:<businessId>:<yyyy-mm>`
    - Reject a send whole when eligible count exceeds remaining quota; never truncate
    - _Requirements: 9.3, 9.4_

  - [x] 7.3 Implement recipient estimate (pre-send, post-filter)
    - Implement `estimateRecipients` running segment + consent/opt-out + frequency-cap filters without sending, returning the realistic reach and `truncated` flag
    - _Requirements: 13.2, 13.5, 14.4_

  - [x] 7.4 Implement analytics + attributed return visits
    - Implement `computeAnalytics`: aggregate send-record outcomes; compute Attributed_Return_Visits by re-resolving recipient tokens against post-send `getCheckInsByNode` at campaign nodes within `attributionWindowDays` (default 14), counting each recipient at most once
    - _Requirements: 11.1, 11.2, 11.4, 11.5_

  - [x]\* 7.5 Write property tests for quota, idempotency, and attribution
    - **Property 8: Quota Non-Truncation**, **Property 9: Send Idempotency**, **Property 12: Attribution Single-Count**
    - Create `backend/src/features/campaigns/__tests__/service.property.test.ts`
    - Assert: send proceeds iff `n ≤ remaining` (else 0 dispatched); re-send rejected once `sending`/`sent`; attribution counts each recipient once and only within window
    - **Validates: Requirements 8.6, 9.3, 9.4, 11.2, 11.5**

- [x] 8. Implement campaign API routes with tier gating and permissions
  - [x] 8.1 Add `manage_campaigns` permission
    - Add `manage_campaigns` to the `owner` and `manager` permission arrays in `backend/src/features/business/types.ts` (`ROLE_PERMISSIONS`)
    - Surface the permission to the frontend role/permission payload
    - _Requirements: 9.5_

  - [x] 8.2 Create campaign API handler
    - Create `backend/src/features/campaigns/handler.ts` with routes: create, list, detail, estimate, send, cancel — all under `requireAuth('business','staff')` + `requireBusinessPermission('manage_campaigns')`
    - Apply tier gating: starter/payg → 402 `upgrade_required` on send; growth/pro → permitted
    - Map service errors to statuses (403 node ownership, 409 quota/already_sent, 404 not found)
    - Register routes in `backend/src/app.ts`
    - _Requirements: 1.1, 8.2, 8.4, 9.1, 9.2, 9.5, 11.3_

  - [x] 8.3 Implement consumer opt-out + signed unsubscribe
    - Add `POST /v1/users/me/campaign-optout` (consumer auth, `{ businessId? }`) and `GET /v1/campaigns/unsubscribe?token=...` (signed token, no login) writing `COPTOUT#` rows
    - Unsubscribe MUST work without phone or SMS re-auth
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]\* 8.4 Write property test for tier gating + integration tests
    - **Property 13: Tier Gating**
    - Create `backend/src/features/campaigns/__tests__/tier-gating.property.test.ts` and `handler.integration.test.ts`
    - Assert: starter/payg send → upgrade-required and 0 dispatched; growth/pro → permitted subject to quota; verify auth, permission, and end-to-end create→send→analytics with stubbed `sendNotification`/SES
    - **Validates: Requirements 9.1, 9.2**

- [ ] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Add Terraform infrastructure for campaign delivery
  - [ ] 10.1 Add campaign-dispatcher Lambda
    - Add `module "lambda_campaign_dispatcher"` in `infra/environments/dev/main.tf` using `../../modules/lambda`, arm64, timeout=60, memory=512
    - Env vars for table names, SQS queue URL, campaign salt; IAM read on checkins/nodes/users, read/write app-data, SQS send to campaign-send queue
    - No VPC Interface Endpoints, no NAT, no always-on resources (C2)
    - _Requirements: 10.1, 10.5, 14.1_

  - [ ] 10.2 Add campaign-sender Lambda
    - Add `module "lambda_campaign_sender"` arm64, timeout=120, memory=512
    - IAM: SES send, read users (verified email), read/write app-data, WebSocket manage (for `sendNotification` socket path), SQS receive/delete on campaign-send queue
    - _Requirements: 5.1, 5.2, 10.2, 10.5_

  - [ ] 10.3 Add SQS campaign-send queue + DLQ
    - Add `module "sqs_campaign_send"` using `../../modules/sqs`, visibility_timeout=150, max_receive_count=2, with DLQ
    - Wire event source mapping to campaign-sender Lambda
    - _Requirements: 10.4_

  - [ ] 10.4 Add EventBridge scheduled-campaign tick
    - Add `campaign-scheduled-tick`: `rate(5 minutes)` triggering campaign-dispatcher to pick up due `scheduled` campaigns
    - _Requirements: 8.3_

  - [ ] 10.5 Mirror infrastructure into prod environment
    - Replicate 10.1–10.4 in `infra/environments/prod/main.tf` (no ECS/RDS/ElastiCache/ALB/NAT; budget unchanged)
    - _Requirements: 14.1, C2_

- [ ] 11. Implement dashboard CampaignsPanel and report one-tap hook
  - [ ] 11.1 Add "campaigns" panel to business dashboard navigation
    - Add `'campaigns'` to `DashboardPanel` type, `PANELS`, `PANEL_LABELS`, and `PANEL_PERMISSIONS` (`manage_campaigns`) in `BusinessDashboard.tsx` / `businessStore.ts`
    - Add lazy import + `renderPanel()` case; add i18n key `biz.panel.campaigns`
    - _Requirements: 13.1_

  - [ ] 11.2 Create CampaignsPanel component
    - Create `apps/business/src/screens/panels/CampaignsPanel.tsx`
    - Composer: segment select, title/body, channel toggles (push/email only), optional reward attach, recipient estimate preview (post-filter), send-now / schedule
    - History list with status + headline analytics (recipients, delivered, attributed return visits)
    - Starter/payg → teaser with locked controls + upgrade prompt
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

  - [ ] 11.3 Wire one-tap win-back from report retention recommendation
    - In `ReportsPanel.tsx`, render a "Create win-back campaign" CTA next to `retention`-type recommendations; opening the composer pre-filled with `lapsed` segment, report `nodeIds`, suggested copy, and `reportId`
    - For starter/payg, replace CTA with upgrade prompt
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property/integration tests and can be deferred for a faster MVP, but each maps to a correctness property in the design.
- **No SMS / no phone**: delivery is email + push only; the `channels` Zod enum structurally forbids anything else, and no phone field exists in any type. See `.kiro/steering/no-sms-no-phone-auth.md`.
- **Serverless-only**: all new compute is arm64 Lambda + SQS + EventBridge; storage is the existing `app-data` table (`PAY_PER_REQUEST`). No new tables/GSIs, no ECS/RDS/ElastiCache/ALB/NAT, no VPC interface endpoints. See `.kiro/steering/serverless-only.md`.
- Delivery reuses `notifications/service.ts` (push) and `shared/email/ses.ts` (email); frequency cap reuses the DynamoDB KV helper; fan-out mirrors the venue-intelligence-reports dispatcher/generator shape.
- Marketing consent is opt-in by default and separate from transactional notification preferences (POPIA).
- All consumer data in send records and analytics is anonymized to per-campaign tokens; campaign documents contain zero consumer identifiers.
