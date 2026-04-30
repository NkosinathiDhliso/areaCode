# Requirements Document

## Introduction

Area Code is a location-based social platform with four portals: Web Consumer, Business, Admin, and Staff. Currently, all four apps require a running backend with database and Redis to display meaningful data. This feature creates a comprehensive client-side mock data layer so that every portal works fully in dev mode (no backend required) for showcase and demo purposes. The mock data uses realistic South African venues, business names, user profiles, and reward offers centred on Johannesburg.

## Glossary

- **Mock_Data_Layer**: A client-side module in each app that intercepts API calls and returns realistic fake data when `DEV_MODE` is active
- **DEV_MODE**: A boolean flag derived from the `VITE_DEV_MOCK` environment variable (or absence of `VITE_API_URL`) that activates the Mock_Data_Layer
- **Web_Consumer_App**: The consumer-facing web application at `apps/web`
- **Business_App**: The business dashboard application at `apps/business`
- **Admin_App**: The admin panel application at `apps/admin`
- **Staff_App**: The staff redemption validator application at `apps/staff`
- **Mock_API_Client**: A drop-in replacement for the shared `ApiClient` that resolves requests from in-memory mock data instead of HTTP
- **Mock_Node**: A Node entity populated with a real Johannesburg venue name, accurate GPS coordinates, a category, and a pulse score representing a specific NodeState
- **Mock_User**: A User entity with a realistic South African name, username, tier, check-in count, and streak
- **Mock_Business**: A BusinessAccount entity with a realistic SA business name, tier, trial status, and associated nodes
- **Mock_Reward**: A Reward entity with a realistic offer title and description tied to a specific Mock_Node
- **Mock_Redemption**: A RewardRedemption entity with a 6-digit alphanumeric code, expiry timestamp, and redeemed status
- **Mock_Report**: A Report entity with a type, status, reporter, and target node
- **Mock_Consent_Record**: A ConsentRecord entity with a user, consent version, and opt-in flags
- **Mock_Leaderboard**: An ordered list of LeaderboardEntry entities with realistic SA usernames and varying tiers
- **Mock_Activity_Feed**: A list of recent check-in events by mock users at mock nodes
- **Shared_Mock_Data_Package**: A shared package at `packages/shared/mocks` that exports all mock data generators and fixtures used across all four apps
- **PulseScore**: A numeric score (0–100) that determines a node's NodeState (dormant 0, quiet 1–10, active 11–30, buzzing 31–60, popping 61+)

## Requirements

### Requirement 1: Shared Mock Data Foundation

**User Story:** As a developer, I want a single shared mock data package that all four apps import from, so that mock data is consistent and maintained in one place.

#### Acceptance Criteria

1. THE Shared_Mock_Data_Package SHALL export typed mock data arrays for Node, User, BusinessAccount, StaffAccount, Reward, RewardRedemption, CheckIn, LeaderboardEntry, Report, AbuseFlag, ConsentRecord, and Toast entities
2. THE Shared_Mock_Data_Package SHALL export exactly 12 Mock_Node entities using the Johannesburg venues: Nando's Rosebank, Father Coffee, Kitchener's Bar, Neighbourgoods Market, Virgin Active Sandton, Arts on Main, Sandton City, Doubleshot Coffee, The Grillhouse, Taboo Nightclub, Keyes Art Mile, and Planet Fitness Melrose
3. WHEN a Mock_Node is created, THE Shared_Mock_Data_Package SHALL assign GPS coordinates accurate to the real venue location (within 50 metres)
4. THE Shared_Mock_Data_Package SHALL assign each Mock_Node a category from the NodeCategory type (food, coffee, nightlife, retail, fitness, arts) matching the real venue type
5. THE Shared_Mock_Data_Package SHALL assign PulseScore values that produce at least one node in each of the five NodeState levels (dormant, quiet, active, buzzing, popping)
6. THE Shared_Mock_Data_Package SHALL populate each Mock_Node with a non-null businessId linking to a corresponding Mock_Business entity
7. THE Shared_Mock_Data_Package SHALL export at least 15 Mock_User entities with realistic South African names (e.g. Sipho Mthembu, Thandi Nkosi, Bongani Khumalo, Lerato Dlamini, Neo Pillay) and usernames derived from those names
8. THE Shared_Mock_Data_Package SHALL distribute Mock_User tiers across all five Tier levels (local, regular, fixture, institution, legend)
9. THE Shared_Mock_Data_Package SHALL export at least 8 Mock_Business entities with realistic SA business names matching the 12 venue nodes, distributed across BusinessTier levels (free, starter, growth, pro, payg)
10. THE Shared_Mock_Data_Package SHALL export at least 15 Mock_Reward entities with realistic offer titles and descriptions tied to specific nodes (e.g. "Free coffee with any breakfast" at Father Coffee, "20% off cocktails before 8pm" at Kitchener's Bar, "Free starter with any main" at Nando's Rosebank, "Buy 1 get 1 free smoothie" at Doubleshot Coffee)
11. THE Shared_Mock_Data_Package SHALL include Mock_Reward entities with varying slot availability: some with limited slots nearly full, some with plenty of slots, and some with no slot limit
12. THE Shared_Mock_Data_Package SHALL include Mock_Reward entities with varying expiry: some expiring within 24 hours, some within 7 days, and some with no expiry
13. THE Shared_Mock_Data_Package SHALL conform all exported entities to the types defined in `packages/shared/types/index.ts`

