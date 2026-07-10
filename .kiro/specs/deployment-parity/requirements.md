# Requirements Document

## Introduction

The July 2026 live-portal failures (WebSocket 502s, three business-route 404s, the Music
Schedule error screen, invisible venue photos) were all repo-vs-deployment parity failures,
not code bugs: the code was right and the deployed world was behind or incomplete. This spec
closes every parity gap found in the follow-up audit and installs gates so the class cannot
recur silently.

Root causes found (each becomes a requirement):

1. ~50 files of fixes sit uncommitted; nothing recent is pushed, so Amplify and any backend
   deploy cannot carry them.
2. The deployed prod API Lambda predates the digest, settings, subscription-payments, and
   Instagram routes the deployed frontends already call (Amplify auto-deploys on push;
   the backend deploys only when `deploy-serverless.ps1` is run by hand).
3. The WebSocket Lambda's Terraform env has NO Cognito pool/client IDs, so token verification
   at `$connect` can never succeed; the live business dashboard cannot receive events.
4. The shared `lambda_dynamodb` IAM policy omits the `music_schedules` table, so the API's
   MusicSchedules calls fail with `AccessDeniedException` (HTTP 400), surfaced as
   "Please check your details and try again."
5. `VITE_CDN_URL` is unset everywhere AND no CDN exists: venue photos upload into a private
   S3 bucket that nothing serves. `update-all-amplify-apps.ps1` provisions only 8 of the
   VITE keys the apps read; the Cognito Hosted UI keys live only in the Amplify console
   (untracked drift), and `VITE_VAPID_PUBLIC_KEY` is documented but not provisioned.
6. One-time scripts (`backfill-user-locks.ts`, `backfill-user-search.ts`, seeds, the consent
   version bump) have no recorded run status per environment.
7. Nothing detects any of the above: `/health` carries no build identity, the go-live check
   probes only an unauthenticated WebSocket handshake, and no check compares code-required
   env/IAM against the deployed Lambdas.

Binding rules: `serverless-only.md` (CloudFront is acceptable, nothing always-on),
`no-fallbacks-no-legacy.md` (missing config fails loudly, no console-managed drift),
`dry-reuse-no-duplication.md` (one release ritual, documented once).

## Glossary

- **Release_Ritual**: The ordered, documented sequence that takes a green working tree to a verified prod: commit, push, Amplify build wait, `deploy-serverless.ps1 -Environment prod` (terraform + lambdas), `go-live-check.ps1`.
- **Build_Sha**: The git commit sha embedded in the backend Lambda bundle at build time and returned by `GET /health`.
- **Sha_Parity**: The go-live check comparing the API's Build_Sha against the sha of the latest successful Amplify build on master.
- **WS_Lambda**: `module.lambda_websocket` (`backend/src/lambdas/websocket.ts`), which verifies JWTs at `$connect`.
- **Table_Closure**: For each accessor in `shared/db/dynamodb.ts` `TableNames`: the env var is present on every Lambda that can reach that code path, the named table exists, and the Lambda's IAM policy covers the table and its indexes.
- **Amplify_Env_Closure**: Every `import.meta.env.VITE_*` key read anywhere in `apps/` or `packages/` is provisioned by `update-all-amplify-apps.ps1` for the apps that read it; no key lives only in the Amplify console.
- **Media_CDN**: The public serving layer (CloudFront in front of the `s3_media` bucket) whose URL is the value of `VITE_CDN_URL`.
- **Ops_Log**: A RUNBOOK section recording every one-time script or backfill: what, which environment, when, by whom, and outcome.

## Requirements

### Requirement 1: The working tree ships

**User Story:** As the founder, I want every completed fix committed, pushed, and deployed,
so that work that exists on my disk actually exists for users.

#### Acceptance Criteria

1. All completed in-flight work (the three bug-fix sessions, the audit-gap-closure streams, the digest/settings/consent changes) SHALL be committed to master and pushed, in reviewable commits.
2. THE push SHALL trigger Amplify builds for all four portals; the run is complete only when all four report SUCCEED on the pushed sha.
3. `pnpm typecheck && pnpm test && pnpm lint && pnpm guard:serverless` SHALL pass immediately before the push.
4. Any in-flight fix that is incomplete at ship time SHALL be listed by name in the commit body as known-pending rather than silently omitted.

### Requirement 2: Backend and infrastructure reach prod

**User Story:** As a business owner, I want the routes my portal calls to exist in prod, so
that the digest card, settings toggle, payments history, Instagram save, and music schedule
work.

#### Acceptance Criteria

1. `./scripts/deploy-serverless.ps1 -Environment prod` SHALL be run after Requirement 1, applying Terraform (music-schedules table, `CityIndex` GSI, and all pending resources) and updating every Lambda.
2. After deploy, `GET /v1/business/digest/latest`, `GET /v1/business/subscription-payments`, `PATCH /v1/business/settings`, and `PUT /v1/business/nodes/:nodeId/instagram` SHALL return non-404 responses for an authenticated business in prod.
3. `terraform plan` output SHALL be reviewed before apply per `tech.md`; any unexpected destroy is a stop.

### Requirement 3: WebSocket Lambda can verify tokens

**User Story:** As a business owner, I want the live dashboard socket to connect, so that
check-ins appear in real time.

#### Acceptance Criteria

1. THE WS_Lambda's Terraform env (dev AND prod) SHALL include all eight Cognito pool/client ID variables that `verifyBearerToken` requires.
2. After deploy, a `$connect` with a valid business token SHALL succeed (connection opens, connection row carries the server-derived `businessId`).
3. THE actual cause of the observed 502s SHALL be read from `/aws/lambda/area-code-prod-websocket` logs and recorded in `docs/GO_LIVE_CHECK_RESULT.md`; IF it is anything beyond the stale artifact and missing env, THEN it SHALL be fixed under this requirement.
4. A `$connect` with an invalid token SHALL be rejected 401 (fail closed, unchanged).

