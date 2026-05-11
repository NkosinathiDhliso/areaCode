# Area Code

Area Code is a location-based social platform for South African venues: consumers check in, earn rewards, and discover places; businesses see live check-ins, publish rewards, and get anonymized intelligence reports on their crowd. Everything runs on a strictly serverless AWS footprint to keep monthly spend in the low tens of dollars before launch traffic.

## Architecture

```
                 ┌────────────────────┐
                 │  Amplify Hosting   │  (web, admin, business, staff)
                 └─────────┬──────────┘
                           │ https
                           ▼
                 ┌────────────────────┐
                 │  API Gateway v2    │  api.areacode.co.za
                 │  (HTTP + WebSocket)│
                 └─────────┬──────────┘
                           │ invoke
                           ▼
    ┌───────────┬──────────┴──────────┬──────────────┐
    │ Lambda API│ Lambda WebSocket    │ Worker Lambdas│
    │ (Fastify) │ (connection manager)│ (reward-eval, │
    └─────┬─────┘                     │  report-gen,  │
          │                            │  pulse-decay, │
          │                            │  ...)         │
          ▼                            └──────┬────────┘
    ┌────────────┐   ┌────────┐   ┌──────────┴───┐
    │ DynamoDB   │   │   S3   │   │     SQS     │
    │ (6 tables) │   │ media  │   │ reward-eval │
    └────────────┘   └────────┘   │ push-sender │
                                  │ report-gen  │
                                  └──────────────┘

Auth: Cognito (4 pools — consumer, business, staff, admin)
Scheduling: EventBridge
Observability: CloudWatch Logs + Alarms, optional Sentry, optional X-Ray
```

No always-on compute. No RDS, ElastiCache, ECS, ALB, or NAT Gateway. See `.kiro/steering/serverless-only.md` for the full rule set.

## Repo Layout

```
apps/           Frontend apps (Vite + React + TypeScript)
  admin/        Admin console
  business/     Business portal
  staff/        Staff redemption app
  web/          Consumer web app
backend/        Fastify app + Lambda handlers + workers
  src/
    app.ts           Fastify app (routes, middleware, HSTS)
    lambda.ts        API Lambda entry (@fastify/aws-lambda)
    lambdas/         Non-API Lambda entries (websocket)
    workers/         SQS/EventBridge-triggered workers
    features/        Feature modules (auth, nodes, rewards, reports, ...)
    shared/          Cross-feature utilities (db, cognito, middleware, monitoring)
infra/          Terraform (environments/dev, environments/prod, modules/)
packages/       Shared TS packages consumed by apps and backend
scripts/        Deployment and operational scripts (PowerShell + bash)
docs/           Operational docs (RUNBOOK, DEPLOY, ROLLBACK)
_archive/       Retired infrastructure (ECS, RDS, etc.) kept for reference
```

## Getting Started

Prerequisites: Node 20, pnpm 9, AWS CLI configured for `us-east-1`, Terraform 1.9+ if you touch infra.

```powershell
pnpm install
cp .env.example .env
# fill in the values you need for local dev
pnpm --filter backend dev          # API on :4000 with hot reload
pnpm --filter web dev              # consumer web on :3000
pnpm --filter business dev         # business portal on :3001
pnpm --filter staff dev            # staff app on :3002
pnpm --filter admin dev            # admin console on :3003
```

Local dev uses mock data when `AREA_CODE_ENV=dev` and `AREA_CODE_FORCE_LIVE` is unset.

## Useful Scripts

```powershell
pnpm lint                       # ESLint
pnpm format                     # Prettier write
pnpm format:check               # Prettier check
pnpm typecheck                  # TypeScript across the monorepo
pnpm test                       # Vitest (unit + integration)
pnpm test:data-integrity        # Schema/data-integrity tests only
pnpm test:e2e                   # End-to-end test suite
pnpm guard:serverless           # Fail if forbidden infra patterns leak in
pnpm --filter backend build:lambda   # esbuild Lambda bundles into backend/dist
```

## Deployment

Backend (Lambda code + infra) — from Windows:

```powershell
./scripts/deploy-serverless.ps1 -Environment prod
./scripts/deploy-serverless.ps1 -Environment prod -SkipTerraform   # code only
./scripts/deploy-serverless.ps1 -Environment prod -TerraformOnly   # infra only
```

From bash:

```bash
./scripts/deploy-serverless.sh us-east-1 prod
SKIP_TERRAFORM=true ./scripts/deploy-serverless.sh us-east-1 prod
```

Quick monolith API redeploy (build + zip + upload, no terraform):

```powershell
./deploy-api.ps1 -Env prod
```

Frontend: Amplify auto-builds on push to `master`. Manual rebuild trigger:

```powershell
./scripts/update-all-amplify-apps.ps1
```

For the pre-deploy checklist, verification steps, and rollback, see `docs/DEPLOY.md` and `docs/RUNBOOK.md`.

## Environments

| Env  | Domain                                                      | Monthly budget |
| ---- | ----------------------------------------------------------- | -------------- |
| dev  | `master.*.amplifyapp.com` previews                          | $50            |
| prod | `areacode.co.za` (+ api, business, staff, admin subdomains) | $100           |

Budget alerts fire to `alerts@areacode.co.za` at 80% threshold.

## Portals

- Consumer web: <https://areacode.co.za>
- Business portal: <https://business.areacode.co.za>
- Staff portal: <https://staff.areacode.co.za>
- Admin console: <https://admin.areacode.co.za>
- API: <https://api.areacode.co.za> (health: `/health`)