### Requirement 2: DEV_MODE Activation and API Interception

**User Story:** As a developer, I want a single environment flag that activates mock data across all apps, so that I can toggle between real and mock backends easily.

#### Acceptance Criteria

1. WHEN the `VITE_DEV_MOCK` environment variable is set to `"true"`, THE Mock_Data_Layer SHALL activate in all four apps
2. WHEN DEV_MODE is active, THE Mock_API_Client SHALL intercept all calls to the shared `ApiClient` (get, post, put, patch, delete) and return mock data without making HTTP requests
3. THE Mock_API_Client SHALL match API paths using a route map that covers all backend endpoints: auth (consumer/business/staff login, verify, refresh, account-type), nodes (list, detail, search, who-is-here), rewards (near-me, unclaimed, create, redeem), check-in, business (me, my-nodes, live-stats, recent-redemptions, staff, qr), admin (consumers, businesses, reports, consent), and social (leaderboard, feed)
4. WHEN DEV_MODE is active, THE Mock_API_Client SHALL resolve all intercepted calls with a simulated network delay between 100ms and 400ms to mimic realistic API latency
5. WHEN DEV_MODE is not active, THE Mock_Data_Layer SHALL not import or bundle any mock data (tree-shaking safe)

### Requirement 3: Web Consumer App — Authentication Flow

**User Story:** As a demo viewer, I want to log in or sign up with any phone number in the Web Consumer App, so that I can experience the full authenticated consumer flow.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and a user submits any phone number on the consumer login screen, THE Mock_Data_Layer SHALL return a success response and advance to the OTP verification step
2. WHEN DEV_MODE is active and a user submits any 6-digit OTP code on the consumer verification screen, THE Mock_Data_Layer SHALL return a valid access token, refresh token, and a Mock_User profile with tier "regular", 23 total check-ins, and a 4-day streak
3. WHEN DEV_MODE is active and a user submits the consumer signup form with any phone number, username, and display name, THE Mock_Data_Layer SHALL return a success response and advance to OTP verification
4. WHEN DEV_MODE is active and a consumer auth token is present, THE Mock_Data_Layer SHALL populate the userStore with the mock user profile

### Requirement 4: Web Consumer App — Map and Nodes

**User Story:** As a demo viewer, I want to see a populated map with 12 Johannesburg nodes showing different pulse states, so that I can experience the core map discovery feature.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the map screen loads, THE Mock_Data_Layer SHALL return all 12 Mock_Node entities for the Johannesburg city slug
2. WHEN DEV_MODE is active, THE Mock_Data_Layer SHALL provide PulseScore values for all 12 nodes so that the map renders nodes in all five visual states (dormant, quiet, active, buzzing, popping)
3. WHEN DEV_MODE is active and a user taps a node marker, THE Mock_Data_Layer SHALL return node detail including the node name, category, pulse score, active rewards for that node, and a who-is-here list with 2–4 Mock_User entries
4. WHEN DEV_MODE is active and a user searches for a venue name, THE Mock_Data_Layer SHALL filter the 12 Mock_Node entities by name substring match and return matching results
5. WHEN DEV_MODE is active and a user filters by category, THE Web_Consumer_App SHALL filter the displayed nodes by the selected NodeCategory from the mock data

### Requirement 5: Web Consumer App — Check-In Flow

**User Story:** As a demo viewer, I want to check in at any node and see a successful response, so that I can experience the check-in and reward flow.

#### Acceptance Criteria

