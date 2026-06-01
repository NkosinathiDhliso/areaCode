# Platform Completeness Audit — Critical Findings

**Date:** June 1, 2026  
**Auditor:** Kiro AI (Full-Stack + Product Owner Review)  
**Scope:** All portals (web, mobile, business, staff, admin) + backend API + real-time infrastructure

---

## Executive Summary

This audit identifies **23 critical gaps** and **17 medium-priority issues** across the Area Code platform that could impact the pilot launch. The findings are organized by severity and grouped by functional area.

### Severity Levels

- **🔴 CRITICAL** — Blocks pilot launch or causes data loss/security breach
- **🟡 HIGH** — Degrades user experience significantly or causes confusion
- **🟢 MEDIUM** — Minor UX friction or missing polish

---

## 🔴 CRITICAL FINDINGS (Must Fix Before Pilot)

### C1. Mobile App Is Incomplete and Non-Functional

**Location:** `apps/mobile/`  
**Impact:** Mobile users cannot use the platform

**Evidence:**

- No `App.tsx` exists in `apps/mobile/src/` or `apps/mobile/app/`
- Mobile app structure shows only components and lib files, no screens or routing
- The push notification registration code (`apps/mobile/src/lib/push.ts`) was just created but has no integration point
- No authentication flow for mobile (no login/signup screens)
- No map screen, no check-in flow, no rewards screen

**Required Actions:**

1. Create `apps/mobile/app/_layout.tsx` (Expo Router root layout)
2. Create authentication screens: `app/(auth)/login.tsx`, `app/(auth)/signup.tsx`, `app/(auth)/oauth-callback.tsx`
3. Create main app screens: `app/(tabs)/map.tsx`, `app/(tabs)/rewards.tsx`, `app/(tabs)/profile.tsx`, etc.
4. Wire up the push notification registration in the post-auth flow
5. Integrate the existing mobile components (NodeDetailSheet, ProximityNudgeBanner, etc.) into the screen hierarchy
6. Test end-to-end: signup → map → check-in → reward claim

**Estimated Effort:** 3-5 days

---

### C2. WebSocket Token Refresh Creates Reconnection Storms

**Location:** `packages/shared/lib/websocket.ts`, `packages/shared/lib/api.ts`  
**Impact:** Users experience disconnections and missed real-time events after token refresh

**Evidence:**

- The API client (`api.ts`) has a token refresh mechanism that fires when tokens expire
- The API client notifies WebSocket listeners via `onTokenRefresh()` when a new token is issued
- The WebSocket manager (`websocket.ts`) subscribes to token refresh events and calls `reconnectWithUrl()`
- **BUT:** The WebSocket URL is rebuilt with the new token, causing a full disconnect/reconnect cycle
- During the reconnect window (1-5 seconds with exponential backoff), real-time events are lost
- If multiple tabs/windows are open, each triggers its own reconnect, creating a storm

**Required Actions:**

1. Implement a "token update" message type in the WebSocket protocol so the server can accept a new token without disconnecting
2. Add `POST /v1/websocket/refresh-token` endpoint that updates the connection's auth context server-side
3. Modify `WebSocketManager.reconnectWithUrl()` to send a token-update message instead of closing the connection
4. Add a fallback: if the server doesn't support token updates, fall back to the current reconnect behavior

**Estimated Effort:** 1-2 days

---

### C3. No Mobile Push Notification Backend Integration

**Location:** `backend/src/features/notifications/`, `apps/mobile/src/lib/push.ts`  
**Impact:** Mobile users never receive push notifications

**Evidence:**

- The mobile app has `registerForPushNotifications()` that calls `POST /v1/users/me/push-token`
- The backend has a `notificationRoutes` handler in `backend/src/features/notifications/handler.ts`
- **BUT:** The `POST /v1/users/me/push-token` endpoint is registered, but there's no implementation that:
  - Stores the Expo push token in the database
  - Sends push notifications via Expo's push service when events occur
  - Handles token expiry and re-registration

**Required Actions:**

1. Add `expoPushToken` and `platform` fields to the users table
2. Implement `POST /v1/users/me/push-token` to persist the token
3. Create a push notification sender worker (`backend/src/workers/push-sender.ts`) that:
   - Reads from the `notification-sender` SQS queue
   - Batches Expo push notifications (max 100 per request)
   - Handles errors (DeviceNotRegistered, InvalidCredentials, etc.)
   - Retries with exponential backoff
