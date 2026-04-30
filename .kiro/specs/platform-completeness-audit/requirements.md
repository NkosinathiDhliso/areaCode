# Requirements Document: Platform Completeness Audit

## Introduction

Area Code is a South African location-based loyalty and check-in platform with five portals: Consumer Web, Consumer Mobile, Business, Staff, and Admin. A deep architecture audit has identified 75 gaps across all portals, backend data flows, and market-specific needs. This requirements document captures every gap as a structured requirement, organized by priority tier: Must-Have for Launch (blocks core user journeys), Important for Scale (limits growth and retention), and Nice-to-Have (market differentiation). The platform runs on a strictly serverless AWS stack (Lambda, API Gateway, DynamoDB, SQS, Cognito, Amplify) with 4 Cognito user pools, WebSocket for real-time updates, and End User Messaging v2 for SMS OTP.

## Glossary

- **Consumer_Portal**: The web and mobile applications used by end consumers to discover venues, check in, earn rewards, view leaderboards, and manage their profiles
- **Business_Portal**: The web application used by business owners to manage venues (nodes), rewards, staff, audience analytics, payments, and boosts
- **Staff_Portal**: The web application used by venue staff to validate reward redemptions
- **Admin_Portal**: The web application used by platform administrators (super_admin, support_agent, content_moderator) to moderate users, businesses, reports, consent, and archetypes
- **Node**: A venue or location registered on the platform where consumers can check in
- **Check_In**: The act of a consumer registering their presence at a Node via GPS proximity or QR code scan
- **Reward**: An incentive (freebie, discount, BOGO) offered by a business at a Node, claimable by consumers after check-in
- **Redemption_Code**: A unique code generated for a consumer after reward evaluation, used by staff to validate and complete the reward claim
- **Tier**: A consumer loyalty level (local, regular, fixture, institution, legend) determined by total check-in count
- **Streak**: A consecutive-day check-in counter maintained per consumer
- **Pulse_Score**: A real-time activity score for a Node, computed from daily check-in count and unique visitors
- **Archetype**: A music-based personality classification resolved from a consumer's genre preferences and dimension scores
- **Crowd_Vibe**: An aggregate music profile of currently checked-in consumers at a Node, including genre counts, archetype percentages, and dimension scores
- **Abuse_Flag**: A record created by the check-in abuse detection system (device_velocity, new_account_velocity, reward_drain) stored in DynamoDB
- **Audit_Log**: A record of admin actions (reset_abuse_flags, send_message, extend_trial, etc.) created by the Admin service
- **POPIA**: Protection of Personal Information Act — South African data privacy legislation requiring consent management and data erasure capabilities
- **Yoco**: A South African payment gateway used for business plan subscriptions and boost purchases
- **Boost**: A paid promotion that increases a Node's visibility on the consumer map for a specified duration (2hr, 6hr, 24hr)
- **SQS_Reward_Queue**: An AWS SQS queue that receives check-in events for asynchronous reward evaluation
- **WebSocket_Server**: The Socket.IO server that delivers real-time pulse updates, toast notifications, business check-in events, and friend activity
- **Notification_Service**: The backend service that delivers notifications via WebSocket (primary) with push notification fallback (Expo for mobile, VAPID for web)
- **Load_Shedding**: Scheduled power outages in South Africa that may affect venue operations
- **MAU**: Monthly Active Users
- **DAU**: Daily Active Users

---

## TIER 1: MUST-HAVE FOR LAUNCH

### Requirement 1: Check-In History View

**User Story:** As a consumer, I want to view my past check-ins, so that I can recall which venues I visited and when.

#### Acceptance Criteria

1. WHEN a consumer navigates to the check-in history section, THE Consumer_Portal SHALL display a paginated list of past check-ins ordered by date descending
2. THE Consumer_Portal SHALL display the venue name, category, and timestamp for each check-in history entry
3. WHEN the consumer scrolls to the end of the current page, THE Consumer_Portal SHALL load the next page of check-in history using cursor-based pagination
4. WHILE the check-in history is loading, THE Consumer_Portal SHALL display a skeleton loading state
5. IF the check-in history API request fails, THEN THE Consumer_Portal SHALL display an error message with a retry option

### Requirement 2: Tier Progression UI

**User Story:** As a consumer, I want to understand how the tier system works and what I need to do to advance, so that I am motivated to check in more frequently.

#### Acceptance Criteria

1. THE Consumer_Portal SHALL display the consumer's current tier alongside a visual progress indicator showing advancement toward the next tier
2. WHEN a consumer views the tier progression section, THE Consumer_Portal SHALL display the check-in thresholds required for each tier level (local, regular, fixture, institution, legend)
3. THE Consumer_Portal SHALL display the specific benefits associated with each tier level
4. WHEN a consumer's tier changes after a check-in, THE Consumer_Portal SHALL display a congratulatory notification indicating the new tier achieved
5. THE Consumer_Portal SHALL display the number of additional check-ins required to reach the next tier

### Requirement 3: Streak Mechanics Explanation

**User Story:** As a consumer, I want to understand how streaks work, so that I can maintain and grow my streak intentionally.

#### Acceptance Criteria

1. WHEN a consumer views the streak section on the profile screen, THE Consumer_Portal SHALL display an explanation of how streaks are calculated (consecutive days with at least one check-in)
2. THE Consumer_Portal SHALL display the consumer's current streak count alongside the streak start date
3. WHEN a consumer's streak is at risk of breaking (no check-in today and streak is active), THE Consumer_Portal SHALL display a visual warning indicator
4. IF a consumer's streak resets to zero, THEN THE Consumer_Portal SHALL display a message explaining that the streak was broken due to a missed day

### Requirement 4: Venue Text Search

**User Story:** As a consumer, I want to search for venues by name, so that I can quickly find a specific venue without browsing the map or filtering by category.

#### Acceptance Criteria

