<!-- GENERATED FILE. DO NOT EDIT.
     Single source of truth: rules/*.md
     Regenerate with: pnpm sync:rules -->

# Tech stack and engineering patterns

Monorepo. pnpm workspaces. TypeScript everywhere. Serverless on AWS. Cost and
infra rules are binding: see `serverless-only.md`.

## Stack

- Frontend: React 18, Vite, Tailwind (CSS variables only), Zustand, i18next.
- Backend: Fastify 5, DynamoDB, AWS Cognito (4 pools), SQS, SNS.
- Infra: Lambda nodejs20.x arm64, API Gateway v2 (HTTP + WebSocket), S3, Amplify.
- Auth: email/password and Google OAuth via Cognito Hosted UI for all four
  pools. Phone-OTP code paths exist as dead code only and return `410 Gone` in
  prod. Do not revive them: see `no-sms-no-phone-auth.md`.

## Commands

```bash
pnpm typecheck                        # TypeScript check
pnpm test                             # vitest run
pnpm lint                             # ESLint
pnpm format:check                     # Prettier check
pnpm guard:serverless                 # fail if forbidden infra patterns leak in
pnpm --filter backend build:lambda    # esbuild Lambda bundles
pnpm --filter @area-code/web build    # vite build (web)

# End-to-end suite is a standalone package (not in the pnpm workspace):
cd tests/e2e && pnpm test             # Playwright across all four portals
```

## Testing

- Unit and logic tests: Vitest (`pnpm test`). Pure logic cores (ranking,
  gestures, check-in CTA, QR, toast admission, selection, camera) get fast-check
  property tests, tagged `Feature: <name>, Property N: <desc>`, min 100 runs.
- Property predicate bodies must be block statements
  (`(x) => { expect(...) }`), never implicit-return arrows: fast-check reads a
  returned value as the pass/fail result.
- Default Vitest environment is node. Component and hook tests opt into jsdom per
  file with `// @vitest-environment jsdom` as the first line.
- Mapbox GL, WebSockets, and check-in calls are mocked. No network or WebGL.
  Mock shared hooks with `vi.hoisted` so the factory can reference mutable mock
  state. Drive real Zustand stores via `setState`, reset in `beforeEach`.
- End-to-end: Playwright in `tests/e2e/`, sweeping consumer, business, staff, and
  admin. Structural checks (no horizontal scroll, CTA reachable, axe criticals);
  visual fidelity is verified manually.

## Backend patterns

- Dependency direction: handler calls service, service calls repository,
  repository calls DB. Never skip layers. Cross-domain logic goes through shared
  interfaces.
- Handler order: JWT verify, role check, Zod validation, rate limit, service, DB,
  socket emit, return.
- Use `await app.register()` for Fastify plugins, never `void`.
- `awsLambdaFastify()` must be called BEFORE `app.ready()`.
- API style: camelCase JSON. Errors: `{ error, message, statusCode }`. Never
  return raw errors; use the typed `AppError`. Auth is Bearer token. Rate
  limiting is a DynamoDB TTL sliding window.

## Database

DynamoDB pay-per-request. No Prisma, no RDS, one access pattern (single-table via
feature repositories).

- Tables: users, nodes, checkins, rewards, businesses, app-data,
  websocket-connections.
- app-data table: generic KV store (`pk: KV#{key}`, `sk: VALUE`).
- Cities: `pk: CITY#{slug}`, `sk: CITY#{slug}`.
- Consent: `pk: USER#{id}`, `sk: CONSENT#{id}`.
- Rate limits and OTP sessions use TTL for auto-expiry.
- Table-name env vars (`USERS_TABLE`, `NODES_TABLE`, etc.) must always be set;
  production Lambda sets them via Terraform. Never rely on dev fallback defaults
  in prod (see `no-fallbacks-no-legacy.md`).

## Real-time

- WebSocket API Gateway with Lambda handler. Connection tracking in DynamoDB
  (websocket-connections table). $connect verifies the JWT and stores the
  server-derived identity (userId / businessId); fan-out reads those
  attributes via broadcastToRoom / broadcastToUser
  (`backend/src/shared/websocket/broadcast.ts`). Emitters live once in
  `backend/src/shared/socket/events.ts` and MUST be awaited (Lambda freezes
  on return; a fire-and-forget emit is lost).
- Route keys: `joinroom`, `leaveroom`. Route keys cannot contain colons, so
  the client maps app-level `room:join` / `room:leave` to them
  (`ROUTE_KEY_BY_EVENT` in `packages/shared/lib/websocket.ts`).
- Frontend: `packages/shared/lib/websocket.ts` singleton. No-op when
  `VITE_WEBSOCKET_URL` is not set.

## Infrastructure and deployment

All resources through Terraform; never create manually. Always `terraform plan`
before `terraform apply`. Lambda: nodejs20.x, arm64, 128MB default, 256MB
workers, 512MB API. Secrets in AWS Secrets Manager at `area-code/{env}/*`.

```bash
./scripts/deploy-serverless.ps1 -Environment prod   # build + terraform + lambda
./scripts/update-all-amplify-apps.ps1               # Amplify env vars + builds
git push origin master                              # auto-triggers Amplify
```

Amplify builds from git, so local changes need a push to take effect.

## Environment variables

These lists are the source of truth the closure checks compare against:
`scripts/check-table-closure.mjs` (backend table env vs Terraform IAM) and
`scripts/check-amplify-env-closure.mjs` (used `VITE_*` keys vs the keys
`update-all-amplify-apps.ps1` provisions). Keep them in sync when a var is added
or removed. Required prod vars are validated at startup and crash on absence; no
masking defaults (see `no-fallbacks-no-legacy.md`).

### Backend (Lambda), consumed via `requireEnv` / `process.env`

- Environment and build: `AREA_CODE_ENV`, `AREA_CODE_FORCE_LIVE` (dev-only live
  override), `AWS_REGION`, `AREA_CODE_BUILD_SHA` (git sha baked at
  `build:lambda`, returned by `GET /health` as `commit`), `PORT` (local server
  only).
- DynamoDB table names (one per `TableNames` accessor in
  `shared/db/dynamodb.ts`): `USERS_TABLE`, `NODES_TABLE`, `CHECKINS_TABLE`,
  `REWARDS_TABLE`, `BUSINESSES_TABLE`, `APP_DATA_TABLE`,
  `MUSIC_SCHEDULES_TABLE`, `PRESENCE_TABLE`. Plus `CONNECTIONS_TABLE`
  (websocket-connections; used by the broadcast and websocket handlers, not a
  `TableNames` accessor).
- Cognito, per pool ID and client ID for all four pools:
  `AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID` / `..._CONSUMER_CLIENT_ID`,
  `..._BUSINESS_USER_POOL_ID` / `..._BUSINESS_CLIENT_ID`,
  `..._STAFF_USER_POOL_ID` / `..._STAFF_CLIENT_ID`,
  `..._ADMIN_USER_POOL_ID` / `..._ADMIN_CLIENT_ID`.
- Media storage: `AREA_CODE_S3_MEDIA_BUCKET`.
- Async queues and invokes: `AREA_CODE_REPORT_QUEUE_URL`,
  `AREA_CODE_REWARD_QUEUE_URL`, `AREA_CODE_CAMPAIGN_SEND_QUEUE_URL`,
  `AREA_CODE_CAMPAIGN_DISPATCHER_FUNCTION` (campaign dispatcher Lambda name).
- Real-time: `WEBSOCKET_ENDPOINT` (API Gateway management endpoint for fan-out).
- Secrets and signing: `AREA_CODE_QR_HMAC_SECRET` (required in prod),
  `AREA_CODE_CAMPAIGN_UNSUB_SECRET` (falls back to the QR HMAC secret),
  `AREA_CODE_ANONYMIZATION_SALT`.
- Web Push (VAPID): `AREA_CODE_VAPID_PUBLIC_KEY`, `AREA_CODE_VAPID_PRIVATE_KEY`,
  `AREA_CODE_VAPID_SUBJECT`.
- Consent: `AREA_CODE_CONSENT_VERSION` (required in prod).
- Email and app URLs: `AREA_CODE_FROM_EMAIL`, `AREA_CODE_WEB_URL`,
  `AREA_CODE_BUSINESS_URL`, `BUSINESS_APP_URL`.
- Payments (Yoco): `YOCO_DEV_SECRET_KEY`, `YOCO_PROD_SECRET_KEY`,
  `YOCO_WEBHOOK_SECRET` (required outside dev).
- Music streaming (Spotify): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
  `SPOTIFY_REDIRECT_URI`.
- Music streaming (Apple Music): `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`,
  `APPLE_MUSIC_PRIVATE_KEY`.
- Geocoding: `MAPBOX_TOKEN` (falls back to `VITE_MAPBOX_TOKEN`).
- Check-in: `CHECKIN_PROXIMITY_MODE`.

### Frontend (Amplify), provisioned by `update-all-amplify-apps.ps1`

Every `import.meta.env.VITE_*` key read in `apps/` or `packages/` for the apps
that read it:

- Core: `VITE_API_URL`, `VITE_WEBSOCKET_URL`, `VITE_MAPBOX_TOKEN`,
  `VITE_CDN_URL` (Media_CDN), `VITE_STAFF_URL`, `VITE_VAPID_PUBLIC_KEY`.
- RUM (CloudWatch real user monitoring): `VITE_RUM_APP_MONITOR_ID`,
  `VITE_RUM_IDENTITY_POOL_ID`, `VITE_RUM_REGION`.
- Cognito Hosted UI domain, per portal: `VITE_COGNITO_HOSTED_UI_DOMAIN`
  (consumer), `VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS`,
  `VITE_COGNITO_HOSTED_UI_DOMAIN_STAFF`, `VITE_COGNITO_HOSTED_UI_DOMAIN_ADMIN`.
- Cognito client ID, per portal: `VITE_COGNITO_CLIENT_ID_CONSUMER`,
  `VITE_COGNITO_CLIENT_ID_BUSINESS`, `VITE_COGNITO_CLIENT_ID_STAFF`,
  `VITE_COGNITO_CLIENT_ID_ADMIN`.

### Frontend build-time and dev-only (read in code, not Amplify-managed)

These are read in the frontend but are deliberately not Amplify branch vars, so
they are allowlisted in `check-amplify-env-closure.mjs` rather than provisioned:

- `VITE_GIT_SHA`: build-time define injected at `vite build` for RUM release
  tagging.
- `VITE_DEV_MOCK`: dev-only mock toggle, never set on a production branch.
- `VITE_APP_SHARE_URL`: optional share deep-link override with a hardcoded prod
  default, so unset is correct.
- `VITE_FLAG_*`: dynamically built feature-flag keys
  (`VITE_FLAG_LIVE_VIBE_ON_MAP`, `VITE_FLAG_LIVE_VIBE_DECLARATION`), read as a
  dev/runtime override that defaults to false.

`VITE_SOCKET_URL` is retired: the websocket client reads `VITE_WEBSOCKET_URL`
only. Do not reintroduce it.

- `DEV_MODE` is only true when `AREA_CODE_ENV === 'dev'` and
  `AREA_CODE_FORCE_LIVE` is not set. All synthetic/hardcoded data must sit behind
  a `DEV_MODE` guard. No mock data or mock fallbacks in production.

## Common gotchas

- PowerShell mangles JSON for AWS CLI. Use file-based JSON.
- Cognito custom attributes need app client read/write permissions.
- API Gateway WebSocket route keys cannot contain colons.
- Phone-OTP routes return `410 Gone` in prod. Do not "fix" or "modernise" them
  (`no-sms-no-phone-auth.md`).
