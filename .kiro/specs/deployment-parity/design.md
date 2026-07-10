# Design Document

## Overview

Closes the repo-vs-deployment parity gaps behind the July 2026 live-portal failures and
installs permanent gates. Two phases: SHIP (get the working tree and pending infra into prod,
with the three Terraform fixes that block live features) and GUARD (build-sha parity,
authenticated socket probe, table/env closure checks, ops log) so the go-live check catches
this class before users do.

Diagnosis evidence, all from the repo:

| Symptom                                                              | Root cause                                                                                                                       | Fix home                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 404: digest/latest, settings PATCH, subscription-payments, instagram | Deployed API Lambda predates the routes; frontends auto-deployed ahead                                                           | Release_Ritual (R1, R2) |
| WebSocket 502 / dead live dashboard                                  | WS_Lambda env has zero Cognito IDs (prod main.tf `lambda_websocket` block); deployed artifact stale                              | R3                      |
| Music Schedule error screen                                          | `lambda_dynamodb` policy (prod main.tf ~1209) omits `music_schedules` ARN: AccessDenied -> 400 -> generic message (`app.ts:150`) | R4                      |
| Photo uploads but never displays                                     | `VITE_CDN_URL` unset AND no CDN exists; `NodeEditorPanel` guards preview on the var silently                                     | R5, R6                  |
| Nothing caught any of it                                             | `/health` has no build identity; WS probe unauthenticated; no closure checks                                                     | R7                      |

## Components and Interfaces

### 1. Ship (R1, R2)

Order matters: gates green, commit, push, wait for four Amplify SUCCEED, then
`deploy-serverless.ps1 -Environment prod` (plan reviewed before apply), then go-live check.
This ordering is the Release_Ritual and lands verbatim in `docs/DEPLOY.md`.

### 2. WS_Lambda auth env (R3)

In `infra/environments/{dev,prod}/main.tf` `module.lambda_websocket.environment_variables`,
add the eight Cognito vars exactly as the API block defines them (same locals/modules):
consumer/business/staff/admin pool + client IDs. No code change: `getPoolConfig` is lazy and
fail-closed. After deploy, read the websocket log group for the recorded 502 cause; expected
findings are init/timeout errors from the stale artifact. Record in GO_LIVE_CHECK_RESULT.

### 3. Table_Closure (R4)

- Add to the shared `lambda_dynamodb` policy Resource list:
  `aws_dynamodb_table.music_schedules.arn` and `"${...}/index/*"`.
- `scripts/check-table-closure.mjs`: parses `backend/src/shared/db/dynamodb.ts` for
  `requireEnv('<X>_TABLE'...)` names, parses `infra/environments/prod/main.tf` for each
  Lambda's env block and `dynamodb-access` policies, prints a matrix of gaps. Static
  (no AWS calls) so it runs in CI; the go-live check runs it too.
- Known accepted asymmetries (workers that genuinely never touch a table) live in a small
  allowlist inside the script with a comment each.

### 4. Media_CDN (R5)

- `infra/modules/cdn` (or inline in envs): `aws_cloudfront_distribution` with the `s3_media`
  bucket as origin via Origin Access Control; bucket policy allows only the distribution.
  Default cache behaviour: GET/HEAD, compress, honour the existing
  `Cache-Control: public, max-age=31536000` from `image-service.ts`. Price class 100.
  No custom domain needed initially (the `*.cloudfront.net` URL is the `VITE_CDN_URL` value);
  a `media.areacode.co.za` alias can follow later without code change.
- Frontend: in the three CDN consumers (`NodeEditorPanel`, `BusinessDashboard`,
  `NodeDetailContent`), replace the silent `if (cdnUrl)` skip with a shared
  `mediaUrl(key): string | null` helper in `packages/shared/lib`; when it returns null in a
  prod build the photo block renders an explicit "Photos unavailable" state and logs once.

### 5. Amplify_Env_Closure (R6)

- Enumerate every `import.meta.env` key with a repo grep (the audit's list: API_URL,
  WEBSOCKET_URL, MAPBOX_TOKEN, CDN_URL, STAFF_URL, VAPID public key, RUM trio, and the
  per-portal Cognito HOSTED_UI_DOMAIN / CLIENT_ID keys).
- `update-all-amplify-apps.ps1` gains the missing keys, sourced from Terraform outputs where
  they exist (Cognito module outputs, CDN URL output) and parameters otherwise. The script
  merges (reads current env, overlays managed keys) rather than replacing, so a manual key
  is never silently dropped; unmanaged keys it finds are printed as drift warnings.
- `scripts/check-amplify-env-closure.mjs`: greps used keys, parses the ps1's managed list,
  reports both directions (used-but-unmanaged, managed-but-unused). `VITE_SOCKET_URL` is
  expected to fall out as managed-but-unused; verify then delete.

### 6. Parity gates (R7)

- Build sha: `build:lambda` esbuild `define`s `process.env.AREA_CODE_BUILD_SHA` from
  `git rev-parse HEAD`; `/health` adds `commit`. Local dev returns `dev`.
- `go-live-check.ps1` additions:
  - Sha_Parity: `GET /health` `.commit` vs `aws amplify list-jobs` latest SUCCEED sha
    (already queried for build parity today); mismatch = FAIL with the two shas printed.
  - Authenticated WS probe: `-WsToken <jwt>` parameter (founder supplies a fresh token, or
    dev-mode token against dev); handshake must open AND a `joinroom` echo must return.
    Without the parameter the check prints the token-path as SKIPPED, never PASS.
  - Runs `check-table-closure.mjs` and `check-amplify-env-closure.mjs`; gaps are FAIL.
- `docs/DEPLOY.md` gets the Release_Ritual as the single ordered list; RUNBOOK and
  GO_LIVE_CHECK_RESULT link to it.

### 7. Ops_Log (R8)

RUNBOOK section: a table (script, purpose, env, date run, run by, outcome). Seed it with the
known history (demo venue seeds and renames from GO_LIVE_CHECK_RESULT, consent bump v1.1 in
dev) and PENDING rows for `backfill-user-locks`, `backfill-user-search` in prod; executing
the pending ones is a founder-run task with the exact commands inline.

## Error Handling

- The deploy script and go-live additions fail loudly with named checks; no gate degrades to
  WARN when it can assert.
- The Amplify env script never deletes keys it does not manage; drift is reported, not
  auto-fixed.
- `mediaUrl()` returning null is a designed visible state, not an exception.

## Testing Strategy

- Unit: `mediaUrl` helper (set/unset), closure scripts against fixture files (a fake tf and
  a fake dynamodb.ts with a known gap -> reported), health `commit` field shape.
- The closure scripts are themselves the regression tests for R4/R6; wire them into CI
  (quality gate) so a future table or VITE key cannot land without closure.
- Live verification is R10's before/after table: the five reported failures re-tested in
  prod and recorded.
- Standard gates: typecheck, test, lint, guard:serverless, terraform fmt/validate.