1. THE Consumer_Portal SHALL provide a text search input on the map screen that accepts venue name queries
2. WHEN a consumer enters a search query of two or more characters, THE Consumer_Portal SHALL display matching venues filtered by name within 300 milliseconds of the last keystroke
3. WHEN a consumer selects a search result, THE Consumer_Portal SHALL center the map on the selected venue and open the venue detail sheet
4. IF no venues match the search query, THEN THE Consumer_Portal SHALL display a "no results found" message
5. WHEN the search input is cleared, THE Consumer_Portal SHALL restore the full venue list with any active category filter applied

### Requirement 5: OTP Back Navigation

**User Story:** As a consumer, I want to go back from the OTP verification step to correct my phone number, so that I am not stuck if I entered the wrong number.

#### Acceptance Criteria

1. WHILE the OTP verification screen is displayed, THE Consumer_Portal SHALL display a back button that returns the consumer to the phone number entry screen
2. WHEN the consumer presses the back button on the OTP screen, THE Consumer_Portal SHALL preserve the previously entered phone number in the input field
3. WHEN the consumer presses the back button on the OTP screen, THE Consumer_Portal SHALL invalidate the current OTP session for the original phone number

### Requirement 6: Consumer Onboarding Flow

**User Story:** As a new consumer, I want a guided onboarding experience after signup, so that I understand how to use the platform's core features.

#### Acceptance Criteria

1. WHEN a consumer completes signup and OTP verification for the first time, THE Consumer_Portal SHALL present a structured onboarding flow
2. THE Consumer_Portal SHALL include onboarding steps that explain: map navigation, checking in at a venue, earning rewards, viewing the leaderboard, and setting music preferences
3. THE Consumer_Portal SHALL allow the consumer to skip the onboarding flow at any step
4. WHEN the consumer completes or skips the onboarding flow, THE Consumer_Portal SHALL persist the onboarding completion state so the flow is not shown again
5. THE Consumer_Portal SHALL display the onboarding flow identically on both web and mobile platforms

### Requirement 7: API Error Recovery

**User Story:** As a consumer, I want clear feedback when something goes wrong, so that I know what happened and can take corrective action.

#### Acceptance Criteria

1. WHEN an API request fails with a network error, THE Consumer_Portal SHALL display a user-visible error message describing the failure
2. WHEN an API request fails with a server error (HTTP 5xx), THE Consumer_Portal SHALL display a generic error message with a retry action
3. WHEN an API request fails with a client error (HTTP 4xx), THE Consumer_Portal SHALL display a specific error message derived from the API error response body
4. WHEN a check-in request fails, THE Consumer_Portal SHALL display the failure reason (cooldown active, too far from venue, QR expired) and retain the venue detail sheet in its open state
5. IF a reward redemption request fails, THEN THE Staff_Portal SHALL display the specific failure reason (invalid_code, already_redeemed, expired_code) to the staff member
6. THE Consumer_Portal SHALL implement a global error boundary that catches unhandled exceptions and displays a recovery screen with a reload option


### Requirement 8: Business Individual Check-In Details

**User Story:** As a business owner, I want to see individual check-in details (who checked in, when, their tier, and visit frequency), so that I can understand my customer base beyond aggregate counts.

#### Acceptance Criteria

1. WHEN a business owner views the Live panel, THE Business_Portal SHALL display a list of individual check-ins for the current day, including consumer display name (if the consumer is not anonymous), tier, and timestamp
2. THE Business_Portal SHALL display the visit frequency (first-time, returning, regular) for each individual check-in entry
3. WHEN a new check-in occurs at the business's Node, THE Business_Portal SHALL append the new check-in entry to the list in real time via WebSocket
4. THE Business_Portal SHALL allow the business owner to filter check-in details by date range
5. THE Business_Portal SHALL respect consumer privacy by displaying only display names and tiers, not phone numbers or other personal identifiers

### Requirement 9: Reward Performance Metrics

**User Story:** As a business owner, I want to see how my rewards are performing, so that I can optimize my reward offerings.

#### Acceptance Criteria

1. WHEN a business owner views the Rewards panel, THE Business_Portal SHALL display the claim rate (claimed count divided by total slots) for each active reward
2. THE Business_Portal SHALL display the average time-to-claim (time between reward activation and first claim) for each reward
3. THE Business_Portal SHALL display the redemption rate (redeemed count divided by claimed count) for each reward
4. WHEN a reward has zero claims after 7 days of being active, THE Business_Portal SHALL display a low-performance indicator
5. THE Business_Portal SHALL display a summary comparison of all active rewards ranked by claim rate

### Requirement 10: Staff QR Code Scanner

**User Story:** As a staff member, I want to scan a consumer's redemption QR code with my device camera, so that I can validate rewards quickly without manual code entry.

#### Acceptance Criteria

1. THE Staff_Portal SHALL provide a QR code scanner interface that uses the device camera to read redemption codes
2. WHEN the QR scanner reads a valid redemption code, THE Staff_Portal SHALL automatically submit the code for validation
3. WHILE the device camera is active for QR scanning, THE Staff_Portal SHALL display a viewfinder overlay indicating the scan area
4. IF the device does not support camera access or the user denies camera permission, THEN THE Staff_Portal SHALL fall back to the manual code entry interface
5. WHEN the QR scanner reads an unrecognized format, THE Staff_Portal SHALL display an error message indicating the code format is invalid

### Requirement 11: Reward Details Before Validation

**User Story:** As a staff member, I want to see the reward details before confirming a redemption, so that I know what I am giving the consumer.

#### Acceptance Criteria

1. WHEN a redemption code is entered or scanned, THE Staff_Portal SHALL display the reward title, type (freebie, discount, BOGO), and description before the staff member confirms the redemption
2. THE Staff_Portal SHALL display the consumer's display name and tier associated with the redemption code
3. THE Staff_Portal SHALL require the staff member to explicitly confirm the redemption after reviewing the details
4. IF the redemption code is invalid, already redeemed, or expired, THEN THE Staff_Portal SHALL display the specific error reason without proceeding to the confirmation step

### Requirement 12: Redemption Confirmation Screen

**User Story:** As a staff member, I want a clear success or failure screen after validating a redemption, so that I can confidently communicate the result to the consumer.

#### Acceptance Criteria

