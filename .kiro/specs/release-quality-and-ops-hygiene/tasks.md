# Implementation Plan: Release Quality and Ops Hygiene

## Overview

Independent of the two sibling specs; no billing or portal code is touched.
Order inside this spec: lint ratchet first (it touches the most files, land
it before anything else to avoid rebase pain), then the monitoring swap, then
workflow gates, then infra hygiene, then the consent bump and bundle budget.
Task 8 (consent bump, prod window) and task 5.1 (worker first runs) need prod
access and founder timing; everything else is repo work.

## Tasks

- [x] 1. Lint ratchet (R1)
  - [x] 1.1 Auto-fix and clean the warning debt
    - `pnpm lint --fix`, then fix or per-line-disable (with reason) the
      remainder; zero errors throughout
    - _Requirements: 1.1_
  - [x] 1.2 Align both workflows on the ratcheted cap
    - Set `--max-warnings <post-cleanup count>` in `quality-gate.yml` AND the
      `ci.yml` lint job, with the ratchet comment (only ever lower)
    - _Requirements: 1.2, 1.3_
  - [x] 1.3 Run the full verification set and record the counts
    - `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm guard:serverless`
    - Recorded counts (verification run): `pnpm typecheck` clean (exit 0);
      `pnpm lint` 0 errors, 173 warnings (exactly at the ratcheted
      `--max-warnings 173` cap, exit 0); `pnpm test` 190 files, 1543 tests
      passed (exit 0); `pnpm guard:serverless` passed (exit 0)
    - _Requirements: 1.4_

- [x] 2. Monitoring: one stack (R2)
  - [x] 2.1 Remove the backend Sentry wrapper
    - Delete `shared/monitoring/sentry.ts`, the `initSentry` await in
      `app.ts`, `captureError` call sites; confirm the Fastify error handler
      still logs structured errors; drop `@sentry/node` from backend deps
    - _Requirements: 2.2_
  - [x] 2.2 Remove Sentry from infra and workflows
    - `sentry_dsn` variable, env plumbing, and workflow secrets references
    - _Requirements: 2.3_
  - [x] 2.3 Rebuild the Health_Gate on CloudWatch
    - RUM_Signal (4 monitors, 30-minute window vs 7-day baseline) plus
      Backend_Signal (alarm states); extract the decision rule as a pure
      function; missing data fails the job loudly; rollback step unchanged
    - _Requirements: 2.1, 2.4_
  - [x] 2.4 Write property test for the health-gate decision rule
    - Property 2: rollback iff regression or alarm; missing data is a
      distinct loud-failure outcome
    - _Requirements: 2.1, 2.4_
  - [x] 2.5 Verify in dev
    - Dev deploy; confirm structured errors land in CloudWatch and the error
      alarm still evaluates; run the gate workflow once on a branch
    - _Requirements: 2.1, 2.2_

- [x] 3. Ops docs match the stack (R3)
  - [x] 3.1 Update RUNBOOK, ROLLBACK, UAT_CHECKLIST, PILOT_LAUNCH_CHECKLIST
    - Frontend triage points at CloudWatch RUM; Sentry references removed or
      marked historical; RUNBOOK gains `schedule-transition-tick` log group
      and `MusicSchedules` table
    - _Requirements: 3.1, 3.2_
  - [x] 3.2 Sync go-live-check wording with the updated docs
    - _Requirements: 3.3_

- [x] 4. Workflow gates (R4, R6)
  - [x] 4.1 Prod_Apply_Gate on `terraform.yml`
    - `environment: prod-infra` on the prod leg (environment created with a
      required reviewer), plan surfaced before the approval wait; dev stays
      auto
    - _Requirements: 4.1, 4.3_
  - [x] 4.2 Document the approval flow and break-glass path in DEPLOY.md
    - _Requirements: 4.2_
  - [x] 4.3 Make CI skips loud and decided
    - e2e-smoke: warning annotation when `vars.E2E_API_URL` is empty (or set
      the var and run it); Sonar: token configured or step deleted, decision
      comment either way; mobile exclusion decision comment in `ci.yml`
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 5. Scheduled workers proven (R5)
  - [x] 5.1 First_Run_Proof for `campaign-sender` and `streak-reminder`
    - Confirm triggers in prod Terraform, invoke no-op-safe or wait one
      schedule tick, verify log group + heartbeat + zero ERRORs, update
      `docs/GO_LIVE_CHECK_RESULT.md`
    - _Requirements: 5.1, 5.3_
  - [x] 5.2 Heartbeat line in any scheduled worker missing one
    - One structured line per invocation, matching the existing worker style
    - _Requirements: 5.2_
  - [x] 5.3 Escalate stale missing log groups in go-live-check
    - Missing log group on a scheduled worker older than 7 days reports FAIL,
      not WARN
    - _Requirements: 5.3_

