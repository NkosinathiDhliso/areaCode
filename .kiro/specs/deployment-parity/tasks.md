# Implementation Plan: Deployment Parity

## Overview

Two phases. SHIP: land the working tree and the three Terraform fixes (WebSocket Cognito
env, MusicSchedules IAM, Media CDN) and deploy prod. GUARD: build-sha parity on /health,
authenticated WS probe, table/env closure scripts wired into the go-live check and CI, ops
log, docs sync. Founder-run steps are marked; they need prod AWS access.

## Tasks

- [x] 1. Terraform fixes that block live features (R3, R4, R5)
  - [x] 1.1 Add the eight Cognito pool/client env vars to `module.lambda_websocket` (dev + prod)
    - Mirror the API lambda block's sources (locals + module outputs).
    - _Requirements: 3.1_
  - [x] 1.2 Add `music_schedules` table + `/index/*` to the shared `lambda_dynamodb` policy
    - _Requirements: 4.1_
  - [x] 1.3 Media CDN: CloudFront distribution with `s3_media` origin (OAC, private bucket), output the URL
    - Price class 100, GET/HEAD, compress. No custom domain yet.
    - _Requirements: 5.1_
  - [x] 1.4 Run the Table_Closure sweep by hand across all Lambdas and fix any further gap found
    - _Requirements: 4.3_
  - [x] 1.5 `terraform fmt -check` + `validate` for dev and prod
    - _Requirements: 10.3_

- [x] 2. Frontend media handling (R5)
  - [x] 2.1 Shared `mediaUrl(key)` helper in `packages/shared/lib`; adopt in NodeEditorPanel, BusinessDashboard, NodeDetailContent
    - _Requirements: 5.3_
  - [x] 2.2 Explicit "Photos unavailable" state when the helper returns null in prod builds
    - _Requirements: 5.3_
  - [x]\* 2.3 Unit tests: helper set/unset, panel renders preview vs unavailable state
    - _Requirements: 5.3_

- [x] 3. Amplify env closure (R6)
  - [x] 3.1 Extend `update-all-amplify-apps.ps1` to manage every used VITE key (Cognito Hosted UI keys, `VITE_CDN_URL`, `VITE_VAPID_PUBLIC_KEY`); merge, never replace; print drift
    - _Requirements: 6.1, 6.2_
  - [x] 3.2 `scripts/check-amplify-env-closure.mjs`: used-vs-managed diff in both directions
    - _Requirements: 6.4_
  - [x] 3.3 Verify `VITE_SOCKET_URL` is unread and remove it from the script
    - _Requirements: 6.3_

- [x] 4. Parity gates (R7)
  - [x] 4.1 Embed git sha at `build:lambda` time; `/health` returns `commit`
    - _Requirements: 7.1_
  - [x] 4.2 `scripts/check-table-closure.mjs` (static: TableNames accessors vs tf env + IAM), with commented allowlist
    - _Requirements: 4.4_
  - [x] 4.3 Go-live check: Sha_Parity FAIL on mismatch; authenticated WS probe via `-WsToken` (SKIPPED without it, never PASS); run both closure scripts as checks
    - _Requirements: 7.2, 7.3, 7.4_
  - [x] 4.4 Wire both closure scripts into the CI quality gate
    - _Requirements: 4.4, 6.4_
  - [x]\* 4.5 Unit tests: closure scripts against fixtures with a known gap; health commit field
    - _Requirements: 4.4, 6.4, 7.1_

- [x] 5. Docs and ops log (R7.5, R8, R9)
  - [x] 5.1 `docs/DEPLOY.md`: the Release_Ritual as the single ordered command list; RUNBOOK links to it
    - _Requirements: 7.5_
  - [x] 5.2 RUNBOOK Ops_Log table seeded with known history + PENDING backfills
    - _Requirements: 8.1, 8.3_
  - [x] 5.3 `rules/tech.md` env sections completed (backend + all VITE keys); run `pnpm sync:rules`
    - _Requirements: 9.1, 9.2_

- [ ] 6. SHIP (founder-run, live access) (R1, R2)
  - [x] 6.1 Gates green locally, commit the working tree (fixes + this spec), push master; wait for four Amplify SUCCEED on the sha
    - List any known-pending fix by name in the commit body.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [~] 6.2 `./scripts/deploy-serverless.ps1 -Environment prod` with plan review
    - _Requirements: 2.1, 2.3_
  - [~] 6.3 Set the new Amplify env vars (`update-all-amplify-apps.ps1`) and rebuild the apps that gained keys
    - _Requirements: 5.2, 6.1_
  - [~] 6.4 Read `/aws/lambda/area-code-prod-websocket` logs for the recorded 502 cause; record it; fix if anything beyond stale artifact + missing env
    - _Requirements: 3.3_
  - [~] 6.5 Run PENDING prod backfills (`backfill-user-locks`, `backfill-user-search`) and record outcomes in the Ops_Log
    - _Requirements: 8.2_

- [ ] 7. Verify (founder-run, live access) (R10)
  - [~] 7.1 Re-test all reported failures in prod and record before/after in GO_LIVE_CHECK_RESULT: WS connect, digest card, settings toggle, payments list, music schedule (with and without schedule), photo preview, Instagram save
    - _Requirements: 2.2, 3.2, 4.2, 5.4, 10.1_
  - [~] 7.2 `go-live-check.ps1 -Environment prod -WsToken <fresh token>` passes with the new gates
    - _Requirements: 10.2_
