# CLAUDE.md

## Project

Area Code is a map-first social discovery app for South African cities.
Users check in at venues, earn rewards, and see live activity on a map.
Three cities: Johannesburg, Cape Town, Durban.

## Architecture

Monorepo. pnpm workspaces. TypeScript everywhere.

```
apps/web          React + Vite (consumer, mobile-first)
apps/mobile       Expo (React Native, shares packages/)
apps/business     React + Vite (business dashboard, responsive)
apps/admin        React + Vite (admin panel, responsive)
apps/staff        React + Vite (staff validator, mobile-first)
packages/shared   Hooks, stores, lib, types, constants
backend           Fastify + DynamoDB + Cognito (Lambda monolith)
infra             Terraform (AWS serverless)
```

## Stack

- Frontend: React 18, Vite, Tailwind (CSS variables only), Zustand, i18next
- Backend: Fastify 5, DynamoDB (not Prisma/RDS), AWS Cognito (4 pools), SQS, SNS
- Infra: Lambda (nodejs20.x arm64), API Gateway v2 (HTTP + WebSocket), DynamoDB, S3, Amplify
- Auth: Cognito CUSTOM_AUTH (phone OTP) for consumer/business/staff, ADMIN_USER_PASSWORD_AUTH for admin

## Commands

```bash
pnpm typecheck              # root-level tsc --noEmit
pnpm test                   # vitest run (188 tests)
pnpm --filter backend build:lambda   # esbuild monolith + websocket + workers
pnpm --filter @area-code/web build   # vite build
```

## Rules

1. No hardcoded colors. Use CSS variables: `text-[var(--text-muted)]`, `bg-[var(--accent)]`
2. No em dashes in any output, comments, or documentation
3. No emojis in system UI (nav, headings, buttons, labels). SVG icons only
4. File max 400 lines. Function max 150 lines. Component max 300 lines
5. No CSS grid in shared components (breaks React Native). Flex only
6. Cards use `rounded-2xl`. Bottom sheets use `rounded-t-3xl`
7. Hooks above all conditional returns
8. Disable buttons during API calls
9. Clean up useEffect subscriptions on unmount
10. All infrastructure through Terraform. Never create AWS resources manually

## Platform Focus

- Consumer web + mobile: mobile-first design, touch targets, no desktop chrome
- Staff: mobile-first, simple validator UI
- Business: responsive (works on both mobile and desktop)
- Admin: responsive (works on both mobile and desktop)

## Four Auth Contexts

Each account type has its own Cognito pool, auth store, and token namespace.
They share nothing. No generic `useAuth()` hook.

| Type     | Store              | Namespace    |
|----------|--------------------|--------------|
| Consumer | consumerAuthStore  | consumer:    |
| Business | businessAuthStore  | business:    |
| Staff    | staffAuthStore     | staff:       |
| Admin    | adminAuthStore     | (admin app)  |

## Backend Pattern

Handler check order: JWT verify, role check, Zod validation, rate limit, service call, DynamoDB op, socket emit, return.

DynamoDB tables: users, nodes, checkins, rewards, businesses, app-data (KV + cities + consent).
Table names from env vars with fallback defaults.

## API Style

- camelCase JSON keys
- Errors: `{ error: string, message: string, statusCode: number }`
- Auth: Bearer token in Authorization header
- Rate limiting: DynamoDB TTL-based sliding window

## Dependencies

- `packages/shared` never imports from `apps/` or `features/`
- `apps/` imports from `packages/` only
- Backend features never import from each other directly

## Environment

- Production: `AREA_CODE_ENV=prod`, Lambda prefix `area-code-prod-`
- Cognito pools: consumer, business, staff, admin (separate pool IDs + client IDs)
- Secrets: Secrets Manager at `area-code/{env}/*`
- Frontend env: `VITE_API_URL`, `VITE_WEBSOCKET_URL`, `VITE_VAPID_PUBLIC_KEY`

## Deployment

```bash
./scripts/deploy-serverless.ps1    # build + terraform + lambda upload
./scripts/update-all-amplify-apps.ps1  # update Amplify env vars + trigger builds
```

Amplify auto-deploys from master branch for all 4 frontend apps.
Lambda code deployed via `aws lambda update-function-code`.
