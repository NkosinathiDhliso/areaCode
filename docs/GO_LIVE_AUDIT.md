# Go-Live Audit Report

**Date:** 17 May 2026
**Branch:** `master` (commit `0e4a87f`)
**Auditor:** Kiro
**Previous audit:** 15 May 2026 (`c084b2b`)

---

## Executive Summary

Conditional **GO**. Since the 15 May audit, Live Vibe on Map shipped behind a default-off flag (table, GSI, schedule-transition-tick Lambda, EventBridge minute rule, schedule-CRUD routes), Sentry was swapped for CloudWatch RUM across all four SPAs, auth hardening and Yoco/OAuth fixes landed, and the eslint config was relaxed so the lint job has zero errors. The remaining blockers are narrow: a stray `process` reference in one web test breaks Amplify's `tsc && vite build` chain, prettier flags two files, and the PR-only quality gate's `--max-warnings 900` is just under the current 966-warning count. None of these affect runtime. The serverless architecture is clean, all 707 tests pass, both Terraform stacks validate, and the no-SMS lock holds.

---

## ✅ PASS — No Action Required

| Area                   | Status                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serverless guard       | `pnpm guard:serverless` passes — no forbidden patterns                                                                                                            |
| Phone-OTP / SMS lock   | `scripts/assert-phone-otp-disabled.ps1` passes; routes return 410 when `AREA_CODE_ENV != 'dev'`                                                                   |
| TypeScript compilation | Root `pnpm typecheck` passes (0 errors)                                                                                                                           |
| Test suite             | 707 tests pass across 67 test files (`pnpm test`)                                                                                                                 |
| ESLint errors          | 0 errors (was 157 on 15 May; resolved via eslint config relax + service-worker globals + test-file overrides)                                                     |
| Lambda build           | `pnpm --filter backend build:lambda` — monolith + websocket + 10 worker Lambdas (added `schedule-transition-tick`)                                                |
| Frontend builds        | admin, business, staff all build cleanly via Vite. Web `vite build` succeeds; only the wrapper `tsc --noEmit` fails (#2)                                          |
| Terraform validate     | Both `dev` and `prod` validate after `terraform init`                                                                                                             |
| Secrets management     | No `.env`, `.tfvars`, or secret files tracked in git                                                                                                              |
| Prod infrastructure    | No ECS, RDS, ElastiCache, ALB, or NAT Gateway references anywhere in `infra/environments/`                                                                        |
| DynamoDB               | All 7 tables (added `music_schedules`) use `PAY_PER_REQUEST` with PITR enabled in both envs                                                                       |
| `MusicSchedules` GSI   | `ByNextTransition` (gsi1pk + nextTransitionAt) wired in dev and prod                                                                                              |
| Lambda architecture    | `architectures = ["arm64"]` set in the lambda module — applies to every Lambda                                                                                    |
| VPC                    | `enable_nat_gateway = false` in both envs                                                                                                                         |
| Budget alerts          | Dev $50, Prod $100 — both configured                                                                                                                              |
| CloudWatch alarms      | Lambda errors / throttles / p99, DynamoDB throttles + system errors per table, SQS DLQ alarms, Route53 health-check alarm                                         |
| Custom domain          | `api.areacode.co.za` with ACM cert + Route53 A record gated on `enable_api_custom_domain=true` (default)                                                          |
| Amplify domains        | web, business, staff, admin all mapped to `areacode.co.za` subdomains                                                                                             |
| Cognito                | 4 pools (consumer, business, staff, admin) with CUSTOM_AUTH triggers                                                                                              |
| CloudWatch RUM         | `cloudwatch-rum` Terraform module declares 4 monitors (web/business/staff/admin); each SPA's `main.tsx` calls `initRum()`                                         |
| X-Ray tracing          | `tracing_mode = "Active"` on prod API Lambda                                                                                                                      |
| HSTS header            | Set in prod via Fastify `onSend` hook (`max-age=31536000; includeSubDomains`)                                                                                     |
| Security headers       | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`                                                                             |
| CORS                   | `backend/src/shared/security/origins.ts` — prod domains + Amplify previews; dev appends localhost                                                                 |
| JWT auth middleware    | `requireAuth('business')` (or stricter) on every route in `business/handler.ts`, `auth/handler.ts`, `music/handler.ts`                                            |
| Schedule-CRUD routes   | `/v1/business/{businessId}/music-schedule[/...]` registered behind `requireAuth('business')` + body validation                                                    |
| Live Vibe feature flag | `live_vibe_on_map` declared in `packages/shared/lib/featureGating.ts` with default `false`; backend evaluator honours flag                                        |
| Schedule tick worker   | `schedule-transition-tick` Lambda packaged on arm64; EventBridge `rate(1 minute)` rule wired in dev and prod                                                      |
| EventBridge schedules  | pulse-decay (5min), leaderboard-reset (Mon 22:00 UTC), partition-manager (daily), cleanup (daily), report-weekly, report-monthly, schedule-transition-tick (1min) |
| SQS queues             | reward-eval, push-sender, report-generation — IAM, DLQs, and consumer mappings correct (push-sender consumer still missing)                                       |
| Deploy scripts         | PowerShell + bash scripts present and consistent                                                                                                                  |
| CI/CD pipeline         | `ci.yml` (lint, typecheck, test, data-integrity, serverless-guard, build, deploy-dev → deploy-prod with smoke test)                                               |
| Pre-push hook          | `pnpm typecheck && pnpm test` blocks broken pushes                                                                                                                |
| Operational docs       | README, DEPLOY.md, RUNBOOK.md, ROLLBACK.md present                                                                                                                |

---

## 🚨 BLOCKERS — Must Fix Before Launch

### 1. `pnpm --filter web build` Fails on `tsc --noEmit`

**Impact:** Amplify's web build runs `pnpm --filter @area-code/web build`, which is `tsc --noEmit && vite build`. The `tsc` step fails, so Amplify deploys of the consumer web app would fail today. Root `pnpm typecheck` passes because it uses the root `tsconfig.json`; the per-package `apps/web/tsconfig.json` has `"types": ["vite/client"]` only and resolves the test file too.

**Error:**

```
src/hooks/__tests__/useMapInit.r1.test.ts(31,3): error TS2591:
  Cannot find name 'process'. Do you need to install type definitions for node?
```

**Cause:** `vi.hoisted(() => { process.env['VITE_MAPBOX_TOKEN'] = 'pk.test' })` in the test file references the Node `process` global, but the web tsconfig doesn't include `@types/node` and doesn't exclude tests. The CI matrix in `ci.yml` invokes `pnpm exec vite build` directly and so doesn't surface this; Amplify does.

**Fix options (pick one):**

1. Exclude tests from `apps/web/tsconfig.json`: add `"**/__tests__/**"` and `"**/*.test.ts"` to `exclude`.
2. Switch the hoisted env-stub to `import.meta.env` or `globalThis` access that doesn't reference `process`.
3. Add a tests-only `apps/web/tsconfig.test.json` that includes node types and have the package script point production builds at the slimmer config.

Option 1 is the smallest change.

### 2. Prettier Check Fails (2 files)

**Impact:** CI `lint-format` job runs `pnpm exec prettier --check .` and exits non-zero, blocking the pipeline.

**Files:**

- `apps/web/src/hooks/__tests__/useMapMarkers.tier-size.test.ts`
- `backend/src/features/nodes/__tests__/repository.test.ts`

**Fix:** `pnpm format` and commit. Whitespace only.

---

## ⚠️ WARNINGS — Should Fix Before Launch

### 3. PR Quality Gate Just Above the 900-Warning Cap

`quality-gate.yml` runs `pnpm exec eslint . --max-warnings 900` on every PR. The current count is **966 warnings** (mostly `import/order` and a handful of `@typescript-eslint/no-unused-vars`). Master push uses `ci.yml` which runs eslint without `--max-warnings`, so master pushes go green; PRs are blocked until either the cap is raised or the warnings are fixed.

**Fix options:**

1. Raise the cap to `--max-warnings 1000` in `.github/workflows/quality-gate.yml`.
2. Run `pnpm lint --fix` to auto-fix the 796 fixable import-order warnings.

Option 2 is cleaner; the auto-fix is mechanical.

### 4. WAF Still Not Attached to API Gateway (CLOSED — superseded by follow-up #17)

This item is resolved as a recorded decision. See "17. Edge Protection Decision: CloudFront+WAF Deferred" in the post-launch follow-ups below. That entry captures the WAFv2-cannot-attach-to-API-Gateway-v2 constraint, the CloudFront requirement and cost, the decision to defer pending founder cost approval, and the compensating controls that hold in the meantime. The floating "WAF absence" note from the May audit stops rolling forward here.

`infra/modules/waf/main.tf` has the rules (CommonRuleSet, KnownBadInputs, rate-limit on check-in at 100/5min, rate-limit on auth at 20/5min). The ALB association block has been removed from the module (ALBs are forbidden infrastructure per `serverless-only.md`, so the association could never be used).

### 5. SNS Alerts Topic Has Zero Subscribers

`aws_sns_topic.alerts` exists in prod and every alarm publishes to it, but there is **no `aws_sns_topic_subscription` anywhere in `infra/`**. Alarms fire into the void. Confirmed by `grep` — zero matches across all `.tf` files.

**Fix:**

```hcl
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = "alerts@areacode.co.za"
}
```

(The budget already emails this address, so the email contact pattern is established.)

### 6. `run-migration` Lambda Still in Dev

`module "lambda_run_migration"` is still declared in `infra/environments/dev/main.tf` (line 510). It scales to zero and costs nothing, but it's a leftover from the RDS era — harmless, confusing. Prod has already removed it.

**Fix:** Remove the module block + its corresponding worker source (none exists in `backend/src/workers/` — the source was already deleted, but Terraform still tries to package an empty placeholder via the module).

### 7. Push-Sender SQS Queue Still Has No Consumer

`module "sqs_push_sender"` is declared in dev and prod but no Lambda is wired as its consumer. Messages enqueued by the API and worker Lambdas (via `AREA_CODE_SQS_PUSH_QUEUE_URL`) sit until TTL. Either:

- Add a `lambda_push_sender` worker (web push + email) and pass its ARN as `lambda_function_arn` to the module.
- Or document that push notifications are deferred post-launch and remove the queue's send permissions to make the deferral explicit.

This was flagged on 15 May; nothing has changed.

### 8. Terraform Formatting

`terraform fmt -check -recursive infra/` reports two files needing format:

- `environments/dev/main.tf`
- `environments/prod/terraform.tfvars`

Run `terraform fmt -recursive infra/` and commit.

### 9. Operational Docs Reference Sentry, Not RUM

Commit `ebd93f9` swapped Sentry for CloudWatch RUM in the frontends, but `docs/RUNBOOK.md`, `docs/ROLLBACK.md`, `docs/UAT_CHECKLIST.md`, and `docs/PILOT_LAUNCH_CHECKLIST.md` still talk about Sentry as the source of truth for crash-free rate. The backend still imports `initSentry` (no-op without `SENTRY_DSN`), but the user-facing playbooks should now point on-call at the CloudWatch RUM console for frontend errors and Sentry only for backend.

`docs/RUNBOOK.md` also doesn't mention the new `schedule-transition-tick` Lambda or the `MusicSchedules` table — both should be added to the log-group and table tables when convenient.

The `release-health-gate.yml` workflow still queries Sentry for the auto-rollback decision. If RUM is now the only frontend monitor, the gate either needs a RUM-aware variant or has to be downgraded to a backend-only signal.

### 10. Backend Sentry Module is Dead Code in Practice

`backend/src/app.ts` calls `await initSentry()` which silently no-ops when `SENTRY_DSN` is unset. Prod `terraform.tfvars` does not set `sentry_dsn`. The `@sentry/node` import in `monitoring/sentry.ts` is dynamic so the bundle stays clean, and `captureError` is wired into the Fastify error handler. This is harmless but wastes a Lambda init step. Either set `sentry_dsn` and use it, or strip the wrapper. Not a blocker.

---

## 📋 RECOMMENDATIONS — Post-Launch

### 11. Booster Purchase Audit Table Does Not Exist

`backend/src/features/business/types.ts` defines `BOOST_PRICING` as a flat `as const` constant (`2hr=2500`, `6hr=5000`, `24hr=10000` cents). No dynamic pricing yet — that's fine.

What is missing is a write path that records what a boost actually sold for at a given timestamp. `purchaseBoost` creates a Yoco checkout with `metadata: { businessId, nodeId, duration, type: 'boost' }`, and `processYocoWebhook → handlePaymentSucceeded` only acts on `metadata.plan` (subscription tier) — it ignores `metadata.type === 'boost'` entirely. There is no `BoosterPurchase` DynamoDB row, no `app_data` `BOOST#<businessId>` write, and a `grep` for `BoosterPurchase|booster_purchase|boost.*audit|boostHistory|recordBoost` returns zero matches across the backend.

