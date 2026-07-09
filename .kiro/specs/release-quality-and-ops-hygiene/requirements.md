# Requirements Document

## Introduction

Third spec from the 9 July 2026 go-live re-audit, alongside
`billing-revenue-integrity` (money path) and
`cross-portal-lifecycle-alignment` (portal truth). This spec, **Release
Quality and Ops Hygiene**, fixes the release pipeline, monitoring stack, and
infrastructure hygiene findings: the gates that are supposed to protect prod
are currently either failing by construction, watching a monitor nobody
feeds, or applying to prod with no human in the loop.

Verified findings this spec fixes:

1. **Every PR fails the quality gate by construction.**
   `quality-gate.yml` runs `eslint . --max-warnings 900`; the repo has 1,125
   warnings (9 July run, mostly `import/order`, roughly 901 auto-fixable).
   Master pushes go green because `ci.yml` runs eslint without a cap, so the
   gate punishes PRs while letting master drift.
2. **The auto-rollback gate is blind.** `release-health-gate.yml` queries
   Sentry release health, but the frontends moved to CloudWatch RUM (commit
   `ebd93f9`) and prod `terraform.tfvars` sets no `sentry_dsn`, so no session
   ever reaches Sentry. The gate can never see a crash and can never trigger
   the rollback it exists for. The backend `initSentry` wrapper is a silent
   no-op in prod, which `no-fallbacks-no-legacy.md` bans.
3. **Ops docs point on-call at the wrong console.** `RUNBOOK.md`,
   `ROLLBACK.md`, `UAT_CHECKLIST.md`, and `PILOT_LAUNCH_CHECKLIST.md` still
   treat Sentry as the frontend crash source of truth. RUNBOOK also lacks the
   `schedule-transition-tick` Lambda and `MusicSchedules` table added in May.
4. **Prod infrastructure applies with no human gate.** `terraform.yml` runs
   `terraform apply -auto-approve` for dev and prod on push to master, with
   no GitHub environment protection on the job.
5. **Two prod workers have never run.** `campaign-sender` and
   `streak-reminder` have no prod log groups (5 July go-live WARNs). Two
   shipped churn defences (winback campaigns, streak reminders) are unproven
   in production.
6. **CI has silent skips.** The e2e smoke job is skipped whenever
   `vars.E2E_API_URL` is unset, and SonarCloud is skipped whenever
   `SONAR_TOKEN` is unset, both without failing or announcing anything. The
   mobile app is excluded from CI without a recorded decision.
7. **Infra leftovers.** `module "lambda_run_migration"` (RDS era) is still in
   `infra/environments/dev/main.tf`; `terraform fmt` drift is unchecked in
   CI.
8. **The consent version was deliberately not bumped** when the
   tier-permanence clause entered the Terms (platform audit C12).
   `AREA_CODE_CONSENT_VERSION` is still `v1.0`, so existing users have never
   re-consented to the updated terms. The deferral was intentional; the
   execution is still owed.
9. **The consumer bundle keeps growing** (2.69 MB, 735 KB gzip at the May
   audit) with no budget or splitting, on a product whose §1.4 launch gate is
   a 2019 Android on mobile data.

Out of scope: anything covered by the two sibling specs, new monitoring
vendors, mobile app CI enablement (decision recorded, work deferred), and
load testing.

## Glossary

- **Quality_Gate**: the PR workflow `.github/workflows/quality-gate.yml`.
- **Warning_Ratchet**: the eslint `--max-warnings` cap policy: set to the
  post-cleanup count and only ever lowered, never raised, so warnings
  monotonically decrease.
- **Health_Gate**: the post-deploy auto-rollback workflow
  `.github/workflows/release-health-gate.yml`.
- **RUM_Signal**: CloudWatch RUM `JsErrorCount` / session metrics from the
  four monitors declared in the `cloudwatch-rum` Terraform module.
