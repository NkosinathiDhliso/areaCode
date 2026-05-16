# Implementation Plan: Dev Showcase Mock Layer

## Overview

Build a shared mock data package at `packages/shared/mocks/` that intercepts the existing `ApiClient`, socket, and geolocation systems when `VITE_DEV_MOCK=true`. Implementation proceeds foundation-first: helpers and data fixtures, then the mock router and API interceptor, then socket and geo overrides, then app-level integration, and finally property-based tests.

## Tasks

- [x] 1. Create mock helpers and data fixtures
  - [x] 1.1 Create `packages/shared/mocks/helpers.ts` with utility functions
    - Implement `mockDelay()` (100–400ms random), `generateId()`, `generateRedemptionCode()` (AC-XXXXX-NNNN format), `hoursAgo(n)`, `daysFromNow(n)`, `randomBetween(min, max)`
    - _Requirements: 2.4, 6.2_

  - [x] 1.2 Create `packages/shared/mocks/data/nodes.ts` with 12 JHB venue nodes
    - Move and enhance existing `apps/web/src/mocks/nodes.ts` data into the shared package
    - Each node must have a non-null `businessId` linking to a mock business (Req 1.6)
    - Use the `mock-node-{n}` ID scheme from the design
    - All nodes typed as `Node` from `packages/shared/types/index.ts`
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 23.1_

  - [x] 1.3 Create `packages/shared/mocks/data/pulseScores.ts` with pulse scores for all 12 nodes
    - Must cover all 5 NodeState levels: dormant, quiet, active, buzzing, popping
    - _Requirements: 1.5, 4.2_

  - [x] 1.4 Create `packages/shared/mocks/data/users.ts` with 15+ SA users
    - Realistic SA names and derived usernames per the design table
    - Distribute across all 5 Tier levels (local, regular, fixture, institution, legend)
    - `mock-user-4` (Lerato Dlamini) is the "current user" with tier regular, 23 check-ins, 4-day streak
    - _Requirements: 1.7, 1.8, 23.1_

  - [x] 1.5 Create `packages/shared/mocks/data/businesses.ts` with 8+ SA businesses
    - Distribute across BusinessTier levels (free, starter, growth, pro, payg)
    - Include trial and grace period entries per design table
    - `mock-biz-2` (Father Coffee Roasters) is the "current business"
    - _Requirements: 1.9, 17.2, 23.1_

  - [x] 1.6 Create `packages/shared/mocks/data/rewards.ts` with 15+ rewards
    - Realistic offer titles tied to specific nodes (Req 1.10)
    - Varying slot availability: limited nearly full, plenty of slots, no limit (Req 1.11)
    - Varying expiry: within 24h, within 7 days, no expiry (Req 1.12)
    - All `nodeId` references must be valid mock node IDs (Req 23.2)
    - _Requirements: 1.10, 1.11, 1.12, 6.1, 6.4, 23.2_

  - [x] 1.7 Create `packages/shared/mocks/data/redemptions.ts` with redemption records
    - At least 2 unclaimed redemptions for the current user with AC-XXXXX-NNNN codes
    - At least 5 recent redemptions for the staff view
    - All `rewardId` and `userId` references must be valid (Req 23.3)
    - _Requirements: 6.2, 21.2, 23.3_

  - [x] 1.8 Create `packages/shared/mocks/data/staff.ts` with staff accounts
    - At least 2 staff accounts linked to `mock-biz-2` for the settings panel
    - _Requirements: 14.3_

  - [x] 1.9 Create `packages/shared/mocks/data/leaderboard.ts` with ranked entries
    - At least 10 entries ranked by check-in count descending
    - Varying tiers and realistic SA display names
    - Include current user rank outside top 10 (e.g. rank 12)
    - All userId, username, displayName, tier must match corresponding mock user (Req 23.6)
    - _Requirements: 7.1, 7.2, 7.3, 23.6_

  - [x] 1.10 Create `packages/shared/mocks/data/feed.ts` with activity feed items
    - At least 8 entries distributed across last 12 hours, most recent first
    - Entries from users with different tiers and at nodes with different categories
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 1.11 Create `packages/shared/mocks/data/reports.ts` with report queue items
    - At least 6 reports with varying types and statuses
    - At least 3 with status "pending"
    - All `reporterId` and `nodeId` references must be valid (Req 23.4)
    - _Requirements: 18.1, 18.2, 23.4_

  - [x] 1.12 Create `packages/shared/mocks/data/consent.ts` with consent records
    - At least 8 records with varying consent versions, analyticsOptIn, broadcastLocation
    - At least 3 with outdated consent version (e.g. "v0.9")
    - All `userId` references must be valid (Req 23.5)
    - _Requirements: 19.1, 19.2, 23.5_

  - [x] 1.13 Create `packages/shared/mocks/data/abuseFlags.ts` with abuse flag entries
    - At least 2 flags (device_velocity, reward_drain) linked to mock users
    - _Requirements: 16.2_