### Requirement 4: Table_Closure holds for every Lambda

**User Story:** As an operator, I want every Lambda to have the env, table, and IAM for every
table its code can touch, so that no feature fails at runtime with an AWS 4xx.

#### Acceptance Criteria

1. THE shared `lambda_dynamodb` policy SHALL include `aws_dynamodb_table.music_schedules.arn` and its `/index/*` (the API Lambda reads and writes MusicSchedules).
2. After deploy, the Music Schedule panel SHALL load for a business with and without an existing schedule (empty state, not the error screen).
3. Table_Closure SHALL be verified for every Lambda in prod Terraform against every `TableNames` accessor, and any other gap found SHALL be fixed in the same change.
4. A repo script (`scripts/check-table-closure`) SHALL automate the comparison (parse `TableNames` accessors, parse Terraform env and IAM blocks, report gaps) so CI or the go-live check can run it.

### Requirement 5: Venue photos have a serving path

**User Story:** As a business owner, I want an uploaded venue photo to actually display, in
my portal and on the consumer venue card.

#### Acceptance Criteria

1. A Media_CDN SHALL exist in Terraform: a CloudFront distribution with the `s3_media` bucket as origin (origin access control, bucket stays private), pay-per-use, no WAF required initially.
2. `VITE_CDN_URL` SHALL be set to the Media_CDN URL for the web and business apps via `update-all-amplify-apps.ps1`.
3. WHEN `VITE_CDN_URL` is unset in a production build, THE photo surfaces SHALL show an explicit unavailable state, never a silent success-without-preview.
4. After deploy, an uploaded photo SHALL render in the business editor preview and on the consumer venue detail.
5. Image responses SHALL keep the existing long-lived cache headers.

### Requirement 6: Amplify_Env_Closure

**User Story:** As an operator, I want every frontend env key provisioned by the one script,
so that no app behaviour depends on console-only configuration.

#### Acceptance Criteria

1. `update-all-amplify-apps.ps1` SHALL provision every `VITE_*` key read in the codebase for the apps that read it, including the Cognito Hosted UI domain/client keys, `VITE_CDN_URL`, and `VITE_VAPID_PUBLIC_KEY`.
2. Keys currently set only in the Amplify console SHALL be imported into the script so the script is the single source of truth; running it SHALL be non-destructive to correct values.
3. Provisioned-but-unread keys (e.g. `VITE_SOCKET_URL` if stale) SHALL be verified and removed from the script.
4. A repo script SHALL diff the `VITE_*` keys used in code against the script's provisioned set, so drift is detectable.

### Requirement 7: Release parity gates

**User Story:** As the founder, I want the go-live check to fail when the deployed world is
behind the repo, so that users stop being the parity detector.

#### Acceptance Criteria

1. THE backend build SHALL embed the git sha, and `GET /health` SHALL return it as `commit`.
2. `go-live-check.ps1` SHALL verify Sha_Parity: the API's `commit` matches the latest successful Amplify build sha on master; mismatch is FAIL.
3. `go-live-check.ps1` SHALL probe an authenticated WebSocket handshake (a dev-issued or founder-supplied token) and expect it to open; the unauthenticated probe alone SHALL no longer count as WebSocket PASS.
4. `go-live-check.ps1` SHALL run the Table_Closure check (R4.4) and the Amplify_Env_Closure diff (R6.4) and report gaps as FAIL.
5. THE Release_Ritual SHALL be documented once in `docs/DEPLOY.md`, listing the exact ordered commands, and every other doc SHALL link to it rather than restate it.

### Requirement 8: One-time operations are recorded and current

**User Story:** As an operator, I want a record of which one-time scripts have run where, so
that "did we ever run the backfill?" has an answer.

#### Acceptance Criteria

1. THE RUNBOOK SHALL gain an Ops_Log section listing every one-time script (`backend/src/scripts/backfill-user-locks.ts`, `backend/src/scripts/backfill-user-search.ts`, `scripts/seed-demo-venues.ps1`, `scripts/claim-demo-venues.ps1`, the consent version bump) with environment, date, and outcome, or PENDING.
2. Every PENDING entry that is required for a live feature SHALL be executed against prod during this spec and its outcome recorded.
3. New one-time scripts SHALL add an Ops_Log entry as part of their definition of done (stated in the RUNBOOK section header).

### Requirement 9: Documentation matches reality

**User Story:** As the next engineer, I want the env var documentation to be complete, so
that a provisioning gap is visible by reading the docs.

#### Acceptance Criteria

1. `rules/tech.md` environment sections SHALL list every backend env var consumed via `requireEnv`/`process.env` and every frontend `VITE_*` key, matching the closure scripts' source lists.
2. `pnpm sync:rules` SHALL be run so the mirror files match.

### Requirement 10: Verification

**User Story:** As the founder, I want proof that each reported failure is gone.

#### Acceptance Criteria

1. All five reported failures SHALL be re-tested in prod after deploy and their before/after recorded in `docs/GO_LIVE_CHECK_RESULT.md`: WebSocket connect (business portal), digest card, settings digest toggle, subscription payments list, Music Schedule load, photo upload preview, Instagram save.
2. `go-live-check.ps1 -Environment prod` SHALL pass with the new gates enabled.
3. Standard suite green: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm guard:serverless`; `terraform fmt -check` and `terraform validate` for infra changes.