1. WHEN a redemption is successfully completed, THE Staff_Portal SHALL display a prominent success confirmation screen showing the reward title and redemption timestamp
2. IF a redemption fails, THEN THE Staff_Portal SHALL display a prominent failure screen with the specific error reason (invalid_code, already_redeemed, expired_code)
3. WHEN the confirmation screen is displayed, THE Staff_Portal SHALL provide a button to return to the scanner or code entry interface for the next redemption
4. THE Staff_Portal SHALL display the success confirmation for a minimum of 3 seconds before allowing navigation away

### Requirement 13: Admin Dashboard Overview

**User Story:** As an admin, I want a summary dashboard showing key platform metrics, so that I can monitor platform health at a glance.

#### Acceptance Criteria

1. WHEN a super_admin logs into the Admin_Portal, THE Admin_Portal SHALL display a dashboard overview as the default landing view
2. THE Admin_Portal SHALL display the following summary metrics: total registered consumers, total registered businesses, total check-ins (all-time and today), and total active rewards
3. THE Admin_Portal SHALL display the count of pending reports in the report queue
4. THE Admin_Portal SHALL display the count of pending erasure requests
5. THE Admin_Portal SHALL refresh the dashboard metrics automatically every 60 seconds

### Requirement 14: Abuse Flag Dashboard

**User Story:** As an admin, I want to see abuse flags created by the backend detection system, so that I can review and act on suspicious activity.

#### Acceptance Criteria

1. WHEN a super_admin navigates to the abuse flags section, THE Admin_Portal SHALL display a list of unreviewed abuse flags ordered by creation date descending
2. THE Admin_Portal SHALL display the flag type (device_velocity, new_account_velocity, reward_drain), the affected user identifier, and the evidence data for each flag
3. WHEN an admin reviews an abuse flag, THE Admin_Portal SHALL allow the admin to mark the flag as reviewed
4. WHEN an admin reviews an abuse flag, THE Admin_Portal SHALL allow the admin to take action (reset flags, disable user) directly from the flag detail view
5. THE Admin_Portal SHALL display the count of unreviewed abuse flags as a badge on the navigation tab

### Requirement 15: Admin Audit Trail Viewer

**User Story:** As an admin, I want to view the audit trail of admin actions, so that I can ensure accountability and review past decisions.

#### Acceptance Criteria

1. WHEN a super_admin navigates to the audit trail section, THE Admin_Portal SHALL display a chronological list of admin actions from the audit log
2. THE Admin_Portal SHALL display the admin identifier, action type, target entity type, target entity identifier, and timestamp for each audit log entry
3. THE Admin_Portal SHALL allow filtering audit logs by admin identifier, action type, and date range
4. THE Admin_Portal SHALL display the before-state and after-state data when available for an audit log entry
5. THE Admin_Portal SHALL support paginated loading of audit log entries

### Requirement 16: Cross-Portal Check-In Data Flow

**User Story:** As a business owner, I want to see detailed check-in data (who, when, tier, frequency) when a consumer checks in at my venue, so that I have actionable customer intelligence.

#### Acceptance Criteria

1. WHEN a consumer checks in at a Node, THE Check_In_Service SHALL include the consumer's display name, tier, and visit count for that Node in the WebSocket event emitted to the business room
2. WHEN the Business_Portal receives a check-in WebSocket event, THE Business_Portal SHALL display the individual check-in details in the Live panel
3. THE Check_In_Service SHALL compute the consumer's visit frequency (total check-ins at that specific Node) and include the count in the business check-in event payload
4. THE Check_In_Service SHALL respect consumer privacy by excluding phone numbers and personal identifiers from the business check-in event payload

### Requirement 17: New Reward Push Notification

**User Story:** As a consumer, I want to receive a notification when a new reward becomes available near me, so that I do not miss time-limited offers.

#### Acceptance Criteria

1. WHEN a business creates a new reward at a Node, THE Notification_Service SHALL send a push notification to consumers who have checked in at that Node within the past 30 days
2. THE Notification_Service SHALL include the reward title, venue name, and reward type in the push notification payload
3. THE Notification_Service SHALL respect the consumer's notification preferences before sending the push notification
4. THE Notification_Service SHALL rate-limit new reward notifications to a maximum of 2 per consumer per day
5. WHILE a consumer has an active WebSocket connection, THE Notification_Service SHALL deliver the new reward notification via WebSocket instead of push

### Requirement 18: Admin Flag Downstream Actions

**User Story:** As an admin, I want flagging a user to trigger downstream consequences, so that moderation actions have real platform impact.

#### Acceptance Criteria

1. WHEN an admin disables a consumer account, THE Admin_Service SHALL revoke the consumer's Cognito tokens immediately
2. WHEN an admin disables a consumer account, THE Admin_Service SHALL prevent the consumer from checking in or claiming rewards until the account is re-enabled
3. WHEN an admin disables a business account, THE Admin_Service SHALL mark all Nodes owned by that business as inactive, hiding them from the consumer map
4. WHEN an admin takes a moderation action against a user, THE Admin_Service SHALL create an audit log entry recording the action, admin identifier, and timestamp

### Requirement 19: Staff Redemption Attribution

**User Story:** As a business owner, I want to see which staff member redeemed each reward, so that I can track staff activity and accountability.

#### Acceptance Criteria

1. WHEN a staff member redeems a reward, THE Rewards_Service SHALL record the staff member's identifier alongside the redemption record
2. WHEN a business owner views recent redemptions, THE Business_Portal SHALL display the staff member's name, the reward title, and the redemption timestamp for each entry
3. THE Business_Portal SHALL allow filtering recent redemptions by staff member

### Requirement 20: Tier Change Notification

**User Story:** As a consumer, I want to be notified when my tier changes, so that I am aware of my new status and any unlocked benefits.

#### Acceptance Criteria

1. WHEN a consumer's tier changes after a check-in, THE Notification_Service SHALL send a notification to the consumer indicating the new tier and any newly unlocked benefits
2. WHILE the consumer has an active WebSocket connection, THE Notification_Service SHALL deliver the tier change notification via WebSocket
3. IF the consumer does not have an active WebSocket connection, THEN THE Notification_Service SHALL deliver the tier change notification via push notification

### Requirement 21: Abuse Flag Surfacing to Admin

