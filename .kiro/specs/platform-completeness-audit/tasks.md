# Implementation Plan: Platform Completeness Audit (Tier 1)

## Overview

This plan implements the 22 Tier 1 (must-have for launch) requirements across all five Area Code portals and the Fastify monolith backend. The implementation follows a dependency-driven order: privacy/safety foundation first (everything depends on it), then backend data enrichment, then portal features grouped by audience. All code is TypeScript. All infrastructure remains strictly serverless — Lambda, API Gateway HTTP API, DynamoDB PAY_PER_REQUEST, SQS, Cognito, Amplify hosting.

## Tasks

- [x] 1. Privacy and Safety Foundation (Requirement 22)
  - [x] 1.1 Add privacy attributes to the Users table and create PrivacyGuard module
    - Add `privacyLevel` (default `"friends_only"`), `isDisabled`, `disabledAt` attributes to the users table schema in `backend/src/features/auth/repository.ts`
    - Create `backend/src/shared/privacy/privacy-guard.ts` module that checks `privacyLevel`, block records, and mutual follows before exposing user activity
    - PrivacyGuard must fail closed — if privacy settings cannot be loaded, treat user as `"private"`
    - Create `backend/src/shared/privacy/types.ts` with `PrivacyLevel` type (`"public" | "friends_only" | "private"`)
    - Ensure new consumer accounts default to `privacyLevel = "friends_only"` in `consumerSignup` in `backend/src/features/auth/service.ts`
    - _Requirements: 22.1, 22.3, 22.4, 22.5_

  - [x] 1.2 Write property tests for PrivacyGuard module
    - **Property 22: New accounts default to friends_only privacy**
    - **Property 23: Privacy level controls visibility in social queries**
    - **Property 24: No GPS coordinates in consumer-facing responses**
    - **Property 25: Block enforcement across all social queries**
    - **Property 27: WebSocket privacy enforcement for non-public users**
    - Create `backend/src/__tests__/properties/privacy-guard.property.test.ts` using fast-check
    - **Validates: Requirements 22.1, 22.3, 22.4, 22.5, 22.7, 22.10**

  - [x] 1.3 Implement block and report data patterns in app-data table
    - Add block record CRUD in a new `backend/src/features/social/block-repository.ts` using pk `BLOCK#{blockerId}` / sk `BLOCKED#{blockedId}` and GSI1 `BLOCKED_BY#{blockedId}` / `BLOCKER#{blockerId}`
    - Add report record CRUD in a new `backend/src/features/social/report-repository.ts` using pk `REPORT#{reportId}` / sk `REPORT#{createdAt}` and GSI1 `REPORT_QUEUE` / `{priority}#{createdAt}`
    - Harassment/stalking reports must create high-priority abuse flags
    - _Requirements: 22.7, 22.8, 22.9_

  - [x] 1.4 Write property test for harassment report → high-priority flag
    - **Property 26: Harassment reports create high-priority abuse flags**
    - Create test in `backend/src/__tests__/properties/privacy-guard.property.test.ts`
    - **Validates: Requirements 22.9**

  - [x] 1.5 Add privacy and block API endpoints to the Fastify monolith
    - Register routes in `backend/src/features/auth/handler.ts` or a new `backend/src/features/privacy/handler.ts`:
      - `GET /v1/users/me/privacy` — return current privacy settings
      - `PATCH /v1/users/me/privacy` — update privacy level (validate: `public`, `friends_only`, `private`)
      - `POST /v1/users/me/block/:targetUserId` — block a user (reject self-block with 400)
      - `DELETE /v1/users/me/block/:targetUserId` — unblock a user
      - `GET /v1/users/me/blocks` — list blocked users
      - `POST /v1/reports` — submit a report (category: `harassment_report`, `stalking`, `other`)
    - _Requirements: 22.2, 22.7, 22.8, 22.9, 22.11_

  - [x] 1.6 Integrate PrivacyGuard into existing social service data flows
    - Modify `backend/src/features/social/service.ts` — `getActivityFeed`, `getCityLeaderboard`, `getWhoIsHere` to filter through PrivacyGuard before returning results
    - Modify `backend/src/features/check-in/service.ts` — `processCheckIn` to skip `emitFriendToast` for non-mutual-follows when user is `friends_only`, and skip all identity toasts when user is `private`
    - Modify city-wide `emitToast` to exclude identity data when user privacy is `friends_only` or `private`
    - Ensure blocked users are excluded from all social query results and WebSocket events
    - _Requirements: 22.3, 22.4, 22.5, 22.6, 22.7, 22.10_

  - [x] 1.7 Build consumer privacy settings UI
    - Create `PrivacySettingsPicker` component in `packages/shared/components/` — three-level selector (public, friends_only, private)
    - Create `PrivacyIndicator` component in `packages/shared/components/` — shows current privacy level on profile
    - Create `BlockUserButton` component in `packages/shared/components/` — block action for profiles/lists
    - Add `PrivacySettingsScreen` to consumer web (`apps/web/src/screens/`) and mobile (`apps/mobile/app/`) — privacy level picker + blocked users list
    - Add block action to user profiles, friend list, and "who's here" entries
    - _Requirements: 22.2, 22.8, 22.11_

  - [x] 1.8 Write unit tests for privacy endpoints and block logic
    - Test self-block returns 400
    - Test block/unblock round-trip
    - Test privacy level validation rejects invalid values
    - Test report submission creates high-priority flag for harassment category
    - _Requirements: 22.7, 22.8, 22.9_

