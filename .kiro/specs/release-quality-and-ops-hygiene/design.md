# Design Document

## Overview

### Goals

- Make every gate real: a PR gate that passes on clean PRs and ratchets debt
  down, a rollback gate that watches the monitor that actually receives
  data, and a prod apply that waits for a human.
- Collapse monitoring to one stack (CloudWatch: RUM for frontends, logs and
  alarms for backend) and delete the Sentry remnants.
- Prove every scheduled worker runs in prod and make "never ran" visible.
- Execute the deferred consent bump safely.
- Put the consumer bundle on a budget before the 2019-Android launch gate is
  tested for real.

### Non-Goals (out of scope)

- New monitoring vendors or paid observability tools.
- Mobile CI enablement (decision recorded only).
- Load or soak testing.
- Anything owned by `billing-revenue-integrity` or
  `cross-portal-lifecycle-alignment`.

### Architectural Constraints (binding)

- Serverless only; nothing in this spec adds an always-on resource.
- One path per capability (`no-fallbacks-no-legacy.md`): Sentry is removed,
  not left as a second, silent monitoring path.
- All infra changes through Terraform; `run-migration` removal goes through
  a normal plan and apply.
- The repo workflow stays: root `pnpm typecheck` is canonical; prod terraform
  applies happen via `deploy-serverless.ps1` or the now-gated workflow.

## Architecture

### The gate lattice after this spec

```
PR:      quality-gate.yml   lint (ratcheted cap), typecheck, test,
                            data-integrity, serverless-guard, sonar (or
                            deleted), e2e-smoke (loud when var missing)
master:  ci.yml             same cap as PR gate, build matrix, deploy-dev,
                            deploy-prod (existing environments)
infra:   terraform.yml      fmt-check, validate, plan (both envs),
                            apply dev (auto), apply prod (environment
                            protection, required reviewer)
post-deploy: release-health-gate.yml
                            RUM_Signal (4 app monitors) + Backend_Signal
                            (Lambda error alarm state) -> rollback decision
                            missing data = job failure, never silent pass
scheduled: go-live-check    worker scan upgraded: missing log group on a
                            scheduled worker older than 7 days = FAIL
```

### Health_Gate signal design (R2)

Replace the two Sentry queries with CloudWatch calls, keeping the workflow's
sleep-30-minutes-then-decide shape:

- **Frontend**: for each of the four RUM monitors, `GetMetricData` on
  `AWS/RUM JsErrorCount` and session count for the 30-minute post-deploy
  window, compared against the trailing 7-day rate for the same monitor. The
  release dimension is the deploy timestamp window, not a release tag: RUM
  has no SHA concept, and the gate runs immediately after a deploy, so the
  window is the release.
- **Backend**: `DescribeAlarms` for the prod API Lambda error and p99 alarms;
  any alarm in ALARM state during the window is a rollback vote.
- Decision rule: frontend error-rate regression beyond threshold OR backend
  alarm vote triggers the existing rollback step. Any CloudWatch API failure
  or empty metric set fails the job loudly (R2.4).

Sentry removal: delete `backend/src/shared/monitoring/sentry.ts`, the
`initSentry` await in `app.ts`, and `captureError` call sites (the Fastify
error handler already logs structured errors to CloudWatch; the existing
error-log alarm covers alerting). Delete the `sentry_dsn` variable, tfvars
plumbing, env var, and workflow secrets. Git history is the archive.

### Warning_Ratchet mechanics (R1)

1. `pnpm lint --fix` clears the auto-fixable import/order bulk.
2. Remaining warnings are fixed, or suppressed per line with
   `-- eslint-disable-next-line <rule> -- reason` where the code is right.
3. Count the result, set `--max-warnings <count>` in BOTH `quality-gate.yml`
   and `ci.yml`, with the ratchet comment: lower this number whenever the
   count drops; never raise it.

### First_Run_Proof (R5)

`campaign-sender` consumes the campaign-send SQS queue; `streak-reminder`
runs on its EventBridge schedule. Proof procedure per worker: confirm the
trigger exists in prod Terraform, invoke with a no-op-safe payload (empty
batch / dry-run flag where supported) or wait one natural schedule tick,
then verify log group, heartbeat line, zero ERRORs, and re-run the go-live
check. The go-live-check worker scan gains an age check: a scheduled worker
whose Lambda `LastModified` is older than 7 days with no log group reports
FAIL.