- **Backend_Signal**: the existing CloudWatch Lambda error and p99 alarms on
  the prod API Lambda.
- **Prod_Apply_Gate**: GitHub environment protection (required reviewer) on
  the prod matrix leg of `terraform.yml`.
- **First_Run_Proof**: a verified prod invocation of a scheduled worker: log
  group exists, heartbeat line present, zero ERROR events, go-live-check
  WARN cleared.
- **Consent_Bump**: raising `AREA_CODE_CONSENT_VERSION` so every consumer is
  re-prompted to accept the current legal terms on next open.
- **Bundle_Budget**: a CI-enforced ceiling on the consumer web gzip bundle
  size.

## Requirements

### Requirement 1: The quality gate is passable and ratchets down

**User Story:** As a developer, I want the PR gate to fail only on real
regressions, so that green means something and PRs are not blocked by debt
that predates them.

#### Acceptance Criteria

1. THE repo SHALL be brought under the warning cap by running the eslint
   auto-fix for the fixable warnings and fixing or per-line-disabling (with a
   reason) the remainder that the team decides to keep.
2. THE Quality_Gate cap SHALL be set to the post-cleanup warning count and
   the Warning_Ratchet policy SHALL be recorded as a comment next to the flag
   (only ever lower it).
3. `ci.yml`'s master lint job SHALL enforce the same cap as the PR gate, so
   master cannot drift above what PRs are held to.
4. THE full verification set (`pnpm typecheck`, `pnpm test`, `pnpm lint`,
   `pnpm guard:serverless`) SHALL pass at the end of this work.

### Requirement 2: One monitoring stack, one working rollback gate

**User Story:** As the on-call founder, I want the auto-rollback gate wired
to the monitor that actually receives data, so that a bad release rolls back
without me watching a dashboard nobody feeds.

#### Acceptance Criteria

1. THE Health_Gate SHALL evaluate the RUM_Signal (frontend error rate for the
   deployed SHA window vs the trailing baseline) and the Backend_Signal
   (Lambda error alarm state) instead of Sentry, keeping the existing
   rollback mechanics (Lambda alias swap) unchanged.
2. THE backend Sentry wrapper (`backend/src/shared/monitoring/sentry.ts`,
   the `initSentry` call in `app.ts`, and the `captureError` wiring) SHALL be
   removed, with error visibility preserved through the existing structured
   CloudWatch error logging and alarms, per `no-fallbacks-no-legacy.md` (one
   monitoring path).
3. THE `sentry_dsn` Terraform variable, its env var plumbing, and the Sentry
   workflow secrets SHALL be removed in the same change.
4. WHEN the Health_Gate cannot read the RUM_Signal (missing metric, API
   error), THE gate SHALL fail loudly (job failure, no rollback decision)
   rather than reporting a silent pass.

### Requirement 3: Ops docs match the real stack

**User Story:** As anyone on call, I want the runbook to name the consoles
and resources that exist today, so that incident response does not start with
archaeology.

#### Acceptance Criteria

1. `RUNBOOK.md`, `ROLLBACK.md`, `UAT_CHECKLIST.md`, and
   `PILOT_LAUNCH_CHECKLIST.md` SHALL point frontend crash and error triage at
   the CloudWatch RUM console, and SHALL drop Sentry references except where
   they describe history.
2. `RUNBOOK.md` SHALL list the `schedule-transition-tick` Lambda log group
   and the `MusicSchedules` table in its log-group and table inventories.
3. THE go-live-check output wording SHALL stay consistent with the docs it
   references after the Sentry removal.

### Requirement 4: Prod applies need a human

**User Story:** As the founder, I want prod Terraform changes to wait for an
approval, so that a bad push cannot silently mutate production
infrastructure.

#### Acceptance Criteria

1. THE prod leg of `terraform.yml` SHALL declare a GitHub environment with a
   required reviewer (Prod_Apply_Gate); dev SHALL keep auto-apply.