- [x] 2. Checkpoint — Privacy foundation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Backend Data Enrichment (Requirements 16, 19, 20, 17, 18, 21)
  - [x] 3.1 Enrich check-in events with consumer details for business portal (Req 16)
    - Modify `processCheckIn` in `backend/src/features/check-in/service.ts` to include `displayName`, `tier`, and `visitCount` in the `emitBusinessCheckin` payload
    - Compute `visitCount` by querying the consumer's total check-ins at that specific node
    - Add new `business:checkin_detail` WebSocket event type in `backend/src/shared/socket/events.ts`
    - Write privacy-filtered business check-in cache records to app-data table (pk `BIZ_CHECKIN#{businessId}#{date}`)
    - Ensure payload contains ONLY `displayName` and `tier` — never phone, email, userId, cognitoSub, lat, lng
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 3.2 Write property tests for business check-in event privacy
    - **Property 6: Visit frequency computation**
    - **Property 7: Business check-in events contain only privacy-safe fields**
    - Create `backend/src/__tests__/properties/data-integrity.property.test.ts`
    - **Validates: Requirements 8.2, 8.5, 16.3, 16.4, 22.6**

  - [x] 3.3 Add staff redemption attribution (Req 19)
    - Modify the reward redemption flow in `backend/src/features/rewards/` to accept and persist `staffId` on the redemption record
    - Add `staffId` attribute to check-in/redemption records in the rewards table
    - Create `GET /v1/business/staff/:staffId/redemptions` endpoint in `backend/src/features/business/handler.ts` to query redemptions by staff member
    - _Requirements: 19.1, 19.2, 19.3_

  - [x] 3.4 Write property test for staff attribution
    - **Property 20: Staff attribution on redemption**
    - Add to `backend/src/__tests__/properties/data-integrity.property.test.ts`
    - **Validates: Requirements 19.1**

  - [x] 3.5 Implement notification pipeline via SQS (Reqs 17, 20)
    - Create `notification-sender` SQS queue infrastructure reference (env var `AREA_CODE_NOTIFICATION_QUEUE_URL`)
    - Create notification history data pattern in app-data table (pk `NOTIF#{userId}`, sk `NOTIF#{createdAt}`, 90-day TTL)
    - Extend `backend/src/features/notifications/service.ts` with `sendNotification` function that: checks user preferences, checks rate limits (max 2 reward notifications/day), persists to history, delivers via WebSocket (primary) or push (fallback)
    - Add `notification:new` WebSocket event in `backend/src/shared/socket/events.ts`
    - Add `tier:changed` WebSocket event in `backend/src/shared/socket/events.ts`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 20.1, 20.2, 20.3_

  - [x] 3.6 Implement new reward notification targeting
    - When a business creates a new reward, query consumers who checked in at that node within the past 30 days
    - Send notification via the notification pipeline with reward title, venue name, and reward type
    - Respect notification preferences and rate limits
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 3.7 Implement tier change detection and notification
    - Modify `backend/src/features/check-in/service.ts` — after `incrementTotalCheckIns` and tier recalculation, detect if tier changed
    - If tier changed, emit `tier:changed` WebSocket event with `{ oldTier, newTier, benefits[] }` and send notification via the notification pipeline
    - _Requirements: 20.1, 20.2, 20.3_

  - [x] 3.8 Write property tests for notification pipeline
    - **Property 13: Notification recipient targeting within time window**
    - **Property 14: Notification preference enforcement**
    - **Property 15: Notification rate limiting**
    - **Property 16: Notification channel selection**
    - **Property 21: Tier change notification contains correct data**
    - Create `backend/src/__tests__/properties/notification-pipeline.property.test.ts`
    - **Validates: Requirements 17.1, 17.3, 17.4, 17.5, 20.1, 20.2, 20.3**

  - [x] 3.9 Implement admin flag downstream actions (Req 18)
    - Create `POST /v1/admin/users/:userId/disable` in `backend/src/features/admin/handler.ts` — revoke Cognito tokens via `AdminUserGlobalSignOut`, set `isDisabled = true` on user record
    - Create `POST /v1/admin/businesses/:businessId/disable` — set `isActive = false` on all nodes owned by the business
    - Add `isDisabled` check to check-in and reward claim flows — reject with 403 `account_disabled`
    - Create audit log entry for every admin moderation action
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [x] 3.10 Write property tests for disable cascade
    - **Property 17: Disabled user is blocked from check-in and reward claims**
    - **Property 18: Disabling a business deactivates all its nodes**
    - **Property 19: Every admin action produces an audit log entry**
    - Create `backend/src/__tests__/properties/disable-cascade.property.test.ts`
    - **Validates: Requirements 18.2, 18.3, 18.4**

  - [x] 3.11 Implement abuse flag surfacing to admin (Req 21)
    - Ensure existing abuse flags from `backend/src/features/check-in/abuse.ts` are queryable via the admin API
    - Add `abuse:new_flag` WebSocket event emitted to `admin:flags` room when a new abuse flag is created
    - Ensure unreviewed flag count is included in admin dashboard metrics
    - _Requirements: 21.1, 21.2, 21.3_