4. Wire the notification pipeline (task 3.5 in platform-completeness-audit) to enqueue push jobs
5. Test end-to-end: register token → trigger notification → receive push on device

**Estimated Effort:** 2-3 days

---

### C4. No Error Recovery for Failed Check-Ins

**Location:** `apps/web/src/screens/MapScreen.tsx`, `apps/mobile/` (when implemented)  
**Impact:** Users lose check-ins when network fails or GPS is inaccurate

**Evidence:**

- The web app's check-in flow calls the API directly
- If the API call fails (network error, 5xx, GPS out of range), the user sees an error toast
- **BUT:** There's no retry mechanism, no offline queue, no way to recover the check-in
- The user must manually retry, but by then they may have moved away from the venue
- The GPS coordinates at retry time may be different, causing a second failure

**Required Actions:**

1. Create a check-in queue in local storage/AsyncStorage
2. When a check-in fails, enqueue it with: `{ nodeId, timestamp, lat, lng, retryCount }`
3. Add a background retry worker that:
   - Runs every 30 seconds when online
   - Retries queued check-ins with exponential backoff (max 3 retries)
   - Removes successful check-ins from the queue
   - Surfaces persistent failures to the user with a "Review failed check-ins" prompt
4. Add a "Failed Check-Ins" section in the profile screen where users can manually retry or discard
5. Ensure the backend accepts check-ins with timestamps up to 15 minutes in the past (current window is unclear)

**Estimated Effort:** 1-2 days

---

### C5. Staff App Has No "My Rank" Widget Implementation

**Location:** `apps/staff/src/screens/StaffHome.tsx`, `backend/src/features/business/staff-leaderboard.ts`  
**Impact:** Staff members cannot see their performance, reducing engagement

**Evidence:**

- The CHURN_DEFENSES.md doc (Part 3) describes a "MyRank widget" that shows top 3 performers + your own rank
- The backend has `staff-leaderboard.ts` that computes leaderboard data
- **BUT:** The staff app's `StaffHome` screen doesn't render this widget
- The staff app only shows a redemption scanner, no performance feedback

**Required Actions:**

1. Create `MyRankWidget` component in `packages/features/staff/` or `apps/staff/src/components/`
2. Add `GET /v1/staff/me/rank` endpoint that returns: `{ rank, redemptionCount, topPerformers: [{ name, count }] }`
3. Render the widget on `StaffHome` above the scanner button
4. Add a refresh button or auto-refresh every 5 minutes
5. Show the motivational prompt when rank is null: "Pitch the app at the till today and you'll be on the board by tomorrow."

**Estimated Effort:** 1 day

---

### C6. No Casual Customer "First-Get" Token Issuer UI

**Location:** `apps/staff/`, `backend/src/features/rewards/guest-claim.ts`  
**Impact:** The casual-customer churn defense (CHURN_DEFENSES.md §1.6) is not usable

**Evidence:**

- The backend has `guest-claim.ts` that implements the token-based first-visit reward
- The PILOT_LAUNCH_CHECKLIST.md (§4) requires staff to issue "dummy First-Get tokens" during pre-launch testing
- **BUT:** There's no UI in the staff app to issue these tokens
- Staff cannot print or display the 8-character token for customers
- The entire casual-customer path is blocked

**Required Actions:**

1. Add `POST /v1/staff/issue-first-get` endpoint that:
   - Generates an 8-character Crockford base32 token
   - Associates it with the venue's first-get reward
   - Returns the token and a printable QR code
2. Create `FirstGetIssuer` component in `apps/staff/src/components/`
3. Add "Issue First-Get Token" button to `StaffHome`
4. Display the token in large text + QR code for the customer to photograph
5. Add a "Print" button that triggers the browser's print dialog with a receipt-sized layout
6. Test end-to-end: issue token → customer signs up → redeems token → gets first-visit credit

**Estimated Effort:** 1-2 days

---

### C7. No Admin Retention Dashboard Implementation

**Location:** `apps/admin/src/screens/`, `backend/src/features/admin/retention.ts`  
**Impact:** Admins cannot identify leaking venues, blocking the churn defense strategy

**Evidence:**

- The CHURN_DEFENSES.md doc (Part 3) describes a "Retention Dashboard" with weekly cohort tables
- The backend has `retention.ts` that computes cohort return rates
- The platform-completeness-audit tasks (11.1) require a `DashboardOverview` screen
- **BUT:** The admin app has no retention dashboard screen
- The `apps/admin/src/screens/` folder exists but the retention dashboard is not listed in the file tree