- [x] 6. Infra hygiene (R7)
  - [x] 6.1 Remove `module "lambda_run_migration"` from dev and apply
    - Plan, apply via the normal dev path, confirm destroy
    - _Requirements: 7.1_
  - [x] 6.2 `terraform fmt` clean plus CI enforcement
    - `terraform fmt -recursive infra/`, add `fmt -check` to
      `terraform.yml`
    - _Requirements: 7.2_

- [x] 7. Consent bump rehearsal and execution (R8)
  - [x] 7.1 Dev rehearsal
    - Bump dev `AREA_CODE_CONSENT_VERSION`, verify one re-consent prompt and
      the recorded version in the admin ConsentAudit screen
    - _Requirements: 8.1, 8.3_
  - [x] 7.2 Prod bump in its own window
    - Separate deploy, release note stating the one-time re-consent prompt,
      founder-timed
    - _Requirements: 8.2_

- [x] 8. Consumer bundle budget (R9)
  - [x] 8.1 Dynamic-import Mapbox GL in `useMapInit`
    - Reuse the existing map loading state; no behaviour change on slow
      loads beyond the spinner
    - _Requirements: 9.1_
  - [x] 8.2 Confirm or add lazy boundaries for ReportsPanel and
        MusicSchedulePanel
    - _Requirements: 9.2_
  - [x] 8.3 `scripts/check-bundle-budget.mjs` plus CI wiring
    - Sums initial-chunk gzip sizes, budget = post-split measurement + 10
      percent, fails over budget; silence remaining Vite chunk warnings by
      raising real splits, not the warning limit
    - _Requirements: 9.3, 9.4_
  - [x] 8.4 Write property test for the budget script
    - Property 1: sums exactly initial chunks, monotone pass/fail, total on
      empty input
    - _Requirements: 9.3_
  - [x] 8.5 Record before/after gzip sizes in this task on completion - Before/after consumer web (`apps/web`) initial-gzip record (measured
        via `pnpm --filter @area-code/web build` + `node
scripts/check-bundle-budget.mjs`): - Baseline (May audit): 2.69 MB raw / 735 KB gzip for the consumer
        bundle. At task 8.1's starting point the build's initial index JS was
        ~7,870 kB raw / ~1,830 kB gzip (Mapbox bundled inline). - After 8.1 (Mapbox GL dynamic-imported to a lazy chunk): initial index
        ~6,146 kB raw / ~1,353 kB gzip, plus a lazy `mapbox-gl` chunk
        ~1,704 kB raw / ~469.8 kB gzip (excluded from the initial payload). - After 8.3 (Phosphor barrel replaced by curated tree-shaken registry +
        `manualChunks` vendor splits): initial gzip total = 322,105 bytes
        (314.56 KB) across the entry JS + CSS (react-vendor 112.26 KB,
        index 104.78 KB, vendor 54.90 KB, i18n-vendor 15.05 KB, index CSS
        14.60 KB, query-vendor 12.97 KB). - Budget = ceil(322,105 \* 1.10) = 354,316 bytes (346.01 KB). Current
        measured initial gzip total 322,105 bytes is within budget; the
        `check-bundle-budget.mjs` check PASSES (exit 0). The lazy `mapbox-gl`
        chunk stays out of the initial total by design. - _Requirements: 9.3_

- [x] 9. Launch-morning confirmations
  - [x] 9.1 Re-run `go-live-check.ps1 -Environment prod` end to end; expect
        the two worker WARNs cleared and no new findings
  - [x] 9.2 §1.4 manual gate re-check on the 2019 Android after the bundle
        split