- [x] 4. Checkpoint — Backend enrichment complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Consumer Portal Features (Requirements 1, 2, 3, 4, 5, 6, 7)
  - [x] 5.1 Implement check-in history API and UI (Req 1)
    - Create `GET /v1/users/me/check-in-history` endpoint with cursor-based pagination (the existing `getCheckInHistory` in auth service can be extended or a new route registered)
    - Create `PaginatedList` shared component in `packages/shared/components/` — cursor-based infinite scroll with error/retry
    - Create `CheckInHistoryScreen` in consumer web (`apps/web/src/screens/`) and mobile (`apps/mobile/app/`) — paginated list showing venue name, category, timestamp per entry
    - Use existing `Skeleton` component from `packages/shared/components/Skeleton.tsx` for loading states
    - Display error message with retry option on API failure
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 5.2 Write property tests for check-in history pagination
    - **Property 1: Pagination preserves ordering and completeness**
    - **Property 2: Check-in history entries contain required fields**
    - Create `backend/src/__tests__/properties/pagination.property.test.ts`
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 5.3 Implement tier progression API and UI (Req 2)
    - Create `GET /v1/users/me/tier-progress` endpoint in `backend/src/features/auth/handler.ts` — returns current tier, next tier threshold, check-ins remaining, and benefits per tier
    - Create `TierProgressBar` shared component in `packages/shared/components/` — visual progress toward next tier
    - Create `TierProgressionPanel` in consumer web and mobile — tier ladder with thresholds (local: 0–9, regular: 10–49, fixture: 50–149, institution: 150–499, legend: 500+) and benefits per tier
    - Display congratulatory notification on tier change (integrate with `tier:changed` WebSocket event from task 3.7)
    - Display number of additional check-ins required to reach next tier
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.4 Write property test for tier computation
    - **Property 3: Tier computation is correct for any check-in count**
    - Create `backend/src/__tests__/properties/tier-computation.property.test.ts`
    - **Validates: Requirements 2.4, 2.5**

  - [x] 5.5 Implement streak mechanics API and UI (Req 3)
    - Create `GET /v1/users/me/streak` endpoint — returns streak count, start date, at-risk status
    - Add `streakStartDate` attribute to users table if not already present
    - At-risk logic: streak > 0 AND last check-in date (SAST) is before today (SAST)
    - Create `StreakDisplay` shared component in `packages/shared/components/` — streak count with at-risk warning indicator
    - Create `StreakInfoPanel` in consumer web and mobile — explanation of streak mechanics, current count, start date, at-risk warning, and broken-streak message
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 5.6 Write property test for streak at-risk detection
    - **Property 4: Streak at-risk detection**
    - Create `backend/src/__tests__/properties/streak.property.test.ts`
    - **Validates: Requirements 3.3**

  - [x] 5.7 Implement venue text search for mobile (Req 4)
    - Create `GET /v1/nodes/search?q=` endpoint in `backend/src/features/nodes/handler.ts` — text search by venue name (case-insensitive, min 2 chars)
    - Create `SearchInput` shared component in `packages/shared/components/` — debounced text input with 300ms delay
    - Create `VenueSearchOverlay` in mobile app (`apps/mobile/`) — search input overlaying the map screen, results list, tap to center map and open venue detail sheet
    - Display "no results found" when query matches nothing; restore full venue list on clear
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.8 Write property test for venue search
    - **Property 5: Venue search returns only matching results**
    - Create `backend/src/__tests__/properties/venue-search.property.test.ts`
    - **Validates: Requirements 4.2**

  - [x] 5.9 Implement OTP back navigation for all portals (Req 5)
    - Create `POST /v1/auth/consumer/otp/cancel` endpoint — invalidate current OTP session by deleting `otp:session:{phone}` from KV store
    - Add back button to OTP verification screens in all portals: consumer web (`apps/web/`), consumer mobile (`apps/mobile/`), business (`apps/business/`), staff (`apps/staff/`)
    - Preserve previously entered phone number when navigating back
    - Call OTP cancel endpoint on back navigation to invalidate the session
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.10 Implement consumer onboarding flow (Req 6)
    - Add `onboardingComplete` attribute to users table (default `false`)
    - Create `POST /v1/users/me/onboarding/complete` endpoint — set `onboardingComplete = true`
    - Create `OnboardingFlow` shared component in `packages/shared/components/` — step-based carousel with skip action
    - Create `OnboardingScreen` in consumer web and mobile — 5 steps: map navigation, checking in, earning rewards, leaderboard, music preferences
    - Show onboarding after first signup+OTP verification only when `onboardingComplete === false`
    - Persist completion state so flow is not shown again
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.11 Implement global error boundary and API error interceptor (Req 7)
    - Create `ErrorBoundary` shared component in `packages/shared/components/` — catches unhandled React errors, logs to Sentry, displays recovery screen with reload button
    - Create `ErrorToast` shared component — contextual error messages with retry action
    - Create shared API error interceptor in `packages/shared/lib/` (or `packages/shared/hooks/`):
      - Network errors → "Connection lost. Check your internet and try again." + retry
      - HTTP 5xx → "Something went wrong. Please try again." + retry
      - HTTP 4xx → extract `message` from response body
      - HTTP 429 → extract `cooldownUntil` and display countdown
    - Wrap root component of each portal app (`apps/web`, `apps/mobile`, `apps/business`, `apps/staff`, `apps/admin`) in `ErrorBoundary`
    - Ensure check-in failure retains venue detail sheet open and displays specific reason
    - Ensure staff redemption failure displays specific error (invalid_code, already_redeemed, expired_code)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 6. Checkpoint — Consumer portal features complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Business Portal Features (Requirements 8, 9)
  - [x] 7.1 Implement individual check-in details API and UI (Req 8)
    - Create `GET /v1/business/check-ins?date=&cursor=` endpoint in `backend/src/features/business/handler.ts` — returns individual check-in details for the business's nodes, filtered by date, with cursor pagination
    - Query business check-in cache from app-data table (populated by task 3.1)
    - Create `CheckInDetailPanel` in `apps/business/src/screens/panels/` — list of individual check-ins with display name, tier, visit frequency (first-time / returning / regular), timestamp
    - Subscribe to `business:checkin_detail` WebSocket event to append new check-ins in real time
    - Add date range filter control
    - Respect consumer privacy — display only display names and tiers, never phone numbers or personal identifiers
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 7.2 Implement reward performance metrics API and UI (Req 9)
    - Create `GET /v1/business/rewards/:rewardId/metrics` endpoint — returns claim rate, time-to-claim, redemption rate
    - Create `GET /v1/business/rewards/summary` endpoint — returns all active rewards ranked by claim rate descending
    - Add `claimedCount`, `firstClaimedAt`, `redeemedCount` attributes to rewards table records
    - Create `RewardMetricsPanel` in `apps/business/src/screens/panels/` — per-reward metrics display with claim rate, time-to-claim, redemption rate
    - Display low-performance indicator when a reward has zero claims after 7 days active
    - Display summary comparison of all active rewards ranked by claim rate
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 7.3 Write property tests for reward metrics
    - **Property 8: Reward rate metrics are correctly bounded**
    - **Property 9: Reward summary is sorted by claim rate**
    - Create `backend/src/__tests__/properties/reward-metrics.property.test.ts`
    - **Validates: Requirements 9.1, 9.3, 9.5**

  - [x] 7.4 Implement staff redemption attribution UI (Req 19 — business portal side)
    - Create `StaffRedemptionPanel` in `apps/business/src/screens/panels/` — redemptions filtered by staff member
    - Display staff member name, reward title, and redemption timestamp for each entry
    - Add staff member filter dropdown
    - _Requirements: 19.2, 19.3_

