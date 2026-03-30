# Requirements Document

## Introduction

Area Code is a premium, map-first social discovery application built for South African urban consumers (18–35). It transforms the physical world into a living social layer — a real-time animated map where every venue, business, and hangout spot is a node that pulses, grows, and rewards community activity. The core loop is: see the map → tap a node → check in → earn rewards → feed the map's energy. Launch cities are Johannesburg, Cape Town, and Durban. Currency is ZAR throughout.

The V1 scope covers: the live map with 5 node visual states, check-in system (reward + presence types), reward engine (nth_checkin, daily_first, streak, milestone), business horizontal-swipe dashboard (6 panels), node claiming with CIPC verification, staff validator portal, city leaderboard, basic activity feed, search, share/deep links, push notifications (streak + reward), privacy toggle, QR fallback check-in, offline/connectivity states, data saver mode, device performance tiers, POPIA consent architecture, node boost, pay-as-you-go tier, and a minimal admin panel.

The system is a pnpm monorepo with apps/web, apps/mobile, apps/business, apps/staff, apps/admin, packages/features, packages/shared, backend, and infra directories. Frontend uses React 18 + Vite + TypeScript with NativeWind styling. Backend uses Fastify + TypeScript with PostgreSQL (PostGIS), Redis, and Socket.io. Infrastructure is AWS (Lambda, API Gateway V2, ECS Fargate for Socket.io, RDS, ElastiCache, S3, SES, Cognito) managed entirely by Terraform.

## Glossary

- **Node**: A map marker representing a business or venue. Nodes have 5 visual states (dormant, quiet, active, buzzing, popping) driven by a pulse score.
- **Pulse_Score**: A real-time numeric score stored in Redis that determines a node's visual state. Calculated as `(checkInsLast30min × 5) + (uniqueUsersToday × 2) + (activeRewards × 10) + trendingBonus`.
- **Check_In**: A user action confirming physical presence at a node. Two types: reward (1 per node per 4 hours, qualifies for rewards) and presence (1 per node per 1 hour, updates pulse score only).
- **Reward**: An incentive created by a business, triggered by check-in activity. V1 types: nth_checkin, daily_first, streak, milestone.
- **Redemption_Code**: A 6-character alphanumeric code with 10-minute expiry shown to business staff to validate a reward claim.
- **Consumer**: An end-user of the app who browses the map, checks in, earns rewards, and participates in leaderboards. Authenticated via the `area-code-consumer` Cognito pool.
- **Business_Owner**: A venue or business operator who manages nodes, creates rewards, and views analytics via the business dashboard. Authenticated via the `area-code-business` Cognito pool.
- **Staff_Member**: A business employee who validates redemption codes. Authenticated via the `area-code-staff` Cognito pool. Invite-only accounts.
- **Admin**: An internal operator who manages users, reviews reports, and audits data. Authenticated via the `area-code-admin` Cognito pool. Roles: super_admin, support_agent, content_moderator.
- **Bottom_Sheet**: A UI panel that slides up from the bottom of the screen, used for node details, check-in flows, and sign-up prompts. Replaces modal dialogs throughout the app.
- **Toast**: An ambient social proof notification that floats on the map surface. Types: surge, reward_pressure, checkin, reward_new, streak, leaderboard.
- **Surge**: A visual shockwave animation triggered when a node crosses a state threshold (e.g., active → buzzing).
- **FOMO_System**: The live toast architecture that surfaces real-time social proof on the map to drive engagement.
- **Business_Dashboard**: A horizontal-swipe-only interface with 6 panels (Live, Rewards, Audience, Node, Boost, Settings) for business owners.
- **Staff_Validator**: A minimal portal at `/staff` for staff members to validate redemption codes and view recent redemptions.
- **City_Leaderboard**: A weekly ranking of the top 50 users per city by check-in count, resetting Monday 00:00 SAST.
- **POPIA**: Protection of Personal Information Act — South African data privacy law. Requires explicit consent, no location persistence, and right to erasure.
- **PostGIS**: PostgreSQL spatial extension used for geographic queries including proximity verification via `ST_DWithin`.
- **NativeWind**: Tailwind CSS classes that compile to React Native StyleSheet, enabling shared styling between web and mobile.
- **Mapbox_GL_JS**: The web map rendering engine. Abstracted behind a `<MapView>` wrapper component.
- **ECS_Fargate**: AWS container service running the Socket.io real-time server and node state evaluator sidecar.
- **Yoco**: South African payment gateway for ZAR business subscription processing.
- **CIPC**: Companies and Intellectual Property Commission — South African business registration authority used for node claim verification.
- **Tier**: User status level based on total check-ins: Local (0–9), Regular (10–49), Fixture (50–149), Institution (150–499), Legend (500+).
- **Broadcast_Location**: A privacy setting derived from `consent_records` (not a column on users) controlling whether a user's check-in activity is visible to others.
- **Rewards_Feed**: A screen accessible from the bottom navigation showing active rewards sorted by proximity and scarcity, with sections for nearby rewards and rewards at the user's regular venues.
- **Upload_System**: The S3 presigned URL flow for image uploads — presigned URLs are generated by Lambda, but file data is uploaded directly to S3 by the client.
- **MapInstance**: A generic interface in `mapStore` abstracting the map engine (Mapbox GL JS on web, `@rnmapbox/maps` on mobile) to prevent direct Mapbox imports in shared code.
- **ECTA**: Electronic Communications and Transactions Act — South African law governing electronic contracts. Requires logging of B2B subscription acceptance.
- **pg_trgm**: PostgreSQL trigram extension enabling fuzzy text matching on node names for multilingual search variants.
- **Safety_System**: The set of protections against coercive tracking, stalking, and presence inference, including silent privacy toggles, inference guards, and stalking guards.
- **CI_CD_Pipeline**: GitHub Actions workflows for Lambda deployment (esbuild + zip), ECS Socket server deployment (Docker + ECR), and Terraform (plan on PR, apply on merge).
- **EAS_Build**: Expo Application Services build configuration with development, preview, and production profiles for the mobile app.

## Requirements

### Requirement 1: Monorepo Project Structure

**User Story:** As a developer, I want a well-structured pnpm monorepo with strict dependency rules, so that code is shared cleanly between web, mobile, business, staff, and admin apps without coupling.

#### Acceptance Criteria