**Implication:** If the team raises boost prices later, there is no audit trail of what historic boosts were sold for. Refunds, dispute handling, and price-change reporting all become guesswork. Yoco's own ledger is the only record.

**Recommendation (post-launch):** Add a `BOOST#<businessId>#<timestamp>` row in `app_data` (or a dedicated `booster_purchases` table) written from `handlePaymentSucceeded` when `metadata.type === 'boost'`, capturing `{ businessId, nodeId, duration, amountCents, currency, yocoCheckoutId, paidAt }`. This is a small, additive change and is the canonical place to put it (it's already where the payment succeeds idempotently).

### 12. Code-Split Large Frontend Bundles

The consumer web bundle is 2.69 MB / 735 KB gzipped (was 2.5 MB on 15 May; growth is from Live Vibe on Map's evaluator + glyph code). Business is 488 KB and has a 462 KB `ReportsPanel` chunk. `vite build` warns. Suggested:

- Lazy-load Mapbox GL via dynamic import.
- Lazy-load `ReportsPanel` and `MusicSchedulePanel` (both already split — confirm they're behind route boundaries).
- Use `manualChunks` for archetype display + RUM init.

Not a launch blocker; the gzipped sizes are still acceptable on 4G.

### 13. Mobile App (Expo) Still Not in CI

`apps/mobile/` exists but is excluded from `ci.yml`'s build matrix and from typecheck. If mobile is in scope for launch, add it. If not, document the deferral — per `.kiro/steering/no-sms-no-phone-auth.md` it must use email + Google OAuth when resumed, not phone.

### 14. SonarCloud Token

`quality-gate.yml` references `SONAR_TOKEN` — if not configured in GitHub secrets the scan silently skips. Not a blocker but reduces code-quality visibility on PRs.

### 15. Prod Terraform Plan Before Apply

`terraform.yml` workflow does `terraform apply -auto-approve` on push to master. Consider GitHub environment protection rules requiring manual approval for prod applies — especially now that Live Vibe on Map is live behind a flag and any errant `terraform apply` could affect the table.

### 16. Live Vibe Canary Plan

The flag default is `false` and the worker short-circuits on it (R12.5 in the spec). Before flipping the flag in prod, confirm: (a) `MusicSchedules` rows exist for at least one venue, (b) `schedule-transition-tick` is logging the empty-window heartbeat, and (c) the WebSocket `node:archetype_change` channel is subscribed on the consumer web app. None of this is blocked by infra; it's a runbook item.

### 17. Edge Protection Decision: CloudFront+WAF Deferred (closes warning #4)

Recorded per the billing-revenue-integrity spec, Requirement 11. This closes the floating "WAF absence" item (#4) that had rolled forward since the May audit.

**Constraint:** AWS WAFv2 cannot associate with API Gateway v2 HTTP APIs. WAF can only attach to a CloudFront distribution, an Application Load Balancer, or a REST (v1) API Gateway stage. Our API is an API Gateway v2 HTTP API, and ALBs are forbidden infrastructure per `serverless-only.md`, so neither of those attachment points is available to us.

**What WAF would require:** A CloudFront distribution placed in front of `api.areacode.co.za`, with the WAF web ACL associated to the distribution. CloudFront is allowed by `serverless-only.md`. Estimated cost is roughly $5 to $15 per month plus request fees.

**Decision: DEFERRED.** The CloudFront+WAF build is deferred pending founder approval of the cost. The build is gated on that approval and is not part of the launch scope.

**Infra change already made (task 14.1):** The ALB association was deleted from `infra/modules/waf`. ALBs are forbidden, so that association could never be used; removing it leaves the WAF module rules in place without a dead attachment path.

**Compensating controls that hold in the meantime:**

- App-level rate limits (DynamoDB TTL sliding window on check-in and auth routes).
- Cognito auth (`requireAuth`) on every business and admin route.
- Fail-closed webhook signature verification (an unsigned or bad-signature payment webhook is rejected, never processed).

When the founder approves the cost, the follow-up is: add a CloudFront distribution in front of `api.areacode.co.za`, associate the existing WAF web ACL to it, and wire it from `infra/environments/prod/main.tf`.

---

## Changes Made During This Audit

This audit was **read-only** by request. No code or infrastructure was modified.

### What was checked

- `git log` since previous audit — 27 commits, including the entire Live Vibe on Map shipment, RUM-for-Sentry swap, auth hardening, and Google OAuth verification work.
- `pnpm typecheck` (root): 0 errors.
- `pnpm test`: 67 files / 707 tests passing.
- `pnpm exec eslint .`: 0 errors / 966 warnings.
- `pnpm format:check`: 2 files unformatted.
- `pnpm guard:serverless`: pass.
- `scripts/assert-phone-otp-disabled.ps1`: pass.
- `pnpm --filter {admin,business,staff} build`: pass.
- `pnpm --filter web build`: **fail** (tsc), `vite build` alone passes.
- `pnpm --filter backend build:lambda`: pass — 12 bundles total.
- `terraform init -backend=false && terraform validate` in `dev` and `prod`: both succeed.
- `terraform fmt -check -recursive infra/`: 2 files need format.
- Read both `infra/environments/{dev,prod}/main.tf` end-to-end. Verified DynamoDB billing mode, Lambda arm64, VPC NAT gateway, `MusicSchedules` GSI, schedule-transition-tick wiring, EventBridge schedules, SNS subscription absence, WAF absence, run-migration leftover, push-sender consumer absence, Cognito 4-pool layout, custom domain config, RUM module wiring.
- Read `backend/src/{app.ts,features/auth/handler.ts,features/business/handler.ts,features/business/service.ts,features/music/handler.ts,features/business/types.ts,shared/security/origins.ts,shared/monitoring/sentry.ts,workers/schedule-transition-tick.ts}`.
- Read `apps/{web,admin,business,staff}/src/main.tsx` to confirm `initRum` import.
- `grep` for `BoosterPurchase|booster_purchase|boost.*audit|boostHistory|recordBoost` in `backend/`: zero matches.
- `grep` for `aws_sns_topic_subscription` in `infra/`: zero matches.
- `grep` for `module.waf` in `infra/environments/`: zero matches.
- `grep` for `live_vibe_on_map` flag declarations: confirmed in `packages/shared/lib/featureGating.ts` with default `false`.

### What could not be verified from this environment

- The actual state of deployed AWS resources (CloudWatch alarm history, RUM monitor IDs in Amplify, Cognito user counts, DynamoDB table sizes). The audit verifies what Terraform declares; it does not query the live AWS plane.
- Whether the latest GitHub Actions CI run on `0e4a87f` is green. The pre-push hook ran cleanly today (typecheck + tests), but the CI lint-format job will fail on prettier and the Amplify web build will fail on tsc per blockers #1 and #2.
- E2E smoke status: `quality-gate.yml`'s `e2e-smoke` job is gated on `vars.E2E_API_URL`. If that variable isn't set, the job is skipped and we get no signal.
- Sentry release-health gate calibration vs. RUM. Functional check would require a deploy.

---

## Suggested Commit Sequence

```bash
# Blocker #1: stop the Amplify web build from breaking on tests
# Edit apps/web/tsconfig.json to exclude tests, then:
git add apps/web/tsconfig.json
git commit -m "fix(web): exclude tests from production tsc build (Amplify fix)"

# Blocker #2: prettier
pnpm format
git add -A
git commit -m "style: prettier auto-fix two test files"

# Warning #3: lint warnings just above the gate
pnpm lint --fix
git add -A
git commit -m "chore(lint): auto-fix import/order warnings"

# Warning #5: subscribe SNS alerts to email
# Edit infra/environments/prod/main.tf and add aws_sns_topic_subscription block
git add infra/environments/prod/main.tf
git commit -m "infra(prod): subscribe alerts@ to area-code-prod-alerts SNS topic"

# Warning #8: terraform fmt
terraform -chdir=infra fmt -recursive
git add -A
git commit -m "style(infra): terraform fmt"

# Warning #9 + Warning #6: optional cleanup
# (RUNBOOK / ROLLBACK doc updates, dev run-migration removal)

git push
```

---

## Go/No-Go Verdict

**Conditional GO** — the platform is architecturally sound. Live Vibe on Map ships safely behind a default-off flag with the backend short-circuit in place. The two real blockers are tooling: the Amplify web build is broken by a single `process` reference in a test file, and prettier flags two files. Fix both, push, verify Amplify and CI go green, then the only outstanding pre-launch infra items are the SNS subscription and (if you want defence in depth on the API) the WAF wiring.