**Required Actions:**

1. Create `RetentionDashboard.tsx` in `apps/admin/src/screens/`
2. Add `GET /v1/admin/retention/cohorts` endpoint that returns weekly cohort data
3. Render a heat-map table: rows = signup weeks, columns = Day 1/7/30/90 return rates
4. Color-code cells: green ≥35%, yellow 20-35%, red <20%
5. Add "Top Leaking Venues" list below the cohort table
6. Add a manual refresh button (cache for 30 minutes as specified)
7. Wire into the admin navigation

**Estimated Effort:** 2 days

---

### C8. No Sentry Release-Health Auto-Rollback Gate

**Location:** `.github/workflows/`, `backend/`, deployment scripts  
**Impact:** Bad releases stay live, causing the §1.5 churn pattern from CHURN_DEFENSES.md

**Evidence:**

- The CHURN_DEFENSES.md doc (§1.5) identifies app crashes as a major churn driver
- The doc recommends a "Sentry release-health gate in the deploy pipeline"
- The `.github/workflows/` folder has `release-health-gate.yml`
- **BUT:** The workflow file's implementation is unclear (not read in this audit)
- There's no evidence of automatic rollback on crash-rate spikes
- The PILOT_LAUNCH_CHECKLIST.md (§2) checks that `rollback=false` in the last run, implying manual intervention

**Required Actions:**

1. Review `.github/workflows/release-health-gate.yml` to confirm it:
   - Queries Sentry's release health API after deploy
   - Checks crash-free user rate in the first 30 minutes
   - Triggers rollback if crash-free rate drops >1% vs previous release
2. If the workflow doesn't implement this, add it:
   - Use Sentry's REST API: `GET /api/0/organizations/{org}/releases/{version}/health/`
   - Compare `crashFreeUsers` to the previous release
   - If regression detected, call the rollback script (`scripts/rollback-lambda.ps1` or similar)
3. Add Slack/email alerts when rollback fires
4. Test with a deliberately broken release in dev

**Estimated Effort:** 1-2 days

---

### C9. No GPS-Proximity Check-In Nudge Implementation

**Location:** `apps/web/src/screens/MapScreen.tsx`, `apps/mobile/` (when implemented)  
**Impact:** The §1.4 operational churn defense from CHURN_DEFENSES.md is missing

**Evidence:**

- The CHURN_DEFENSES.md doc (§1.4) describes a "GPS-proximity check-in nudge" that fires when a consumer enters venue radius
- The doc states: "We already have GPS proximity for check-in; we just don't use it to prompt the check-in conversation."
- The mobile app has a `ProximityNudgeBanner` component in `apps/mobile/src/components/`
- **BUT:** There's no code that:
  - Monitors the user's location in the background
  - Detects when they enter a venue's geofence (e.g. 50m radius)
  - Triggers the nudge banner
  - Persists "already nudged" state to avoid spam

**Required Actions:**

1. Add background location tracking (web: Geolocation API with watch, mobile: expo-location with background mode)
2. Implement geofence detection:
   - Fetch nearby venues when location updates
   - Check if user is within 50m of any venue
   - If yes and not already nudged in the last 24h, show the banner
3. Create a "nudge history" in local storage: `{ venueId, timestamp }`
4. Wire the `ProximityNudgeBanner` to the map screen
5. Add a "Check In Now" button that pre-fills the check-in flow
6. Test: walk into a venue's radius → banner appears → tap button → check-in completes

**Estimated Effort:** 2-3 days

---

### C10. No Reward Threshold Grandfathering Implementation

**Location:** `backend/src/features/rewards/threshold-lock.ts`, `backend/src/features/rewards/service.ts`  
**Impact:** The §1.1 churn pattern from CHURN_DEFENSES.md (Starbucks redemption-price hike) can occur

**Evidence:**

- The CHURN_DEFENSES.md doc (§1.1) describes the "loss-aversion" failure mode when a venue raises a reward threshold
- The doc recommends "grandfather any reward threshold for users already in flight"
- The backend has `threshold-lock.ts` which suggests this feature exists
- **BUT:** The file's implementation is unclear (not read in this audit)
- The platform-completeness-audit tasks don't mention this feature
- The churn-defences spec (`.kiro/specs/churn-defences/`) is referenced but not read

**Required Actions:**

