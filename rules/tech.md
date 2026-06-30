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
  (websocket-connections table).
- Route keys: `joinroom`, `leaveroom`, `presencejoin`, `presenceleave`. They
  cannot contain colons.
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

- Backend (Lambda): AREA_CODE_ENV, table names, Cognito pool IDs + client IDs, S3
  bucket, SQS URLs, QR HMAC secret, VAPID keys, consent version.
- Frontend (Amplify): VITE_API_URL, VITE_WEBSOCKET_URL, VITE_VAPID_PUBLIC_KEY.
- `DEV_MODE` is only true when `AREA_CODE_ENV === 'dev'` and
  `AREA_CODE_FORCE_LIVE` is not set. All synthetic/hardcoded data must sit behind
  a `DEV_MODE` guard. No mock data or mock fallbacks in production.

## Common gotchas

- PowerShell mangles JSON for AWS CLI. Use file-based JSON.
- Cognito custom attributes need app client read/write permissions.
- API Gateway WebSocket route keys cannot contain colons.
- Phone-OTP routes return `410 Gone` in prod. Do not "fix" or "modernise" them
  (`no-sms-no-phone-auth.md`).