- [x] 8. Checkpoint — Business portal features complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Staff Portal Features (Requirements 10, 11, 12)
  - [x] 9.1 Implement QR code scanner (Req 10)
    - Create `QrScanner` shared component in `packages/shared/components/` — camera-based QR code scanner with viewfinder overlay
    - Create `POST /v1/staff/redeem/scan` endpoint in `backend/src/features/staff/handler.ts` — accepts scanned redemption code
    - Add QR scanner button to `apps/staff/src/screens/StaffHome.tsx`
    - Auto-submit code when QR scanner reads a valid redemption code
    - Fall back to manual code entry if camera access is denied or unsupported
    - Display error for unrecognized QR format
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 9.2 Implement reward preview before validation (Req 11)
    - Create `GET /v1/staff/redeem/:code/preview` endpoint — returns reward title, type, description, consumer display name, and tier
    - Create `RedemptionPreview` shared component in `packages/shared/components/` — displays reward details before confirmation
    - Display specific error reason (invalid_code, already_redeemed, expired_code) without proceeding to confirmation if code is invalid
    - Require explicit confirm action from staff member
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 9.3 Implement redemption confirmation screen (Req 12)
    - Create `POST /v1/staff/redeem/:code/confirm` endpoint — confirms redemption, records `staffId` attribution
    - Create `RedemptionResult` shared component in `packages/shared/components/` — success/failure confirmation screen
    - Display success screen with reward title and redemption timestamp (minimum 3 seconds before allowing navigation)
    - Display failure screen with specific error reason
    - Provide button to return to scanner/code entry for next redemption
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 9.4 Wire the 4-step redemption flow in Staff Portal
    - Integrate QR scanner → preview → confirm → result as a single `RedemptionFlow` in `apps/staff/src/screens/`
    - Connect to existing `StaffHome` screen with a prominent "Scan Redemption" button
    - Ensure the flow handles all error states from the design's error handling table (invalid_code, already_redeemed, expired_code, camera permission denied)
    - _Requirements: 10.1, 11.1, 12.1_