1. WHEN DEV_MODE is active, THE Mock_Data_Layer SHALL provide a fake geolocation position within 100 metres of the centroid of the 12 Johannesburg mock nodes (approximately -26.15, 28.04)
2. WHEN DEV_MODE is active and a user taps the check-in button on any node, THE Mock_Data_Layer SHALL return a successful CheckInResponse with a cooldownUntil timestamp 4 hours in the future
3. WHEN DEV_MODE is active and a check-in succeeds, THE Mock_Data_Layer SHALL increment the node's PulseScore by 5 and update the node state in the mapStore
4. WHEN DEV_MODE is active and a check-in succeeds, THE Mock_Data_Layer SHALL increment the user's totalCheckIns count in the userStore by 1

### Requirement 6: Web Consumer App — Rewards

**User Story:** As a demo viewer, I want to see realistic rewards near me and my unclaimed rewards, so that I can experience the reward discovery and redemption flow.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the rewards screen loads, THE Mock_Data_Layer SHALL return at least 8 "near me" Mock_Reward entries with node names, distances (150m–2000m), slot counts, and claimed counts
2. WHEN DEV_MODE is active and the user is authenticated, THE Mock_Data_Layer SHALL return at least 2 unclaimed reward entries with redemption codes (format "AC-XXXXX-NNNN"), code expiry timestamps, and associated node names
3. WHEN DEV_MODE is active and a user views a node detail sheet, THE Mock_Data_Layer SHALL display the active rewards for that node with title, type, slots remaining, and expiry information
4. WHEN DEV_MODE is active and a reward has limited slots, THE Mock_Data_Layer SHALL show the slots remaining count (e.g. "8 of 50 left") on the reward card

### Requirement 7: Web Consumer App — Leaderboard

**User Story:** As a demo viewer, I want to see a populated leaderboard with ranked users, so that I can experience the competitive social feature.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the leaderboard screen loads, THE Mock_Data_Layer SHALL return at least 10 Mock_Leaderboard entries ranked by check-in count in descending order
2. THE Mock_Data_Layer SHALL include leaderboard entries with varying tiers (local, regular, fixture, institution, legend) and realistic SA display names
3. WHEN DEV_MODE is active and the user is authenticated, THE Mock_Data_Layer SHALL include the current user's rank (outside the top 10, e.g. rank 12) and check-in count in the leaderboard response

### Requirement 8: Web Consumer App — Activity Feed

**User Story:** As a demo viewer, I want to see a populated activity feed with recent check-ins, so that I can experience the social feed feature.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the feed screen loads, THE Mock_Data_Layer SHALL return at least 8 Mock_Activity_Feed entries showing mock users checking in at various mock nodes
2. THE Mock_Data_Layer SHALL distribute feed entries across the last 12 hours with realistic timestamps (more recent entries first)
3. THE Mock_Data_Layer SHALL include feed entries from users with different tiers and at nodes with different categories

### Requirement 9: Web Consumer App — Profile

**User Story:** As a demo viewer, I want to see a populated profile screen with tier, streak, and check-in stats, so that I can experience the profile and settings features.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the profile screen loads, THE Web_Consumer_App SHALL display the mock user's display name, tier badge ("regular"), total check-ins (23), and current streak (4 days)
2. WHEN DEV_MODE is active and the user toggles privacy or appearance settings, THE Web_Consumer_App SHALL update the local state without making API calls

### Requirement 10: Business App — Authentication Flow

**User Story:** As a demo viewer, I want to log in to the Business App with any phone number, so that I can experience the full business dashboard.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and a user submits any phone number on the business login screen, THE Mock_Data_Layer SHALL return a success response and advance to OTP verification
2. WHEN DEV_MODE is active and a user submits any 6-digit OTP code on the business verification screen, THE Mock_Data_Layer SHALL return a valid access token, refresh token, and a businessId
3. WHEN DEV_MODE is active and a business auth token is present, THE Mock_Data_Layer SHALL populate the businessStore with a Mock_Business profile (businessName: "Father Coffee Roasters", tier: "growth", trialEndsAt: 10 days from now)

### Requirement 11: Business App — Live Panel

**User Story:** As a demo viewer, I want to see the live panel with today's check-ins, rewards claimed, and recent activity, so that I can experience the real-time business dashboard.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the live panel loads, THE Mock_Data_Layer SHALL return live stats: 34 check-ins today, 12 rewards claimed today, and a list of 5 recent activity entries
2. THE Mock_Data_Layer SHALL include recent activity entries with timestamps within the last 4 hours, showing check-ins and reward claims with mock user display names
3. WHEN DEV_MODE is active, THE Business_App SHALL display the getting-started checklist steps as completed (photo added, first reward created, node shared, QR displayed)