**User Story:** As an admin, I want abuse flags created by the check-in abuse detection system to be visible in the Admin Portal, so that automated detection feeds into human review.

#### Acceptance Criteria

1. WHEN the Check_In_Service creates an abuse flag (device_velocity, new_account_velocity, reward_drain), THE Admin_Portal SHALL display the flag in the abuse flags section within 60 seconds
2. THE Admin_Portal SHALL display the total count of unreviewed abuse flags on the admin dashboard overview
3. WHEN an admin marks an abuse flag as reviewed, THE Admin_Portal SHALL remove the flag from the unreviewed list and record the review action in the audit log

### Requirement 22: Anti-Stalking and Location Privacy Safeguards

**User Story:** As a consumer, I want to control who can see my location and check-in activity, so that I am protected from stalking, harassment, and unwanted tracking.

#### Acceptance Criteria

1. THE Consumer_Portal SHALL default all new accounts to "friends only" visibility for check-in activity — only mutual follows can see where the consumer has checked in
2. THE Consumer_Portal SHALL provide a privacy setting with three levels: "public" (anyone on leaderboard/feed), "friends only" (mutual follows), and "private" (nobody sees check-in activity)
3. WHEN a consumer's privacy is set to "private", THE Social_Service SHALL exclude the consumer's check-ins from the public feed, leaderboard, and "who's here" lists
4. WHEN a consumer's privacy is set to "friends only", THE Social_Service SHALL only include the consumer's check-ins in feeds and "who's here" lists visible to mutual follows
5. THE Consumer_Portal SHALL NOT display real-time location data (GPS coordinates) to any other consumer under any privacy setting — only venue name and check-in timestamp are shareable
6. THE Business_Portal SHALL display consumer check-in data using display names and tiers only — THE Business_Portal SHALL NEVER display phone numbers, exact check-in times to the minute, or any data that could enable tracking a specific individual's movement pattern
7. WHEN a consumer blocks another consumer, THE Social_Service SHALL prevent the blocked consumer from seeing the blocker's check-ins, profile, or presence in any "who's here" list
8. THE Consumer_Portal SHALL provide a "block user" action accessible from any user profile, friend list, or "who's here" entry
9. WHEN a consumer reports another consumer for harassment or stalking, THE Admin_Service SHALL create a high-priority abuse flag with type "harassment_report" that appears at the top of the admin abuse flag queue
10. THE Check_In_Service SHALL NOT include the consumer's check-in in any real-time WebSocket event visible to non-friends when the consumer's privacy is set to "friends only" or "private"
11. THE Consumer_Portal SHALL display a privacy indicator on the profile screen showing the current visibility level
12. THE Admin_Portal SHALL provide a "stalking/harassment" report category with escalated review priority and the ability to immediately disable the reported account pending review

---

## TIER 2: IMPORTANT FOR SCALE

### Requirement 23: Mobile Settings Screen

**User Story:** As a mobile consumer, I want a settings screen where I can manage notification preferences, language, and app configuration, so that I can customize my experience.

#### Acceptance Criteria

1. THE Consumer_Portal (mobile) SHALL provide a settings screen accessible from the profile tab
2. THE Consumer_Portal (mobile) SHALL allow the consumer to toggle notification preferences (streak at risk, reward activated, reward claimed, leaderboard pre-warning, followed user check-in)
3. THE Consumer_Portal (mobile) SHALL allow the consumer to select a preferred language from available translations
4. WHEN the consumer changes a notification preference, THE Consumer_Portal SHALL persist the change to the Notification_Service within 5 seconds

### Requirement 23: In-App Notification Center

**User Story:** As a consumer, I want to view a history of my notifications, so that I can review past alerts I may have missed.

#### Acceptance Criteria

1. THE Consumer_Portal SHALL provide a notification center accessible from the main navigation
2. THE Consumer_Portal SHALL display notifications in reverse chronological order with a timestamp and read/unread status
3. WHEN a consumer opens the notification center, THE Consumer_Portal SHALL mark all visible notifications as read
4. THE Notification_Service SHALL persist all notifications sent to a consumer (WebSocket and push) in a notification history table
5. THE Consumer_Portal SHALL support paginated loading of notification history

### Requirement 24: Social Sharing

**User Story:** As a consumer, I want to share my check-ins and achievements on social media, so that I can invite friends and show off my activity.

#### Acceptance Criteria

1. WHEN a consumer completes a check-in, THE Consumer_Portal SHALL offer a share action that generates a shareable link or image
2. THE Consumer_Portal SHALL support sharing to at least WhatsApp, Instagram Stories, and Twitter via the native share sheet
3. THE Consumer_Portal SHALL include the venue name, consumer's tier, and a branded Area Code watermark in the shareable content

### Requirement 25: Achievement and Badge System

**User Story:** As a consumer, I want to earn badges for milestones beyond tier progression, so that I have additional goals to work toward.

#### Acceptance Criteria

1. THE Consumer_Portal SHALL display a badges section on the profile screen showing earned and locked badges
2. WHEN a consumer reaches a milestone (first check-in, 10 check-ins, 50 check-ins, first reward claimed, 7-day streak, 30-day streak, checked in at 5 different venues), THE Consumer_Portal SHALL award the corresponding badge
3. WHEN a badge is earned, THE Notification_Service SHALL send a notification to the consumer
4. THE Consumer_Portal SHALL display the criteria required to unlock each locked badge

### Requirement 26: Referral System

**User Story:** As a consumer, I want to invite friends and earn rewards for successful referrals, so that I am incentivized to grow the platform.

#### Acceptance Criteria

1. THE Consumer_Portal SHALL generate a unique referral code for each consumer
2. WHEN a referred consumer completes signup and their first check-in, THE Rewards_Service SHALL credit a referral reward to the referring consumer
3. THE Consumer_Portal SHALL display the consumer's referral code, total successful referrals, and earned referral rewards on the profile screen
4. THE Consumer_Portal SHALL provide a share action for the referral code via the native share sheet

### Requirement 27: Offline Data Caching

**User Story:** As a consumer on a limited data plan, I want the app to cache essential data locally, so that I can browse previously loaded content without an active connection.