- [x] 10. Checkpoint — Staff portal features complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Admin Portal Features (Requirements 13, 14, 15)
  - [x] 11.1 Implement admin dashboard overview API and UI (Req 13)
    - Create `GET /v1/admin/dashboard` endpoint in `backend/src/features/admin/handler.ts` — returns summary metrics: total consumers, total businesses, total check-ins (all-time + today), active rewards, pending reports count, pending erasure requests count
    - Store daily metrics in app-data table (pk `METRICS#DAILY`, sk `METRICS#{date}`) computed on-demand with 60s KV cache
    - Create `DashboardOverview` screen in `apps/admin/src/screens/` — display all metrics, set as default landing view for super_admin
    - Auto-refresh metrics every 60 seconds via polling
    - Display unreviewed abuse flag count (from task 3.11)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 11.2 Implement abuse flag dashboard API and UI (Reqs 14, 21)
    - Create `GET /v1/admin/abuse-flags` endpoint — returns unreviewed abuse flags ordered by creation date descending, including harassment reports from Req 22
    - Create `POST /v1/admin/abuse-flags/:flagId/review` endpoint — mark flag as reviewed, create audit log entry
    - Create `POST /v1/admin/abuse-flags/:flagId/action` endpoint — take action (reset flags, disable user) from flag detail view
    - Create `AbuseFlagDashboard` screen in `apps/admin/src/screens/` — flag list with type, affected user, evidence data; review/action workflow
    - Display unreviewed flag count as badge on navigation tab
    - Subscribe to `abuse:new_flag` WebSocket event for real-time flag appearance
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 21.1, 21.2, 21.3_

  - [x] 11.3 Write property tests for abuse flag ordering and admin audit
    - **Property 10: Abuse flags are ordered by creation date descending**
    - **Property 19: Every admin action produces an audit log entry**
    - Add to `backend/src/__tests__/properties/admin-ordering.property.test.ts`
    - **Validates: Requirements 14.1, 18.4**

  - [x] 11.4 Implement admin audit trail viewer API and UI (Req 15)
    - Create `GET /v1/admin/audit-logs` endpoint — paginated audit log with filters for adminId, action type, date range
    - Use existing audit log data pattern (pk `AUDIT#{logId}`, GSI1 `AUDIT_LOGS`) with FilterExpression for action type filtering
    - Create `AuditTrailViewer` screen in `apps/admin/src/screens/` — chronological list with admin ID, action type, target entity, timestamp, before/after state
    - Add filter controls for admin ID, action type, and date range
    - Support paginated loading with cursor-based pagination
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 11.5 Write property tests for audit log filtering and pagination
    - **Property 11: Audit log filtering returns only matching entries**
    - **Property 12: Audit log pagination preserves completeness**
    - Create `backend/src/__tests__/properties/admin-ordering.property.test.ts`
    - **Validates: Requirements 15.3, 15.5**

  - [x] 11.6 Wire admin disable actions to downstream consequences (Req 18 — admin UI side)
    - Add "Disable User" and "Disable Business" actions to admin consumer/business management screens
    - Connect to `POST /v1/admin/users/:userId/disable` and `POST /v1/admin/businesses/:businessId/disable` endpoints (implemented in task 3.9)
    - Display confirmation dialog before executing disable action
    - Show audit log entry creation confirmation
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

- [x] 12. Final Checkpoint — All Tier 1 features complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all 22 Tier 1 requirements have corresponding implementations.
  - Verify privacy model (Req 22) is enforced across all data flows.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each logical group
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Requirement 22 (Privacy/Safety) is implemented first because all other data flows depend on the PrivacyGuard module
- All infrastructure remains strictly serverless — no ECS, RDS, ElastiCache, ALB, or NAT Gateway
- All DynamoDB operations use the existing `app-data` single-table design with PAY_PER_REQUEST billing