1. Read `backend/src/features/rewards/threshold-lock.ts` to confirm it implements grandfathering
2. If not implemented, add:
   - When a reward's threshold increases, snapshot the old threshold
   - For users with progress toward the old threshold, lock them to the old value
   - Store: `{ userId, rewardId, lockedThreshold, progressAtLock }`
3. Modify the reward progress calculation to check for locked thresholds first
4. Add a "Grandfathered" badge in the consumer rewards UI for locked rewards
5. Test: user has 3/5 visits → venue changes to 8 visits → user still sees 3/5, not 3/8

**Estimated Effort:** 1-2 days

---

### C11. No "Tier Never Expires" Copy in Consumer UI

**Location:** `apps/web/src/screens/RewardsScreen.tsx`, `apps/mobile/` (when implemented)  
**Impact:** Users may assume tiers expire (§1.3 perception failure from CHURN_DEFENSES.md)

**Evidence:**

- The CHURN_DEFENSES.md doc (§1.3) recommends adding: "Your tier never expires. Specific Gets may have end dates set by the venue."
- The platform-completeness-audit tasks don't mention this copy change
- The consumer rewards screen exists but the copy is unclear

**Required Actions:**

1. Add a single line of explanatory text to the rewards screen: "Your tier never expires. Specific Gets may have end dates set by the venue."
2. Place it below the tier badge, above the rewards list
3. Style it as secondary text (smaller, muted color)
4. Ensure it's visible on both web and mobile

**Estimated Effort:** 15 minutes

---

### C12. No T&C Commitment: "Tier Earned = Tier Kept"

**Location:** Legal documents, `apps/web/public/`, `apps/mobile/assets/`  
**Impact:** Users have no written guarantee against the §1.2 tier-demotion pattern from CHURN_DEFENSES.md

**Evidence:**

- The CHURN_DEFENSES.md doc (§1.2) recommends adding a written commitment: "tier earned is tier kept"
- The platform-completeness-audit tasks don't mention this legal change
- The web app has legal pages (`/legal/privacy`, `/legal/terms`) but their content is unclear

**Required Actions:**

1. Add a "Tier Permanence" section to the Terms of Service
2. Text: "Once you earn a tier (Local, Regular, Fixture, Institution, Legend), you keep it permanently. We will never demote you to a lower tier, even if you stop checking in."
3. Update the privacy policy to clarify that tier is not personal data (it's a count-based threshold)
4. Ensure both web and mobile apps link to the updated terms
5. Add a version number and "last updated" date to the terms page

**Estimated Effort:** 1 hour (legal review may take longer)

---

## 🟡 HIGH-PRIORITY FINDINGS (Should Fix Before Pilot)

### H1. No Offline Mode for Consumer App

**Location:** `apps/web/`, `apps/mobile/` (when implemented)  
**Impact:** Users in poor network conditions cannot browse venues or view rewards

**Evidence:**

- The web app has a `ConnectivityBanner` component that shows online/offline status
- The `useConnectivityStore` tracks network state
- **BUT:** There's no offline data caching, no service worker, no IndexedDB persistence
- When offline, the map is blank, rewards don't load, profile is inaccessible

**Required Actions:**

1. Add a service worker for the web app (Vite PWA plugin)
2. Cache venue data, rewards, and user profile in IndexedDB
3. Show cached data when offline with a "Last updated" timestamp
4. Queue check-ins and reward claims for retry when back online (see C4)
5. For mobile, use AsyncStorage + React Query's offline mode

**Estimated Effort:** 2-3 days

---

### H2. No Rate Limiting on Check-In Endpoint

**Location:** `backend/src/features/check-in/handler.ts`  
**Impact:** Abuse via rapid-fire check-ins, GPS spoofing, or bot attacks

**Evidence:**

- The check-in endpoint `POST /v1/check-in` has abuse detection in `backend/src/features/check-in/abuse.ts`
- The abuse module checks for velocity (too many check-ins in a short window)
- **BUT:** There's no rate limit at the API Gateway or Fastify middleware level
- A malicious user can flood the endpoint before the abuse detector kicks in

**Required Actions:**

1. Add rate limiting middleware to Fastify (e.g. `@fastify/rate-limit`)
2. Set limit: 10 check-ins per user per minute (generous for legitimate use, blocks floods)
3. Return 429 with `Retry-After` header when limit exceeded
4. Add rate limit bypass for admin/test accounts (via JWT claim)
5. Monitor rate limit hits in CloudWatch

**Estimated Effort:** 1 day

---