### Consent_Bump (R8)

Dev first: bump `AREA_CODE_CONSENT_VERSION` in dev Terraform, verify the
consumer re-consent prompt fires once and the consent row records the new
version (admin ConsentAudit screen). Then prod, in its own deploy, release
notes stating every consumer sees one re-consent prompt. Rollback path: the
version is an env var; reverting it stops new prompts (already-recorded
consents at the new version are harmless).

### Bundle_Budget (R9)

- `vite-bundle` measurement in CI: after `pnpm --filter @area-code/web
build`, a small script sums gzip sizes of the initial entry chunks
  (excluding lazy chunks) and fails over budget. Budget = post-split
  measurement + 10 percent, recorded in the script.
- Mapbox GL via `import('mapbox-gl')` inside `useMapInit` behind the
  existing loading state; the map screen already has a loading path for
  token-missing, reused for module-loading.
- Verify `ReportsPanel` and `MusicSchedulePanel` are `React.lazy` route
  boundaries; split if not.

## Components and Interfaces

- `.github/workflows/quality-gate.yml`, `ci.yml`: cap alignment, sonar
  decision, e2e-smoke loud-skip annotation (`core.warning` step when the var
  is empty).
- `.github/workflows/terraform.yml`: `fmt -check` step; prod job gains
  `environment: prod-infra` (created in repo settings with a required
  reviewer); plan output uploaded before the approval wait.
- `.github/workflows/release-health-gate.yml`: CloudWatch queries per the
  signal design; rollback mechanics untouched.
- `backend/src/app.ts`, `backend/src/shared/monitoring/`: Sentry removal.
- `scripts/go-live-check.ps1`: worker-scan age escalation (WARN to FAIL after
  7 days), doc wording sync.
- `infra/environments/dev/main.tf`: remove `module "lambda_run_migration"`.
- `infra/environments/{dev,prod}`: `sentry_dsn` removal; consent version bump
  (dev then prod, separate applies).
- `apps/web/src/hooks/useMapInit.ts`: dynamic Mapbox import.
- `apps/business`: route-level lazy confirmation for the two heavy panels.
- `scripts/` (new, small): `check-bundle-budget.mjs` used by CI.
- `docs/RUNBOOK.md`, `ROLLBACK.md`, `UAT_CHECKLIST.md`,
  `PILOT_LAUNCH_CHECKLIST.md`, `DEPLOY.md`: monitoring and approval-flow
  updates.

## Data Models

None. This spec adds no persisted rows and no schema changes. The only state
changes are Terraform resource removals (`run-migration`, `sentry_dsn`) and
an env var value (`AREA_CODE_CONSENT_VERSION`).

## Correctness Properties

This spec is pipeline and ops work; property-based testing applies only where
pure logic exists:

### Property 1: Bundle budget script

For arbitrary sets of chunk descriptors (name, size, initial flag), the
budget script sums exactly the initial chunks, passes iff the sum is within
budget, and never throws on empty input. fast-check, min 100 runs.

### Property 2: Health gate decision rule

For arbitrary frontend rate pairs (release window vs baseline) and backend
alarm states, the decision function (extracted as a pure function inside the
workflow's script step or a small script file) votes rollback iff regression
exceeds threshold or an alarm votes, and always fails (distinct outcome) on
missing data. Min 100 runs.

## Testing Strategy

- The two property tests above, tagged
  `Feature: release-quality-and-ops-hygiene, Property N`.
- Workflow changes validated by running each workflow once on a branch
  (workflow_dispatch where available) before relying on them.
- Sentry removal verified by `pnpm typecheck`, full test suite, and a dev
  deploy showing structured errors still land in CloudWatch and the error
  alarm still evaluates.
- First_Run_Proof recorded by re-running `go-live-check.ps1` and updating
  `docs/GO_LIVE_CHECK_RESULT.md` with the cleared WARNs.
- Consent bump: dev rehearsal per the design, admin ConsentAudit screen
  verification, then the prod window.
- Bundle work: before/after gzip sizes recorded in the task, §1.4 manual
  gate (2019 Android, 10 seconds) stays the human check.