### Requirement 12: Business App — Rewards Panel

**User Story:** As a demo viewer, I want to see existing rewards with different statuses, so that I can experience the reward management interface.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the rewards panel loads, THE Mock_Data_Layer SHALL return at least 4 Mock_Reward entities owned by the mock business: 2 active rewards with varying slot usage, 1 reward expiring within 24 hours, and 1 inactive (expired) reward
2. WHEN DEV_MODE is active and a user creates a new reward via the rewards panel form, THE Mock_Data_Layer SHALL return a success response with a generated reward ID and add the reward to the local mock state

### Requirement 13: Business App — Audience Panel

**User Story:** As a demo viewer, I want to see audience insights with visitor demographics and peak hours, so that I can experience the analytics feature.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the audience panel loads, THE Mock_Data_Layer SHALL return mock audience insights: visitor count (247 unique this month), tier breakdown (40% local, 30% regular, 20% fixture, 8% institution, 2% legend), peak hours (12:00–14:00 and 18:00–21:00), and top repeat visitors (5 entries)
2. WHEN DEV_MODE is active and the business tier is "growth" or higher, THE Business_App SHALL display the audience insights panel as accessible (not gated)

### Requirement 14: Business App — Node Editor, Boost, and Settings

**User Story:** As a demo viewer, I want to see the node editor with the business's claimed node, boost options, and settings with subscription info, so that I can experience the full business management suite.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the node editor panel loads, THE Mock_Data_Layer SHALL return the business's claimed Mock_Node (Father Coffee) with editable fields: name, category, colour, icon, and QR check-in toggle
2. WHEN DEV_MODE is active and the boost panel loads, THE Mock_Data_Layer SHALL return boost pricing options (2hr, 6hr, 24hr) with ZAR prices matching the backend BOOST_PRICING constants
3. WHEN DEV_MODE is active and the settings panel loads, THE Mock_Data_Layer SHALL return subscription info (tier: "growth", trial ends in 10 days), a staff list with 2 Mock_StaffAccount entries, and a QR code data object for the business's node
4. WHEN DEV_MODE is active and a user updates node settings or creates a boost, THE Mock_Data_Layer SHALL return a success response without making HTTP requests

### Requirement 15: Admin App — Authentication Flow

**User Story:** As a demo viewer, I want to log in to the Admin App with any email and password, so that I can experience the admin dashboard.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and a user submits any email and password on the admin login screen, THE Mock_Data_Layer SHALL return a valid access token, adminId, and role "super_admin"
2. WHEN DEV_MODE is active and an admin auth token is present, THE Mock_Data_Layer SHALL populate the adminAuthStore with the mock admin credentials

### Requirement 16: Admin App — Consumer Management

**User Story:** As a demo viewer, I want to see a list of consumer users with different tiers and flags, so that I can experience the consumer management interface.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the consumer management screen loads, THE Mock_Data_Layer SHALL return a paginated list of at least 10 Mock_User entities with varying tiers, check-in counts, and creation dates
2. THE Mock_Data_Layer SHALL include at least 2 Mock_User entities with associated AbuseFlag entries (types: device_velocity, reward_drain) to demonstrate the flagged user workflow
3. WHEN DEV_MODE is active and an admin searches for a user by phone or username, THE Mock_Data_Layer SHALL filter the mock user list by substring match
4. WHEN DEV_MODE is active and an admin performs an action (disable account, reset flags, recalculate tier), THE Mock_Data_Layer SHALL return a success response and update the local mock state

### Requirement 17: Admin App — Business Management

**User Story:** As a demo viewer, I want to see a list of business accounts with different tiers and trial statuses, so that I can experience the business management interface.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the business management screen loads, THE Mock_Data_Layer SHALL return a paginated list of at least 8 Mock_Business entities with varying tiers (free, starter, growth, pro, payg)
2. THE Mock_Data_Layer SHALL include at least 1 Mock_Business on an active trial (trialEndsAt in the future) and at least 1 Mock_Business in payment grace period (paymentGraceUntil in the future)
3. WHEN DEV_MODE is active and an admin performs an action (extend trial, deactivate rewards, override CIPC), THE Mock_Data_Layer SHALL return a success response

### Requirement 18: Admin App — Report Queue

