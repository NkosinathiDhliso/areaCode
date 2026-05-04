# CLAUDE.md

## Project

Area Code: map-first social discovery app for South African cities.
Users check in at venues, earn rewards, see live activity on a map.
Three cities: Johannesburg, Cape Town, Durban.
Live at areacode.co.za.

## Architecture

Monorepo. pnpm workspaces. TypeScript everywhere. Serverless on AWS.

```
apps/web          Consumer app (React + Vite, mobile-first)
apps/mobile       Expo React Native (shares packages/)
apps/business     Business dashboard (React + Vite, responsive)
apps/admin        Admin panel (React + Vite, responsive)
apps/staff        Staff validator (React + Vite, mobile-first)
packages/shared   Hooks, stores, lib, types, constants
backend           Fastify monolith (Lambda + API Gateway)
infra             Terraform modules and environments
```

## Stack

- Frontend: React 18, Vite, Tailwind (CSS variables only), Zustand, i18next
- Backend: Fastify 5, DynamoDB, AWS Cognito (4 pools), SQS, SNS
- Infra: Lambda nodejs20.x arm64, API Gateway v2 (HTTP + WebSocket), S3, Amplify
- Auth: Cognito CUSTOM_AUTH phone OTP for consumer/business/staff, password auth for admin

## Commands

```bash
pnpm typecheck                        # TypeScript check
pnpm test                             # vitest run
pnpm --filter backend build:lambda    # esbuild Lambda bundles
pnpm --filter @area-code/web build    # vite build (web)
```

## Platform Focus

- Consumer web + mobile: mobile-first, 375px baseline, touch targets
- Staff: mobile-first, simple validator UI
- Business: responsive, works on phone and desktop
- Admin: responsive, works on phone and desktop

## Writing Rules

- Never use em dashes. Use commas, periods, or restructure the sentence
- Never use emojis in system UI (nav, headings, buttons, labels)
- Keep comments short. No filler words
- No superlatives or hyperbole in docs or UI copy

## Code Limits

| Metric      | Warning | Hard limit |
| ----------- | ------- | ---------- |
| File size   | 300     | 400 lines  |
| Function    | 30      | 150 lines  |
| Component   | 200     | 300 lines  |
| Line length | 100     | 120 chars  |

## Styling Rules

- All colors via CSS variables. Never use Tailwind color classes directly
- Cards: `rounded-2xl`. Bottom sheets: `rounded-t-3xl`
- No CSS grid in shared components (breaks React Native). Flex only
- Buttons: `active:scale-95` for tactile feedback
- Inputs: `rounded-xl` with `focus:border-[var(--accent)]`
- Map fills 100dvh x 100dvw. No vertical scroll on map screen

## Code Rules

- Hooks above all conditional returns
- Disable buttons during API calls with loading state
- Clean up useEffect subscriptions on unmount
- Check `statusCode` on API errors, show specific messages
- Use `await app.register()` for Fastify plugins, never `void`
- One component per file
- No `any` in component props
- No inline business logic in components
- No mock data in production. All synthetic/hardcoded data returns must be inside a `DEV_MODE` guard. `DEV_MODE` is only true when `AREA_CODE_ENV === 'dev'` and `AREA_CODE_FORCE_LIVE` is not set. Never add mock fallbacks that run in production.

## Dependency Direction

Backend: handler calls service, service calls repository, repository calls DB.
Never skip layers. Cross-domain logic goes through shared interfaces.

Frontend: `apps/` imports from `packages/` only. `packages/shared` never imports
from `apps/` or feature modules. Features import from shared only.

## Four Auth Contexts

Each type has its own Cognito pool, auth store, token namespace.
No shared `useAuth()` hook. No role switching in a single store.

| Type     | Store             | Namespace   |
| -------- | ----------------- | ----------- |
| Consumer | consumerAuthStore | consumer:   |
| Business | businessAuthStore | business:   |
| Staff    | staffAuthStore    | staff:      |
| Admin    | adminAuthStore    | (admin app) |

## Backend Patterns

Handler order: JWT verify, role check, Zod validation, rate limit, service, DB, socket emit, return.

DynamoDB tables: users, nodes, checkins, rewards, businesses, app-data.
Table names from env vars with prod fallback defaults.

API style: camelCase JSON. Errors: `{ error, message, statusCode }`.
Auth: Bearer token. Rate limiting: DynamoDB TTL sliding window.

Never return raw errors. Use typed `AppError`.

## Database

DynamoDB pay-per-request. No Prisma, no RDS.

- app-data table: generic KV store (`pk: KV#{key}`, `sk: VALUE`)
- Cities: `pk: CITY#{slug}`, `sk: CITY#{slug}`
- Consent: `pk: USER#{id}`, `sk: CONSENT#{id}`
- Rate limits and OTP sessions use TTL for auto-expiry

## Real-Time

WebSocket API Gateway with Lambda handler.
Connection tracking in DynamoDB (websocket-connections table).
Route keys: `joinroom`, `leaveroom`, `presencejoin`, `presenceleave` (no colons).

Frontend: `packages/shared/lib/websocket.ts` singleton.
Falls back to no-op when `VITE_WEBSOCKET_URL` is not set.

## Infrastructure

All resources through Terraform. Never create manually.
Always `terraform plan` before `terraform apply`.

Lambda: nodejs20.x, arm64, 128MB default, 256MB workers, 512MB API.
Secrets in AWS Secrets Manager at `area-code/{env}/*`.

## Deployment

```bash
./scripts/deploy-serverless.ps1       # build + terraform + lambda upload
./scripts/update-all-amplify-apps.ps1 # Amplify env vars + trigger builds
git push origin master                # auto-triggers Amplify rebuilds
```

## Environment Variables

Backend (Lambda): AREA_CODE_ENV, table names, Cognito pool IDs + client IDs,
S3 bucket, SQS URLs, QR HMAC secret, VAPID keys, consent version.

Frontend (Amplify): VITE_API_URL, VITE_WEBSOCKET_URL, VITE_VAPID_PUBLIC_KEY.

## Naming

| Type            | Convention  | Example                |
| --------------- | ----------- | ---------------------- |
| Components      | PascalCase  | NodeMarker.tsx         |
| Hooks           | camelCase   | useCheckIn.ts          |
| Stores          | camelCase   | mapStore.ts            |
| Backend routes  | kebab-case  | /check-in              |
| DynamoDB tables | kebab-case  | area-code-prod-users   |
| Env vars        | UPPER_SNAKE | AREA_CODE_DB_URL       |
| Lambda names    | kebab-case  | area-code-prod-api     |
| Secrets         | slash-sep   | area-code/prod/qr-hmac |

## Common Gotchas

- `awsLambdaFastify()` must be called BEFORE `app.ready()`
- API Gateway WebSocket route keys cannot contain colons
- PowerShell mangles JSON for AWS CLI. Use file-based JSON
- Amplify builds from git. Local changes need push to take effect
- SNS SMS sandbox: new accounts only send to verified numbers
- Cognito custom attributes need app client read/write permissions