#### Acceptance Criteria

1. THE Consumer_Portal (mobile) SHALL cache the most recently loaded venue list, profile data, and reward list in local storage
2. WHILE the device is offline, THE Consumer_Portal (mobile) SHALL display cached venue data with a visual indicator that the data may be stale
3. WHEN the device regains connectivity, THE Consumer_Portal (mobile) SHALL refresh cached data automatically
4. THE Consumer_Portal (mobile) SHALL limit the local cache size to 10 megabytes

### Requirement 28: Business Payment and Billing History

**User Story:** As a business owner, I want to view my payment history, so that I can track my spending and verify charges.

#### Acceptance Criteria

1. WHEN a business owner navigates to the billing section, THE Business_Portal SHALL display a chronological list of all payments processed via Yoco
2. THE Business_Portal SHALL display the payment amount, date, plan or boost type, and payment status (succeeded, failed) for each entry
3. WHEN a Yoco webhook event is processed, THE Business_Service SHALL persist the payment event details (amount, status, plan, timestamp) in a payment history table
4. THE Business_Portal SHALL support paginated loading of payment history

### Requirement 29: Staff Performance Tracking

**User Story:** As a business owner, I want to see how many redemptions each staff member has processed, so that I can evaluate staff performance.

#### Acceptance Criteria

1. WHEN a business owner views the staff management section, THE Business_Portal SHALL display the total redemption count for each staff member
2. THE Business_Portal SHALL display the most recent redemption timestamp for each staff member
3. THE Business_Portal SHALL allow sorting staff members by redemption count

### Requirement 30: Venue Operating Hours

**User Story:** As a business owner, I want to set operating hours for my venues, so that consumers know when my venue is open.

#### Acceptance Criteria

1. THE Business_Portal SHALL allow the business owner to set opening and closing times for each day of the week per Node
2. WHEN a consumer views a Node on the map, THE Consumer_Portal SHALL display the venue's operating hours
3. WHEN a venue is currently outside its operating hours, THE Consumer_Portal SHALL display an "Currently Closed" indicator on the venue detail sheet
4. IF a consumer attempts to check in at a venue outside its operating hours, THEN THE Check_In_Service SHALL allow the check-in but display a warning that the venue may be closed

### Requirement 31: Venue Open/Closed Status

**User Story:** As a business owner, I want to manually set my venue as open or closed (for load shedding or other reasons), so that consumers have accurate availability information.

#### Acceptance Criteria

1. THE Business_Portal SHALL provide a toggle for each Node to manually set the venue status to open or closed
2. WHEN a business owner changes a venue's status, THE Business_Portal SHALL update the status in real time via the API
3. WHEN a venue is marked as closed, THE Consumer_Portal SHALL display a "Closed" badge on the venue marker and detail sheet
4. WHEN a venue is marked as closed, THE Consumer_Portal SHALL still allow the consumer to view venue details but SHALL display a warning that the venue is currently closed

### Requirement 32: Peak Hours Analysis

**User Story:** As a business owner, I want to see when my venue is busiest, so that I can optimize staffing and promotions.

#### Acceptance Criteria

1. WHEN a business owner views the Audience panel, THE Business_Portal SHALL display a peak hours chart showing check-in distribution by hour of day
2. THE Business_Service SHALL compute peak hours from check-in timestamp data aggregated over the past 30 days
3. THE Business_Portal SHALL highlight the top 3 busiest hours for the venue

### Requirement 33: Churn Indicators

**User Story:** As a business owner, I want to be alerted when regular customers stop visiting, so that I can take retention actions.

#### Acceptance Criteria

1. THE Business_Service SHALL identify consumers who checked in at least 3 times in the past 30 days but have not checked in during the most recent 14 days
2. WHEN churned consumers are identified, THE Business_Portal SHALL display a "Regulars at Risk" section in the Audience panel with the count of at-risk consumers
3. THE Business_Portal SHALL display the last check-in date for each at-risk consumer (display name and tier only, no personal identifiers)

### Requirement 34: System Health Monitoring

**User Story:** As an admin, I want visibility into system health metrics, so that I can identify and respond to technical issues.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a system health section showing Lambda error rates for the past 24 hours
2. THE Admin_Portal SHALL display DynamoDB throttling event counts for the past 24 hours
3. THE Admin_Portal SHALL display SMS OTP delivery success rates for the past 24 hours
4. THE Admin_Portal SHALL display WebSocket active connection count
5. IF any health metric exceeds a warning threshold (Lambda error rate above 5%, DynamoDB throttling above 0, SMS delivery rate below 90%), THEN THE Admin_Portal SHALL display a warning indicator

### Requirement 35: Financial Overview for Admin

**User Story:** As an admin, I want to see revenue and payment metrics, so that I can track platform financial health.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display total revenue processed via Yoco for the current month and previous month
2. THE Admin_Portal SHALL display the count of active paid business subscriptions by plan tier (starter, growth, pro, payg)
3. THE Admin_Portal SHALL display the count of businesses currently in payment grace period
4. THE Admin_Portal SHALL display total boost revenue for the current month

### Requirement 36: Admin Bulk Actions

**User Story:** As an admin, I want to perform actions on multiple users or businesses at once, so that I can manage the platform efficiently at scale.

#### Acceptance Criteria

1. THE Admin_Portal SHALL allow selecting multiple consumers from the consumer management list
2. WHEN multiple consumers are selected, THE Admin_Portal SHALL allow the admin to perform bulk actions (disable accounts, reset abuse flags, send message)
3. THE Admin_Portal SHALL allow selecting multiple businesses from the business management list
4. WHEN multiple businesses are selected, THE Admin_Portal SHALL allow the admin to perform bulk actions (extend trial, deactivate)
5. THE Admin_Portal SHALL display a confirmation dialog before executing any bulk action, showing the count of affected entities

### Requirement 37: Admin Advanced Filtering

**User Story:** As an admin, I want to filter users and businesses by date range, status, and tier, so that I can find specific records efficiently.

#### Acceptance Criteria