**User Story:** As a demo viewer, I want to see a report queue with different report types and statuses, so that I can experience the content moderation workflow.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the report queue screen loads, THE Mock_Data_Layer SHALL return at least 6 Mock_Report entities with varying types (wrong_location, permanently_closed, fake_rewards, offensive_content) and statuses (pending, reviewed, dismissed, actioned)
2. THE Mock_Data_Layer SHALL include at least 3 reports with status "pending" to demonstrate the review workflow
3. WHEN DEV_MODE is active and an admin reviews or actions a report, THE Mock_Data_Layer SHALL return a success response and update the report status in local mock state

### Requirement 19: Admin App — POPIA Consent Audit

**User Story:** As a demo viewer, I want to see consent records and the re-consent list, so that I can experience the POPIA compliance audit feature.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the consent audit screen loads, THE Mock_Data_Layer SHALL return at least 8 Mock_Consent_Record entities with varying consent versions, analyticsOptIn, and broadcastLocation values
2. THE Mock_Data_Layer SHALL include at least 3 Mock_Consent_Record entities with an outdated consent version (e.g. "v0.9") to populate the re-consent list
3. WHEN DEV_MODE is active and an admin exports the re-consent list, THE Mock_Data_Layer SHALL return the filtered list of users needing re-consent

### Requirement 20: Staff App — Authentication Flow

**User Story:** As a demo viewer, I want to log in to the Staff App with any phone number, so that I can experience the staff redemption workflow.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and a user submits any phone number on the staff login screen, THE Mock_Data_Layer SHALL return a success response and advance to OTP verification
2. WHEN DEV_MODE is active and a user submits any 6-digit OTP code on the staff verification screen, THE Mock_Data_Layer SHALL return a valid access token, staffId, businessId, and nodeName ("Father Coffee")
3. WHEN DEV_MODE is active and a staff auth token is present, THE Mock_Data_Layer SHALL populate the staffAuthStore with the mock staff credentials

### Requirement 21: Staff App — Redemption Validator

**User Story:** As a demo viewer, I want to validate any 6-digit redemption code and see recent redemptions, so that I can experience the staff redemption workflow.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and a staff member submits any 6-digit alphanumeric code in the validator, THE Mock_Data_Layer SHALL return a success response with the redeemed reward title and timestamp
2. WHEN DEV_MODE is active and the recent redemptions list loads, THE Mock_Data_Layer SHALL return at least 5 Mock_Redemption entries with codes, reward titles, timestamps within the last 8 hours, and associated user display names
3. IF DEV_MODE is active and a staff member submits a code shorter than 6 characters, THEN THE Mock_Data_Layer SHALL return an "invalid_code" error response

### Requirement 22: Mock Socket Events

**User Story:** As a demo viewer, I want to see real-time toast notifications and pulse updates on the map, so that I can experience the live social atmosphere.

#### Acceptance Criteria

1. WHEN DEV_MODE is active and the Web_Consumer_App map screen is open, THE Mock_Data_Layer SHALL emit simulated socket events at random intervals between 8 and 20 seconds: node:pulse_update, toast:new (checkin, reward_new, streak types), and node:state_change
2. WHEN DEV_MODE is active and the Business_App live panel is open, THE Mock_Data_Layer SHALL emit simulated business:checkin and business:reward_claimed socket events at random intervals between 15 and 45 seconds
3. WHEN DEV_MODE is active, THE Mock_Data_Layer SHALL cycle simulated events across different mock nodes and mock users to create a varied, realistic activity pattern

### Requirement 23: Data Consistency and Type Safety

**User Story:** As a developer, I want all mock data to be fully typed and consistent across entities, so that the mock layer does not introduce type errors or broken references.

#### Acceptance Criteria

1. THE Shared_Mock_Data_Package SHALL export all mock data with explicit TypeScript types matching the interfaces in `packages/shared/types/index.ts`
2. FOR ALL Mock_Reward entities, THE Shared_Mock_Data_Package SHALL reference a valid Mock_Node ID in the nodeId field
3. FOR ALL Mock_Redemption entities, THE Shared_Mock_Data_Package SHALL reference a valid Mock_Reward ID in the rewardId field and a valid Mock_User ID in the userId field
4. FOR ALL Mock_Report entities, THE Shared_Mock_Data_Package SHALL reference a valid Mock_User ID in the reporterId field and a valid Mock_Node ID in the nodeId field
5. FOR ALL Mock_Consent_Record entities, THE Shared_Mock_Data_Package SHALL reference a valid Mock_User ID in the userId field
6. FOR ALL Mock_LeaderboardEntry entities, THE Shared_Mock_Data_Package SHALL reference a valid Mock_User ID, username, displayName, and tier matching the corresponding Mock_User entity
