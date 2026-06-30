# Project structure and boundaries

Monorepo, pnpm workspaces, TypeScript everywhere.

```
apps/web          Consumer app (React + Vite, mobile-first)
apps/mobile       Expo React Native (shares packages/)
apps/business     Business dashboard (React + Vite, responsive)
apps/admin        Admin panel (React + Vite, responsive)
apps/staff        Staff validator (React + Vite, mobile-first)
packages/shared   Hooks, stores, lib, types, constants
backend           Fastify monolith (Lambda + API Gateway)
infra             Terraform modules and environments
docs              Operational docs (RUNBOOK, DEPLOY, ROLLBACK)
scripts           Deployment and operational scripts (PowerShell + bash)
tests/e2e         Standalone Playwright package (not in the workspace)
```

Backend internals:

```
backend/src/
  app.ts          Fastify app (routes, middleware, HSTS)
  lambda.ts       API Lambda entry (@fastify/aws-lambda)
  lambdas/        Non-API Lambda entries (websocket)
  workers/        SQS/EventBridge-triggered workers
  features/       Feature modules (auth, nodes, rewards, reports, ...)
  shared/         Cross-feature utilities (db, cognito, middleware, monitoring)
```

## Dependency direction

- Backend: handler calls service, service calls repository, repository calls DB.
  Never skip layers. Cross-domain logic goes through shared interfaces.
- Frontend: `apps/` imports from `packages/` only. `packages/shared` never
  imports from `apps/` or feature modules. Features import from shared only.
- One home per concept. Cross-app code lives in `packages/shared`; backend domain
  logic lives once in its feature or shared module; infra patterns live in
  `infra/modules/*`. See `dry-reuse-no-duplication.md`.

## Four auth contexts

Each type has its own Cognito pool, auth store, and token namespace. There is no
shared `useAuth()` hook and no role switching in a single store.

| Type     | Store             | Namespace   |
| -------- | ----------------- | ----------- |
| Consumer | consumerAuthStore | consumer:   |
| Business | businessAuthStore | business:   |
| Staff    | staffAuthStore    | staff:      |
| Admin    | adminAuthStore    | (admin app) |

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
