# Implementation Plan: Area Code — Map-First Social Discovery App

## Overview

This plan implements the full V1 scope of Area Code: a pnpm monorepo with 5 apps, shared packages, a Fastify + TypeScript backend, PostgreSQL (PostGIS) + Redis data layer, Socket.io real-time server, and AWS infrastructure via Terraform. Tasks are ordered so each builds on the previous — infrastructure and data layer first, then backend features, then frontend shared packages, then app shells, then feature integration, then wiring and polish.

Implementation language: **TypeScript** throughout (React 18 + Vite frontend, Fastify backend, Terraform HCL for infra).

## Tasks

- [-] 1. Monorepo scaffolding, tooling, and shared types
  - [x] 1.1 Initialise pnpm monorepo with workspace config
    - Create root `package.json` (private, workspaces), `pnpm-workspace.yaml`, root `tsconfig.json` (strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
    - Create directory structure: `apps/web`, `apps/mobile`, `apps/business`, `apps/staff`, `apps/admin`, `packages/features/*`, `packages/shared/*`, `backend/src/features/*`, `backend/src/shared/*`, `backend/src/workers/`, `infra/modules/*`, `infra/environments/*`, `infra/shared/`
    - Add `.env.example` with all required environment variables using placeholder values. Must include all ~40 variables from the master prompt: `AREA_CODE_ENV`, `AREA_CODE_CONSENT_VERSION`, `AREA_CODE_DB_URL`, `AREA_CODE_DB_READ_URL`, `AREA_CODE_REDIS_URL`, `AWS_REGION`, `AREA_CODE_S3_MEDIA_BUCKET`, `AREA_CODE_SMS_ORIGINATION_NUMBER`, 4× Cognito pool IDs + client IDs (consumer, business, staff, admin) with both `AREA_CODE_COGNITO_*` and `VITE_COGNITO_*` variants, `VITE_MAPBOX_TOKEN`, `AREA_CODE_MAPBOX_TOKEN_MOBILE`, `MAPBOX_DOWNLOADS_TOKEN`, `YOCO_DEV_SECRET_KEY`, `YOCO_DEV_PUBLIC_KEY`, `YOCO_PROD_SECRET_KEY`, `YOCO_PROD_PUBLIC_KEY`, `AREA_CODE_QR_HMAC_SECRET`, `AREA_CODE_VAPID_PUBLIC_KEY`, `AREA_CODE_VAPID_PRIVATE_KEY`, `AREA_CODE_VAPID_SUBJECT`, `AREA_CODE_SQS_REWARD_QUEUE_URL`, `AREA_CODE_SQS_PUSH_QUEUE_URL`, `AREA_CODE_FINGERPRINT_PRO_KEY`, `AREA_CODE_CIPC_API_KEY`, `PORT`, `VITE_API_URL`, `VITE_SOCKET_URL`
    - Add `scripts/deploy-secrets.sh` — reads `.env`, pushes each secret to AWS Secrets Manager using path pattern `area-code/{env}/{service}`. Mapping: `YOCO_*_SECRET_KEY` → `area-code/{env}/yoco-secret-key`, `YOCO_*_PUBLIC_KEY` → `area-code/{env}/yoco-public-key`, `VITE_MAPBOX_TOKEN` → `area-code/{env}/mapbox-token`, `AREA_CODE_DB_URL` → `area-code/{env}/db-url`, `AREA_CODE_DB_READ_URL` → `area-code/{env}/db-read-url`, `AREA_CODE_REDIS_URL` → `area-code/{env}/redis-url`, `AREA_CODE_QR_HMAC_SECRET` → `area-code/{env}/qr-hmac-secret`, `AREA_CODE_FINGERPRINT_PRO_KEY` → `area-code/{env}/fingerprint-pro-key`, `AREA_CODE_CIPC_API_KEY` → `area-code/{env}/cipc-api-key`, `AREA_CODE_VAPID_PRIVATE_KEY` → `area-code/{env}/vapid-private-key`, `AREA_CODE_SQS_REWARD_QUEUE_URL` → `area-code/{env}/sqs-reward-queue-url`, `AREA_CODE_SQS_PUSH_QUEUE_URL` → `area-code/{env}/sqs-push-queue-url`. Script uses `aws secretsmanager create-secret` or `put-secret-value` (update if exists). Accepts `--env dev|prod` flag to select Yoco keys (dev uses `YOCO_DEV_*`, prod uses `YOCO_PROD_*`). Never hardcode secret values in Terraform or handler code.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 40.3, 40.10_

  - [x] 1.2 Configure ESLint, Prettier, Husky, and dependency enforcement
    - Set up ESLint flat config with `typescript-eslint`, `react-hooks`, `import` plugin
    - Configure Prettier (120 char line length), Husky pre-commit (format + lint) and pre-push (test)
    - Add ESLint import rules to enforce dependency direction: `packages/features/*` → `packages/shared/*` only, `packages/shared/` never imports from `packages/features/*`, `packages/*` never imports from `apps/*`
    - Enforce one component per file, no `any` in component props, hook cleanup rules via ESLint
    - Note: test files are NOT generated during implementation — testing deferred to post-implementation phase
    - _Requirements: 1.7, 1.8, 1.9, 37.1, 37.2, 37.4, 37.5, 37.6, 37.7_

  - [x] 1.3 Create shared TypeScript types and constants
    - Create `packages/shared/types/index.ts` with all shared interfaces: `Node`, `NodeState`, `PulseScore`, `CheckIn`, `Reward`, `RewardRedemption`, `User`, `BusinessAccount`, `StaffAccount`, `Toast`, `ToastType`, `SocketEvents` (ServerToClient + ClientToServer), `MapInstance`, `Tier`, `ConsentRecord`, `AbuseFlag`, `Report`, `LeaderboardEntry`
    - Create `packages/shared/constants/sa-cities.ts`, `node-categories.ts`, `reward-types.ts`, `tier-levels.ts`
    - _Requirements: 1.6, 3.4, 4.1, 5.1, 7.1, 8.1, 18.7, 18.8, 20.1, 33.1_

  - [x] 1.4 Create design system tokens and primitives
    - Create `tokens.css` with all CSS variables (backgrounds, text, accent, status, node category colours, tier badge colours including `--tier-legend: linear-gradient(135deg, #f093fb, #f5576c, #fda085)`, border, nav-height, bottom-sheet-radius)
    - Create shimmer keyframe animation for Legend tier gradient badge
    - Create `packages/shared/components/primitives.tsx` — `Box`, `Text`, `Row` mapping to `div`/`span`/`div(flex-row)` for web
    - Set up font preloading in `apps/web/index.html` for Syne (700, 800) and DM Sans (400, 500)
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 33.7, 33.10, 34.1, 34.3, 60.1, 60.2_

  - [-] 1.5 Create shared lib utilities
    - Create `packages/shared/lib/api.ts` — typed API client with base URL, auth header injection, error handling
    - Create `packages/shared/lib/socket.ts` — singleton Socket.io client instance (never instantiate new socket in a component)
    - Create `packages/shared/lib/storage.ts` — abstraction wrapping `localStorage` (web) / `AsyncStorage` (mobile); all storage access goes through this module
    - Create `packages/shared/lib/platform.ts` — `isWeb`, `setPageTitle`, `getDeviceInfo`, platform detection; all `window`/`document`/`navigator` access goes through this module
    - Create `packages/shared/lib/geoUtils.ts` — haversine distance calculation for client-side toast filtering
    - Create `packages/shared/lib/formatters.ts` — date formatting with `date-fns`, relative time, ZAR currency
    - Create `packages/shared/lib/featureGating.ts` — consumer and business tier feature gates
    - _Requirements: 8.9, 18.10, 34.2, 34.5_

  - []*  1.6 Write property tests for shared types and utilities
    - **Property 1: Haversine distance symmetry** — `haversine(a, b) === haversine(b, a)` for all coordinate pairs
    - **Validates: Requirements 8.9**
    - **Property 2: Tier assignment monotonicity** — higher check-in counts always produce equal or higher tiers
    - **Validates: Requirements 20.1**

- [ ] 2. Checkpoint — Ensure monorepo builds and lints cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Database schema, Prisma, and migrations
  - [ ] 3.1 Set up Prisma with PostGIS and initial migration
    - Configure `backend/prisma/schema.prisma` with all models using `@map`/`@@map` for snake_case DB ↔ camelCase code
    - Create initial migration enabling PostGIS and pg_trgm extensions (`CREATE EXTENSION IF NOT EXISTS`)
    - Create city seed migration inserting Cape Town, Johannesburg, Durban with `ON CONFLICT DO NOTHING`
    - _Requirements: 30.1, 30.7, 30.8, 40.1, 40.4_

  - [ ] 3.2 Create core schema migration — users, business_accounts, cities, neighbourhoods, nodes
    - Define `users` table with tier, total_check_ins, cognito_sub, city_id, neighbourhood_id FK
    - Define `business_accounts` with tier, trial_ends_at, payment_grace_until, yoco_customer_id
    - Define `cities` and `neighbourhoods` (with PostGIS polygon boundary + GIST index)
    - Define `nodes` with generated `GEOGRAPHY(POINT, 4326)` column, GIST index, claim_status, claim_cipc_status, qr_checkin_enabled
    - Create GIN trigram index on `nodes.name`: `CREATE INDEX idx_nodes_name_trgm ON nodes USING GIN (name gin_trgm_ops)`
    - _Requirements: 14.9, 30.2, 30.5, 30.6, 30.9, 59.2_

  - [ ] 3.3 Create check-ins, rewards, and redemptions migration
    - Define `check_ins` partitioned by month (`PARTITION BY RANGE (checked_in_at)`) with indexes on `(node_id, checked_in_at)` and `(user_id, checked_in_at)`, neighbourhood_id FK
    - Create initial `check_ins` partitions for the current month and next month (e.g., `check_ins_2026_04`, `check_ins_2026_05`) — the partition manager worker handles subsequent months, but at least two partitions must exist at first deploy
    - Define `rewards` table with type check constraint, total_slots, slots_locked, is_active, expires_at
    - Define `reward_redemptions` with `UNIQUE(reward_id, user_id)` for idempotency
    - _Requirements: 30.3, 30.4, 7.3, 7.7, 59.1, 59.3_

  - [ ] 3.4 Create social, consent, notifications, staff, and admin tables migration
    - Define `user_follows` with `UNIQUE(follower_id, following_id)` and indexes
    - Define `consent_records` with `broadcast_location`, `analytics_opt_in`, indexed by `(user_id, consented_at DESC)`
    - Define `business_consent_records` for ECTA compliance
    - Define `user_push_tokens` with `UNIQUE(user_id, token)`, `notification_preferences`
    - Define `staff_invites` (invite_token, expires_at), `staff_accounts`
    - Define `node_images`, `reports`, `leaderboard_history`
    - Define `abuse_flags`, `device_fingerprints` with indexes
    - Define `audit_log`, `impersonation_log`, `admin_messages`
    - Define `webhook_events` with `UNIQUE(event_id)` for Yoco idempotency
    - _Requirements: 30.2, 45.1, 52.1, 52.2, 52.3, 23.7, 13.6, 22.1, 14.5, 29.2, 29.4, 28.6, 28.7, 50.4, 57.1, 57.2_

  - [ ] 3.5 Create Prisma client and migration runner
    - Create `backend/src/shared/db/prisma.ts` — Prisma client singleton
    - Create `backend/src/shared/db/migration-runner.ts` — Lambda-compatible migration runner
    - _Requirements: 30.7_

  - []*  3.6 Write property tests for schema constraints
    - **Property 3: Reward redemption idempotency** — inserting the same (reward_id, user_id) pair twice never creates a duplicate row
    - **Validates: Requirements 7.3, 30.4**

- [ ] 4. Backend shared infrastructure — Redis, errors, middleware, socket
  - [ ] 4.1 Create Redis client and key helpers
    - Create `backend/src/shared/redis/client.ts` — Redis client singleton with connection handling
    - Create `backend/src/shared/redis/keys.ts` — all Redis key patterns as typed functions: `checkinCooldownReward(userId, nodeId)`, `checkinCooldownPresence(userId, nodeId)`, `checkinToday(nodeId)`, `nodeActive(nodeId)`, `toastQueue(cityId)`, `userConsent(userId)`, `toastSurgeSeen(userId, nodeId)`, `otpCooldown(phone)`, `leaderboard(cityId)`, `nodesPulse(cityId)`, `rewardNotificationsToday(userId)`, `notifDeferred(userId)`
    - _Requirements: 18.11, 18.12_

  - [ ] 4.2 Create AppError and error handling
    - Create `backend/src/shared/errors/AppError.ts` — typed error class with HTTP status code and safe message
    - Set up Fastify `setErrorHandler` globally to catch all errors and return typed JSON responses (camelCase keys)
    - Establish backend conventions: Fastify + TypeScript for all handlers, layer separation (routes → services → repositories), `[route-name]` log prefix for CloudWatch filterability, Prisma `@map`/`@@map` for camelCase ↔ snake_case mapping
    - _Requirements: 32.1, 32.3, 32.5, 32.6, 32.7_

  - [ ] 4.3 Create auth middleware
    - Create `backend/src/shared/middleware/auth.ts` — JWT verification against Cognito public keys, extracting userId, role, citySlug from token claims
    - Support 4 Cognito pool verifiers (consumer, business, staff, admin) selected by route prefix
    - _Requirements: 2.1, 32.2_

  - [ ] 4.4 Create rate-limit and validation middleware
    - Create `backend/src/shared/middleware/rate-limit.ts` — Redis-backed rate limiter with configurable window and max requests
    - Create `backend/src/shared/middleware/validation.ts` — Zod schema validation for body, params, query
    - _Requirements: 32.4, 32.9_

  - [ ] 4.5 Create Socket.io server with room management
    - Create `backend/src/shared/socket/server.ts` — Socket.io server setup with JWT auth at handshake (token optional for anonymous)
    - Create `backend/src/shared/socket/rooms.ts` — room join/leave helpers for city, node, user, business rooms
    - Create `backend/src/shared/socket/events.ts` — typed event emitters for `node:pulse_update`, `node:state_surge`, `node:state_change`, `toast:new`, `reward:claimed`, `reward:slots_update`, `leaderboard:update`
    - Token present → join `city:{slug}` + `user:{userId}`; token absent → join `city:{slug}` only
    - Support `business:{businessId}` room: business dashboard clients join on auth, receive check-in and reward claim events for their nodes
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.13, 61.1, 61.2, 61.3_

  - []*  4.6 Write property tests for Redis key helpers
    - **Property 4: Redis key uniqueness** — different input combinations always produce different key strings
    - **Validates: Requirements 18.11**

- [ ] 5. Checkpoint — Backend shared layer compiles and Redis/DB connections work
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Auth feature — backend endpoints for all 4 contexts
  - [ ] 6.1 Implement consumer auth endpoints
    - `POST /v1/auth/consumer/signup` — validate phone (E.164), username, displayName, citySlug; create Cognito user; insert `users` row; send OTP; return 409 if exists, 422 if invalid
    - `POST /v1/auth/consumer/verify-otp` — verify OTP, return tokens + user; 401 if invalid, 429 if too many attempts
    - `POST /v1/auth/consumer/login` — send OTP; 404 if not found
    - `POST /v1/auth/consumer/refresh` — refresh token; 401 if invalid
    - Insert initial `consent_records` row on signup with defaults (broadcast_location: true, analytics_opt_in: false)
    - Enforce OTP rate limit: 3/hour/phone, 60s resend cooldown via Redis
    - _Requirements: 2.4, 2.5, 2.11, 2.15, 2.16, 17.7, 32.9, 49.1, 49.2, 49.3, 49.4_

  - [ ] 6.2 Implement business auth endpoints
    - `POST /v1/auth/business/signup` — validate email, phone, businessName, optional registrationNumber; create Cognito user; insert `business_accounts` row; send OTP; 409 if exists
    - `POST /v1/auth/business/verify-otp` — verify OTP, return tokens + business
    - `POST /v1/auth/business/login` — send OTP
    - Insert initial `business_consent_records` row on subscription acceptance (ECTA compliance): `business_id`, `consent_version`, `tier`, `ip_address`, `accepted_at`; records retained indefinitely, never deleted
    - _Requirements: 2.4, 2.5, 2.11, 45.1, 45.2, 45.3, 49.5, 49.6, 49.7_

  - [ ] 6.3 Implement staff auth and invite endpoints
    - `POST /v1/staff-invite/accept` — validate invite token (7-day expiry), create Cognito staff account, send OTP; 410 if expired/accepted
    - `POST /v1/auth/staff/login` — send OTP
    - `POST /v1/auth/staff/verify-otp` — verify OTP, return tokens + staff (8hr access token TTL)
    - _Requirements: 2.12, 2.13, 49.8, 49.9, 49.10_

  - [ ] 6.4 Implement shared auth endpoints
    - `POST /v1/auth/logout` — revoke refresh token in Cognito; any role
    - `GET /v1/auth/account-type?phone={e164}` — return `consumer | business | staff | not_found`; rate-limited 5 req/min/IP; never distinguish wrong pool from no account
    - _Requirements: 2.9, 2.10, 49.11, 49.12_

  - []*  6.5 Write property tests for auth service
    - **Property 5: Account-type endpoint never leaks pool information** — for any phone number, response is always one of the 4 allowed values
    - **Validates: Requirements 2.9**
    - **Property 6: OTP rate limiting is enforced** — more than 3 OTP requests per phone per hour always returns 429
    - **Validates: Requirements 32.9**

- [ ] 7. Nodes feature — backend CRUD, search, claiming
  - [ ] 7.1 Implement node endpoints
    - `GET /v1/nodes/:citySlug` — nodes for city, cached 30s via CloudFront
    - `GET /v1/nodes/:nodeId/detail` — full node detail with pulse score from Redis, reward proximity for authenticated users, who's here count; auth optional
    - `GET /v1/nodes/:nodeSlug/public` — public node info (no auth) returning `{ name, category, city, pulseScore, activeRewardCount, ogImage }` for OG tags and share links
    - `GET /v1/nodes/:nodeId/who-is-here` — rate-limited 20 req/10min/user; returns avatars with followed-first ordering for authenticated users; mutual follow detection for profile access (mutual → full profile, non-mutual → tier badge + initials only)
    - `GET /v1/nodes/search?q=&lat=&lng=` — pg_trgm fuzzy search with 2-char minimum; ranking formula: `similarity(name, query) * (1 / ST_Distance) * pulseScore`; requires GIN index `CREATE INDEX idx_nodes_name_trgm ON nodes USING GIN (name gin_trgm_ops)`; handles multilingual variants (e.g. "KwaZulu"/"KZN"/"Kwa-Zulu"); returns max 20 results; 400 if query < 2 chars
    - `POST /v1/nodes` — create node (business auth); primary geocoding via Mapbox, fallback "Pin it on the map" → reverse-geocode pin to nearest suburb; `lat`/`lng` is source of truth, not address string
    - `PUT /v1/nodes/:nodeId` — update node (business auth, owner only)
    - _Requirements: 3.7, 3.14, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 15.4, 15.5, 15.6, 15.7, 16.3, 16.5, 21.3, 44.4, 44.5, 48.1, 48.2, 48.3, 48.4_

  - [ ] 7.2 Implement node claiming with CIPC verification
    - `POST /v1/nodes/:nodeId/claim` — validate CIPC registration number format (`YYYY/NNNNNN/NN`), call CIPC API:
      - CIPC validates + name matches → auto-approve, instant provisional access
      - CIPC validates + name mismatch → flag for manual review (24–48h)
      - CIPC returns invalid → reject immediately with reason
      - CIPC unavailable (timeout/5xx) → queue for manual review, grant provisional access with message
    - Handle claim_status transitions: unclaimed → pending → claimed
    - Handle claim_cipc_status: `validated`, `pending_manual`, `cipc_unavailable`, `rejected`
    - Provisional access: `unverified` badge on node; rewards are live, badge remains until admin confirms
    - Enforce one pending claim per node; additional applicants see "Claim in progress" and can submit counter-claim for admin review
    - New node creation: business fills form (name, address or map pin, category, optional photos); Mapbox geocoding primary, "Pin it on the map" fallback → reverse-geocode to nearest suburb; `lat`/`lng` as source of truth
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 48.1, 48.2_

  - [ ] 7.3 Implement node reporting
    - `POST /v1/nodes/:nodeId/report` — accept report type (`wrong_location` | `permanently_closed` | `fake_rewards` | `offensive_content` | `other`) + optional detail (max 200 chars)
    - Auto-flag node when 5+ fraud reports (`fake_rewards`) in 24 hours: set node `is_active = false` (flagged), hide from trending surfaces; notify business owner via socket/push: "Your node has been reported and is under review."
    - Business can appeal via Settings panel (max 500 chars + optional photo)
    - Ban reporter after 3 rejected reports in 30 days (tracked via `reports.status = 'dismissed'` count per `reporter_id`)
    - Reporter identity never revealed to node owner; admin can see reporter_id
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7_

  - []*  7.4 Write property tests for node search
    - **Property 7: Search results are always sorted by proximity × pulseScore** — for any query, results maintain sort invariant
    - **Validates: Requirements 16.3**

- [ ] 8. Check-in feature — backend with proximity, cooldowns, abuse detection
  - [ ] 8.1 Implement check-in endpoint and service
    - `POST /v1/check-in { nodeId, lat, lng, qrToken?, type }` — full pipeline:
      1. JWT verify + role check
      2. If qrToken present: validate HMAC token (15-min rotation), bypass GPS; else: PostGIS `ST_DWithin` 200m proximity check (cast to `::geography`)
      3. Redis cooldown check (reward: 4hr, presence: 1hr)
      4. Velocity/abuse checks (device fingerprint, IP subnet, new account velocity)
      5. INSERT check_in (user_id, node_id, type, checked_in_at only — no lat/lng persisted)
      6. INCR Redis daily counter, recalculate pulse score, update sorted set
      7. Publish to SQS reward-evaluation queue
      8. Emit `node:pulse_update` to city socket room
      9. If `getUserConsent(userId).broadcast_location` is true: emit `toast:new` to city room
      10. Return `{ success, cooldownUntil }` immediately
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.13, 5.14, 6.3, 17.1, 17.3, 44.2, 44.3_

  - [ ] 8.2 Implement consent service for broadcast_location
    - Create consent service: `getUserConsent(userId)` reads Redis cache first (`user:consent:{userId}` EX 3600), falls back to DB query (`SELECT FROM consent_records WHERE user_id = ? ORDER BY consented_at DESC LIMIT 1`), re-populates cache on miss
    - `consent_records` is append-only; latest row per user is the active consent; `broadcast_location` is never a column on `users` table
    - Consent update endpoint: `PUT /v1/users/me/consent` — INSERT new `consent_records` row, invalidate Redis cache
    - When `broadcast_location` is false: user excluded from "who's here", live count badge not incremented, no toast emitted; pulse score still updates on backend
    - _Requirements: 17.3, 17.4, 17.5, 17.6, 17.9, 44.2, 44.3_

  - [ ] 8.3 Implement abuse detection service
    - Abuse checks run in check-in pipeline after proximity validation, before DB insert: `JWT verify → proximity check → cooldown check → ABUSE CHECKS → insert check_in`
    - Device fingerprint check: same fingerprint, >3 check-ins at different nodes in 30 min → flag for review (no auto-action)
    - IP subnet check: >3 users from same /28 subnet within 50m in 1 hour → flag all for review (no auto-action)
    - Pulse score anomaly: node jumped ≥2 states in <2 minutes → auto-suppress + flag node + notify admin
    - Reward slot draining: same device claiming >2 rewards at same node in 24h → auto-block + flag
    - New account velocity: account <24h old, >3 check-ins → rate-limit to 1/hour, flag for review (no auto-action)
    - Device fingerprinting: Web → FingerprintJS Pro (SHA-256 hash), iOS/Android → device UUID + model hash; stored in `device_fingerprints` table linked to `user_id`; multiple accounts sharing fingerprint flagged but never auto-blocked (shared devices exist)
    - If flagged with auto-action: return 429 with generic message; if flagged without auto-action: allow check-in, create `abuse_flags` record asynchronously
    - Store flags in `abuse_flags` table with type, entity_id, entity_type, evidence_json, reviewed status, auto_actioned flag
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5_

  - []*  8.4 Write property tests for check-in service
    - **Property 8: Check-in cooldown enforcement** — a reward check-in within 4 hours of a previous one at the same node always returns 429
    - **Validates: Requirements 5.4**
    - **Property 9: Location coordinates are never persisted** — after any check-in, the check_ins table row contains no lat/lng data
    - **Validates: Requirements 5.7, 17.1**

- [ ] 9. Reward engine — backend evaluation, claiming, redemption
  - [ ] 9.1 Implement SQS reward-evaluator Lambda
    - Triggered by check-in SQS messages
    - Evaluate all active rewards at the node for the user: `nth_checkin` (count user's check-ins at node), `daily_first` (count today's check-ins at node), `streak` (consecutive days with check-in, day boundary 00:00–23:59 SAST), `milestone` (node's total check-ins today)
    - Auto-claim qualified rewards: INSERT `reward_redemptions` with `ON CONFLICT DO NOTHING`
    - Generate 6-char alphanumeric redemption code with 10-min expiry
    - Emit `reward:claimed` to `user:{userId}` socket room if connected; else enqueue push notification with 60s delay
    - Emit `reward:slots_update` to `node:{nodeId}` room when slots change
    - Emit `reward_pressure` toast when slots ≤ 5
    - Enforce business tier limits on active rewards (Starter: 3, Growth: 10, Pro: unlimited)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [ ] 9.2 Implement reward CRUD for business
    - `POST /v1/business/rewards` — create reward (business auth, owner of node)
    - `PUT /v1/business/rewards/:id` — update reward (cannot increase total_slots once is_active=true)
    - `GET /v1/rewards/near-me?lat=&lng=` — active rewards within 5km; sorting formula: `(1 / distance) * (total_slots / (total_slots - claimed_count + 1))`; auth required (consumer)
    - `GET /v1/users/me/unclaimed-rewards` — unclaimed rewards for offline users
    - _Requirements: 7.7, 7.10, 7.11, 38.5_

  - [ ] 9.3 Implement staff redemption validation
    - `POST /v1/rewards/:rewardId/redeem` — staff auth, validate redemption code (6-char, 10-min expiry), mark as redeemed
    - Response 200: `{ success: true, rewardTitle, redeemedAt }`; Response 400: `{ error: 'invalid_code' | 'expired_code' | 'already_redeemed' }`
    - Staff endpoint never returns user data (privacy constraint)
    - _Requirements: 7.4, 13.3, 13.4_

  - []*  9.4 Write property tests for reward engine
    - **Property 10: Reward claim idempotency** — claiming the same reward for the same user twice never creates duplicate redemptions
    - **Validates: Requirements 7.3**
    - **Property 11: Slot count never exceeds total_slots** — claimed_count is always ≤ total_slots
    - **Validates: Requirements 7.7**

- [ ] 10. Checkpoint — Core backend features (auth, nodes, check-in, rewards) compile and pass tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Business feature — backend dashboard endpoints, payments, QR
  - [ ] 11.1 Implement business profile and subscription endpoints
    - `GET /v1/business/me` — business profile + subscription status
    - `GET /v1/business/plans` — pricing (Starter free, Growth R299/mo or R2,990/yr, Pro R799/mo or R7,990/yr, PAYG R99/day or R199/week) — never hardcoded in frontend
    - `POST /v1/business/checkout` — create Yoco checkout session with metadata
    - `POST /v1/business/boost` — purchase node boost (R25/2hr, R50/6hr, R150/24hr)
    - _Requirements: 10.11, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 11.2 Implement Yoco webhook handler
    - `POST /v1/webhooks/yoco` — verify Yoco signature header (invalid → 401 + log), deduplicate via `webhook_events` table (`UNIQUE(event_id)`, duplicate → 200 no-op)
    - Return 200 immediately after signature verification + dedup, process business logic async
    - Process `payment.succeeded` → update business tier, activate subscription
    - Process `payment.failed` → trigger 7-day grace period (`payment_grace_until`), send emails on day 1, 4, 7; grace expiry → deactivate rewards, drop to free tier with dashboard banner; successful retry during grace → cancel lapse sequence
    - Idempotent: same event_id processed twice causes no duplicate tier changes, emails, or grace period initiations
    - _Requirements: 50.1, 50.2, 50.3, 50.4, 50.5, 57.3, 11.7, 11.8, 11.9_

  - [ ] 11.3 Implement staff management endpoints
    - `POST /v1/business/staff/invite` — send invite link (7-day expiry), enforce tier limits (Starter: 2, Growth: 5, Pro: unlimited)
    - `GET /v1/business/staff` — list staff accounts
    - `DELETE /v1/business/staff/:id` — remove staff account
    - _Requirements: 13.6, 13.7_

  - [ ] 11.4 Implement QR code generation and validation
    - QR token generation: `HMAC(nodeId + flooredTimestamp, serverSecret)` with 15-minute rotation
    - `GET /v1/business/nodes/:nodeId/qr` — generate QR code data (URL: `areacode.co.za/qr/{nodeId}/{token}`)
    - QR token validation in check-in service (bypass GPS)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 11.5 Implement business trial management
    - 14-day free trial for Growth and Pro tiers
    - Email nudges at day 7, 12, 14 via SES
    - _Requirements: 11.10_

- [ ] 12. Social feature — backend feed, leaderboard, follows
  - [ ] 12.1 Implement social graph endpoints
    - `POST /v1/users/:id/follow` — follow user (consumer auth)
    - `DELETE /v1/users/:id/follow` — unfollow user
    - _Requirements: 15.1, 52.4_

  - [ ] 12.2 Implement activity feed
    - `GET /v1/feed` — activity feed grouped by venue ("3 people you follow were at Assembly last night"), surface reward claimed when applicable, cursor-based pagination
    - _Requirements: 15.2, 15.3, 41.6, 41.7_

  - [ ] 12.3 Implement nearby recent feed endpoint
    - `GET /v1/feed/nearby-recent?lat=&lng=&radiusMetres=1000&withinMinutes=10` — returns most recent check-in event within radius and time window for notification permission priming
    - Returns `{ event: { username, nodeName, distanceMetres, minutesAgo } | null }` — display name only, never full user identity
    - Rate-limited: 10 req/min/user
    - Only returns events from users with `broadcast_location = true`
    - _Requirements: 53.1, 53.2, 53.3, 53.4, 53.5_

  - [ ] 12.4 Implement city leaderboard
    - `GET /v1/leaderboard/:citySlug` — top 50 users + requesting user's rank pinned at bottom if outside top 50
    - Redis operations: `ZREVRANGE leaderboard:{cityId}:week 0 49 WITHSCORES` for top 50, `ZSCORE` for user's count, `ZREVRANK` for user's rank
    - Batch fetch user profiles (top 50 + requesting user) from PostgreSQL for avatar, username, tier badge
    - Check-in increments leaderboard via `ZINCRBY leaderboard:{cityId}:week {increment} {userId}`
    - Response: `{ entries: [...], userRank: { rank, checkInCount } }`
    - _Requirements: 14.1, 14.2, 14.3_

  - []*  12.5 Write property tests for leaderboard
    - **Property 12: Leaderboard is always sorted descending by check-in count** — for any city, returned entries maintain sort invariant
    - **Validates: Requirements 14.1**

- [ ] 13. Background workers — pulse decay, leaderboard reset, partition manager
  - [ ] 13.1 Implement pulse decay worker
    - EventBridge Lambda every 5 minutes
    - For each city: read all node pulse scores from Redis, apply decay (off-peak 00:00–17:59 SAST: `score × 0.90`, peak 18:00–23:59: `score × 0.95`, floor 0)
    - If state tier changed: emit `node:state_change` to city socket room
    - Idempotent, `[pulse-decay]` log prefix, completion summary
    - _Requirements: 4.5, 4.6, 32.8_

  - [ ] 13.2 Implement leaderboard reset worker
    - EventBridge Lambda Monday 00:00 SAST: atomic reset sequence per city:
      1. `ZREVRANGE leaderboard:{cityId}:week 0 49 WITHSCORES` → snapshot top 50
      2. INSERT into `leaderboard_history` (city_id, week_ending, user_id, rank, check_in_count)
      3. `RENAME leaderboard:{cityId}:week leaderboard:{cityId}:week:prev` (atomic, never zero individual scores)
      4. Send push to top 10: "You finished #{rank} in {cityName} this week."
      5. `DEL leaderboard:{cityId}:week:prev`
    - EventBridge Lambda Sunday 20:00 SAST: send pre-reset push to opted-in users with current rank
    - _Requirements: 14.4, 14.5, 14.6, 14.7_

  - [ ] 13.3 Implement node state evaluator sidecar
    - ECS Fargate sidecar running every 30s per city (staggered by offset)
    - Read pulse scores from Redis sorted set, detect state tier changes
    - Emit `node:state_surge` to city socket room on threshold crossing
    - Emit `toast:surge` (priority 1) when entering popping state
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 13.4 Implement partition manager worker
    - Monthly Lambda creating check_ins partitions one month ahead
    - _Requirements: 30.3_

  - [ ] 13.5 Implement cleanup worker
    - Process right-to-erasure queue: hard-delete after 30 days
    - _Requirements: 17.8_

- [ ] 14. Notification, upload, and admin backend features
  - [ ] 14.1 Implement push notification service
    - Support Expo Push Notifications + Web Push (VAPID)
    - Notification types with opt-in defaults: streak at risk (OFF, max 1/day), reward activated at regulars (OFF, max 2/day), leaderboard pre-reset (OFF, 1/week), top 10 result (ON, 1/week), reward claimed (ON, socket primary + 60s push fallback)
    - Delivery architecture: check if user has active socket → if yes, emit via socket; if no, delay 60s then send push via Expo Push API (iOS/Android) or Web Push (VAPID)
    - Push token management: stored in `user_push_tokens` with platform (`expo` | `web`), device_id; `UNIQUE(user_id, token)` prevents duplicates
    - Handle `DeviceNotRegistered` by setting `is_active = false`
    - Never push for toast events, pulse changes, or other users' check-ins
    - Enforce 2 reward push notifications/day/user via Redis key `reward_notifications_today:{userId}` with 86400s TTL
    - Permission priming flow: after first successful check-in, show personalised value hook Bottom_Sheet; use nearby recent check-in event if available, else fall back to value list; "Not now" → defer 7 days via Redis `notif:deferred:{userId}` EX 604800; never ask twice in one session
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 38.6, 38.7_

  - [ ] 14.2 Implement S3 presigned URL upload
    - `POST /v1/upload/presigned` — accept `{ fileType, contentType }`, return `{ uploadUrl, s3Key, expiresIn: 300 }`
    - Enforce 5MB max, allow only `image/jpeg`, `image/webp`, `image/png`
    - S3 key format: `{env}/{type}/{ownerId}/{uuid}.{ext}`
    - `POST /v1/nodes/:nodeId/images` — register uploaded image in `node_images` table
    - _Requirements: 39.1, 39.2, 39.3, 39.4, 39.5, 39.6, 39.7_

  - [ ] 14.3 Implement admin endpoints
    - Consumer management: view check-in history, disable/enable account (Cognito `AdminDisableUser`), reset abuse flags, recalculate tier, override streak (mandatory reason), process erasure (soft-delete → hard-delete 30-day queue), view push tokens, view consent history, send admin messages (Socket primary + push fallback, never email)
    - Business management: view subscription/payment history, extend trial (logged), view/revoke staff, force-deactivate rewards, override CIPC validation, view/invalidate QR tokens
    - POPIA consent audit: per-user consent view, re-consent export (users on version < current), erasure queue with countdown, data access log
    - Report review queue: surface nodes with 3+ reports of same type first; review, dismiss, or action
    - All actions logged to `audit_log` with `before_state`/`after_state` JSONB; impersonation logged to `impersonation_log` (super_admin only, read-only, mandatory note — API rejects without note)
    - Role enforcement: super_admin (all actions including impersonation), support_agent (view + message users, extend trials, view consent — no delete, no impersonate), content_moderator (node management, report queue, claim review only)
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9_

  - [ ] 14.4 Implement health check and API standards
    - `GET /health` — no auth, no rate limit, returns `{ status, env, version, timestamp, db, redis }`; 503 if DB or Redis unreachable; used by ECS ALB target health checks
    - Configure Fastify CORS with explicit allowed origins per environment: prod → `['https://areacode.co.za', 'https://business.areacode.co.za', 'https://staff.areacode.co.za', 'https://admin.areacode.co.za']`; dev → `['http://localhost:3000', ...:3003']`; never `origin: '*'` in prod; `credentials: true`
    - Cursor-based pagination on all list endpoints: default 20, max 50, `limit > 50` → 400; response format `{ items, nextCursor, hasMore }`; never offset-based
    - All routes prefixed with `/v1/`; future breaking changes coexist as `/v2/`
    - Error response format: `{ error: string, message: string, statusCode: number }`
    - _Requirements: 41.1, 41.2, 41.3, 41.4, 41.5, 41.6, 41.7_

  - [ ] 14.5 Implement user profile and privacy endpoints
    - `GET /v1/users/me` — user profile with tier, total check-ins, streak count; tier recalculated on each check-in using `getTier(totalCheckIns)` thresholds
    - `PATCH /v1/users/me` — update `displayName`, `avatarUrl`, `citySlug` (validate city exists → 422 if not found, Zod schema: displayName 1–50 chars, avatarUrl valid URL or null, citySlug non-empty string)
    - `GET /v1/users/me/check-in-history` — paginated check-in history (cursor-based)
    - `POST /v1/users/me/export-history` — export check-in history as CSV
    - `DELETE /v1/users/me/check-in-history` — soft-delete (`deleted_at` timestamp), hard-delete after 30 days via cleanup worker
    - `PUT /v1/users/me/consent` — update consent_records (append-only insert), invalidate Redis cache `user:consent:{userId}`; broadcast_location toggle changes silently (no confirmation, no notification, no email)
    - `POST /v1/users/me/push-token` — register push token `{ token, platform: 'expo' | 'web', deviceId? }`, `ON CONFLICT (user_id, token) DO UPDATE SET last_used_at = NOW(), is_active = true`, return 201
    - `GET /v1/users/me/notification-preferences` — return current notification opt-in state; if no row exists, return defaults (all false except `rewardClaimedPush: true`)
    - `PATCH /v1/users/me/notification-preferences` — partial update of notification preference booleans via Zod strict schema (reject unknown keys), `INSERT ... ON CONFLICT (user_id) DO UPDATE SET` only provided fields
    - Consent versioning: format `v{major}.{minor}` stored in Lambda env var `AREA_CODE_CONSENT_VERSION`; major bump → re-consent Bottom_Sheet on next app open
    - Aggregation rule enforcement: no data point in any API response may represent fewer than 20 unique users
    - _Requirements: 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 20.3, 44.1, 44.6, 54.1, 54.2, 54.3, 54.4, 55.1, 55.2, 55.3, 55.4, 56.1, 56.2, 56.3, 56.4_

- [ ] 15. Checkpoint — All backend features complete and compile
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Frontend shared components and hooks
  - [ ] 16.1 Create shared UI components
    - `BottomSheet` — reusable: `rounded-t-3xl`, spring slide from `translateY(100%)` to `translateY(0)`, backdrop overlay, sets `toastStore.isBottomSheetOpen`
    - `Avatar` — user avatar with tier badge overlay, initials fallback
    - `TierBadge` — Local (grey), Regular (bronze), Fixture (silver), Institution (gold), Legend (animated gradient)
    - `LiveToast` — single toast renderer with spring slide animation from `translateX(110%)`
    - `NodeStateIndicator` — visual indicator for node state (dormant through popping)
    - Skeleton screen components matching content shapes for loading states
    - _Requirements: 9.1, 20.1, 20.2, 33.6, 33.8, 33.9_

  - [ ] 16.2 Create MapView abstraction and AnimatedNode
    - `MapView` — platform abstraction wrapper: Mapbox GL JS for web, identical props interface from `packages/shared/types/map.ts`
    - `MapInstance` interface in `mapStore`: `flyTo(options)`, `setFeatureState(feature, state)`, `getZoom()`, `getBounds()` — no direct Mapbox imports
    - `AnimatedNode` — animation wrapper abstracting Framer Motion for web
    - _Requirements: 3.12, 3.13, 34.6, 34.7, 46.1, 46.2, 46.3_

  - [ ] 16.3 Create shared hooks
    - `useCheckIn` — React Query mutation for `POST /v1/check-in`, invalidates node queries on success, disables button during flight
    - `useNodePulse` — subscribes to `node:pulse_update` socket events, updates `mapStore.pulseScores`
    - `useRealtimeToast` — subscribes to `toast:new` socket events, client-side haversine filtering (≤2km), manages toast queue (max 1 visible, 4s display, priority ordering, drop oldest lowest-priority when queue >3)
    - `useGeolocation` — GPS acquisition with 8s timeout, accuracy check, permission state management
    - `useRewards` — React Query for reward data, handles reward proximity ("one more visit" line)
    - `useSocketRoom` — join/leave socket rooms with symmetric cleanup on unmount
    - `useCooldownTimer` — countdown timer for check-in cooldown display
    - _Requirements: 5.12, 5.13, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9, 8.10, 8.11, 35.1, 35.2, 35.3_

  - [ ] 16.4 Create Zustand stores
    - `mapStore` — nodes, pulseScores, mapInstance (MapInstance | null)
    - `userStore` — user, tier, totalCheckIns, streakCount, onboarding flags (`OnboardingState`: `hintSeen`, `layerHintSeen`, `firstCheckIn`); persisted to storage
    - `toastStore` — queue, isBottomSheetOpen
    - `rewardStore` — activeRewards, unclaimedRewards
    - `businessStore` — business, nodes, currentPanel
    - `locationStore` — lastKnownPosition, accuracy, permissionState
    - `navigationStore` — `NavigationState`: `activeDefaultTab` (time-based: Rewards 00:00–17:00, Leaderboard 17:00–23:59), `hasNavigated` (true once user manually switches tab; resets on fresh app open, not on foreground resume); time-based default only applies when `hasNavigated` is false
    - `connectivityStore` — state machine: `Online` | `APIOnly` (socket disconnected, API reachable) | `Offline` (navigator.onLine false)
    - `consumerAuthStore`, `businessAuthStore`, `staffAuthStore`, `adminAuthStore` — each with namespaced token storage (`consumer:accessToken`, etc.), no shared `useAuth()` hook
    - All stores use Zustand + immer middleware; node states and user profile persisted to `localStorage`/`AsyncStorage` via Zustand persist middleware for offline fallback
    - _Requirements: 2.2, 2.3, 26.1, 26.2, 26.3, 26.4, 27.5_

  - []*  16.5 Write property tests for toast queue management
    - **Property 13: Toast queue never exceeds 3 items** — after any sequence of toast additions, queue length is always ≤ 3
    - **Validates: Requirements 8.4**
    - **Property 14: Surge toasts always preempt lower-priority toasts** — a surge toast is always at the front of the queue
    - **Validates: Requirements 8.1**

- [ ] 17. Checkpoint — Shared frontend packages compile
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Consumer web app — map, nodes, check-in, toasts
  - [ ] 18.1 Set up apps/web with React 18 + Vite + Expo Router
    - Configure Vite with TypeScript, NativeWind v4, Framer Motion
    - Set up Expo Router for file-based routing (web mode); never React Router DOM
    - Import `tokens.css`, configure font preloading
    - Set up i18next + react-i18next with English translation keys (no hardcoded strings); translation files in `apps/web/src/i18n/locales/en.json`; all user-facing strings use `t('key')` pattern
    - No file in `packages/` imports `window`, `document`, `navigator`, `localStorage`, `sessionStorage` directly — all through `storage.ts` and `platform.ts`
    - No shared component uses `<div>`, `<span>`, `<p>` directly — only primitives; NativeWind v4 classes for all styling; no CSS grid in shared components (flex only); no inline style objects
    - _Requirements: 34.1, 34.2, 34.3, 34.4, 34.5, 36.1, 36.2, 36.3_

  - [ ] 18.2 Implement LiveMap feature
    - `LiveMap` — full-viewport (`100dvh × 100dvw`) map container, mounts Mapbox once, persists across navigation
    - Configure Mapbox: pitch 45°, bearing -10°, fog settings, 3D buildings via `fill-extrusion`
    - `NodeMarker` — SVG-layered markers: blur halo → outer ring (animated stroke-dashoffset) → core dot (category colour) → live count badge (visible at buzzing+)
    - 5 visual states driven by pulseScore: dormant (8px, 4s breathe), quiet (10px, 3s breathe), active (14px, 1.5s pulse), buzzing (20px, 0.8s pulse + count badge), popping (28px, 0.4s pulse + avatar stack)
    - Node size: `base + (pulseScore × 0.4px)`, max `base × 2.5`
    - Tap node → open NodeDetail bottom sheet; long-press → quick preview pill
    - Layer switching (swipe left/right): Social, Trending, Rewards
    - Category chips (horizontally scrollable, no wrap) at top
    - "Quiet here" pill when all visible nodes dormant → fly to nearest buzzing node
    - No zoom controls — pinch only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.14, 3.15, 51.1, 51.6_

  - [ ] 18.3 Implement ToastOverlay (FOMO system)
    - `ToastOverlay` — toast strip above bottom nav, hidden when bottom sheet open
    - Priority queue: surge (1), reward_pressure (2), checkin (3), reward_new (3), streak (4), leaderboard (4)
    - Max 1 visible, 4s display, spring slide in/out from `translateX(110%)`
    - Queue >3: drop oldest lowest-priority silently
    - Never show toast for user's own action
    - Client-side haversine filtering (≤2km); show all city toasts if location unavailable
    - Surge toast cooldown: 60 min per user per venue (client-side check against Redis key)
    - Short, declarative, present-tense copy — no exclamation marks, no emoji
    - _Requirements: 3.11, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11_

  - [ ] 18.4 Implement NodeDetail bottom sheet
    - 4 sections: header (image, name, live status, city, category, rating), social (avatar stack + count, tags), rewards (active rewards with scarcity cues), check-in CTA
    - Collapse rewards section when empty; collapse to minimum for dormant nodes with no activity: identity + "Be the first to check in today." + CTA button
    - Scarcity: slots ≤5 → `--danger` colour + exact number ("3 left"); countdown ≤30min → `--warning` + live countdown; countdowns above 30min not shown
    - Followed users: names above avatar stack ("Sipho is here" or "Sipho and 2 others you follow are here"); no follows: tier composition ("Mostly Fixtures and Institutions"), omit if no data
    - "Who's here" avatars tappable to full profile only on mutual follow; non-mutual → tier badge + initials only (stalking guard)
    - Goal gradient: "One more visit unlocks your {rewardTitle}" when exactly 1 check-in away, in `--text-secondary` with no animation
    - 3-dot menu: "Share node", "Report this venue"
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 7.9, 15.6, 44.4_

  - [ ] 18.5 Implement check-in flow and animations
    - CheckInSheet — GPS acquisition → API call → animation → reward display
    - Disable CHECK IN button during API call ("Checking in...")
    - Node animation on check-in: scale 1.4× (150ms spring), ripple ring expand + fade (600ms), live count badge number flip (120ms)
    - Surge animation on state threshold: core dot scale 1×→2×→1× (80ms spring), Ring 1 expand 1×→3× + fade (500ms), colour cross-fade (300ms), Ring 2 fires 150ms after Ring 1 if entering popping
    - Cooldown timer UI after check-in
    - _Requirements: 5.1, 5.12, 5.13, 4.3, 3.7_

  - [ ] 18.6 Implement search sheet
    - `SearchSheet` (`packages/features/discovery/SearchSheet.tsx`) bottom sheet with auto-focus input, numeric keyboard suppressed
    - "Nearby" (sorted by `similarity * (1/distance) * pulseScore`) and "Trending in {city}" sections
    - 300ms debounce, 2-char minimum; 400 error if fewer
    - Tap result → close sheet → `mapStore.mapInstance.flyTo(node)` → auto-open NodeDetail sheet
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ] 18.7 Implement rewards map layer and feed
    - Rewards layer: dim non-reward nodes to 20% opacity, show reward pill above reward nodes (title + slots remaining, e.g. "Free coffee · 8 left"), spring fade-in
    - Tap reward pill → open node detail sheet
    - Rewards feed (bottom nav, rewards icon): "Rewards Near You" (proximity × scarcity, 5km radius from `GET /v1/rewards/near-me`) and "Rewards at Your Regulars" (nodes with 3+ user check-ins)
    - _Requirements: 38.1, 38.2, 38.3, 38.4, 38.5_

  - [ ] 18.8 Implement consumer auth screens
    - Hard-fork landing: "I'm a customer" / "I'm a business" → routes to `/signup/consumer` or `/signup/business`
    - Consumer login at `/login`, sign-up at `/signup/consumer` — share no components with business auth
    - OTP verification screen
    - Profile setup screen
    - Sign-up consent: two explicit opt-ins — "Contribute anonymised check-in data to city insights" (OFF default), "Show my activity on the map" (ON default with explanation)
    - Wrong-door hint: if consumer login fails and account-type returns `business` → "This number is registered to a business account. Sign in here →"
    - ProtectedRoute: show error screen with retry on thrown auth errors — never redirect to login on network failure
    - Sign-up bottom sheet for anonymous users attempting gated actions: "Sign up to check in, earn rewards, and join the leaderboard" with "I'm a customer" / "I'm a business" buttons; never redirects to separate `/login` page
    - _Requirements: 2.4, 2.5, 2.6, 2.10, 2.15, 2.16, 17.7, 19.3_

  - [ ] 18.9 Implement anonymous user experience
    - Map always accessible without auth
    - Anonymous sees: node markers with colour/size/state, name/category/address, today's check-in count (number only, no avatars), reward count ("2 active rewards", no details)
    - Gated actions (check-in, who's here, reward details, leaderboard, profiles) → sign-up bottom sheet (never redirect to `/login`)
    - Anonymous socket: city room only (no `user:` room), receives `node:pulse_update`, `toast:new`, `node:state_surge`; cannot emit `presence:join` or `presence:leave`
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [ ] 18.10 Implement social features — leaderboard, feed, profile
    - City leaderboard screen (bottom nav, trophy icon): top 50 with rank, avatar, username, tier badge, check-in count + user's rank pinned at bottom with separator line if outside top 50
    - `LeaderboardRecap` component: Monday recap card showing prior week's top 3 + user's rank, auto-dismiss 8s or on tap; displayed in Activity Feed
    - Activity feed: grouped by venue ("3 people you follow were at Assembly last night"), reward-first copy ("Aisha got a free filter at Truth Coffee" over "Aisha checked in to Truth Coffee"); ungrouped only when 1 person at venue
    - User profile: tier badge + avatar, username, display name, city; stats row (total check-ins, current streak, current tier); paginated check-in history (cursor-based); badge collection grid
    - Streak badge: persistent bottom-left above nav when streak > 0, SVG flame icon (--warning when ≥3, --text-muted when 1–2), tap → micro-sheet ("{N}-night streak. Check in today to keep it." + progress dots), single subtle pulse after 18:00 if no check-in today; day boundary 00:00–23:59 SAST
    - Follow/unfollow from profile
    - _Requirements: 14.1, 14.2, 14.3, 14.8, 15.1, 15.2, 15.3, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [ ] 18.11 Implement onboarding hints
    - First open: fade in "Tap any dot to explore" pill at map centre after 1.5s, dismiss on [×] or first node tap
    - First layer-swipe attempt: "← Social  Trending  Rewards →" hint at map edge, fades after 3s or first successful swipe
    - First check-in: quiet toast "You're on the map." — no confetti, no particle effects
    - Track `OnboardingState` in userStore (`hintSeen`, `layerHintSeen`, `firstCheckIn`), persisted to `localStorage`/`AsyncStorage`; hints never shown twice
    - Design rules: no tutorial screens, no modals, no overlays blocking interaction
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5_

  - [ ] 18.12 Implement share, deep links, and privacy
    - Share node: `navigator.share()` (web) or `Share.share()` (RN) with URL `areacode.co.za/node/{nodeSlug}` and text "Check this out on Area Code"; fallback: copy URL to clipboard if share API unavailable
    - Deep link handling: URL opened → Expo Router matches route → fetch node by slug → `mapStore.mapInstance.flyTo({ center: [lng, lat], zoom: 16 })` → auto-open NodeDetail sheet
    - Deep link patterns: `areacode.co.za/node/{nodeSlug}` (node detail), `areacode.co.za/qr/{nodeId}/{token}` (QR check-in), `areacode.co.za/staff-invite/{token}` (staff invite)
    - Mobile: `areacode://` custom scheme + universal links via Expo Router
    - Privacy toggle in Profile → Privacy: "Show my activity on the map" (top section, single toggle); changes silently — no confirmation, no notification, no email
    - Export/delete check-in history; "Delete all check-in history" prominently placed (not buried), fast flow: one tap to view → one tap to delete
    - Notification permission priming: personalised value hook bottom sheet after first check-in, defer 7 days on "Not now", never ask twice in one session
    - _Requirements: 21.1, 21.2, 21.4, 17.2, 17.6, 17.7, 17.8, 23.4, 23.5, 44.1, 44.6_

  - [ ] 18.13 Implement offline, data saver, and performance tiers
    - Connectivity state machine: Online → APIOnly (socket disconnects) → Offline (navigator.onLine false); transitions tracked in `connectivityStore`
    - Online: full experience; APIOnly: dot indicator "Live updates paused", poll at 30s intervals, check-in still enabled; Offline: banner "No connection. Check-ins paused.", cached map tiles, "Last updated Xm ago"
    - Reconnect: silently resume, replay last 5 min events only (not full outage backlog), dismiss indicators
    - Offline: grey out CHECK IN ("Connect to check in") — no error toast; "Rewards unavailable offline" in node detail
    - Persist node states to localStorage via Zustand persist middleware as fallback; user profile and tier cached indefinitely; rewards never cached
    - Socket.io reconnect: exponential backoff with jitter (baseDelay: 1000ms, maxDelay: 30000ms, jitter: true) — handles load shedding reconnect storms
    - Data saver (activated when `navigator.connection.saveData === true` or user enables in Profile → Settings): static raster tiles, 30s polling instead of Socket.io, initials instead of avatars, no background refetch, no blur halos/triple-layer glow, CSS transitions instead of Lottie, "D" badge on nav (tappable to explain and offer disable)
    - Device performance tiers (detected on first map load via `navigator.hardwareConcurrency` + 500ms frame-rate probe): High (4+ cores, 55+ fps → full experience), Mid (2–3 cores, 30–54 fps → disable 3D buildings, halve blur halo opacity), Low (1–2 cores, <30 fps → disable 3D + blur, reduce pitch to 20°, `reducedMotion: true`); nodes still breathe and pulse at all tiers
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8, 25.1, 25.2, 25.3, 25.4, 25.5, 25.6_

  - [ ] 18.14 Implement context-aware navigation
    - Bottom nav with time-based default tab: Rewards 00:00–17:00 SAST, Leaderboard 17:00–23:59 SAST
    - Implementation: `useEffect` on mount + foreground reads current hour via `new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: 'numeric', hour12: false })`; no server call
    - `navigationStore.hasNavigated` set to true once user manually switches tab; `hasNavigated` resets on fresh app open (not on foreground resume); time-based default only applies when `hasNavigated` is false
    - Bottom nav statically positioned at viewport bottom — never scrolls with content; use `flex flex-col` with `flex-1` for viewport fill
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 51.4, 51.5_

- [ ] 19. Checkpoint — Consumer web app renders map, check-in flow works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Business dashboard app — horizontal swipe, 6 panels
  - [ ] 20.1 Set up apps/business with React 18 + Vite + Expo Router
    - Configure Vite, NativeWind, Framer Motion, i18next
    - Business auth screens: `/business/login`, `/signup/business` — share no components with consumer auth
    - Business ProtectedRoute using `businessAuthStore`; failed guard → `/business/login`
    - _Requirements: 2.5, 2.6, 34.4_

  - [ ] 20.2 Implement BusinessDashboard horizontal swipe container
    - 6 panels in horizontal swipe order: Live, Rewards, Audience, Node, Boost, Settings
    - Spring physics (`tension: 280, friction: 60`) — pure horizontal translation, velocity-aware
    - Horizontal pill dots at top showing current panel; tap dot → jump to panel
    - Each panel exactly `100dvh`; inner content may scroll vertically
    - No vertical nav, no sidebar, no tabs
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 51.2, 51.3, 51.6_

  - [ ] 20.3 Implement Live panel
    - Real-time check-in counter (large number), live user avatars appearing, today's pulse score graph
    - Context benchmarks: "vs last Tuesday +18%", "vs your average +12%", "vs similar venues nearby: above average"
    - Zero-state checklist for nodes with <10 total check-ins: add photo, create first reward, share node, display QR code — each linking to relevant panel
    - _Requirements: 10.5, 10.6_

  - [ ] 20.4 Implement Rewards panel
    - Reward cards: claimed count, slots remaining, expiry
    - "+" button to create new reward
    - Reward creation form with slot lock warning: "Slot count cannot be raised once live. Set a realistic number."
    - _Requirements: 10.7, 10.8_

  - [ ] 20.5 Implement Audience panel
    - Anonymised aggregates: age range, tier distribution, repeat vs new visitors
    - No individual user data; minimum 20 users per data point
    - _Requirements: 10.9, 17.10_

  - [ ] 20.6 Implement Node editor panel
    - Customise: colour, icon, name, category tags, photos carousel (S3 presigned URL upload)
    - Preview of how node looks at each pulse state
    - Pin-on-map fallback for geocoding failures: "Pin it on the map" → reverse-geocode pin to nearest suburb; `lat`/`lng` as source of truth
    - _Requirements: 10.10, 48.1, 48.2_

  - [ ] 20.7 Implement Boost panel
    - Tiered ZAR pricing (R25/2hr, R50/6hr, R150/24hr) loaded from `GET /business/plans`
    - Yoco checkout flow
    - Growth/Pro included boosts apply to 6-hour slot
    - _Requirements: 10.11, 11.4_

  - [ ] 20.8 Implement Settings panel
    - Business profile, contact info, opening hours
    - Subscription management with trial status
    - Staff account management (invite by phone/email, list, remove); enforce tier limits (Starter: 2, Growth: 5, Pro: unlimited)
    - QR code display at A4-printable resolution, "Download PNG", "Regenerate" buttons; regenerate invalidates old token
    - Node flag notification + appeals submission (max 500 chars + optional photo)
    - _Requirements: 10.12, 6.4, 6.5, 13.6, 13.7, 22.4, 22.5_

- [ ] 21. Staff validator app
  - [ ] 21.1 Set up apps/staff with React 18 + Vite
    - Staff auth at `/staff/login` using `staffAuthStore`; failed guard → `/staff/login`
    - Staff invite acceptance flow at `/staff-invite/{token}`
    - _Requirements: 2.7, 2.13_

  - [ ] 21.2 Implement StaffValidator interface
    - `StaffValidator` (`packages/features/staff/StaffValidator.tsx`): full-bleed `100dvh` layout, no page-level scroll, single column:
      1. Business logo + node name header
      2. 6-digit code input (large, centred, auto-focus, numeric keyboard)
      3. Validation result banner (success green / failure red, auto-dismiss 5s)
      4. `RecentRedemptions` (`packages/features/staff/RecentRedemptions.tsx`): scrollable list within remaining viewport — codes + timestamps only, no user identity, no avatar, no username
    - Success/failure display on validation
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 51.3, 51.6_

- [ ] 22. Admin panel app
  - [ ] 22.1 Set up apps/admin with React 18 + Vite
    - Admin auth at `/admin/login` using `adminAuthStore`; failed guard → `/admin/login`
    - Separate Cognito pool (`area-code-admin`) with `custom:admin_role` attribute
    - Role-based UI rendering: super_admin sees all panels, support_agent sees consumer view + message + business view + extend trial, content_moderator sees node management + report queue + claim review
    - _Requirements: 2.8, 2.14, 28.1, 28.2_

  - [ ] 22.2 Implement admin management screens
    - Consumer Users screen: search, view check-in history, disable/enable (Cognito `AdminDisableUser`), reset abuse flags, recalculate tier, override streak (mandatory reason), process erasure (soft-delete → hard-delete 30-day queue), view push tokens + notification preferences, view consent record history, send in-app admin messages
    - Business Accounts screen: view subscription tier + payment history, extend trial (logged), view/revoke staff accounts, force-deactivate rewards, override CIPC validation result, view/invalidate QR tokens
    - POPIA Consent Audit screen: per-user consent view, re-consent export (users on version < current), erasure request queue with countdown, data access request log
    - Report Queue screen: nodes with 3+ reports of same type surfaced first; review, dismiss, or action
    - Impersonation (super_admin only): read-only access, mandatory `note` field (API rejects without it), logged to `impersonation_log` with `started_at`/`ended_at`
    - All actions insert into `audit_log` with `admin_id`, `admin_role`, `action`, `entity_type`, `entity_id`, `before_state` (JSONB), `after_state` (JSONB), `note`
    - Admin messages delivered via Socket (primary) + push fallback, never email
    - _Requirements: 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9_

- [ ] 23. Checkpoint — All 4 frontend apps render and connect to backend
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 24. Terraform infrastructure
  - [ ] 24.1 Create shared Terraform backend and provider
    - `infra/shared/backend.tf` — S3 + DynamoDB remote state
    - `infra/shared/provider.tf` — AWS provider pinned to us-east-1
    - _Requirements: 31.1, 31.4, 40.2_

  - [ ] 24.2 Create reusable Terraform modules
    - `lambda` module — function + IAM role, `arm64` architecture (Graviton2), `provided.al2023` runtime, configurable memory/timeout/env_vars/provisioned_concurrency; bundled via esbuild to single JS file → zip → `aws lambda update-function-code`
    - `cognito` module — user pool + client + domain, configurable token TTLs and explicit auth flows; instantiate 4 pools (consumer, business, staff, admin); staff pool access token TTL 8 hours
    - `rds` module — PostgreSQL with PostGIS, Multi-AZ in prod, backup retention 7 days (02:00–03:00 UTC window), read replica for analytics; manual snapshot `area-code-{env}-pre-migration-{date}` before migrations on `check_ins`/`users`
    - `elasticache` module — Redis replication group (1 primary + 2 replicas, `cache.t4g.small`)
    - `ecs-service` module — ECS Fargate service + ALB + ECR for Socket.io server + state evaluator sidecar
    - `api-gateway` module — API Gateway V2 HTTP API + routes + stages
    - `s3` module — media bucket with CORS rules and lifecycle
    - `waf` module — WAF ACL with AWS Managed Rules, rate-based rules (100 req/5min/IP on `/check-in`, 20 req/5min/IP on `/auth/*`), CloudWatch logging
    - _Requirements: 31.2, 31.5, 31.6, 31.7, 31.8, 31.9, 31.10_

  - [ ] 24.3 Create dev and prod environment compositions
    - `infra/environments/dev/main.tf` — compose all modules for dev
    - `infra/environments/prod/main.tf` — compose all modules for prod (Multi-AZ RDS, higher provisioned concurrency)
    - PgBouncer on ECS Fargate for Lambda connection pooling in `transaction` mode
    - Lambda VPC strategy documented via `lambda_in_vpc` variable
    - AWS Budgets with 80% threshold alert to SNS topic
    - Provisioned concurrency: check-in (min 2), node-detail (min 2), rewards-near-me (min 1)
    - Lambda environment variables wired to Secrets Manager ARNs (not plaintext): `AREA_CODE_DB_URL` → `area-code/{env}/db-url`, `AREA_CODE_REDIS_URL` → `area-code/{env}/redis-url`, etc. Use `aws_secretsmanager_secret_version` data source in Terraform to reference ARNs. ECS task definitions pull secrets the same way via `secrets` block (not `environment`). `VITE_*` variables are build-time only (set in Amplify Console, not Secrets Manager). Run `scripts/deploy-secrets.sh --env {env}` before first `terraform apply` to populate Secrets Manager.
    - _Requirements: 31.3, 31.6, 31.7, 31.10, 31.11_

  - [ ] 24.4 Create CloudWatch alarms and monitoring
    - Check-in Lambda error rate (>10 errors in 2 periods of 60s)
    - Lambda duration P95 >400ms (60s period)
    - RDS CPU >80% (300s period)
    - ElastiCache evictions >0 (300s period)
    - ECS task restarts >2/hour (3600s period)
    - All alarms notify SNS topic subscribed to engineering team
    - RDS automated backups: 7-day retention, 02:00–03:00 UTC window
    - SLO targets (documented, monitored): `POST /v1/check-in` ≤500ms P95 / 99.5% availability, `GET /v1/nodes/{id}/detail` ≤300ms P95 / 99.9%, Socket city room join ≤2s / 99.0%, `GET /v1/rewards/near-me` ≤600ms P95 / 99.5%
    - Error budget: 0.5% monthly downtime on check-in (~3.6h); breach → blameless post-mortem within 48h
    - Mapbox cost monitoring: weekly map load count review in CloudWatch, alert at 80% of monthly Mapbox budget; if >$1,000/month → evaluate MapLibre GL JS + self-hosted Maptiler tiles
    - _Requirements: 47.1, 47.2, 47.3, 47.4, 47.5, 46.4, 46.5_

  - [ ] 24.5 Create ECS Fargate Dockerfile for Socket.io container
    - Dockerfile in repository for Socket.io server + node state evaluator sidecar
    - _Requirements: 40.5_

  - [ ] 24.6 Create Amplify build configurations
    - `amplify.yml` for each portal (web, business, staff, admin) with `--filter` flag targeting correct pnpm workspace
    - _Requirements: 40.7_

- [ ] 25. Expo mobile app configuration
  - [ ] 25.1 Configure apps/mobile with Expo
    - `app.config.ts` with bundle identifiers (`co.za.areacode.app` iOS + Android), location permission descriptions (NSLocationWhenInUseUsageDescription — never request always-on), `@rnmapbox/maps` plugin (with `MAPBOX_DOWNLOADS_TOKEN`), `expo-location`, `expo-notifications`
    - Deep link scheme `areacode://` mapping to Expo Router routes: `areacode://node/{nodeSlug}` → `app/(map)/node/[nodeSlug]`, `areacode://qr/{nodeId}/{token}` → `app/(map)/qr/[nodeId]/[token]`, `areacode://staff-invite/{token}` → `app/staff-invite/[token]`
    - Universal links: serve `.well-known/apple-app-site-association` (Apple) and `.well-known/assetlinks.json` (Android) from web app; pattern `areacode.co.za/node/*`
    - EAS Build config (`eas.json`): `development` (developmentClient: true, internal distribution), `preview` (internal distribution), `production` (store distribution)
    - _Requirements: 42.1, 42.2, 42.3, 42.4_

  - [ ] 25.2 Create universal link association files
    - Create `apps/web/public/.well-known/apple-app-site-association` mapping `/node/*`, `/qr/*`, `/staff-invite/*` to iOS bundle `co.za.areacode.app` (TEAMID placeholder for build-time substitution)
    - Create `apps/web/public/.well-known/assetlinks.json` mapping same URL patterns to Android package `co.za.areacode.app` (SHA256_FINGERPRINT placeholder)
    - Both files served as `Content-Type: application/json` with no auth requirement
    - _Requirements: 62.1, 62.2, 62.3_

- [ ] 26. CI/CD pipelines
  - [ ] 26.1 Create CI/CD scaffolding files
    - Create `infra/lambda_list.txt` listing all Lambda function names (one per line)
    - Create root `Makefile` with `build-fn` (esbuild → zip) and `deploy-fn` (aws lambda update-function-code) targets accepting `FN` and `ENV` parameters, plus `build-all` and `deploy-all` targets reading from `lambda_list.txt`
    - Create `sonar-project.properties` at root configuring SonarCloud project key, organisation, sources (`packages/`, `apps/`, `backend/src/`), exclusions (`node_modules`, `dist`, `*.test.*`, `migrations`), and coverage report paths
    - _Requirements: 58.1, 58.2, 58.3, 58.4_

  - [ ] 26.2 Create GitHub Actions workflows
    - Lambda deployment: esbuild → zip → save current as `previous.zip` for rollback → `aws lambda update-function-code`; arm64 architecture
    - ECS Socket server: Docker build → push to ECR → `aws ecs update-service --force-new-deployment`; rollback via prior task definition revision (immutable revisions)
    - Terraform: `terraform plan` on PR, `terraform apply` on main merge; remote state S3 + DynamoDB
    - Quality gate workflow: SonarCloud scan, ESLint (frontend + backend), TypeScript check (`tsc --noEmit`), Vitest with coverage; gates: coverage ≥80%, duplicated lines <3%, maintainability A/B, reliability A, security A, debt ratio <5%
    - Branch strategy: `main` → production (protected, requires PR + passing checks), `develop` → staging, feature branches → `develop` via PR
    - Prerequisites documented: AWS SNS SMS sandbox exit (OTP delivery), AWS SES sandbox exit (transactional email), secrets in AWS Secrets Manager (`area-code/{env}/{service}`)
    - _Requirements: 31.12, 40.6, 43.1, 43.2, 43.3, 43.4, 43.5, 43.6, 37.3, 37.4, 40.8, 40.9, 40.10_

  - [ ] 26.3 Document rollback procedures
    - Lambda: upload `previous.zip` via single command
    - ECS: prior task definition revision (immutable revisions)
    - Database: RDS snapshots before migrations on `check_ins`/`users` tables, named `area-code-{env}-pre-migration-{date}`; point-in-time restore procedure documented
    - _Requirements: 43.5, 43.6, 43.7, 47.4, 47.5_

- [ ] 27. Final integration and wiring
  - [ ] 27.1 Wire Socket.io real-time events end-to-end
    - Verify: check-in → pulse update → map marker animation → toast emission → client rendering
    - Verify: reward claim → socket event → reward bottom sheet display
    - Verify: state surge → surge animation → surge toast
    - Verify: anonymous users receive city room events
    - _Requirements: 5.10, 5.11, 5.12, 7.5, 4.3, 4.4, 19.4_

  - [ ] 27.2 Wire business dashboard live updates
    - Business socket room (`business:{businessId}`) receives live check-in events and reward claim events
    - Live panel subscribes to `business:{businessId}` room on mount, leaves on unmount (symmetric cleanup)
    - Live panel counter updates in real-time via `business:checkin` and `business:reward_claimed` socket events
    - _Requirements: 10.5, 61.1, 61.2, 61.3, 61.4_

  - [ ] 27.3 Wire GPS failure states and QR fallback
    - GPS state machine: Requesting → Acquired (accuracy ≤200m) | PoorAccuracy (>200m) | Timeout (8s) | Denied
    - Location permission denied → full-screen prompt: "Area Code needs your location to check in." with [Enable] and [Browse only]; Browse only shows map, disables check-in
    - Poor accuracy (>200m) → CHECK IN button text: "Weak signal — move closer to the entrance"
    - Timeout (8s) → CHECK IN button text: "Location unavailable. Try moving to an open area."
    - Backend 422 with `accuracy_insufficient` → QR fallback prompt: "Scan the venue's QR code to check in"
    - _Requirements: 35.1, 35.2, 35.3, 35.4_

  - [ ] 27.4 Wire notification permission priming
    - After first successful check-in: fetch `GET /v1/feed/nearby-recent` for personalised value hook
    - If nearby event exists: show personalised bottom sheet ("Sipho just checked in to Truth Coffee, 0.4km away. Turn on notifications to catch moments like this.")
    - If no nearby event: fall back to generic value list bottom sheet
    - "Not now" → defer 7 days via Redis key `notif:deferred:{userId}` EX 604800
    - _Requirements: 23.4, 23.5, 53.1, 53.2, 53.3_

  - []*  27.5 Write integration tests for core flows
    - Test check-in → reward evaluation → socket notification flow
    - Test business reward creation → toast emission flow
    - Test leaderboard update on check-in
    - _Requirements: 5.1–5.12, 7.1–7.6, 14.1_

- [ ] 28. Final checkpoint — Full system integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at each major milestone
- Property tests validate universal correctness properties from the design
- The implementation language is TypeScript throughout (React 18 + Vite frontend, Fastify backend, Terraform HCL for infrastructure)
- All code must comply with ENGINEERING_STANDARDS.md (400-line file limit, complexity limits, CI/CD quality gates) and CLAUDE.md (styling rules, dependency direction, naming conventions)
- V2 features (referral rewards, neighbourhood leaderboard UI, post-boost analytics, reward conversion analytics) are excluded — only V1 schema preparation is included