1. THE Admin_Portal SHALL provide filter controls for consumer search including: registration date range, tier, account status (active, disabled), and city
2. THE Admin_Portal SHALL provide filter controls for business search including: registration date range, plan tier, payment status (active, grace, expired), and city
3. WHEN filters are applied, THE Admin_Portal SHALL update the search results to reflect the active filters
4. THE Admin_Portal SHALL allow combining text search with filter controls

### Requirement 38: Admin Data Export

**User Story:** As an admin, I want to export user, business, and report data, so that I can perform offline analysis and generate reports.

#### Acceptance Criteria

1. THE Admin_Portal SHALL provide an export action for consumer search results in CSV format
2. THE Admin_Portal SHALL provide an export action for business search results in CSV format
3. THE Admin_Portal SHALL provide an export action for the report queue in CSV format
4. THE Admin_Portal SHALL include all visible columns in the exported CSV file
5. WHEN an export is initiated, THE Admin_Portal SHALL generate the file asynchronously and provide a download link upon completion

### Requirement 39: Reward Code Push Notification

**User Story:** As a consumer, I want to receive a push notification when a reward code is generated for me, so that I do not miss claimable rewards.

#### Acceptance Criteria

1. WHEN the SQS_Reward_Queue evaluator generates a redemption code for a consumer, THE Notification_Service SHALL send a notification to the consumer with the reward title and venue name
2. THE Notification_Service SHALL deliver the notification via WebSocket if the consumer has an active connection, or via push notification otherwise
3. THE Notification_Service SHALL rate-limit reward code notifications to a maximum of 2 per consumer per day

### Requirement 40: Leaderboard Reset Notification

**User Story:** As a consumer, I want to be notified of my final leaderboard rank when the weekly leaderboard resets, so that I know how I performed.

#### Acceptance Criteria

1. WHEN the weekly leaderboard resets, THE Notification_Service SHALL send a notification to each consumer who had at least one check-in during the week, including their final rank and check-in count
2. THE Notification_Service SHALL send the leaderboard reset notification within 1 hour of the reset event
3. THE Notification_Service SHALL deliver the notification via push notification (not WebSocket) since the reset occurs at a scheduled time

### Requirement 41: Unsurfaced Abuse Flag Remediation

**User Story:** As an admin, I want all backend-created abuse flags to appear in the Admin Portal, so that no automated detection goes unreviewed.

#### Acceptance Criteria

1. THE Admin_Service SHALL provide an API endpoint that returns all unreviewed abuse flags from the DynamoDB appData table
2. THE Admin_Portal SHALL query the abuse flags endpoint and display results in the abuse flags section
3. THE Admin_Portal SHALL display the flag type, evidence JSON, creation timestamp, and auto-actioned status for each flag

### Requirement 42: Load Shedding Awareness

**User Story:** As a consumer, I want to see which venues may be affected by load shedding, so that I do not travel to a closed venue.

#### Acceptance Criteria

1. WHEN a business owner marks a venue as closed due to load shedding, THE Consumer_Portal SHALL display a "Load Shedding" badge on the venue marker
2. THE Business_Portal SHALL provide a "closed due to load shedding" option distinct from a general "closed" status
3. THE Consumer_Portal SHALL allow filtering the map to hide venues currently affected by load shedding

### Requirement 43: Data-Light Mode

**User Story:** As a consumer on a limited data plan, I want a data-light mode that reduces bandwidth usage, so that I can use the app without exhausting my data allocation.

#### Acceptance Criteria

1. THE Consumer_Portal (mobile) SHALL provide a data-light mode toggle in the settings screen
2. WHILE data-light mode is active, THE Consumer_Portal (mobile) SHALL disable automatic image loading and use text-only venue markers
3. WHILE data-light mode is active, THE Consumer_Portal (mobile) SHALL reduce API polling frequency by 50 percent
4. WHILE data-light mode is active, THE Consumer_Portal (mobile) SHALL disable WebSocket connections and use polling-only for updates

### Requirement 44: MAU and DAU Tracking

**User Story:** As a platform stakeholder, I want to track monthly and daily active user counts, so that I can measure platform engagement.

#### Acceptance Criteria

1. THE Admin_Service SHALL compute and store DAU (distinct consumers with at least one API request per day) and MAU (distinct consumers with at least one API request per calendar month)
2. THE Admin_Portal SHALL display DAU and MAU metrics on the dashboard overview with a 7-day trend chart
3. THE Admin_Service SHALL compute DAU and MAU using DynamoDB counters updated on each authenticated consumer API request

### Requirement 45: Check-In Velocity Trends

**User Story:** As a platform stakeholder, I want to see check-in volume trends over time, so that I can measure platform growth.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a check-in velocity chart showing daily check-in counts for the past 30 days
2. THE Admin_Service SHALL aggregate daily check-in counts from the check-in table and store them in a daily metrics record
3. THE Admin_Portal SHALL display the week-over-week percentage change in check-in volume

### Requirement 46: Reward Claim Rate Metrics

**User Story:** As a platform stakeholder, I want to see platform-wide reward claim rates, so that I can assess the effectiveness of the reward system.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display the platform-wide reward claim rate (total claims divided by total available slots) on the dashboard overview
2. THE Admin_Portal SHALL display the claim rate broken down by reward type (freebie, discount, BOGO)
3. THE Admin_Service SHALL compute claim rate metrics daily and store them in a metrics record

---

## TIER 3: NICE-TO-HAVE (Market Differentiation)

### Requirement 47: Consumer "Who's Here" View

**User Story:** As a consumer, I want to see who else is checked in at a venue (friends and anonymous counts), so that I can decide whether to visit.

#### Acceptance Criteria

1. WHEN a consumer views a venue detail sheet, THE Consumer_Portal SHALL display the total count of currently checked-in consumers
2. THE Consumer_Portal SHALL display the names and avatars of mutual friends currently checked in at the venue
3. THE Consumer_Portal SHALL display the tier distribution of checked-in consumers without revealing non-friend identities

### Requirement 48: Venue Reviews and Ratings

**User Story:** As a consumer, I want to rate and review venues I have visited, so that I can share my experience with other consumers.

#### Acceptance Criteria

