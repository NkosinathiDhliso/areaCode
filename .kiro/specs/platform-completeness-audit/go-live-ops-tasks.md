# Implementation Plan: Go-Live Operations & Infrastructure Readiness (Tier 0)

## Overview

This plan addresses infrastructure, CI/CD, monitoring, and operational gaps that were not covered by the original 22-requirement platform completeness audit. These are "Tier 0" items — they don't add user-facing features but are required for a safe, maintainable production launch. Without them, deployments will fail, errors will go unnoticed, and the team cannot debug production issues.

All work happens on the `serverless-prod-cleanup` branch. All infrastructure remains strictly serverless.

## Context

- Current branch: `serverless-prod-cleanup` (based on known-good `b829a0a`)
- Prod Lambda: rolled back to v41 (re-upload of v39), healthy on DynamoDB-only code
- The CI/CD pipelines (`.github/workflows/`) still reference ECS, Prisma, and Docker from the old architecture
- Prod Terraform still has dead Secrets Manager data sources for `db_url` and `redis_url`
- Monitoring is partially wired (Sentry code exists but DSN not passed to Lambda)
- No operational documentation exists

## Tasks

- [ ] 1. Clean CI/CD Pipelines (remove ECS/Prisma/Docker references)
  - [ ] 1.1 Remove `deploy-ecs.yml` workflow entirely
    - Delete `.github/workflows/deploy-ecs.yml` — it deploys to ECS/Fargate which no longer exists
    - Move to `_archive/retired-high-cost-infra/.github/workflows/deploy-ecs.yml` if preservation is desired

  - [ ] 1.2 Clean `ci.yml` — remove ECS and Prisma jobs
    - Remove the `schema-validation` job (Prisma schema validate + migrate diff) — we use DynamoDB, not Prisma
    - Remove the `build-ecs-image` job (Docker build + ECR push) — no ECS exists
    - Remove `deploy-dev` steps that reference: `aws ecs update-service`, ECR login/push, `run-migration` Lambda invoke
    - Remove `deploy-prod` steps that reference: `aws ecs update-service`, ECR login/push, `run-migration` Lambda invoke
    - Update `deploy-dev` and `deploy-prod` to use the serverless deploy pattern (build Lambda zip, `aws lambda update-function-code`)
    - Ensure `build-lambdas` job no longer depends on `schema-validation`
    - Keep: lint-format, typecheck, test, data-integrity, build-lambdas, build-frontends

  - [ ] 1.3 Update `deploy-lambda.yml` to match current build system
    - Verify it uses `pnpm --filter backend build:lambda` (not `make build-all`)
    - If it references a Makefile that doesn't exist on this branch, update to use the actual build command
    - Ensure it deploys: api, websocket, and all worker Lambdas from `dist/`

  - [ ] 1.4 Add serverless guard to CI
    - Add a `serverless-guard` job to `ci.yml` that runs `pnpm guard:serverless`
    - Make it a required check so PRs that reintroduce forbidden patterns are blocked

  - [ ] 1.5 Run `pnpm guard:serverless` to verify no forbidden patterns leaked in

- [ ] 2. Fix Environment Variable Mismatches
  - [ ] 2.1 Fix `MEDIA_BUCKET` vs `AREA_CODE_S3_MEDIA_BUCKET` mismatch
    - The back-ported `image-service.ts` uses `process.env['MEDIA_BUCKET']`
    - Prod Terraform passes `AREA_CODE_S3_MEDIA_BUCKET` to the API Lambda
    - Either: update `image-service.ts` to read `AREA_CODE_S3_MEDIA_BUCKET`, OR add `MEDIA_BUCKET` to Terraform env vars
    - Preferred: update `image-service.ts` to use `process.env['AREA_CODE_S3_MEDIA_BUCKET'] ?? process.env['MEDIA_BUCKET'] ?? 'area-code-media'` for backward compat

  - [ ] 2.2 Verify all backend env var references match Terraform outputs
    - Grep backend for `process.env[` and cross-reference with `environment_variables` in `infra/environments/prod/main.tf`
    - Document any mismatches and fix them
    - Key vars to verify: `USERS_TABLE`, `NODES_TABLE`, `CHECKINS_TABLE`, `REWARDS_TABLE`, `BUSINESSES_TABLE`, `APP_DATA_TABLE`, `AREA_CODE_REWARD_QUEUE_URL`, all Cognito pool/client IDs