- [x] 2. Checkpoint — Verify all fixture data compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement mock router and API interceptor
  - [x] 3.1 Create `packages/shared/mocks/mockRouter.ts` with route resolver
    - Implement `resolve(method, path, body)` with path pattern matching and parameter extraction
    - Register all route patterns from the design's route table
    - Implement handlers for auth endpoints: consumer login/verify/signup, business login/verify, staff login/verify, admin login (Req 3.1–3.4, 10.1–10.3, 15.1–15.2, 20.1–20.3)
    - Implement handlers for node endpoints: list by city, detail with rewards + who-is-here, search by name substring (Req 4.1–4.4)
    - Implement check-in handler: return success + cooldownUntil, increment pulse score by 5, increment user check-in count (Req 5.2–5.4)
    - Implement reward endpoints: near-me with distances, unclaimed with codes, redeem with code validation (Req 6.1–6.4, 21.1, 21.3)
    - Implement leaderboard and feed endpoints (Req 7.1–7.3, 8.1–8.3)
    - Implement user profile endpoint returning current mock user (Req 9.1)
    - Implement business endpoints: me, live-stats, my-nodes, audience, rewards CRUD, boost, staff, QR, node update (Req 11.1–11.3, 12.1–12.2, 13.1–13.2, 14.1–14.4)
    - Implement admin endpoints: consumers with search/actions, businesses with actions, reports with actions, consent with export (Req 16.1–16.4, 17.1–17.3, 18.1–18.3, 19.1–19.3)
    - Implement staff recent-redemptions endpoint (Req 21.2)
    - Maintain mutable MockState for pulse scores, rewards, reports, user check-in count
    - Return 404 for unmatched routes with console warning
    - _Requirements: 2.2, 2.3, 3.1–3.4, 4.1–4.5, 5.2–5.4, 6.1–6.4, 7.1–7.3, 8.1–8.3, 9.1, 10.1–10.3, 11.1–11.3, 12.1–12.2, 13.1–13.2, 14.1–14.4, 15.1–15.2, 16.1–16.4, 17.1–17.3, 18.1–18.3, 19.1–19.3, 20.1–20.3, 21.1–21.3_

  - [x] 3.2 Create `packages/shared/mocks/mockApi.ts` with API interceptor
    - Implement `patchApiClient()` that monkey-patches the `api` singleton's private `request` method
    - Patched method extracts method/path/body, delegates to `mockRouter.resolve()`, adds 100–400ms delay
    - _Requirements: 2.2, 2.4_

- [x] 4. Implement mock socket and geolocation overrides
  - [x] 4.1 Create `packages/shared/mocks/mockSocket.ts` with mock socket emitter
    - Implement `MockSocket` class with `on`, `off`, `emit`, `connected` matching the Socket interface subset
    - Implement `startConsumerEmitter()` emitting `node:pulse_update`, `toast:new`, `node:state_change` at 8–20s intervals
    - Implement `startBusinessEmitter()` emitting `business:checkin`, `business:reward_claimed` at 15–45s intervals
    - Cycle events across different mock nodes and users for variety
    - Graceful error handling: catch handler errors, log, continue emitting
    - _Requirements: 22.1, 22.2, 22.3_

  - [x] 4.2 Create `packages/shared/mocks/mockGeo.ts` with geolocation override
    - Implement `patchGeolocation()` that overrides `getCurrentPosition` in `platform.ts` to return `{ lat: -26.15, lng: 28.04, accuracy: 15 }`
    - No-op silently if `navigator.geolocation` doesn't exist
    - _Requirements: 5.1_

- [x] 5. Create entry point and wire into apps
  - [x] 5.1 Create `packages/shared/mocks/index.ts` entry point
    - Export `initDevMocks()` that calls `patchApiClient()`, replaces `getSocket` with mock socket, calls `patchGeolocation()`, and starts appropriate emitter timers
    - Export `IS_DEV_MOCK` boolean flag
    - _Requirements: 2.1, 2.5_

  - [x] 5.2 Update `apps/web/src/main.tsx` to conditionally call `initDevMocks()` before rendering
    - Add `if (import.meta.env.VITE_DEV_MOCK === 'true') { await import(...); initDevMocks() }` before `ReactDOM.createRoot`
    - _Requirements: 2.1, 3.4, 4.1, 5.1_

  - [x] 5.3 Update `apps/business/src/main.tsx` to conditionally call `initDevMocks()` before rendering
    - Same pattern as web app
    - _Requirements: 2.1, 10.3_

  - [x] 5.4 Update `apps/admin/src/main.tsx` to conditionally call `initDevMocks()` before rendering
    - Same pattern as web app
    - _Requirements: 2.1, 15.2_

  - [x] 5.5 Update `apps/staff/src/main.tsx` to conditionally call `initDevMocks()` before rendering
    - Same pattern as web app
    - _Requirements: 2.1, 20.3_

  - [x] 5.6 Update `apps/web/src/screens/MapScreen.tsx` to remove inline mock fallback
    - Remove the try/catch mock fallback in the `useQuery` queryFn and the direct import of `MOCK_NODES`/`MOCK_PULSE_SCORES` from `../mocks/nodes`
    - The mock API interceptor now handles this transparently
    - _Requirements: 4.1, 4.2_