1. WHEN a consumer has checked in at a venue at least once, THE Consumer_Portal SHALL allow the consumer to submit a rating (1 to 5 stars) and an optional text review
2. THE Consumer_Portal SHALL display the average rating and review count on the venue detail sheet
3. THE Consumer_Portal SHALL display the most recent reviews on the venue detail sheet with the reviewer's display name and tier
4. THE Consumer_Portal SHALL allow a consumer to edit or delete their own review

### Requirement 49: Consumer Crowd Vibe Display

**User Story:** As a consumer, I want to see the music vibe of a venue's current crowd, so that I can find venues that match my music taste.

#### Acceptance Criteria

1. WHEN a consumer views a venue detail sheet, THE Consumer_Portal SHALL display the crowd vibe data including top genres and dominant archetype
2. THE Consumer_Portal SHALL display the aggregate dimension scores as a visual radar chart
3. WHEN the crowd vibe data is empty (no checked-in consumers with music preferences), THE Consumer_Portal SHALL display a "No vibe data yet" placeholder

### Requirement 50: Competitor Comparison for Business

**User Story:** As a business owner, I want to see how my venue compares to nearby competitors, so that I can benchmark my performance.

#### Acceptance Criteria

1. WHEN a business owner views the Audience panel, THE Business_Portal SHALL display anonymized aggregate metrics for nearby venues within a 2-kilometer radius
2. THE Business_Portal SHALL display the business's check-in rank relative to nearby venues
3. THE Business_Portal SHALL not reveal the names or specific metrics of individual competitor venues

### Requirement 51: Boost ROI Metrics

**User Story:** As a business owner, I want to see the return on investment for my boosts, so that I can decide whether to purchase more.

#### Acceptance Criteria

1. WHEN a business owner views the Boost panel, THE Business_Portal SHALL display a before/after comparison of check-in counts for each completed boost
2. THE Business_Portal SHALL display the cost per incremental check-in for each boost
3. THE Business_Portal SHALL display the total boost spend and total incremental check-ins for the current month

### Requirement 52: Invoice and Receipt Download

**User Story:** As a business owner, I want to download invoices for my payments, so that I can use them for accounting and tax purposes.

#### Acceptance Criteria

1. THE Business_Portal SHALL provide a download action for each payment in the billing history that generates a PDF invoice
2. THE Business_Portal SHALL include the business name, payment amount, date, VAT number (if provided), and payment reference on the invoice
3. THE Business_Portal SHALL include the Area Code company details and South African VAT registration on the invoice

### Requirement 53: Business Data Export

**User Story:** As a business owner, I want to export my analytics data, so that I can perform custom analysis outside the platform.

#### Acceptance Criteria

1. THE Business_Portal SHALL provide an export action for check-in data in CSV format
2. THE Business_Portal SHALL provide an export action for audience analytics in CSV format
3. THE Business_Portal SHALL provide an export action for reward performance data in CSV format
4. THE Business_Portal SHALL include date range selection for all data exports

### Requirement 54: Staff Shift Management

**User Story:** As a staff member, I want to clock in and out of my shifts, so that the business can track my working hours.

#### Acceptance Criteria

1. THE Staff_Portal SHALL provide a clock-in and clock-out button on the home screen
2. WHEN a staff member clocks in, THE Staff_Portal SHALL record the shift start time
3. WHEN a staff member clocks out, THE Staff_Portal SHALL record the shift end time and calculate the shift duration
4. THE Business_Portal SHALL display shift history for each staff member in the staff management section

### Requirement 55: Staff Personal Performance Stats

**User Story:** As a staff member, I want to see my own redemption statistics, so that I can track my performance.

#### Acceptance Criteria

1. THE Staff_Portal SHALL display the staff member's total redemption count for the current day and current week
2. THE Staff_Portal SHALL display the staff member's average redemptions per shift
3. THE Staff_Portal SHALL display a list of the staff member's recent redemptions with reward title and timestamp

### Requirement 56: Refund and Reversal Capability

**User Story:** As a staff member, I want to reverse an incorrect redemption, so that mistakes can be corrected.

#### Acceptance Criteria

1. WHEN a staff member views a recent redemption, THE Staff_Portal SHALL provide a reversal action within 15 minutes of the redemption
2. WHEN a reversal is initiated, THE Rewards_Service SHALL restore the reward slot and invalidate the redemption record
3. THE Staff_Portal SHALL require the staff member to provide a reason for the reversal
4. THE Rewards_Service SHALL create an audit log entry for each reversal

### Requirement 57: Admin Notification for High-Priority Events

**User Story:** As an admin, I want to be notified of high-priority events (erasure requests, abuse spikes), so that I can respond promptly.

#### Acceptance Criteria

1. WHEN a new POPIA erasure request is submitted, THE Admin_Service SHALL send a notification to all super_admin users
2. WHEN the count of unreviewed abuse flags exceeds 10 within a 1-hour window, THE Admin_Service SHALL send an abuse spike notification to all super_admin users
3. THE Admin_Service SHALL deliver admin notifications via email (SES) since admins may not have the Admin_Portal open

### Requirement 58: Impersonation Audit Trail in UI

**User Story:** As an admin, I want to view the impersonation audit trail in the Admin Portal, so that I can review all impersonation sessions.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a dedicated impersonation log section showing all impersonation sessions
2. THE Admin_Portal SHALL display the admin identifier, target user identifier, target account type, note, start time, and end time for each impersonation session
3. THE Admin_Portal SHALL allow filtering impersonation logs by admin identifier and date range

### Requirement 59: Pulse Decay History Persistence

**User Story:** As a platform stakeholder, I want pulse score history to be persisted for trend analysis, so that venue activity patterns can be studied over time.

#### Acceptance Criteria

1. THE Check_In_Service SHALL persist pulse score snapshots for each Node at 15-minute intervals in a time-series DynamoDB table
2. THE Business_Portal SHALL display a pulse score trend chart for the past 7 days on the Live panel
3. THE Admin_Portal SHALL display pulse score trends for any Node in the system health section

### Requirement 60: Leaderboard History View

**User Story:** As a consumer, I want to view past leaderboard results, so that I can see my historical rankings.