- [ ] 3. Clean Prod Terraform (remove dead references)
  - [ ] 3.1 Remove dead Secrets Manager data sources
    - Remove `data "aws_secretsmanager_secret" "db_url"` — RDS no longer exists
    - Remove `data "aws_secretsmanager_secret" "redis_url"` — ElastiCache no longer exists
    - These will cause `terraform plan` to fail if the secrets were deleted from AWS

  - [ ] 3.2 Remove legacy per-route Lambdas that are no longer needed
    - Evaluate: `lambda_check_in`, `lambda_node_detail`, `lambda_rewards_near_me` — these were "legacy per-route Lambdas" per the comment in prod main.tf
    - If the monolith API Lambda now handles all routes (which it does via `$default` catch-all), these can be removed
    - Check if any API Gateway routes still point to them (they don't — only `$default` and `POST /v1/webhooks/yoco` are defined)
    - Move their Terraform blocks to `_archive/` and remove associated IAM policies
    - **Caution**: verify no EventBridge schedules or SQS triggers point to them before removing

  - [ ] 3.3 Add `SENTRY_DSN` to API Lambda environment variables
    - Add `SENTRY_DSN = var.sentry_dsn` to `module "lambda_api"` environment_variables in prod main.tf
    - Add `variable "sentry_dsn"` with `sensitive = true` and empty default
    - This enables error monitoring that's currently silently disabled

  - [ ] 3.4 Add `MEDIA_BUCKET` (or `AREA_CODE_S3_MEDIA_BUCKET`) to API Lambda env vars if not already present
    - Verify the image upload routes will work with the env var name used in code

  - [ ] 3.5 Add report-dispatcher and report-generator Lambdas to prod (if missing)
    - Dev Terraform has `lambda_report_dispatcher` and `lambda_report_generator` — verify prod has them too
    - If missing, add them with the same config as dev (they're needed for venue intelligence reports)

  - [ ] 3.6 Run `terraform plan` (dry-run) against prod to verify no errors
    - Do NOT apply — just verify the plan succeeds without referencing deleted resources

- [ ] 4. Add Monitoring & Alerting
  - [ ] 4.1 Add CloudWatch alarms for API Lambda
    - Alarm: API Lambda errors > 5 in 5 minutes → SNS alert
    - Alarm: API Lambda duration p99 > 10s → SNS alert (cold start or DynamoDB issue)
    - Alarm: API Lambda throttles > 0 → SNS alert

  - [ ] 4.2 Add CloudWatch alarms for DynamoDB
    - Alarm: Any table `ThrottledRequests` > 0 → SNS alert
    - Alarm: Any table `SystemErrors` > 0 → SNS alert

  - [ ] 4.3 Add SQS dead-letter queue monitoring
    - Alarm: reward-eval DLQ messages > 0 → SNS alert
    - Alarm: push-sender DLQ messages > 0 → SNS alert
    - (Requires DLQ to be configured on the SQS modules — check if they exist)

  - [ ] 4.4 Add uptime health check
    - Option A: Route53 health check on `GET /health` endpoint (free tier covers 50 checks)
    - Option B: External service (UptimeRobot free tier — 5-min intervals)
    - At minimum, document the health endpoint URL for manual monitoring

  - [ ] 4.5 Enable Lambda X-Ray tracing (optional, low cost)
    - Add `tracing_config { mode = "Active" }` to the API Lambda module
    - Enables request tracing across Lambda → DynamoDB → SQS

- [ ] 5. Create Operational Documentation
  - [ ] 5.1 Create `README.md` in project root
    - Project overview (what Area Code is, 1 paragraph)
    - Architecture diagram (text-based: API Gateway → Lambda → DynamoDB, etc.)
    - Local development setup (pnpm install, env vars needed, dev mode)
    - Available scripts (`pnpm guard:serverless`, `pnpm --filter backend build:lambda`, etc.)
    - Deployment instructions (reference `scripts/deploy-serverless.ps1`)
    - Frontend deployment (Amplify auto-deploys from branch, or manual trigger)
    - Links to portals (areacode.co.za, business.areacode.co.za, etc.)

  - [ ] 5.2 Create `docs/RUNBOOK.md` — incident response
    - How to check if prod is healthy (`curl /health`)
    - How to view Lambda logs (CloudWatch log group names)
    - How to rollback a bad deploy (re-upload previous Lambda zip, or revert Amplify)
    - How to disable a misbehaving feature (env var feature flags)
    - Contact/escalation info
    - Common failure modes and fixes (DynamoDB throttle → check hot partition, Lambda timeout → check cold start)

  - [ ] 5.3 Create `docs/DEPLOY.md` — deployment checklist
    - Pre-deploy: run guard, run build, run tests
    - Deploy backend: `./scripts/deploy-serverless.ps1`
    - Deploy frontend: push to branch, Amplify auto-builds
    - Post-deploy: verify health endpoint, check CloudWatch for errors
    - Rollback procedure

- [ ] 6. Add Custom API Domain (optional but recommended)
  - [ ] 6.1 Create ACM certificate for `api.areacode.co.za`
    - Add `aws_acm_certificate` resource in prod Terraform
    - DNS validation via Route53

  - [ ] 6.2 Add API Gateway custom domain mapping
    - Add `aws_apigatewayv2_domain_name` resource
    - Add `aws_apigatewayv2_api_mapping` to connect the HTTP API to the custom domain
    - Add Route53 A record (alias) pointing to the API Gateway domain

  - [ ] 6.3 Update frontend env vars
    - Change `VITE_API_URL` from raw API Gateway URL to `https://api.areacode.co.za`
    - Update CORS origins if needed

- [ ] 7. Security Hardening
  - [ ] 7.1 Add WAF to API Gateway (basic protection)
    - Create `aws_wafv2_web_acl` with rules:
      - AWS managed rule: `AWSManagedRulesCommonRuleSet` (XSS, SQLi, etc.)
      - Rate-based rule: 1000 requests per 5 minutes per IP
    - Associate with the HTTP API Gateway
    - Cost: ~$5/month + $0.60/million requests — acceptable for launch protection

  - [ ] 7.2 Add `Strict-Transport-Security` header to API responses
    - Add Fastify `onSend` hook that sets `Strict-Transport-Security: max-age=31536000; includeSubDomains`

  - [ ] 7.3 Verify Cognito token expiry settings
    - Access tokens: 1 hour (default, good)
    - Refresh tokens: 30 days (verify this is acceptable)
    - Staff pool: 8 hours access token (already configured)

- [ ] 8. Final Pre-Launch Verification
  - [ ] 8.1 Run full build pipeline locally
    - `pnpm guard:serverless` — must pass
    - `pnpm --filter backend build:lambda` — must succeed
    - `pnpm --filter web build` — must succeed
    - `pnpm --filter business build` — must succeed
    - `pnpm --filter staff build` — must succeed
    - `pnpm --filter admin build` — must succeed

  - [ ] 8.2 Verify prod health after deploy
    - `curl https://<api-endpoint>/health` returns `{"status":"ok"}`
    - `curl https://<api-endpoint>/v1/nodes/johannesburg` returns 200 with node data
    - Business portal loads and shows venue editor
    - Consumer web loads map with nodes

  - [ ] 8.3 Smoke test critical user journeys
    - Consumer: signup → OTP → onboarding → map → check-in → reward claim
    - Business: login → view nodes → create reward → see check-in in live panel
    - Staff: login → scan/enter code → preview → confirm → success
    - Admin: login → dashboard → view abuse flags → view audit trail

  - [ ] 8.4 Push `serverless-prod-cleanup` to remote
    - `git push -u origin serverless-prod-cleanup`
    - Create PR to master with description of all changes
    - After merge, this becomes the new production branch

## Priority Order

If time is limited, do these in order:

1. **Task 1** (CI/CD cleanup) — unblocks merging to master
2. **Task 2** (env var fixes) — unblocks image upload working in prod
3. **Task 3.1** (dead Secrets Manager refs) — unblocks `terraform plan`
4. **Task 3.3** (Sentry DSN) — enables error visibility
5. **Task 5.1** (README) — enables anyone to deploy
6. **Task 8** (verification) — confirms everything works
7. **Tasks 4, 6, 7** (monitoring, custom domain, WAF) — can be fast-follow post-launch

## Notes

- All changes stay on `serverless-prod-cleanup` branch
- Do NOT merge current master into this branch
- Do NOT delete `wip/pre-serverless-cleanup` branch
- Do NOT read or commit `infra/environments/prod/terraform.tfvars`
- Guard script ignores `_archive/` — old material can live there for reference
- The `deploy-ecs.yml` workflow is the most dangerous leftover — if someone triggers it manually, it will try to deploy to non-existent ECS infrastructure