1. THE Monorepo SHALL use pnpm workspaces with workspace definitions for `apps/*`, `packages/*`, and `backend` in both `package.json` and `pnpm-workspace.yaml`.
2. THE Monorepo SHALL contain five app directories: `apps/web` (React + Vite consumer portal), `apps/mobile` (Expo consumer portal), `apps/business` (React + Vite business dashboard), `apps/staff` (React + Vite staff validator), and `apps/admin` (React + Vite admin panel).
3. THE Monorepo SHALL contain shared packages: `packages/features` (feature modules shared between web and mobile) and `packages/shared` (cross-feature components, hooks, lib, types, constants, stores).
4. THE Monorepo SHALL contain a `backend` directory with feature-based organisation (check-in, nodes, rewards, business, auth, social, admin, staff, notifications) each containing handler.ts, service.ts, repository.ts, and types.ts.
5. THE Monorepo SHALL contain an `infra` directory with reusable Terraform modules (lambda, cognito, rds, elasticache, ecs-service, api-gateway, s3) and environment compositions (dev, prod).
6. THE Monorepo SHALL enforce TypeScript strict mode (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`) in the root `tsconfig.json`, with all app and package configs extending it.
7. WHEN a file in `packages/features/*` imports code, THE Build_System SHALL reject imports from another feature's internals — only imports from `packages/shared/*` are permitted.
8. WHEN a file in `packages/shared/` imports code, THE Build_System SHALL reject imports from `packages/features/*`.
9. WHEN a file in `packages/` imports code, THE Build_System SHALL reject imports from `apps/`.

### Requirement 2: Authentication System — Four Separate Contexts

**User Story:** As a platform operator, I want four completely separate authentication contexts (Consumer, Business, Staff, Admin), so that credentials, tokens, and sessions never bleed across account types.

#### Acceptance Criteria

1. THE Auth_System SHALL maintain four separate AWS Cognito user pools: `area-code-consumer`, `area-code-business`, `area-code-staff`, and `area-code-admin`.
2. THE Auth_System SHALL maintain four separate Zustand auth stores: `consumerAuthStore`, `businessAuthStore`, `staffAuthStore`, and `adminAuthStore`, with no shared `useAuth()` hook.
3. THE Auth_System SHALL namespace token storage keys as `consumer:accessToken`, `consumer:refreshToken`, `business:accessToken`, `business:refreshToken`, `staff:accessToken`, `staff:refreshToken` — never using a generic `accessToken` key.
4. WHEN a user reaches the sign-up entry point, THE Auth_System SHALL present a hard-fork landing screen ("I'm a customer" / "I'm a business") before any credentials are entered, routing to `/signup/consumer` or `/signup/business` respectively.
5. THE Auth_System SHALL provide separate sign-in routes: `/login` (consumer), `/business/login` (business), `/staff/login` (staff), `/admin/login` (admin), sharing no components between them.
6. WHEN a route guard fails for a business route (`/business/*`), THE Auth_System SHALL redirect to `/business/login` — never to `/login`.
7. WHEN a route guard fails for a staff route (`/staff/*`), THE Auth_System SHALL redirect to `/staff/login`.
8. WHEN a route guard fails for an admin route (`/admin/*`), THE Auth_System SHALL redirect to `/admin/login`.
9. THE Auth_System SHALL provide a `GET /auth/account-type?phone={e164}` endpoint that returns `consumer | business | staff | not_found`, rate-limited to 5 requests per minute per IP, returning `not_found` for all misses without distinguishing wrong pool from no account.
10. WHEN a consumer login OTP fails and the account-type endpoint returns `business`, THE Auth_System SHALL display: "This number is registered to a business account. Sign in here →".
11. THE Auth_System SHALL configure Cognito access token TTL to 15 minutes, refresh token TTL to 30 days, and ID token TTL to 15 minutes for consumer and business pools.
12. THE Auth_System SHALL configure the staff Cognito pool access token TTL to 8 hours.
13. THE Auth_System SHALL create staff accounts via invite-only links (`areacode.co.za/staff-invite/{token}`) with 7-day expiry, not through self-registration.
14. THE Auth_System SHALL create admin accounts via manual provisioning only.
15. WHEN `getCurrentUser()` encounters a network error, THE Auth_System SHALL throw an error — never returning `null` for network failures.
16. WHEN a `ProtectedRoute` encounters a thrown auth error, THE Auth_System SHALL display an error screen with a retry button — never redirecting to the login page.

### Requirement 3: Live Map — Core Visual Engine

**User Story:** As a consumer, I want to see a real-time animated 3D map of my city where nodes pulse and grow based on live activity, so that I can discover where the action is right now.

#### Acceptance Criteria

1. THE Map SHALL fill `100dvh × 100dvw` with no constraining containers, padding, or `max-w-*` wrappers.
2. THE Map SHALL render with Mapbox GL JS configured at pitch 45°, bearing -10°, and fog settings (`range: [0.5, 10]`, `color: '#0a0a0f'`, `horizon-blend: 0.03`).
3. THE Map SHALL render 3D buildings via `fill-extrusion` on the composite source with colour `#161622` and opacity 0.7.
4. THE Map SHALL display node markers in 5 visual states driven by Pulse_Score from Redis: dormant (score 0, 8px, 4s breathe), quiet (1–10, 10px, 3s breathe), active (11–30, 14px, 1.5s pulse), buzzing (31–60, 20px, 0.8s pulse with live count badge), popping (61+, 28px, 0.4s pulse with avatar stack).
5. THE Map SHALL calculate node size as `base + (pulseScore × 0.4px)` with a maximum of `base × 2.5`.
6. THE Map SHALL render each node marker with a layered SVG structure: blur halo (bottom), outer ring with animated stroke-dashoffset, core dot with category colour, and live count badge (top, visible at buzzing+).
7. WHEN a user taps a node, THE Map SHALL slide up a Bottom_Sheet with the node detail view.
8. WHEN a user long-presses a node, THE Map SHALL display a quick preview pill showing name, live count, and top reward title.
9. WHEN a user swipes left or right on the map surface, THE Map SHALL switch between Social, Trending, and Rewards layers.
10. THE Map SHALL display horizontally scrollable category chips at the top of the screen without wrapping.
11. THE Map SHALL display the Toast strip above the bottom navigation, hiding it when a Bottom_Sheet is open.
12. THE Map SHALL never reinitialise the Mapbox instance on navigation — the map component mounts once and persists.
13. THE Map SHALL abstract the map instance behind a generic `MapInstance` interface in `mapStore` that never imports Mapbox GL JS directly, enabling React Native portability.
14. WHEN all visible nodes are dormant, THE Map SHALL display a subtle pill: "Quiet here — see what's happening nearby →" that switches to the Trending layer and flies to the nearest buzzing node.
15. THE Map SHALL provide no zoom controls — pinch-to-zoom only.

### Requirement 4: Node State Transitions and Surge Animations

**User Story:** As a consumer, I want to see dramatic visual surges when a node crosses a state threshold, so that the map feels alive and I experience FOMO about nearby activity.

#### Acceptance Criteria

1. WHEN a node's Pulse_Score crosses a state threshold (dormant→quiet, quiet→active, active→buzzing, buzzing→popping), THE Node_State_Evaluator SHALL emit a `node:state_surge` event to the city socket room.
2. THE Node_State_Evaluator SHALL run as an ECS Fargate sidecar process every 30 seconds per city, staggered by offset to avoid thundering herd.
3. WHEN a client receives a `node:state_surge` event, THE Map SHALL animate: core dot scale 1×→2×→1× (80ms spring), Ring 1 expand 1×→3× and fade (500ms), colour cross-fade to new state (300ms), and if entering popping, Ring 2 fires 150ms after Ring 1.
4. WHEN a node enters the popping state, THE FOMO_System SHALL emit a `toast:surge` (priority 1) to the city room.
5. THE Pulse_Decay_Worker SHALL run every 5 minutes via EventBridge Lambda, applying time-weighted decay: `score × 0.90` during off-peak hours and `score × 0.95` during 18:00–23:00 SAST peak hours, with a floor of 0.
6. WHEN the Pulse_Decay_Worker changes a node's state tier, THE Pulse_Decay_Worker SHALL emit a `node:state_change` event to the city socket room.

### Requirement 5: Check-In System

**User Story:** As a consumer, I want to check in to venues I visit, so that I earn rewards, contribute to the map's energy, and appear in the social layer.

#### Acceptance Criteria

1. WHEN a consumer taps the CHECK IN button on a node detail Bottom_Sheet, THE Check_In_System SHALL acquire GPS coordinates and send `POST /check-in { nodeId, lat, lng, type }`.
2. THE Check_In_System SHALL verify proximity on the backend using PostGIS `ST_DWithin` with a 200-metre radius, casting to `::geography` for accurate metre-based distance — never trusting client-reported distance for eligibility.
3. IF the user is beyond 200 metres, THEN THE Check_In_System SHALL return HTTP 422 with a descriptive error.
4. THE Check_In_System SHALL enforce reward check-in cooldown of 4 hours per user per node via Redis key `checkin:cooldown:reward:{userId}:{nodeId}` with `EX 14400`.
5. THE Check_In_System SHALL enforce presence check-in cooldown of 1 hour per user per node via Redis key `checkin:cooldown:presence:{userId}:{nodeId}` with `EX 3600`.
6. IF the user is on cooldown, THEN THE Check_In_System SHALL return HTTP 429 with `{ cooldownUntil }`.
7. THE Check_In_System SHALL store only `(user_id, node_id, type, checked_in_at)` in the `check_ins` table — latitude and longitude coordinates are used for validation then discarded, never persisted.
8. WHEN a check-in is recorded, THE Check_In_System SHALL increment the Redis daily counter for the node, recalculate the Pulse_Score, and update the Redis sorted set.
9. WHEN a check-in is recorded, THE Check_In_System SHALL publish `{ userId, nodeId, checkInId }` to an SQS reward-evaluation queue for async reward processing, returning `{ success, cooldownUntil }` immediately without waiting for reward evaluation.
10. WHEN a check-in is recorded, THE Check_In_System SHALL emit `node:pulse_update` to the city socket room.
11. WHEN a check-in is recorded and `getUserConsent(userId).broadcast_location` is true, THE Check_In_System SHALL emit `toast:new` to the city socket room.
12. WHEN a check-in is recorded, THE Map SHALL animate the node marker with a scale to 1.4× (150ms spring), a ripple ring expanding outward and fading (600ms), and a live count badge number flip (120ms vertical digit rotation).
13. THE Check_In_System SHALL disable the CHECK IN button during the API call, showing "Checking in..." to prevent duplicate submissions.
14. THE Check_In_System SHALL run velocity checks on every check-in: device fingerprint (>3 check-ins at different nodes in 30 min → flag), IP proximity (>3 users from same /28 subnet within 50m in 1 hour → flag), new account velocity (account <24h old, >3 check-ins → rate-limit to 1/hour).

### Requirement 6: QR Code Fallback Check-In

**User Story:** As a consumer in a mall basement or area with poor GPS, I want to check in by scanning a QR code at the venue entrance, so that I can still participate when GPS is unreliable.

#### Acceptance Criteria

1. WHEN a business enables QR check-in (`qr_checkin_enabled = true`), THE QR_System SHALL generate a QR code encoding `areacode.co.za/qr/{nodeId}/{token}`.
2. THE QR_System SHALL rotate QR tokens every 15 minutes using `HMAC(nodeId + flooredTimestamp, serverSecret)`.
3. WHEN a consumer scans a QR code, THE Check_In_System SHALL accept `POST /check-in { nodeId, qrToken }`, validating the token is unexpired and belongs to the specified node, bypassing GPS proximity verification.
4. THE Business_Dashboard SHALL display the node's check-in QR code at A4-printable resolution in the Settings panel with "Download PNG" and "Regenerate" buttons.
5. WHEN a business taps "Regenerate", THE QR_System SHALL invalidate the old QR token and generate a new URL token.

### Requirement 7: Reward Engine

**User Story:** As a business owner, I want to create rewards triggered by check-in activity, so that I incentivise repeat visits and build customer loyalty.

#### Acceptance Criteria

1. THE Reward_Engine SHALL support four V1 reward types: `nth_checkin` (user's Nth check-in at this node), `daily_first` (first N check-ins of the day), `streak` (N consecutive days with at least 1 check-in, day boundary 00:00–23:59 SAST), and `milestone` (node reaches X check-ins today).
2. WHEN the SQS reward-evaluator Lambda processes a check-in, THE Reward_Engine SHALL evaluate all active rewards at the node and auto-claim qualified rewards.
3. WHEN a reward is claimed, THE Reward_Engine SHALL insert into `reward_redemptions` with `ON CONFLICT DO NOTHING` on `UNIQUE(reward_id, user_id)` to ensure idempotency.
4. WHEN a reward is claimed, THE Reward_Engine SHALL generate a 6-character alphanumeric Redemption_Code with a 10-minute expiry.
5. WHEN a reward is claimed and the user has an active socket connection, THE Reward_Engine SHALL emit `reward:claimed` to the `user:{userId}` socket room.
6. WHEN a reward is claimed and the user has no active socket connection, THE Reward_Engine SHALL enqueue a push notification with 60-second delay: "You earned a reward at {nodeName}. Open Area Code to claim it."
7. THE Reward_Engine SHALL enforce that reward slot count (`total_slots`) is locked after a reward goes live (`is_active = true`) and cannot be increased — a new reward must be created for additional slots.
8. WHEN a reward's remaining slots reach 5 or fewer, THE FOMO_System SHALL emit a `reward_pressure` toast (priority 2) to the city room.
9. WHEN an authenticated user is exactly 1 check-in away from an `nth_checkin` reward at a node, THE Node_Detail_Sheet SHALL display: "One more visit unlocks your {rewardTitle}." in `--text-secondary` with no animation or highlighting.
10. THE Reward_Engine SHALL enforce business tier limits on active rewards: Starter (free) = 3, Growth = 10, Pro = unlimited.
11. WHEN a user opens the app after being offline during a reward claim, THE Reward_Engine SHALL surface unclaimed rewards via `GET /users/me/unclaimed-rewards` with a banner: "You earned a reward while offline."

### Requirement 8: FOMO Toast System

**User Story:** As a consumer, I want to see ambient live toasts on the map showing nearby activity, so that I feel the social energy and am motivated to participate.

#### Acceptance Criteria

1. THE FOMO_System SHALL support 6 toast types with priority ordering: surge (1, highest), reward_pressure (2), checkin (3), reward_new (3), streak (4), leaderboard (4).
2. THE FOMO_System SHALL display a maximum of 1 toast at a time, queuing subsequent toasts behind the visible one.
3. THE FOMO_System SHALL display each toast for 4 seconds, then slide it out to the right, sliding the next toast in.
4. WHEN the toast queue exceeds 3 items, THE FOMO_System SHALL drop the oldest lowest-priority toast silently.
5. THE FOMO_System SHALL animate toasts sliding in from `translateX(110%)` with spring physics, settling, then exiting to `translateX(110%)`.
6. WHEN a Bottom_Sheet is open, THE FOMO_System SHALL hide the toast strip (`display: none`), not merely cover it with z-index.
7. THE FOMO_System SHALL never show a toast for the user's own action.
8. THE FOMO_System SHALL use short, declarative, present-tense copy with no exclamation marks and no emoji in system-generated text.
9. WHEN a `toast:new` event includes `nodeId`, `nodeLat`, and `nodeLng`, THE FOMO_System SHALL filter client-side using haversine distance against the user's last-known GPS position, rendering the toast only if distance is within 2km.
10. IF the user's location is unavailable (permission denied), THEN THE FOMO_System SHALL show all city toasts without distance filtering.
11. THE FOMO_System SHALL enforce a surge toast cooldown of 60 minutes per user per venue via Redis key `toast:surge:seen:{userId}:{nodeId}` with `EX 3600`, suppressing duplicate surge toasts client-side.

### Requirement 9: Node Detail Sheet

**User Story:** As a consumer, I want to see concise, actionable information about a venue when I tap its node, so that I can decide whether to check in.

#### Acceptance Criteria

1. WHEN a consumer taps a node, THE Node_Detail_Sheet SHALL slide up as a Bottom_Sheet with `rounded-t-3xl` top corners and spring physics from `translateY(100%)` to `translateY(0)`.
2. THE Node_Detail_Sheet SHALL contain exactly 4 sections: header (image, name, live status, city, category, rating), social (avatar stack with count, tags), rewards (active rewards with scarcity cues), and check-in CTA button.
3. THE Node_Detail_Sheet SHALL collapse the rewards section when no active rewards exist.
4. WHEN reward slots are 5 or fewer, THE Node_Detail_Sheet SHALL shift the slot count text to `--danger` colour and change the label to the exact number remaining (e.g., "3 left"), never using vague terms.
5. WHEN a reward countdown has 30 minutes or fewer remaining, THE Node_Detail_Sheet SHALL display a live countdown in `--warning` colour. Countdowns above 30 minutes are not shown.
6. WHEN followed users are present at the node, THE Node_Detail_Sheet SHALL display their names above the avatar stack as the first visible element (e.g., "Sipho is here" or "Sipho and 2 others you follow are here").
7. WHEN no followed users are present, THE Node_Detail_Sheet SHALL display tier composition below the avatar stack (e.g., "Mostly Fixtures and Institutions"), omitting the line entirely if no data is available.
8. WHEN a dormant node with no active rewards or check-ins is tapped, THE Node_Detail_Sheet SHALL collapse to its minimum: identity + "Be the first to check in today." + CTA button.
9. THE Node_Detail_Sheet SHALL provide a 3-dot menu with "Share node" and "Report this venue" options.

### Requirement 10: Business Dashboard — Horizontal Swipe

**User Story:** As a business owner, I want a horizontal-swipe dashboard with 6 panels, so that I can manage my venue's presence, rewards, and analytics in a mobile-friendly interface.

#### Acceptance Criteria

1. THE Business_Dashboard SHALL present 6 panels in horizontal swipe order: Live, Rewards, Audience, Node, Boost, Settings.
2. THE Business_Dashboard SHALL use horizontal-only navigation with spring physics (`tension: 280, friction: 60`) — no vertical nav, no sidebar, no tabs.
3. THE Business_Dashboard SHALL display horizontal pill dots at the top showing the current panel position, with tapping a dot jumping to that panel.
4. WHILE a panel is displayed, THE Business_Dashboard SHALL ensure each panel is exactly `100dvh` tall — inner content may scroll vertically, but panel-to-panel navigation is horizontal only.
5. THE Live_Panel SHALL display a real-time check-in counter (large number), live user avatars appearing, today's pulse score graph, and context benchmarks ("vs last Tuesday +18%", "vs your average +12%", "vs similar venues nearby: above average").
6. WHEN a node has fewer than 10 total check-ins, THE Live_Panel SHALL replace the live counter with a getting-started checklist: add photo, create first reward, share node, display QR code — each item linking to the relevant panel.
7. THE Rewards_Panel SHALL display active rewards as cards showing claimed count, slots remaining, and expiry, with a "+" button to create new rewards.
8. THE Rewards_Panel SHALL display a notice during reward creation: "Slot count cannot be raised once live. Set a realistic number."
9. THE Audience_Panel SHALL display anonymised aggregates only: age range, tier distribution, repeat vs new visitors — no individual user data without consent.
10. THE Node_Panel SHALL allow customisation of node colour, icon, name, category tags, and photos carousel, with a preview of how the node looks at each pulse state.
11. THE Boost_Panel SHALL display tiered ZAR pricing (R25/2hr, R50/6hr, R150/24hr) with Yoco checkout, with prices loaded from `GET /business/plans` — never hardcoded.
12. THE Settings_Panel SHALL contain business profile, contact info, opening hours, subscription management, staff account management, QR code display/download/regenerate, and node flag notification with appeals submission.

### Requirement 11: Business Subscription and Payments

**User Story:** As a business owner, I want to subscribe to Growth or Pro tiers using ZAR payments, so that I can unlock additional features for my venue.

#### Acceptance Criteria

1. THE Payment_System SHALL process all financial transactions through Yoco in ZAR — never processing card details client-side.
2. THE Payment_System SHALL load all prices from `GET /business/plans` — never hardcoding prices in frontend components.
3. THE Payment_System SHALL support subscription tiers: Starter (free), Growth (R299/mo or R2,990/yr), Pro (R799/mo or R7,990/yr), and Pay-as-you-go (R99/day or R199/week).
4. THE Payment_System SHALL support Node Boost pricing: R25/2hr, R50/6hr, R150/24hr, with Growth/Pro included boosts applying to the 6-hour slot.
5. WHEN a business selects a plan, THE Payment_System SHALL create a Yoco checkout session and redirect to the Yoco payment page.
6. WHEN payment succeeds, THE Payment_System SHALL poll `GET /business/me` every 3 seconds (max 10 attempts) to confirm subscription activation.
7. WHEN a Yoco webhook reports `payment.failed`, THE Payment_System SHALL enter a 7-day grace period (`payment_grace_until` on `business_accounts`), sending emails on day 1, day 4, and day 7.
8. WHEN the grace period expires without successful payment, THE Payment_System SHALL deactivate rewards and drop the node to free tier with a dashboard banner.
9. WHEN a successful payment retry occurs during the grace period, THE Payment_System SHALL cancel the lapse sequence immediately.
10. THE Payment_System SHALL provide 14-day free trials for Growth and Pro tiers with email nudges at day 7, day 12, and day 14.

### Requirement 12: Node Claiming and Business Onboarding

**User Story:** As a business owner, I want to claim my venue on the map with CIPC verification, so that I can manage my node and create rewards.

#### Acceptance Criteria

1. WHEN a business signs up and searches for their venue, THE Node_Claiming_System SHALL display existing nodes matching the search.
2. WHEN a business taps "Claim this venue" on an existing node, THE Node_Claiming_System SHALL require a CIPC-format business registration number (`YYYY/NNNNNN/NN`).
3. WHEN the CIPC API validates the registration number and the name matches the node, THE Node_Claiming_System SHALL auto-approve the claim and grant instant provisional access.
4. WHEN the CIPC API validates the registration number but the name does not match, THE Node_Claiming_System SHALL flag the claim for manual review (24–48 hours).
5. WHEN the CIPC API returns an invalid registration number, THE Node_Claiming_System SHALL reject the claim immediately with a reason.
6. IF the CIPC API is unavailable (timeout or 5xx), THEN THE Node_Claiming_System SHALL queue the claim for manual review, grant provisional access, and display: "We couldn't verify your registration number automatically. We'll review it within 24 hours. Your dashboard is available in the meantime."
7. WHILE a node has provisional access, THE Node_Claiming_System SHALL display an `unverified` badge on the node — rewards are live, but the badge remains until admin confirms.
8. WHEN a venue does not exist on the map, THE Node_Claiming_System SHALL allow the business to add it via a form (name, address or map pin, category, optional photos), creating the node in `unclaimed` state.
9. THE Node_Claiming_System SHALL allow only one pending claim per node at a time — additional applicants see "Claim in progress" and can submit a counter-claim for admin review.
10. THE Node_Claiming_System SHALL store claim status in `nodes.claim_status` (unclaimed, pending, claimed) and CIPC status in `nodes.claim_cipc_status` (validated, pending_manual, cipc_unavailable, rejected).

### Requirement 13: Staff Validator Portal

**User Story:** As a staff member at a venue, I want a simple code validator interface, so that I can verify customer reward redemptions quickly.

#### Acceptance Criteria

1. THE Staff_Validator SHALL be accessible at the `/staff` route with authentication via the `area-code-staff` Cognito pool.
2. THE Staff_Validator SHALL display a code input field and a list of recent redemptions.
3. WHEN a staff member enters a Redemption_Code, THE Staff_Validator SHALL validate it against the backend and display success or failure.
4. THE Staff_Validator SHALL display redemption codes and timestamps only — never showing which user account redeemed, to protect consumer privacy.
5. THE Staff_Validator SHALL not provide access to audience analytics, reward creation/editing, subscription management, or other staff account visibility.
6. THE Business_Dashboard Settings_Panel SHALL allow business owners to invite staff members by phone number or email, with the system sending an invite link (`areacode.co.za/staff-invite/{token}`) that expires in 7 days.
7. THE Business_Dashboard SHALL enforce staff account limits per tier: Starter = 2, Growth = 5, Pro = unlimited.

### Requirement 14: City Leaderboard

**User Story:** As a consumer, I want to see a weekly city leaderboard ranking users by check-ins, so that I feel competitive motivation to check in more.

#### Acceptance Criteria

1. THE City_Leaderboard SHALL display the top 50 users in each city, ranked by check-in count in the current week.
2. THE City_Leaderboard SHALL be accessible from the bottom navigation (trophy icon).
3. WHEN the user is outside the top 50, THE City_Leaderboard SHALL pin the user's own rank at the bottom of the list.
4. THE City_Leaderboard SHALL reset every Monday at 00:00 SAST.
5. WHEN the leaderboard resets, THE Leaderboard_Worker SHALL snapshot final standings to the `leaderboard_history` table, then reset weekly scores in Redis using `RENAME + DEL` (never zeroing scores).
6. WHEN the leaderboard resets, THE Leaderboard_Worker SHALL send push notifications to the top 10 of the prior week: "You finished #{rank} in {cityName} this week."
7. THE Leaderboard_Worker SHALL send a pre-reset push notification at Sunday 20:00 SAST to opted-in users with their current rank.
8. WHEN a user opens the app on Monday after a reset, THE Activity_Feed SHALL display a recap card showing the prior week's top 3 and the user's own rank, auto-dismissing after 8 seconds or on tap.
9. THE Database SHALL include `neighbourhood_id` columns on `check_ins` and `users` tables in V1 migrations, and a `neighbourhoods` table with PostGIS polygon boundaries, to support V2 neighbourhood leaderboards without requiring migration on large tables.

### Requirement 15: Social Graph and Activity Feed

**User Story:** As a consumer, I want to follow other users and see a feed of their activity, so that I feel socially connected and discover venues through my network.

#### Acceptance Criteria

1. THE Social_System SHALL allow verified consumers to follow other users.
2. THE Activity_Feed SHALL group check-ins by venue: "3 people you follow were at Assembly last night" — not 3 separate cards. Ungrouped only when 1 person at a venue.
3. THE Activity_Feed SHALL surface the reward claimed when applicable: "Aisha got a free filter at Truth Coffee" over "Aisha checked in to Truth Coffee".
4. WHEN followed users are currently at a node, THE Node_Detail_Sheet SHALL display "X people you follow are at this node right now" replacing the raw count.
5. WHEN a user views a node's "who's here" section, THE Node_Detail_Sheet SHALL order followed users first, with their names as the headline element above the avatar stack.
6. THE Social_System SHALL make "who's here" avatars tappable to a full profile only when the viewer and subject mutually follow each other — otherwise showing tier badge + initials only.
7. THE Social_System SHALL rate-limit `GET /nodes/{nodeId}/who-is-here` to 20 requests per 10 minutes per user, returning 429 and flagging for review on excess.

### Requirement 16: Search

**User Story:** As a consumer, I want to search for venues by name, so that I can quickly find and navigate to a specific node on the map.

#### Acceptance Criteria

1. WHEN a consumer taps the search icon (top-right of map screen), THE Search_System SHALL slide up a SearchSheet Bottom_Sheet.
2. THE Search_System SHALL display results in two sections: "Nearby" (sorted by proximity × pulseScore) and "Trending in {cityName}".
3. THE Search_System SHALL debounce search input by 300ms with a minimum of 2 characters before triggering `GET /nodes/search?q=...&lat=...&lng=...`.
4. WHEN a consumer taps a search result, THE Search_System SHALL close the sheet, fly the map to that node, and auto-open its detail Bottom_Sheet.
5. THE Search_System SHALL use PostgreSQL `pg_trgm` trigram fuzzy matching on node names to handle multilingual name variants and informal naming conventions.

### Requirement 17: Privacy, POPIA Compliance, and Consent Architecture

**User Story:** As a consumer in South Africa, I want control over my data and visibility, so that my privacy is protected in compliance with POPIA.

#### Acceptance Criteria

1. THE Privacy_System SHALL never persist user location coordinates — `check_ins` stores only `(user_id, node_id, type, checked_in_at)`.
2. THE Privacy_System SHALL provide a "Show my activity on the map" toggle in Profile → Privacy (top section, single toggle), defaulting to on with clear explanation.
3. WHEN `broadcast_location` is false, THE Privacy_System SHALL ensure the user does not appear in "who's here" avatar stacks, the live count badge does not increment for their check-in, no toast is emitted for their check-in, and their check-in still updates the Pulse_Score on the backend only.
4. THE Privacy_System SHALL derive `broadcast_location` from the latest `consent_records` row per user — never storing it as a column on the `users` table.
5. THE Privacy_System SHALL cache consent values in Redis (`user:consent:{userId}` with `EX 3600`), falling back to a DB query and re-populating the cache on miss.
6. THE Privacy_System SHALL allow the `broadcast_location` toggle to be changed silently — no confirmation dialogs, no "your followers will be notified" messaging, no email sent.
7. THE Privacy_System SHALL present two explicit opt-ins at sign-up: "Contribute anonymised check-in data to city insights" (off by default) and "Show my activity on the map" (on by default with explanation).
8. THE Privacy_System SHALL provide in Profile → Privacy: view all check-in history, export check-in history (CSV), and delete all check-in history (soft-delete, hard-delete after 30 days per POPIA Article 14).
9. THE Privacy_System SHALL track consent version (format `v{major}.{minor}`) in `consent_records`, with major version bumps triggering a re-consent Bottom_Sheet on next app open.
10. THE Privacy_System SHALL enforce an aggregation rule: no data point in any report or API response may represent fewer than 20 unique users.
11. THE Privacy_System SHALL store the current consent version in Lambda environment variable `AREA_CODE_CONSENT_VERSION`.

### Requirement 18: Real-Time Architecture (Socket.io and Redis)

**User Story:** As a consumer, I want real-time updates on the map without refreshing, so that node states, toasts, and social activity feel live and immediate.

#### Acceptance Criteria

1. THE Real_Time_System SHALL run the Socket.io server on ECS Fargate (not Lambda) to maintain persistent TCP connections.
2. THE Real_Time_System SHALL authenticate socket connections via JWT (Cognito public key verification) at the handshake, rejecting unauthenticated connections.
3. WHEN a token is present, THE Real_Time_System SHALL join the client to `city:{citySlug}` and `user:{userId}` rooms.
4. WHEN no token is present (anonymous user), THE Real_Time_System SHALL join the client to `city:{citySlug}` only (read-only, no presence events emitted).
5. WHEN a node detail Bottom_Sheet opens, THE Real_Time_System SHALL join the client to `node:{nodeId}` room, leaving on sheet close.
6. THE Real_Time_System SHALL ensure every `room:join` has a corresponding `room:leave` in cleanup, and every socket subscription is cleaned up on component unmount.
7. THE Real_Time_System SHALL broadcast `node:pulse_update { nodeId, pulseScore, checkInCount, state }` to city rooms on check-in.
8. THE Real_Time_System SHALL broadcast `toast:new { type, message, nodeId, nodeLat, nodeLng, avatarUrl }` to city rooms, always including `nodeLat` and `nodeLng` when `nodeId` is present.
9. THE Real_Time_System SHALL broadcast `reward:slots_update { rewardId, slotsRemaining }` to node rooms when reward availability changes.
10. THE Real_Time_System SHALL use a single socket instance from `packages/shared/lib/socket.ts` — never instantiating a new socket in a component.
11. THE Real_Time_System SHALL store all Redis key patterns in `backend/src/shared/redis/keys.ts` — never constructing key strings inline.
12. THE Real_Time_System SHALL set explicit TTLs on all ephemeral Redis keys (cooldowns, presence, toast queues).
13. IF Redis is unavailable, THEN THE Real_Time_System SHALL render all nodes as `dormant` — never falling back to DB counts for live Pulse_Score.

### Requirement 19: Anonymous User Experience

**User Story:** As an unauthenticated visitor, I want to browse the live map and see node summaries, so that I can experience the app's value before signing up.

#### Acceptance Criteria

1. THE Map SHALL always be accessible to anonymous users without authentication gating.
2. THE Map SHALL display to anonymous users: node markers with colour, size, and state; node pulse state labels; node name, category, and address; today's check-in count (number only, not avatars); and reward count ("2 active rewards", not details).
3. WHEN an anonymous user attempts to check in, view "who's here", view reward details, access the leaderboard, or view any user profile, THE Auth_System SHALL display a sign-up Bottom_Sheet — never redirecting to a separate `/login` page.
4. THE Real_Time_System SHALL allow anonymous users to receive toasts and pulse updates via city room subscription without authentication.

### Requirement 20: User Tiers and Profile

**User Story:** As a consumer, I want to see my tier status and check-in history on my profile, so that I feel a sense of progression and status.

#### Acceptance Criteria

1. THE Tier_System SHALL assign tiers based on total check-ins: Local (0–9, grey badge), Regular (10–49, bronze badge), Fixture (50–149, silver badge), Institution (150–499, gold badge), Legend (500+, animated gradient badge).
2. THE Tier_System SHALL display tier badges on user avatars in "who's here" sections and on the City_Leaderboard.
3. THE Profile_Screen SHALL display the user's tier, total check-ins, streak count, check-in history, and badge collection.
4. THE Profile_Screen SHALL display the streak badge persistently in the bottom-left corner above the nav when streak > 0, using an SVG flame icon coloured `--warning` when streak ≥ 3 and `--text-muted` when 1–2.
5. WHEN a user taps the streak badge, THE Profile_Screen SHALL open a micro-sheet: "{N}-night streak. Check in today to keep it." with progress dots for the week.
6. WHILE a user has not checked in today and it is after 18:00 local time, THE Streak_System SHALL pulse the streak badge once (single, subtle animation).

### Requirement 21: Share and Deep Links

**User Story:** As a consumer, I want to share venues with friends via a link, so that I can invite them to discover places on Area Code.

#### Acceptance Criteria

1. WHEN a consumer taps "Share node" from the node detail 3-dot menu, THE Share_System SHALL open the native share sheet with URL `areacode.co.za/node/{nodeSlug}` and text "Check this out on Area Code".
2. WHEN a deep link `areacode.co.za/node/{nodeSlug}` is opened, THE Share_System SHALL open the app (or web fallback), fly the map to the node, and auto-open its detail Bottom_Sheet.
3. THE Share_System SHALL provide a public node endpoint `GET /nodes/{nodeSlug}/public` (no auth required) returning name, category, city, current Pulse_Score, and active reward count for web fallback and OG tag metadata.
4. THE Share_System SHALL handle deep links via Expo Router universal links on mobile and standard URL routing on web.

### Requirement 22: Report and Flag Mechanism

**User Story:** As a consumer, I want to report problematic venues, so that the platform maintains quality and trust.

#### Acceptance Criteria

1. WHEN a consumer taps "Report this venue" from the node detail 3-dot menu, THE Report_System SHALL display a single-select list of report types: wrong location, permanently closed, fake/manipulated check-ins, inappropriate content, other.
2. THE Report_System SHALL accept an optional text field (max 200 characters) and submit via `POST /v1/nodes/{nodeId}/report`.
3. WHEN a node receives 5 or more fraud reports in 24 hours, THE Report_System SHALL automatically set the node to `flagged` status, hiding it from trending surfaces pending review.
4. WHEN a node is flagged, THE Report_System SHALL notify the business owner: "Your node has been reported and is under review. It remains visible but won't appear in trending until resolved."
5. THE Report_System SHALL allow the business owner to submit an appeal via the Settings panel (max 500 characters + optional photo evidence).
6. THE Report_System SHALL never reveal reporter identity to the node owner.
7. WHEN a reporter has 3 rejected reports in 30 days, THE Report_System SHALL ban the reporter from submitting further reports.

### Requirement 23: Push Notifications

**User Story:** As a consumer, I want to receive timely push notifications about my streaks and rewards, so that I stay engaged without being spammed.

#### Acceptance Criteria

1. THE Notification_System SHALL support delivery via Expo Push Notifications (iOS/Android) and Web Push (VAPID keys for Chrome, Edge, Firefox).
2. THE Notification_System SHALL support notification types with opt-in defaults: streak at risk (OFF, max 1/day), reward activated at regulars (OFF, max 2/day), leaderboard pre-reset (OFF, 1/week), top 10 result (ON, 1/week), reward claimed (ON, per-event with socket primary and 60s push fallback).
3. THE Notification_System SHALL never send push for toast events, pulse score changes, or other users' check-ins — push is for personal, time-sensitive signals only.
4. THE Notification_System SHALL prime the OS permission prompt with a personalised value hook Bottom_Sheet after the first successful check-in, using a nearby recent check-in event if available, or falling back to a value list.
5. WHEN a user dismisses the notification prompt with "Not now", THE Notification_System SHALL defer for 7 days via Redis key `notif:deferred:{userId}` with `EX 604800` — never asking twice in one session.
6. THE Notification_System SHALL handle `DeviceNotRegistered` errors by setting `is_active = false` on the push token.
7. THE Notification_System SHALL store push tokens in `user_push_tokens` and preferences in `notification_preferences` tables.

### Requirement 24: Offline and Connectivity States

**User Story:** As a consumer in South Africa where connectivity gaps are common, I want the app to degrade gracefully when offline, so that I can still browse cached data and understand what features are unavailable.

#### Acceptance Criteria

1. WHEN `navigator.onLine` is false or fetch times out, THE Offline_System SHALL display a subtle banner: "No connection. Check-ins paused." with cached map tiles and node states showing "Last updated Xm ago".
2. WHEN the socket disconnects but the API is reachable, THE Offline_System SHALL display a single dot indicator in the nav ("Live updates paused") and poll at 30-second intervals — never 5-second intervals.
3. WHEN connectivity is restored, THE Offline_System SHALL silently resume real-time updates, dismiss indicators, and replay only the last 5 minutes of events (not the full outage backlog).
4. WHILE offline, THE Offline_System SHALL grey out the CHECK IN button with text "Connect to check in" — no error toast, the button state is self-explanatory.
5. WHILE offline, THE Offline_System SHALL show "Rewards unavailable offline" in the node detail sheet — rewards are never cached.
6. THE Offline_System SHALL persist node states via Zustand store to `localStorage`/`AsyncStorage` as a fallback, and cache user profile and tier indefinitely.
7. THE Offline_System SHALL configure Socket.io reconnect with exponential backoff and jitter (`baseDelay: 1000ms, maxDelay: 30000ms, jitter: true`) to handle load shedding reconnect storms.
8. THE Offline_System SHALL limit the Redis pub/sub queue to max 500 events per city, dropping events beyond this depth.

### Requirement 25: Data Saver and Device Performance Tiers

**User Story:** As a consumer on a limited data plan or low-end device, I want the app to adapt to my constraints, so that it remains usable without excessive data consumption or lag.

#### Acceptance Criteria

1. WHEN `navigator.connection.saveData` is true or the user enables Data Saver in Profile → Settings, THE Data_Saver_System SHALL activate: static map tiles, Socket.io replaced with 30s polling, avatar images replaced with initials placeholders, no background refetch, blur halos and triple-layer glow disabled, Lottie animations replaced with CSS transitions.
2. WHILE Data Saver is active, THE Data_Saver_System SHALL display a small "D" badge on the nav bar, tappable to explain the mode and offer to disable it.
3. THE Performance_System SHALL detect device tier on first map load via `navigator.hardwareConcurrency` and a 500ms frame-rate probe.
4. WHILE the device is detected as Mid tier (2–3 cores, 30–54fps), THE Performance_System SHALL disable 3D buildings and halve blur halo opacity.
5. WHILE the device is detected as Low tier (1–2 cores, <30fps), THE Performance_System SHALL disable 3D buildings, disable blur halos, reduce map pitch to 20°, and set Framer Motion `reducedMotion: true`.
6. THE Performance_System SHALL ensure nodes still breathe and pulse at all device tiers — reduction is cosmetic depth only, not core behaviour.

### Requirement 26: Context-Aware Navigation

**User Story:** As a consumer, I want the app's default tab to shift based on time of day, so that the most relevant experience is surfaced when I open the app.

#### Acceptance Criteria

1. WHILE the current time is 00:00–17:00 SAST, THE Navigation_System SHALL default to the Rewards tab (discovery mode).
2. WHILE the current time is 17:00–23:59 SAST, THE Navigation_System SHALL default to the Leaderboard tab (social mode).
3. THE Navigation_System SHALL set the default tab via `navigationStore.activeDefaultTab` using a `useEffect` that reads the current hour on mount and on each app foreground event — no server call required.
4. WHEN the user has already navigated to a tab in the current session, THE Navigation_System SHALL preserve their last-visited tab — the time-based default only applies on fresh app open.

### Requirement 27: First-Time User Onboarding

**User Story:** As a new user, I want minimal, context-delivered hints that don't block my interaction, so that I learn the app naturally without tutorial screens or modals.

#### Acceptance Criteria

1. WHEN a new user opens the app for the first time, THE Onboarding_System SHALL load the map normally, then after 1.5 seconds fade in a single hint pill at map centre: "Tap any dot to explore" with a dismiss [×] button.
2. WHEN the user taps their first node, THE Onboarding_System SHALL permanently dismiss the hint pill.
3. WHEN the user attempts their first layer-swipe and has never switched layers, THE Onboarding_System SHALL display a one-time gesture hint at the map edge: "← Social  Trending  Rewards →" that fades after 3 seconds or on first successful swipe.
4. WHEN the user completes their first check-in, THE Onboarding_System SHALL display a quiet toast: "You're on the map." — no confetti, no particle effects.
5. THE Onboarding_System SHALL track onboarding state (`hintSeen`, `layerHintSeen`, `firstCheckIn`) in `userStore`, persisted to storage, ensuring hints are never shown twice.

### Requirement 28: Admin Panel

**User Story:** As an internal operator, I want an admin panel to manage users, review reports, audit consent, and investigate abuse, so that the platform operates safely and compliantly.

#### Acceptance Criteria

1. THE Admin_Panel SHALL be a separate React web app at `/admin` with its own Cognito pool (`area-code-admin`).
2. THE Admin_Panel SHALL enforce three roles via Cognito custom attribute `custom:admin_role`: super_admin (all actions), support_agent (view + message users, extend trials, view consent — no delete, no impersonate), content_moderator (node management, report queue, claim review only).
3. THE Admin_Panel SHALL provide consumer user management: view check-in history, disable/re-enable account (Cognito `AdminDisableUser`), reset abuse flags, manually recalculate tier, override streak count (with mandatory reason), process right-to-erasure (soft-delete → hard-delete 30-day queue), view push tokens and notification preferences, view consent record history, and send in-app admin messages.
4. THE Admin_Panel SHALL provide business account management: view subscription tier and payment history, manually extend trial (logged), view and revoke staff accounts, force-deactivate rewards, override CIPC validation result, and view/invalidate QR tokens.
5. THE Admin_Panel SHALL provide a POPIA consent audit panel: per-user consent view, re-consent export (users on version < current), erasure request queue with countdown, and data access request log.
6. THE Admin_Panel SHALL log all admin actions to the `audit_log` table with `admin_id`, `admin_role`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, and `note`.
7. THE Admin_Panel SHALL log all impersonation sessions to the `impersonation_log` table with a mandatory `note` field — the API rejects impersonation requests without a note. Impersonation is super_admin only and read-only.
8. THE Admin_Panel SHALL deliver admin messages via Socket (primary) with push fallback — never via email.
9. THE Admin_Panel SHALL surface nodes with 3 or more reports of the same type in the report review queue.

### Requirement 29: Abuse Prevention

**User Story:** As a platform operator, I want automated abuse detection and prevention, so that check-in gaming, reward draining, and fake activity are caught early.

#### Acceptance Criteria

1. THE Abuse_System SHALL run velocity checks on every `POST /check-in` after proximity validation: device fingerprint check (same fingerprint, >3 check-ins at different nodes in 30 min → flag), IP subnet check (>3 users from same /28 subnet within 50m in 1 hour → flag all), pulse score anomaly (node jumped ≥2 states in <2 minutes → flag node and notify admin), reward slot draining (same device claiming >2 rewards at same node in 24h → block and flag), new account velocity (account <24h old, >3 check-ins → rate-limit to 1/hour).
2. THE Abuse_System SHALL store flagged events in the `abuse_flags` table with type, entity_id, entity_type, evidence_json, reviewed status, and auto_actioned flag.
3. THE Abuse_System SHALL auto-suppress only pulse score anomaly and reward slot draining cases (high confidence) — device velocity, IP subnet, and new account velocity flag for admin review without auto-action.
4. THE Abuse_System SHALL store hashed device fingerprints (FingerprintJS Pro for web, device UUID + model hash for native) in the `device_fingerprints` table linked to user_id.
5. THE Abuse_System SHALL flag multiple user accounts sharing a device fingerprint for review — never blocking on fingerprint alone, as shared devices exist.

### Requirement 30: Database Schema and Migrations

**User Story:** As a developer, I want a well-defined PostgreSQL schema with PostGIS, partitioning, and idempotent migrations, so that the data layer supports all V1 features reliably.

#### Acceptance Criteria

1. THE Database SHALL use PostgreSQL with the PostGIS extension enabled for geographic queries.
2. THE Database SHALL include core tables: `users`, `business_accounts`, `cities`, `neighbourhoods`, `nodes`, `check_ins`, `rewards`, `reward_redemptions`, `node_images`, `reports`, `leaderboard_history`, `consent_records`, `business_consent_records`, `user_push_tokens`, `notification_preferences`, `staff_invites`, `staff_accounts`, `abuse_flags`, `device_fingerprints`, `audit_log`, `impersonation_log`, `admin_messages`, and `user_follows`.
3. THE Database SHALL partition the `check_ins` table by month using `PARTITION BY RANGE (checked_in_at)`, with a monthly Lambda job creating partitions one month ahead.
4. THE Database SHALL enforce reward idempotency via `UNIQUE(reward_id, user_id)` constraint on `reward_redemptions`.
5. THE Database SHALL use `GEOGRAPHY(POINT, 4326)` generated column on `nodes` for spatial indexing with a GIST index.
6. THE Database SHALL store all timestamps as UTC using `TIMESTAMPTZ`.
7. THE Database SHALL use Prisma ORM with `@map` and `@@map` for snake_case DB columns and camelCase code, with raw SQL via `prisma.$queryRaw` for PostGIS spatial operations.
8. THE Database SHALL use append-only migrations with `IF NOT EXISTS` / `IF EXISTS` for idempotency — never modifying or deleting existing migration files.
9. THE Database SHALL include the `neighbourhoods` table and `neighbourhood_id` FK columns on `users` and `check_ins` in V1 migrations to avoid large-table migrations for V2.

### Requirement 31: AWS Infrastructure (Terraform)

**User Story:** As a developer, I want all AWS infrastructure defined in Terraform with reusable modules, so that environments are reproducible and no resources are created manually.

#### Acceptance Criteria

1. THE Infrastructure SHALL be defined entirely in Terraform — never creating AWS resources manually.
2. THE Infrastructure SHALL use reusable Terraform modules for: Lambda (function + IAM role), Cognito (4 user pools + clients), RDS (PostgreSQL with PostGIS, Multi-AZ in prod), ElastiCache (Redis replication group with 1 primary + 2 replicas, `cache.t4g.small`), ECS Fargate (Socket.io server + state evaluator sidecar), API Gateway V2 (HTTP API + routes), and S3 (media buckets).
3. THE Infrastructure SHALL compose modules in `infra/environments/dev/` and `infra/environments/prod/` — environment directories never define resources directly.
4. THE Infrastructure SHALL use S3 + DynamoDB for Terraform remote state.
5. THE Infrastructure SHALL deploy Lambda functions on `arm64` (Graviton2) architecture with `provided.al2023` runtime.
6. THE Infrastructure SHALL provision concurrency on critical-path Lambdas: check-in (min 2), node-detail (min 2), rewards-near-me (min 1).
7. THE Infrastructure SHALL deploy PgBouncer on ECS Fargate for Lambda connection pooling in `transaction` mode.
8. THE Infrastructure SHALL configure RDS with Multi-AZ in production and a read replica for analytics queries.
9. THE Infrastructure SHALL attach WAF to API Gateway V2 with AWS Managed Rules, rate-based rules (100 req/5min per IP on `/check-in`, 20 req/5min per IP on `/auth/*`), and CloudWatch logging.
10. THE Infrastructure SHALL configure AWS Budgets with an 80% threshold alert to an SNS topic subscribed to the engineering team.
11. THE Infrastructure SHALL use either Lambda outside VPC with security groups on RDS/Redis, or Lambda inside VPC with VPC endpoints — never deploying Lambda in a VPC without a NAT Gateway cost mitigation strategy, documented via `lambda_in_vpc` Terraform variable.
12. WHEN deploying a new Lambda, THE Infrastructure SHALL follow the checklist: write handler, add to Terraform (both dev and prod), add API Gateway route, add to `lambda_list.txt`, add to build script, `terraform plan` then `terraform apply` before code deploy.

### Requirement 32: Backend API Architecture

**User Story:** As a developer, I want a consistent backend architecture with strict handler ordering, layered separation, and typed errors, so that the API is reliable, secure, and maintainable.

#### Acceptance Criteria

1. THE Backend SHALL use Fastify with TypeScript for all HTTP handlers.
2. THE Backend SHALL follow strict handler check order on every route: JWT verify (401) → role check (403) → Zod input validation (400) → rate limit check via Redis (429) → service layer call → repository call → Redis update → Socket emit → return 200/201.
3. THE Backend SHALL enforce layer separation: services contain all business logic (never access `req`/`reply`), repositories contain only DB/Redis queries (zero business logic), routes never call repositories directly.
4. THE Backend SHALL validate all API inputs with Zod schemas — no manual `if` checks on request bodies.
5. THE Backend SHALL use typed `AppError` from `backend/src/shared/errors/AppError.ts` for all error responses — never returning raw JS errors or untyped error objects.
6. THE Backend SHALL return camelCase JSON keys, with Prisma mapping between camelCase code and snake_case DB columns.
7. THE Backend SHALL log with `[route-name]` prefix convention for CloudWatch filterability.
8. THE Backend SHALL make background workers (pulse decay, leaderboard recalc, cleanup) idempotent, with `[worker-name]` log prefix and completion summary logs.
9. THE Backend SHALL rate-limit OTP requests: max 3 per phone number per hour, 60-second resend cooldown via Redis key `otp:cooldown:{phone}`, returning 429 with `{ retryAfter: 60 }`.

### Requirement 33: Design System and UI Standards

**User Story:** As a developer, I want a consistent dark-first design system with CSS variable tokens, so that the app maintains its premium urban aesthetic across all surfaces.

#### Acceptance Criteria

1. THE Design_System SHALL define all colours in `tokens.css` CSS variables — never using hardcoded hex values or Tailwind colour classes in components.
2. THE Design_System SHALL use dark-first theming with backgrounds (`--bg-map: #0a0a0f`, `--bg-base: #0f0f17`, `--bg-surface: #161622`, `--bg-raised: #1e1e2e`), text (`--text-primary: #f0f0f5`, `--text-secondary: #a0a0b8`, `--text-muted: #606078`), and accent (`--accent: #6c63ff`).
3. THE Design_System SHALL use `Syne` (700, 800 weights) for display/headings and `DM Sans` (400, 500 weights) for body/UI, preloaded in `<head>` to prevent layout shift.
4. THE Design_System SHALL use 4px base spacing unit with all spacing as multiples of 4px.
5. THE Design_System SHALL use spring physics for all animations (default `tension: 280, friction: 60`) — no linear transitions.
6. THE Design_System SHALL use `rounded-2xl` for cards and `rounded-t-3xl` for Bottom_Sheets — never `rounded-xl` or `rounded-lg`.
7. THE Design_System SHALL use no emoji in system UI (navigation, headings, buttons, labels) — SVG icons only. Emoji permitted only in user-generated content.
8. THE Design_System SHALL use no modal dialogs — all interactions happen in Bottom_Sheets or inline.
9. THE Design_System SHALL use skeleton screens matching content shape for loading states — never spinners on the map, never indeterminate progress bars.
10. THE Design_System SHALL use no confetti, no particle explosions, no auto-play sound, no rainbow gradients (except Legend tier), no interstitials, no bouncing nav icons.

### Requirement 34: Cross-Platform Abstraction

**User Story:** As a developer, I want clean abstraction layers between web and mobile, so that the codebase ports from React + Vite to Expo with minimal rework.

#### Acceptance Criteria

1. THE Abstraction_Layer SHALL provide platform-agnostic primitives (`Box`, `Text`, `Row`) in `packages/shared/components/primitives` — web maps to `div/span`, mobile maps to `View/Text`.
2. THE Abstraction_Layer SHALL ensure no file in `packages/` imports `window`, `document`, `navigator`, `localStorage`, or `sessionStorage` directly — all access goes through `packages/shared/lib/storage.ts` and `packages/shared/lib/platform.ts`.
3. THE Abstraction_Layer SHALL ensure no shared component uses `<div>`, `<span>`, or `<p>` directly — only the primitive abstractions.
4. THE Abstraction_Layer SHALL use Expo Router for all navigation (never React Router DOM).
5. THE Abstraction_Layer SHALL use NativeWind v4 class names for all styling — never CSS grid in shared components (flex only), never inline style objects.
6. THE Abstraction_Layer SHALL abstract the map behind a `<MapView>` wrapper: `apps/web` uses Mapbox GL JS, `apps/mobile` uses `@rnmapbox/maps`, both exporting an identical props interface from `packages/shared/types/map.ts`.
7. THE Abstraction_Layer SHALL abstract animations: Framer Motion for web, React Native Reanimated v3 for mobile — feature components never import either directly.

### Requirement 35: GPS Failure States

**User Story:** As a consumer, I want clear feedback when GPS is unavailable or inaccurate, so that I understand why I can't check in and what alternatives exist.

#### Acceptance Criteria

1. WHEN location permission is denied, THE GPS_System SHALL display a full-screen prompt: "Area Code needs your location to check in." with [Enable] and [Browse only] options — Browse only shows the map but disables check-in.
2. WHEN location accuracy is poor (>200m), THE GPS_System SHALL display on the CHECK IN button: "Weak signal — move closer to the entrance".
3. WHEN location acquisition times out after 8 seconds, THE GPS_System SHALL display: "Location unavailable. Try moving to an open area."
4. WHEN the backend returns 422 with `{ reason: 'accuracy_insufficient' }`, THE GPS_System SHALL display a QR fallback prompt directing the user to scan the venue's QR code.

### Requirement 36: Internationalisation Preparation

**User Story:** As a developer, I want all user-facing strings to use translation keys from day one, so that adding Afrikaans and other languages in V2 is a translation file drop, not a component rewrite.

#### Acceptance Criteria

1. THE i18n_System SHALL use `i18next` + `react-i18next` for web and `i18n-js` for Expo.
2. THE i18n_System SHALL ensure all user-facing strings use translation keys (e.g., `t('check_in.button_label')`) — no hardcoded English strings in components.
3. THE i18n_System SHALL ship V1 with English only, with the architecture ready for V2 Afrikaans support as a translation file addition.

### Requirement 37: Engineering Quality Standards

**User Story:** As a developer, I want enforced code quality gates, so that the codebase remains maintainable, testable, and consistent.

#### Acceptance Criteria

1. THE Quality_System SHALL enforce file size limits: warning at 300 lines, build failure at 400 lines per file; function/method warning at 30 lines, failure at 150 lines.
2. THE Quality_System SHALL enforce complexity limits: cyclomatic complexity warning at 10, failure at 15; cognitive complexity warning at 15, failure at 25; nesting depth warning at 3, failure at 4 levels.
3. THE Quality_System SHALL enforce CI/CD quality gates: code coverage ≥80%, duplicated lines <3%, maintainability rating A or B, reliability rating A, security rating A, technical debt ratio <5%.
4. THE Quality_System SHALL use ESLint (flat config with `typescript-eslint` + `react-hooks` + `import` plugin), Prettier (120 char line length), Vitest for frontend tests, and Husky for pre-commit (format + lint) and pre-push (test) hooks.
5. THE Quality_System SHALL enforce one component per file, no `any` in component props, and TypeScript strict mode with no exceptions.
6. THE Quality_System SHALL enforce that every hook setting up a subscription or interval cleans up in its return function.
7. THE Quality_System SHALL NOT generate test files during implementation — testing is deferred to a post-implementation phase.


### Requirement 38: Rewards Discovery Layer and Feed

**User Story:** As a consumer, I want a dedicated rewards map layer and a rewards feed, so that I can discover active rewards without hunting across the map.

#### Acceptance Criteria

1. WHEN a consumer switches to the Rewards map layer, THE Map SHALL dim all nodes except those with active rewards.
2. WHEN a node has active rewards on the Rewards layer, THE Map SHALL display a reward pill above the node showing the reward title and remaining slots (e.g., "Free coffee · 8 left"), fading in with spring animation.
3. WHEN a consumer taps a reward pill on the Rewards layer, THE Map SHALL open the node detail Bottom_Sheet directly.
4. THE Rewards_Feed SHALL be accessible from the bottom navigation rewards icon and SHALL contain two sections: "Rewards Near You" (sorted by proximity × scarcity) and "Rewards at Your Regulars" (nodes the user has checked into 3 or more times).
5. THE Rewards_API SHALL provide `GET /rewards/near-me?lat=...&lng=...` returning active rewards within 5km sorted by proximity × scarcity.
6. WHEN a reward activates at a node the user has previously visited and the user has notifications enabled, THE Notification_System SHALL send a push notification with the message: "New reward at {nodeName} — {slotsRemaining} slots open now."
7. THE Notification_System SHALL enforce a maximum of 2 reward push notifications per day per user, tracked via Redis key `reward_notifications_today:{userId}`.

### Requirement 39: Image Upload via S3 Presigned URLs

**User Story:** As a business owner or consumer, I want to upload images securely via presigned URLs, so that file uploads never pass through Lambda and are handled efficiently by S3.

#### Acceptance Criteria

1. THE Upload_System SHALL provide `POST /v1/upload/presigned` (auth required, consumer or business) accepting `{ fileType: 'node_image' | 'avatar' | 'business_logo', contentType }` and returning `{ uploadUrl, s3Key, expiresIn: 300 }`.
2. WHEN a client receives a presigned URL, THE Upload_System SHALL require the client to upload directly to S3 via a PUT request using the `uploadUrl`.
3. WHEN an image upload to S3 completes, THE Upload_System SHALL require the client to register the image via `POST /v1/nodes/{nodeId}/images { s3Key }` to store the reference in the `node_images` table.
4. THE Upload_System SHALL enforce a maximum file size of 5MB via the S3 presigned URL policy.
5. THE Upload_System SHALL allow only `image/jpeg`, `image/webp`, and `image/png` content types.
6. THE Upload_System SHALL generate S3 keys in the format `{env}/{type}/{ownerId}/{uuid}.{ext}`.
7. THE Upload_System SHALL never accept file uploads directly through Lambda — all file uploads go through S3 presigned URLs.

### Requirement 40: Deployment Readiness

**User Story:** As a developer, I want all deployment prerequisites documented and enforced, so that the app starts correctly in every environment without missing configuration.

#### Acceptance Criteria

1. THE Database SHALL create PostGIS and pg_trgm extensions in the first migration before any schema migrations run.
2. THE Infrastructure SHALL use a Terraform remote state backend (S3 bucket + DynamoDB table) created manually before the first `terraform init`.
3. THE Repository SHALL contain a `.env.example` file at the root with all required environment variables using placeholder values, committed to git, while `.env` is gitignored.
4. THE Database SHALL include a city seed data migration inserting Cape Town, Johannesburg, and Durban with `ON CONFLICT DO NOTHING` for idempotency.
5. THE Infrastructure SHALL include an ECS Fargate Dockerfile for the Socket.io container in the repository.
6. THE Infrastructure SHALL deploy all Lambda functions as zip packages built via esbuild to a single bundled JS file — never as container images. ECR is used only for the Socket.io ECS container.
7. THE Infrastructure SHALL include an `amplify.yml` build configuration for each portal (web, business, staff, admin), with the `--filter` flag targeting the correct pnpm workspace.
8. THE Infrastructure SHALL require AWS SNS SMS sandbox exit before launch to enable OTP delivery to unverified phone numbers.
9. THE Infrastructure SHALL require AWS SES sandbox exit before launch to enable transactional email delivery to unverified addresses.
10. THE Infrastructure SHALL store all sensitive environment variables in AWS Secrets Manager using the path pattern `area-code/{env}/{service}`, with Lambda and ECS task definitions pulling from those ARNs — never hardcoding values in Terraform or handler code.

### Requirement 41: API Standards

**User Story:** As a developer, I want consistent API conventions across all endpoints, so that clients can rely on predictable versioning, pagination, CORS, and health checks.

#### Acceptance Criteria

1. THE API SHALL prefix all routes with `/v1/` — no unversioned routes are permitted.
2. WHEN a breaking change ships in a future version, THE API SHALL coexist both `/v1/` and the new version prefix so that old clients are not broken.
3. THE API SHALL configure the Fastify CORS plugin with explicit allowed origins — never using `origin: '*'` in production. The dev environment adds `localhost` origins; the production environment does not.
4. THE API SHALL provide `GET /health` with no auth and no rate limit, returning `{ status, env, version, timestamp, db, redis }` for ECS ALB target health checks.
5. IF the database or Redis is unreachable, THEN THE Health_Check SHALL return HTTP 503.
6. THE API SHALL use cursor-based pagination on all list endpoints — never offset-based pagination. Default limit is 20, maximum limit is 50, and requests with `limit > 50` are rejected.
7. THE API SHALL return paginated responses in the format `{ items, nextCursor, hasMore }`.

### Requirement 42: Expo Mobile App Configuration

**User Story:** As a mobile developer, I want a properly configured Expo app with deep linking, location permissions, and EAS build profiles, so that the mobile app builds and deploys correctly across development, preview, and production.

#### Acceptance Criteria

1. THE Mobile_App SHALL define `apps/mobile/app.config.ts` with bundle identifiers (`co.za.areacode.app` for both iOS and Android), location permission descriptions, the `@rnmapbox/maps` plugin with `MAPBOX_DOWNLOADS_TOKEN`, `expo-location` plugin, and `expo-notifications` plugin.
2. THE Mobile_App SHALL configure the deep link scheme `areacode://` mapping to Expo Router file-based routes (e.g., `areacode://node/{nodeSlug}` maps to `app/(map)/node/[nodeSlug]`).
3. THE Mobile_App SHALL support universal links (`areacode.co.za/node/*`) requiring Apple App Site Association and Android Asset Links files served from the web app.
4. THE Mobile_App SHALL include an EAS Build configuration at `apps/mobile/eas.json` with three profiles: `development` (developmentClient enabled, internal distribution), `preview` (internal distribution), and `production`.

### Requirement 43: CI/CD Pipeline

**User Story:** As a developer, I want automated CI/CD pipelines with clear branch strategy and rollback procedures, so that deployments are safe, repeatable, and recoverable.

#### Acceptance Criteria

1. THE CI_CD_Pipeline SHALL enforce the branch strategy: `main` deploys to production (protected, requires PR + passing checks), `develop` deploys to staging, and feature branches merge to `develop` via PR.
2. THE CI_CD_Pipeline SHALL include a GitHub Actions workflow for Lambda deployment: esbuild bundling to a single JS file, zipping, and deploying via `aws lambda update-function-code`.
3. THE CI_CD_Pipeline SHALL include a GitHub Actions workflow for ECS Socket server deployment: Docker build, push to ECR, and `aws ecs update-service --force-new-deployment`.
4. THE CI_CD_Pipeline SHALL include a GitHub Actions workflow for Terraform: `terraform plan` on PR, `terraform apply` on main merge.
5. THE CI_CD_Pipeline SHALL support Lambda rollback by uploading the prior artifact as `previous.zip` before each deploy, enabling single-command restoration.
6. THE CI_CD_Pipeline SHALL support ECS rollback via prior task definition revision numbers, as ECS task definition revisions are immutable.
7. THE CI_CD_Pipeline SHALL support database rollback via RDS snapshots taken before migrations touching `check_ins` or `users` tables, with a documented point-in-time restore procedure.

### Requirement 44: Platform Safety

**User Story:** As a consumer in South Africa, I want robust safety protections against coercive tracking, stalking, and presence inference, so that my physical safety is protected when using the app.

#### Acceptance Criteria

1. THE Safety_System SHALL allow the `broadcast_location` toggle to be changed silently — no confirmation dialogs, no "your followers will be notified" messaging, and no email sent when the setting changes.
2. WHILE a user has `broadcast_location` set to false, THE Check_In_System SHALL not increment the live count badge on the node for that user's check-in, preventing third-party presence inference.
3. WHILE a user has `broadcast_location` set to false, THE FOMO_System SHALL not emit toasts for that user's check-in activity.
4. THE Safety_System SHALL ensure "Who's here" avatars are tappable to a full profile only when the viewer and the subject mutually follow each other. Non-mutual-followers see tier badge and initials only.
5. THE Safety_System SHALL rate-limit the `GET /nodes/{nodeId}/who-is-here` endpoint to 20 requests per 10 minutes per user, returning HTTP 429 and flagging for review when exceeded.
6. THE Safety_System SHALL place the "Delete all check-in history" option prominently in Profile → Privacy (not buried in Settings → Data → Advanced), with a fast flow: one tap to view history, one tap to initiate deletion, hard delete after 30 days per POPIA Article 14.

### Requirement 45: Business Consent Records (ECTA)

**User Story:** As a platform operator, I want to log business subscription acceptance for ECTA compliance, so that all B2B electronic contract agreements are auditable.

#### Acceptance Criteria

1. THE Database SHALL include a `business_consent_records` table with columns: `id` (UUID PK), `business_id` (FK to `business_accounts`), `consent_version` (TEXT NOT NULL), `tier` (TEXT NOT NULL), `ip_address` (TEXT), and `accepted_at` (TIMESTAMPTZ).
2. WHEN a business owner accepts a subscription agreement (Growth or Pro tier), THE Consent_System SHALL insert a record into `business_consent_records` capturing the business ID, consent version, selected tier, client IP address, and acceptance timestamp.
3. THE Consent_System SHALL retain all business consent records indefinitely for ECTA audit purposes — records are never deleted.

### Requirement 46: Mapbox Cost Mitigation

**User Story:** As a platform operator, I want to minimise Mapbox billing by preventing unnecessary map reinitialisation and abstracting the map instance, so that costs stay within budget and a migration path to MapLibre exists.

#### Acceptance Criteria

1. THE Map SHALL never reinitialise the Mapbox instance on navigation — the map component mounts once and persists across Bottom_Sheet open/close and screen transitions.
2. THE Map SHALL store the map instance in `mapStore` as `MapInstance | null` typed as a generic interface that never imports `mapboxgl` or any Mapbox package directly.
3. THE MapInstance interface SHALL expose: `flyTo(options)`, `setFeatureState(feature, state)`, `getZoom()`, and `getBounds()` — no other component or hook interacts with Mapbox GL JS or `@rnmapbox/maps` directly.
4. THE Operations_Team SHALL monitor map load count in CloudWatch weekly and configure an alert at 80% of the monthly Mapbox budget.
5. IF Mapbox costs exceed $1,000 per month, THEN THE Operations_Team SHALL evaluate MapLibre GL JS with self-hosted Maptiler tiles as a drop-in replacement.

### Requirement 47: CloudWatch Alarms and Operational Monitoring

**User Story:** As a platform operator, I want CloudWatch alarms and SLO targets, so that operational issues are detected early and service reliability is measurable.

#### Acceptance Criteria

1. THE Infrastructure SHALL define CloudWatch alarms in Terraform for: check-in Lambda error rate (threshold: more than 10 errors in 2 evaluation periods of 60 seconds), Lambda duration P95 exceeding 400ms, RDS CPU exceeding 80%, ElastiCache evictions exceeding 0, and ECS task restarts exceeding 2 per hour.
2. THE Operations_Team SHALL enforce SLO targets: `POST /v1/check-in` at P95 latency 500ms or less with 99.5% availability, `GET /v1/nodes/{id}/detail` at P95 latency 300ms or less with 99.9% availability, Socket city room join at 2 seconds or less with 99.0% availability, and `GET /v1/rewards/near-me` at P95 latency 600ms or less with 99.5% availability.
3. THE Operations_Team SHALL track an error budget of 0.5% monthly downtime on check-in (approximately 3.6 hours), and any breach SHALL trigger a blameless post-mortem within 48 hours.
4. THE Infrastructure SHALL configure RDS automated backups with 7-day retention in production, with a backup window of 02:00–03:00 UTC.
5. WHEN a migration touches the `check_ins` or `users` tables, THE Operations_Team SHALL create a manual RDS snapshot named `area-code-{env}-pre-migration-{date}` before executing the migration.

### Requirement 48: Address and Geocoding Fallback

**User Story:** As a business owner in South Africa, I want to place my venue on the map by dragging a pin when formal address geocoding fails, so that informal settlement venues and backyard businesses can be listed.

#### Acceptance Criteria

1. WHEN a business creates a new node and Mapbox geocoding does not return a satisfactory address, THE Node_Creation_System SHALL provide a "Pin it on the map" fallback where the user drags a pin to their location.
2. WHEN a pin is placed on the map, THE Node_Creation_System SHALL reverse-geocode the coordinates to the nearest suburb or neighbourhood for display purposes, using `lat`/`lng` as the source of truth — not the address string.
3. THE Search_System SHALL use `pg_trgm` trigram fuzzy matching on node names in `GET /nodes/search` in addition to Mapbox text search, handling multilingual name variants (e.g., "KwaZulu", "KZN", "Kwa-Zulu") and informal naming conventions.
4. THE Search_System SHALL require a minimum of 2 characters before executing a search query.

### Requirement 49: Auth Endpoint Contracts

**User Story:** As a developer, I want explicit API contracts for all authentication endpoints, so that frontend and backend teams can implement against a shared specification without ambiguity.

#### Acceptance Criteria

1. THE Auth_API SHALL provide `POST /v1/auth/consumer/signup` accepting `{ phone (E.164), username, displayName, citySlug }` and returning `{ userId, message: 'OTP sent' }`. IF the phone is already registered, THEN THE Auth_API SHALL return HTTP 409. IF the phone format is invalid, THEN THE Auth_API SHALL return HTTP 422.
2. THE Auth_API SHALL provide `POST /v1/auth/consumer/verify-otp` accepting `{ phone, code (6 digits) }` and returning `{ accessToken, refreshToken, user }`. IF the OTP is invalid or expired, THEN THE Auth_API SHALL return HTTP 401. IF too many attempts are made, THEN THE Auth_API SHALL return HTTP 429.
3. THE Auth_API SHALL provide `POST /v1/auth/consumer/login` accepting `{ phone }` and returning `{ message: 'OTP sent' }`. IF the account is not found, THEN THE Auth_API SHALL return HTTP 404.
4. THE Auth_API SHALL provide `POST /v1/auth/consumer/refresh` accepting `{ refreshToken }` and returning `{ accessToken }`. IF the refresh token is invalid or expired, THEN THE Auth_API SHALL return HTTP 401.
5. THE Auth_API SHALL provide `POST /v1/auth/business/signup` accepting `{ email, phone, businessName, registrationNumber? }` and returning `{ businessId, message: 'OTP sent to phone' }`. IF the email or phone is already registered, THEN THE Auth_API SHALL return HTTP 409.
6. THE Auth_API SHALL provide `POST /v1/auth/business/verify-otp` accepting `{ phone, code }` and returning `{ accessToken, refreshToken, business }`.
7. THE Auth_API SHALL provide `POST /v1/auth/business/login` accepting `{ phone }` and returning `{ message: 'OTP sent' }`.
8. THE Auth_API SHALL provide `POST /v1/auth/staff/login` accepting `{ phone }` and returning `{ message: 'OTP sent' }`.
9. THE Auth_API SHALL provide `POST /v1/auth/staff/verify-otp` accepting `{ phone, code }` and returning `{ accessToken, refreshToken, staff }`.
10. THE Auth_API SHALL provide `POST /v1/staff-invite/accept` accepting `{ inviteToken, name, phone }` and returning `{ message: 'OTP sent for verification' }`, creating a Cognito staff account. IF the invite token is expired or already accepted, THEN THE Auth_API SHALL return HTTP 410.
11. THE Auth_API SHALL provide `POST /v1/auth/logout` (auth required, any role) accepting `{ refreshToken }` and returning `{ success: true }`, revoking the refresh token in Cognito.
12. THE Auth_API SHALL provide `GET /v1/auth/account-type?phone={e164}` as specified in Requirement 2 AC9, included here for endpoint completeness.

### Requirement 50: Yoco Webhook Security

**User Story:** As a platform operator, I want secure, idempotent webhook handling for Yoco payment events, so that subscription state changes are processed reliably without duplicate side effects.

#### Acceptance Criteria

1. THE Webhook_Handler SHALL provide `POST /v1/webhooks/yoco` and verify the Yoco signature header before processing any event payload. IF the signature is invalid, THEN THE Webhook_Handler SHALL return HTTP 401 and log the attempt.
2. THE Webhook_Handler SHALL process `payment.succeeded` events by updating the business subscription tier and activating the subscription.
3. THE Webhook_Handler SHALL process `payment.failed` events by triggering the 7-day grace period flow as specified in Requirement 11 AC7.
4. THE Webhook_Handler SHALL be idempotent — processing the same event ID twice SHALL NOT cause duplicate tier changes, duplicate email sends, or duplicate grace period initiations. THE Webhook_Handler SHALL track processed event IDs via a `webhook_events` table with a UNIQUE constraint on `event_id`.
5. THE Webhook_Handler SHALL return HTTP 200 immediately after signature verification and event ID deduplication, processing the business logic asynchronously to avoid Yoco webhook timeout retries.

### Requirement 51: Viewport and Scroll Discipline

**User Story:** As a consumer or business owner, I want full-bleed screens that fill the viewport without page-level scrolling, so that the app feels native and immersive on all devices.

#### Acceptance Criteria

1. THE Map_Screen SHALL fill `100dvh × 100dvw` with no page-level vertical or horizontal scrolling.
2. THE Business_Dashboard SHALL render each panel at exactly `100dvh` — inner content within a panel may scroll, but the page itself SHALL NOT scroll vertically.
3. THE Layout_System SHALL NOT apply `max-w-*` wrappers on full-bleed screens (map, business dashboard, staff validator).
4. THE Bottom_Nav SHALL be positioned statically at the bottom of the viewport — the Bottom_Nav SHALL NOT scroll with page content.
5. THE Layout_System SHALL use `flex flex-col` with `flex-1` to fill viewport space on dashboard stat grids — never using `space-y-8` with fixed gaps that cause desktop scrolling.
6. THE Map_Screen, Business_Dashboard, and Staff_Validator SHALL never display page-level scroll bars.

### Requirement 52: Social Graph Database Table

**User Story:** As a developer, I want a dedicated `user_follows` table in the V1 schema, so that the social graph feature (Requirement 15) has the data layer it needs for activity feed grouping, social context, and mutual follow detection.

#### Acceptance Criteria

1. THE Database SHALL include a `user_follows` table with columns: `id` (UUID PK), `follower_id` (FK to `users`), `following_id` (FK to `users`), and `created_at` (TIMESTAMPTZ).
2. THE Database SHALL enforce a UNIQUE constraint on `(follower_id, following_id)` in the `user_follows` table to prevent duplicate follow relationships.
3. THE Database SHALL create indexes on `follower_id` and `following_id` columns in the `user_follows` table for efficient feed queries and mutual follow detection.
4. THE Social_System SHALL use the `user_follows` table for: activity feed grouping (Requirement 15 AC2), "who's here" social context (Requirement 15 AC5), and mutual follow detection for profile access (Requirement 15 AC6).

### Requirement 53: Nearby Recent Feed Endpoint

**User Story:** As a consumer who just completed my first check-in, I want the notification permission prompt to show a personalised nearby event, so that I understand the value of notifications before granting permission.

#### Acceptance Criteria

1. THE Feed_API SHALL provide `GET /v1/feed/nearby-recent` (consumer auth required) accepting query parameters `lat`, `lng`, `radiusMetres` (default 1000), and `withinMinutes` (default 10).
2. THE Feed_API SHALL return the most recent check-in event within the specified radius and time window as `{ event: { username: string, nodeName: string, distanceMetres: number, minutesAgo: number } | null }`.
3. IF no event is found within the radius and time constraints, THEN THE Feed_API SHALL return `{ event: null }`.
4. THE Feed_API SHALL return only the user's display name in the `username` field — never the full user identity, phone number, or user ID.
5. THE Feed_API SHALL rate-limit the endpoint to 10 requests per minute per user, returning HTTP 429 when exceeded.

### Requirement 54: User Profile Update Endpoint

**User Story:** As a consumer, I want to update my display name, avatar, and home city, so that my profile stays current as my preferences change.

#### Acceptance Criteria

1. THE Profile_API SHALL provide `PATCH /v1/users/me` (consumer auth required) accepting optional fields `displayName`, `avatarUrl`, and `citySlug`.
2. WHEN a valid `citySlug` is provided, THE Profile_API SHALL verify the city exists in the `cities` table before updating — returning HTTP 422 if the city slug is invalid.
3. THE Profile_API SHALL return the updated user profile on success.
4. THE Profile_API SHALL validate all input fields with Zod schemas — `displayName` must be 1–50 characters, `avatarUrl` must be a valid URL or null, `citySlug` must be a non-empty string.

### Requirement 55: Push Token Registration Endpoint

**User Story:** As a consumer, I want to register my device's push notification token, so that the system can deliver push notifications to my device.

#### Acceptance Criteria

1. THE Push_API SHALL provide `POST /v1/users/me/push-token` (consumer auth required) accepting `{ token: string, platform: 'expo' | 'web', deviceId?: string }`.
2. THE Push_API SHALL insert the token into the `user_push_tokens` table, respecting the `UNIQUE(user_id, token)` constraint — duplicate registrations are silently ignored via `ON CONFLICT DO NOTHING`.
3. THE Push_API SHALL update `last_used_at` on the token row if the token already exists for the user.
4. THE Push_API SHALL return HTTP 201 on successful registration.

### Requirement 56: Notification Preferences Endpoints

**User Story:** As a consumer, I want to view and update my notification preferences, so that I control which push notifications I receive.

#### Acceptance Criteria

1. THE Preferences_API SHALL provide `GET /v1/users/me/notification-preferences` (consumer auth required) returning the current notification opt-in state for all notification types: `streakAtRisk`, `rewardActivated`, `rewardClaimedPush`, `leaderboardPrewarning`, `followedUserCheckin`.
2. THE Preferences_API SHALL provide `PATCH /v1/users/me/notification-preferences` (consumer auth required) accepting a partial object of notification preference booleans.
3. WHEN a preference key is not included in the PATCH body, THE Preferences_API SHALL leave that preference unchanged.
4. THE Preferences_API SHALL validate all input fields with Zod — only the defined boolean preference keys are accepted.

### Requirement 57: Webhook Events Idempotency Table

**User Story:** As a developer, I want a dedicated `webhook_events` table in the V1 schema, so that Yoco webhook processing (Requirement 50) has the data layer it needs for event deduplication.

#### Acceptance Criteria

1. THE Database SHALL include a `webhook_events` table with columns: `id` (UUID PK), `event_id` (TEXT UNIQUE NOT NULL), `event_type` (TEXT NOT NULL), and `processed_at` (TIMESTAMPTZ DEFAULT NOW()).
2. THE Database SHALL enforce a UNIQUE constraint on `event_id` in the `webhook_events` table to prevent duplicate webhook processing.
3. THE Webhook_Handler SHALL insert into `webhook_events` before processing business logic — if the insert fails due to the UNIQUE constraint, the handler returns HTTP 200 without re-processing.

### Requirement 58: CI/CD Scaffolding Files

**User Story:** As a developer, I want the CI/CD scaffolding files (lambda list, Makefile, SonarCloud config) present in the repository from day one, so that the deployment pipeline works without manual file creation.

#### Acceptance Criteria

1. THE Repository SHALL contain `infra/lambda_list.txt` listing all Lambda function names (one per line), read by the CI/CD pipeline during deployment.
2. THE Repository SHALL contain a `Makefile` at the repository root with `build-fn` and `deploy-fn` targets that accept `FN` and `ENV` parameters for building and deploying individual Lambda functions via esbuild and AWS CLI.
3. THE Repository SHALL contain `sonar-project.properties` at the repository root configuring the SonarCloud project key, organisation, sources, exclusions, and coverage report paths.
4. WHEN a new Lambda handler is added, THE Developer SHALL add the function name to `infra/lambda_list.txt` as part of the same PR.

### Requirement 59: Initial Check-In Partition and Trigram Index

**User Story:** As a developer, I want the initial `check_ins` partition and the trigram search index created in V1 migrations, so that the app is functional from first deploy without manual SQL intervention.

#### Acceptance Criteria

1. THE Database Migration SHALL create at least one initial `check_ins` partition covering the current month and the next month at the time of first deployment.
2. THE Database Migration SHALL create a GIN trigram index on `nodes.name` using `gin_trgm_ops` to support fuzzy search via `pg_trgm`: `CREATE INDEX idx_nodes_name_trgm ON nodes USING GIN (name gin_trgm_ops)`.
3. THE Partition_Manager_Worker (monthly Lambda) SHALL create the next month's partition ahead of time, but the initial migration SHALL NOT depend on the worker for the first usable partition.

### Requirement 60: Legend Tier Gradient Token

**User Story:** As a developer, I want the Legend tier gradient defined as a CSS token alongside the other tier colours, so that the animated gradient badge is consistent with the design system.

#### Acceptance Criteria

1. THE Design_System SHALL define `--tier-legend` in `tokens.css` as `linear-gradient(135deg, #f093fb, #f5576c, #fda085)`.
2. THE TierBadge component SHALL apply the `--tier-legend` gradient to the Legend tier badge with a shimmer animation — all other tiers use solid colour tokens.

### Requirement 61: Business Socket Room

**User Story:** As a business owner viewing the live dashboard, I want real-time check-in and reward events for my venue, so that the Live panel updates instantly without polling.

#### Acceptance Criteria

1. THE Real_Time_System SHALL support a `business:{businessId}` socket room that business dashboard clients join on authentication.
2. WHEN a check-in occurs at a node owned by a business, THE Real_Time_System SHALL emit the check-in event to the `business:{businessId}` room in addition to the city room.
3. WHEN a reward is claimed at a node owned by a business, THE Real_Time_System SHALL emit the reward claim event to the `business:{businessId}` room.
4. THE Business_Dashboard Live_Panel SHALL subscribe to the `business:{businessId}` room on mount and leave on unmount, with symmetric cleanup.

### Requirement 62: Universal Link Association Files

**User Story:** As a mobile developer, I want Apple App Site Association and Android Asset Links files served from the web app, so that universal links open the mobile app instead of the browser.

#### Acceptance Criteria

1. THE Web_App SHALL serve `/.well-known/apple-app-site-association` as a JSON file mapping `areacode.co.za/node/*`, `areacode.co.za/qr/*`, and `areacode.co.za/staff-invite/*` paths to the iOS app bundle identifier `co.za.areacode.app`.
2. THE Web_App SHALL serve `/.well-known/assetlinks.json` as a JSON file mapping the same URL patterns to the Android package `co.za.areacode.app`.
3. BOTH files SHALL be served with `Content-Type: application/json` and no authentication requirement.