#### Acceptance Criteria

1. THE Consumer_Portal SHALL provide a leaderboard history section showing past weekly leaderboard results
2. THE Consumer_Portal SHALL display the consumer's rank and check-in count for each past week
3. THE Consumer_Portal SHALL display the top 10 entries for each past weekly leaderboard

### Requirement 61: Consumer Music Dimension Scores Display

**User Story:** As a consumer, I want to see my music dimension scores, so that I understand how my archetype was determined.

#### Acceptance Criteria

1. WHEN a consumer views the music section on the profile screen, THE Consumer_Portal SHALL display the consumer's dimension scores (energy, cultural_rootedness, sophistication, edge, spirituality) as a visual radar chart
2. THE Consumer_Portal SHALL display the consumer's resolved archetype name and description alongside the dimension scores
3. WHEN a consumer has no music preferences set, THE Consumer_Portal SHALL display a prompt to set genre preferences or connect a streaming service

### Requirement 62: Check-In Type Breakdown

**User Story:** As a business owner, I want to see the breakdown of check-in types (reward vs presence) at my venue, so that I can understand consumer intent.

#### Acceptance Criteria

1. THE Business_Portal SHALL display the ratio of reward check-ins to presence check-ins on the Audience panel
2. THE Business_Portal SHALL display the check-in type breakdown as a daily trend chart for the past 30 days

### Requirement 63: Notification Delivery Status Tracking

**User Story:** As a platform operator, I want to track notification delivery status, so that I can identify delivery failures and improve reliability.

#### Acceptance Criteria

1. THE Notification_Service SHALL record the delivery status (delivered_socket, delivered_push, failed, no_tokens) for each notification sent
2. THE Admin_Portal SHALL display notification delivery success rates on the system health section
3. THE Admin_Portal SHALL display the count of consumers with no active push tokens

### Requirement 64: Payment Webhook Event Viewer

**User Story:** As an admin, I want to view processed Yoco webhook events, so that I can debug payment issues.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a list of processed Yoco webhook events with event type, business identifier, amount, and timestamp
2. THE Admin_Portal SHALL allow filtering webhook events by event type (payment.succeeded, payment.failed) and date range
3. THE Admin_Portal SHALL display the full webhook payload for each event in an expandable detail view

### Requirement 65: USSD Fallback Channel

**User Story:** As a consumer using a feature phone, I want to interact with Area Code via USSD, so that I can participate without a smartphone.

#### Acceptance Criteria

1. THE Platform SHALL provide a USSD shortcode that allows consumers to check in by entering a venue code
2. THE USSD_Service SHALL validate the venue code and record the check-in in the same pipeline as GPS and QR check-ins
3. THE USSD_Service SHALL send an SMS confirmation to the consumer after a successful USSD check-in

### Requirement 67: Additional Mobile Payment Integration

**User Story:** As a business owner, I want to accept payments via additional South African payment methods, so that I can reach more customers.

#### Acceptance Criteria

1. WHERE the business owner selects an alternative payment method, THE Business_Portal SHALL support at least one additional payment provider beyond Yoco (such as Ozow for instant EFT)
2. THE Business_Service SHALL process webhook events from the additional payment provider using the same idempotency and signature verification patterns as Yoco

### Requirement 68: Township and Informal Settlement Venue Support

**User Story:** As a business owner in a township or informal settlement, I want to register my venue even if GPS coordinates are imprecise, so that my business is represented on the platform.

#### Acceptance Criteria

1. THE Business_Portal SHALL allow manual pin placement on the map when registering a Node, in addition to address-based geocoding
2. THE Check_In_Service SHALL use an expanded proximity radius (500 metres instead of 200 metres) for Nodes flagged as being in areas with imprecise GPS
3. THE Business_Portal SHALL allow the business owner to flag a Node as being in an area with imprecise GPS during registration

### Requirement 69: Business Tier Distribution Analytics

**User Story:** As a platform stakeholder, I want to see the distribution of businesses across plan tiers, so that I can assess monetization health.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a chart showing the count of businesses on each plan tier (free, starter, growth, pro, payg)
2. THE Admin_Portal SHALL display the month-over-month change in business tier distribution

### Requirement 70: Revenue Per Business Tracking

**User Story:** As a platform stakeholder, I want to see average revenue per business, so that I can track monetization efficiency.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display the average revenue per paying business for the current month
2. THE Admin_Portal SHALL display the total number of paying businesses and total revenue

### Requirement 71: Churn Rate Calculation

**User Story:** As a platform stakeholder, I want to see consumer and business churn rates, so that I can measure retention.

#### Acceptance Criteria

1. THE Admin_Service SHALL compute monthly consumer churn rate (consumers active in month N-1 but not in month N, divided by total active in month N-1)
2. THE Admin_Service SHALL compute monthly business churn rate (businesses that downgraded to free or became inactive)
3. THE Admin_Portal SHALL display consumer and business churn rates on the dashboard overview with a 3-month trend

### Requirement 72: Geographic Coverage Metrics

**User Story:** As a platform stakeholder, I want to see geographic coverage metrics, so that I can identify expansion opportunities.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display the count of active Nodes per city
2. THE Admin_Portal SHALL display a map visualization showing Node density by geographic area
3. THE Admin_Portal SHALL display cities with zero or fewer than 5 Nodes as expansion targets

### Requirement 73: Social Graph Density Metrics

**User Story:** As a platform stakeholder, I want to see social graph metrics, so that I can assess the strength of the social network.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display the average number of mutual friends per consumer
2. THE Admin_Portal SHALL display the percentage of consumers with at least one mutual friend
3. THE Admin_Portal SHALL display the total follow count and mutual follow count platform-wide

### Requirement 74: Music Archetype Adoption Rates

**User Story:** As a platform stakeholder, I want to see how many consumers have set music preferences and which archetypes are most common, so that I can assess feature adoption.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display the percentage of consumers who have set at least one music genre preference
2. THE Admin_Portal SHALL display the distribution of resolved archetypes across all consumers with music preferences
3. THE Admin_Portal SHALL display the percentage of consumers who have connected a streaming service (Spotify or Apple Music)