2. `docs/DEPLOY.md` SHALL document the approval step and the break-glass
   alternative (`scripts/deploy-serverless.ps1 -Environment prod`, which
   stays the canonical scripted path per the repo workflow).
3. THE workflow SHALL continue to run `terraform plan` and surface the plan
   in the job output before the apply step waits for approval.

### Requirement 5: Every scheduled worker has First_Run_Proof

**User Story:** As the founder, I want proof that every shipped churn defence
actually executes in prod, so that "we have winback campaigns" is a fact and
not a hope.

#### Acceptance Criteria

1. `campaign-sender` and `streak-reminder` SHALL each produce First_Run_Proof
   in prod: triggered via their real schedule or a manual invoke with a
   no-op-safe payload, log group present, heartbeat logged, zero ERROR
   events.
2. EVERY scheduled worker SHALL log a single structured heartbeat line per
   invocation (most already do; add where missing) so the go-live-check
   worker scan distinguishes "never ran" from "ran quietly".
3. THE two go-live-check WARNs for missing log groups SHALL be cleared, and
   the go-live-check SHALL treat a missing log group for a scheduled worker
   older than 7 days as FAIL, not WARN.

### Requirement 6: CI skips are loud and decided

**User Story:** As a developer, I want CI to tell me when a job did not run,
so that a skipped safety net is a visible decision and not a silent gap.

#### Acceptance Criteria

1. WHEN `vars.E2E_API_URL` is unset, THE e2e smoke job SHALL emit a visible
   warning annotation naming the missing variable (or the variable SHALL be
   set and the job run); the silent skip SHALL be removed.
2. THE SonarCloud step SHALL either receive its token or be deleted, one or
   the other, with the decision recorded in the workflow file comment.
3. THE mobile app's exclusion from CI SHALL be recorded as a decision comment
   in `ci.yml` next to the build matrix, referencing the deferral note in
   `docs/PLATFORM_AUDIT_FINDINGS.md`.

### Requirement 7: Infrastructure hygiene

**User Story:** As the next engineer reading the Terraform, I want no
retired-era resources and no format drift, so that the infra reads as owned.

#### Acceptance Criteria

1. `module "lambda_run_migration"` SHALL be removed from
   `infra/environments/dev/main.tf` and destroyed from the dev state.
2. `terraform fmt -check -recursive infra/` SHALL pass and SHALL be enforced
   in the terraform workflow so drift fails CI.

### Requirement 8: The consent bump is executed, not orphaned

**User Story:** As the founder, I want existing users to re-consent to the
terms that now include the tier-permanence clause, so that the legal surface
and the recorded consents agree before real businesses onboard.

#### Acceptance Criteria

1. THE re-consent flow SHALL be verified in dev by bumping the consent
   version there and confirming the consumer app re-prompts and records the
   new version.
2. `AREA_CODE_CONSENT_VERSION` SHALL be bumped in prod in a deliberate
   window (not bundled with unrelated deploys), with the expected UX (every
   user re-prompted once) noted in the deploy record.
3. THE consent audit surface in the admin portal SHALL show the new version
   taking effect.

### Requirement 9: The consumer bundle gets a budget

**User Story:** As a consumer on a 2019 Android on mobile data, I want the
map app to load inside the launch gate's 10 seconds, so that the first
impression survives.

#### Acceptance Criteria

1. Mapbox GL SHALL be loaded via dynamic import so the initial chunk does not
   carry it.
2. `ReportsPanel` and `MusicSchedulePanel` in the business app SHALL be
   confirmed behind route-level lazy boundaries (split if not).
3. A Bundle_Budget SHALL be enforced in CI for the consumer web build
   (initial gzip total, threshold set from the post-split measurement plus
   modest headroom), failing the build when exceeded.
4. THE consumer web build SHALL emit no Vite chunk-size warnings at the
   configured limit after splitting.