- [x] 6. Checkpoint — Verify mock layer activates in all four apps
  - Ensure all tests pass, ask the user if questions arise.

- [x]\* 7. Property-based tests
  - [x]\* 7.1 Write property test for referential integrity
    - **Property 1: Mock data referential integrity**
    - Verify all foreign key references resolve across entity arrays (rewards→nodes, redemptions→rewards+users, reports→users+nodes, consent→users, leaderboard→users with matching fields)
    - **Validates: Requirements 1.6, 23.2, 23.3, 23.4, 23.5, 23.6**

  - [x]\* 7.2 Write property test for route resolution
    - **Property 2: All registered mock routes resolve without error**
    - Call `resolve(method, path)` for every registered route pattern and verify non-null response
    - **Validates: Requirements 2.2, 2.3**

  - [x]\* 7.3 Write property test for mock delay bounds
    - **Property 3: Mock API delay is within bounds**
    - Measure delay across multiple calls and verify 100–400ms range
    - **Validates: Requirements 2.4**

  - [x]\* 7.4 Write property test for auth acceptance
    - **Property 4: Any phone number or credential succeeds at all auth endpoints**
    - Generate random phone numbers, emails, passwords and verify success responses
    - **Validates: Requirements 3.1, 3.3, 10.1, 15.1, 20.1**

  - [x]\* 7.5 Write property test for OTP verification
    - **Property 5: Any 6-digit OTP returns valid auth tokens**
    - Generate random 6-digit strings and verify token responses with correct identity fields
    - **Validates: Requirements 3.2, 10.2, 20.2**

  - [x]\* 7.6 Write property test for node search
    - **Property 6: Node search returns only matching results**
    - Generate random substrings of node names and verify filtered results contain query
    - **Validates: Requirements 4.4**

  - [x]\* 7.7 Write property test for check-in state mutation
    - **Property 7: Check-in updates pulse score and user count**
    - Generate random node IDs and verify pulse +5, totalCheckIns +1, cooldownUntil ~4h
    - **Validates: Requirements 5.2, 5.3, 5.4**

  - [x]\* 7.8 Write property test for node detail reward filtering
    - **Property 8: Node detail includes only rewards belonging to that node**
    - Generate random node IDs and verify all returned rewards have matching nodeId
    - **Validates: Requirements 6.3**

  - [x]\* 7.9 Write property test for leaderboard sort order
    - **Property 9: Leaderboard is sorted by check-in count descending**
    - Verify consecutive pairs have non-increasing checkInCount
    - **Validates: Requirements 7.1**

  - [x]\* 7.10 Write property test for feed timestamp ordering
    - **Property 10: Feed entries are sorted by timestamp descending and within 12 hours**
    - Verify descending order and all timestamps within 12-hour window
    - **Validates: Requirements 8.2**

  - [x]\* 7.11 Write property test for admin user search
    - **Property 11: Admin user search filters by substring match**
    - Generate random substrings and verify returned users match by username or phone
    - **Validates: Requirements 16.3**

  - [x]\* 7.12 Write property test for mutation endpoint success
    - **Property 12: Mutation endpoints return success**
    - Generate random mutation requests and verify success responses
    - **Validates: Requirements 14.4, 16.4, 17.3**

  - [x]\* 7.13 Write property test for report status persistence
    - **Property 13: Report status updates persist in mock state**
    - Generate random report actions and verify state updates persist
    - **Validates: Requirements 18.3**

  - [x]\* 7.14 Write property test for re-consent export filtering
    - **Property 14: Re-consent export returns only outdated consent versions**
    - Verify all exported records have outdated versions
    - **Validates: Requirements 19.3**

  - [x]\* 7.15 Write property test for staff code validation
    - **Property 15: Staff redemption validates code length**
    - Generate strings of various lengths and verify success for 6-char, error for shorter
    - **Validates: Requirements 21.1, 21.3**

  - [x]\* 7.16 Write property test for DEV_MODE flag
    - **Property 16: DEV_MODE flag correctly reads environment variable**
    - Generate random strings and verify flag is true only for "true"
    - **Validates: Requirements 2.1**

  - [x]\* 7.17 Write property test for reward creation persistence
    - **Property 17: Reward creation adds to mock state**
    - Generate random reward payloads and verify they appear in subsequent queries
    - **Validates: Requirements 12.2**

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing `apps/web/src/mocks/nodes.ts` data is migrated into the shared package; the old file can be removed after task 5.6
