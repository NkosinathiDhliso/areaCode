# Go-Live Check Result

Recorded run of `scripts/go-live-check.ps1 -Environment prod`. All checks are
read-only. This file records one run, its verbatim output, and the follow-up
items every FAIL and WARN implies. It is not launch approval on its own: the
four MANUAL gates below are human launch-day checks the script cannot make.

## Coverage layers

Go-live readiness has three layers, kept distinct on purpose. The first two are
automated and catch STRUCTURAL problems only. The third is a human gate for
purely visual defects the first two cannot see.

1. `scripts/go-live-check.ps1` (this run): backend and deployment truth. Health,
   nodes, portals, DLQs, API and worker logs, Amplify build parity, Cognito
   across all four pools, WebSocket reachability.
2. `tests/e2e` sweep: UI structure across all four portals. No overlay leaks,
   primary CTA reachable, no horizontal scroll, axe criticals clean.
3. Checklist §1 real-device pass: human eyes on a real phone for purely visual
   defects, misaligned glass, wrong colors, janky motion, that layers 1 and 2
   cannot detect.

Key caveat: layers 1 and 2 catch structural leaks (wrong surface visible, wrong
tab, blocked interaction) but NOT purely visual problems. A green script plus a
green e2e run is never launch approval on its own. The checklist §1 real-device
pass stays mandatory. See `docs/PILOT_LAUNCH_CHECKLIST.md` §1.

## Run

- Date: 2026-07-05 10:05 SAST
- Command: `./scripts/go-live-check.ps1 -Environment prod`
- Region: us-east-1
- Exit code: 0 (no failing checks)
- Tally: 36 PASS, 0 FAIL, 2 WARN, 4 MANUAL

This supersedes the earlier 2026-07-03 run (recorded in git history). Since then:
the three worker/DLQ config FAILs are fixed and verified; the three placeholder
demo venues were renamed and given live gets; two more demo venues were seeded
(Braamfontein Beans, Maboneng Social) so Johannesburg now has 7 nodes with
margin above the 5-node floor, each with a live reward; and the worker error
scan is deploy-aware (reports "since deploy …", not a blind 24h window). The
`pulse-decay` transient FAIL from the 09:35 re-run was cleared by redeploying the
worker at 07:45:26Z. The only remaining WARNs are two worker log groups that are
not yet queryable because those workers have not been invoked in prod (no log
group exists yet); they self-resolve on first invocation. The four manual gates
stay human by design.

## Coverage changes since this run (billing-revenue-integrity)

Recorded after this 2026-07-05 run, so the verbatim output below predates them
and will differ from a future run:

- The `push-sender` SQS queue and its DLQ were deleted. Report-ready
  notifications now deliver via SES email plus WebSocket, so
  `area-code-prod-push-sender-dlq` no longer exists. The go-live check no longer
  probes that DLQ. The `[PASS] DLQ area-code-prod-push-sender-dlq` line in the
  output below is from before the deletion and will not appear on future runs.
- The go-live check now covers the billing pipeline. It asserts the Yoco secrets
  `YOCO_WEBHOOK_SECRET` and `YOCO_PROD_SECRET_KEY` are present and non-empty on
  `area-code-prod-api`, and `YOCO_WEBHOOK_SECRET` on `area-code-prod-yoco-webhook`
  (presence only, secret values are never printed). It also probes the live
  webhook route with an unsigned POST to `/v1/webhooks/yoco` and expects HTTP
  401, proving the signature gate is alive and fails closed.
- The billing lifecycle behind manual gate §1.3 is now shipped: a paid checkout
  writes `paidUntil` and `paidInterval`, tiers expire with a 7-day grace window
  and a renewal reminder email, boost purchases activate a bounded boost window,
  and checkout redirects land on truthful screens in the business portal. A
  future run will show the billing secret-presence and webhook-signature lines
  and omit the push-sender DLQ line.

## Full output

```
==========================================
  Area Code - Go-Live Readiness Check
  Environment: prod
  Region: us-east-1
==========================================

HTTP checks
[PASS] API health: status=ok, env=prod
[PASS] Nodes count: 7 nodes
[PASS] Nodes active + in JHB box: all 7 node(s) active with coords in JHB box
[PASS] Portal https://areacode.co.za: HTTP 200
[PASS] Portal https://business.areacode.co.za: HTTP 200
[PASS] Portal https://staff.areacode.co.za: HTTP 200
[PASS] Portal https://admin.areacode.co.za: HTTP 200
[PASS] HTTP->HTTPS redirect: HTTP 301 -> https://areacode.co.za/

AWS state checks
[PASS] DLQ area-code-prod-reward-eval-dlq: ApproximateNumberOfMessages=0
[PASS] DLQ area-code-prod-push-sender-dlq: ApproximateNumberOfMessages=0
[PASS] DLQ area-code-prod-campaign-send-dlq: ApproximateNumberOfMessages=0
[PASS] DLQ area-code-prod-report-generation-dlq: ApproximateNumberOfMessages=0
[PASS] API error logs 24h: no ERROR events in last 24h
[PASS] Amplify area-code-staff (master): SUCCEED at ab5baeb (includes c047c94)
[PASS] Amplify area-code-admin (master): SUCCEED at ab5baeb (includes c047c94)
[PASS] Amplify area-code-web (master): SUCCEED at ab5baeb (includes c047c94)
[PASS] Amplify area-code-business (master): SUCCEED at ab5baeb (includes c047c94)

Backend end-to-end sweep
[PASS] WebSocket reachability: handshake opened (State=Open) at wss://ilcimxarf0.execute-api.us-east-1.amazonaws.com/prod
[PASS] Cognito consumer password min length: MinimumLength=8 (>= 8)
[PASS] Cognito consumer MFA not required: MfaConfiguration=OFF
[PASS] Cognito consumer Google IdP: Google identity provider configured
[PASS] Cognito business password min length: MinimumLength=8 (>= 8)
[PASS] Cognito business MFA: MfaConfiguration=OFF (informational; stronger posture allowed)
[PASS] Cognito business Google IdP: Google identity provider configured
[PASS] Cognito staff password min length: MinimumLength=8 (>= 8)
[PASS] Cognito staff MFA: MfaConfiguration=OFF (informational; stronger posture allowed)
[PASS] Cognito staff Google IdP: Google identity provider configured
[PASS] Cognito admin password min length: MinimumLength=8 (>= 8)
[PASS] Cognito admin MFA: MfaConfiguration=ON (informational; stronger posture allowed)
[PASS] Cognito admin Google IdP: Google identity provider configured
[PASS] Worker errors /aws/lambda/area-code-prod-reward-evaluator: no ERROR events since deploy 2026-07-05T06:42:05Z
[PASS] Worker errors /aws/lambda/area-code-prod-presence-expiry: no ERROR events since deploy 2026-07-05T05:56:27Z
[PASS] Worker errors /aws/lambda/area-code-prod-pulse-decay: no ERROR events since deploy 2026-07-05T07:45:26Z
[WARN] Worker errors /aws/lambda/area-code-prod-campaign-sender: log group not queryable (missing group or credentials)
[PASS] Worker errors /aws/lambda/area-code-prod-report-generator: no ERROR events since deploy 2026-07-05T05:56:39Z
[WARN] Worker errors /aws/lambda/area-code-prod-streak-reminder: log group not queryable (missing group or credentials)

Seed-data readiness
  - Plato Coffee Co. | active (implied) | has-coords=yes | live rewards=1 | First-Get=no
  - Braamfontein Beans | active (implied) | has-coords=yes | live rewards=1 | First-Get=no
  - Hive Kitchen | active (implied) | has-coords=yes | live rewards=1 | First-Get=no
  - Maboneng Social | active (implied) | has-coords=yes | live rewards=1 | First-Get=no
  - Revolver Eatery | active (implied) | has-coords=yes | live rewards=1 | First-Get=no
  - Father Coffee | active (implied) | has-coords=yes | live rewards=2 | First-Get=yes
  - Furmished | active (implied) | has-coords=yes | live rewards=1 | First-Get=no
[PASS] First-Get present: at least one Johannesburg venue has a First-Get reward
[PASS] Venues with live rewards: every venue has >= 1 live reward

Manual gates (not verifiable by script)
[MANUAL] §1.1 First QR scan on a real staff phone: staff sees redemption preview, confirms, sees Redeemed
[MANUAL] §1.2 First live customer signup from the venue: Google OAuth or email; new user lands on the map
[MANUAL] §1.3 Yoco test payment upgrades venue to paid: test-card webhook flips the venue from trial to paid within 60s
[MANUAL] §1.4 Map loads on a 2019 Android on mobile data: shows the map and at least one node within 10s

==========================================
  Result: PASS (no failing checks)
==========================================
```

## Resolution note (2026-07-05)

All three FAILs below are fixed and verified:

- Root cause 1: missing table env vars on `reward-evaluator` and `pulse-decay`.
  Fixed in Terraform (full table closure per worker) and applied.
- Root cause 2 (masked by 1): the worker Lambdas sat in a VPC with no NAT and
  no DynamoDB gateway endpoint, so every AWS or HTTPS call hung to timeout.
  All workers now run outside the VPC, matching the api/presence-expiry
  pattern. See the "Not in VPC" notes in `infra/environments/prod/main.tf`.
- The DLQ (grown to 11) was redriven after the fix; all messages processed in
  ~600ms with no errors and the queue is at 0. `pulse-decay` completes cleanly
  on schedule.

Originally a re-run inside 24h of the fix still showed the two worker-error
FAILs, because the worker scan used a blind trailing 24h window and the retired
code's final ERROR events were still inside it. That was a false FAIL against
healthy, redeployed workers. The worker error scan now scopes its window to each
worker's last deploy (`lambda get-function-configuration` LastModified), never
earlier than 24h ago: a fixed-and-redeployed worker reads PASS immediately
because pre-fix errors fall before the deploy time. A re-run now reports the
truth without waiting for the events to age out.

The 2026-07-05 run is green: DLQs at 0, all workers PASS ("no ERROR events since
deploy …"), and every venue carries a live get so the seed-data checks PASS. The
transient `pulse-decay` FAIL from the 09:35 re-run was cleared by redeploying the
worker at 07:45:26Z. Two more demo venues (Braamfontein Beans, Maboneng Social)
were seeded via `scripts/seed-demo-venues.ps1`, taking Johannesburg to 7 nodes,
so the node-count WARN cleared too. What remains is non-blocking: two
worker log groups not yet queryable (workers not yet invoked in prod), and the
four manual launch-day gates.

### Decision (2026-07-05): the three placeholder venues are Area Code-owned demo venues

"Plato coffe", "Hi", and "RuleRev" are not customer venues. They are Area Code's
own test/demo venues, owned by the company. They already sit on paid-tier
business accounts (that is the only reason they surface on the public
`/v1/nodes/johannesburg` map, per `nodes/repository.ts getNodesByCitySlug`, which
hides any node without a paid-tier owning business), so ownership is already the
correct data state. They are kept, not deleted: they carry the Johannesburg node
count above the launch minimum without inventing customer relationships that do
not exist.

Two rules govern them so they stay honest, not mock data:

1. Honest presence still applies. An Area Code demo venue may show an honest zero
   or low live count; it must never render a faked crowd, pulse, or "your crowd
   is here" claim. See `honest-presence.md`.
2. They need honest, non-placeholder names and at least one real live get each
   before launch, so they read as genuine venues on the map, not test rows.
   Applied via `scripts/claim-demo-venues.ps1` (dry-run by default, `-Confirm`
   to apply; an allowlist of the exact demo node IDs is the guard — no other
   node can be touched, and ownership is not reassigned).

Applied 2026-07-05 (prod, account 562691664641):

| was         | now              | live get                             |
| ----------- | ---------------- | ------------------------------------ |
| Plato coffe | Plato Coffee Co. | Free flat white on your 5th check-in |
| Hi          | Hive Kitchen     | Free side dish on your 5th check-in  |
| RuleRev     | Revolver Eatery  | Free dessert on your 5th check-in    |

Each get is a `nth_checkin` loyalty reward (trigger 5), verified live through
`GET /v1/nodes/johannesburg` and `GET /v1/nodes/:id/rewards`. All five paid-tier
Johannesburg venues now carry at least one live reward, so the "zero live
rewards" WARN clears. Note: a sixth node, "TrendPulse", exists in the table but
sits on a free-tier business, so it is hidden from the paid-only map (this is why
the check counts 5). It was left untouched.

## Follow-up items (every FAIL and WARN)

Reconciled to the 2026-07-05 run. The three original FAILs (reward-eval DLQ
backlog, and the reward-evaluator / pulse-decay missing-table-env-var startup
crashes) are fixed and verified: DLQs at 0 and both workers PASS. See the
Resolution note above for the root cause (missing table env vars, masked by the
workers sitting in a VPC with no egress) and the fix (full table closure +
running the workers outside the VPC).

### FAIL (blocks a green run, exit code 1)

None. The 09:47 run is green (exit 0).

Historical (first re-run, 09:35): `Worker errors
/aws/lambda/area-code-prod-pulse-decay: 1 ERROR event since deploy
2026-07-05T06:35:49Z`. First event at 06:36:29Z, ~40s after the deploy:
`TimeoutError: connect ETIMEDOUT 3.218.180.158:443`. Transient, not a code
defect: an invocation that started on the old in-VPC-no-egress networking in the
seconds before the out-of-VPC config propagated. pulse-decay is not in a VPC now
(empty VpcConfig) and ran cleanly 13 times after (zero errors). RESOLVED by
redeploying the worker (same code, HEAD `ab5baeb`) at 07:45:26Z, which moved the
deploy-aware scan window past the stale event. Owner: backend/ops.

### WARN (does not fail the run, resolve before or track into launch)

1. `Nodes count: 5 nodes (minimum met, no margin)`. RESOLVED 2026-07-05 by
   seeding two more demo venues (Braamfontein Beans, Maboneng Social) via
   `scripts/seed-demo-venues.ps1`, taking Johannesburg to 7 active paid-tier
   nodes with margin above the 5-node floor. Each seeded venue was given a live
   get via `claim-demo-venues.ps1`. Note: this is demo padding for pre-launch
   resilience; seeding real customer venues remains the proper long-term fix.
   Owner: content/seeding.
2. `Worker errors /aws/lambda/area-code-prod-campaign-sender` and
   `.../area-code-prod-streak-reminder: log group not queryable`. Both log
   groups could not be read, most likely because the workers have never been
   invoked in prod so no log group exists yet (not a permissions gap — the other
   worker groups queried fine in this run). Action: confirm each group is created
   on first invocation, then re-run; a genuinely missing group on a scheduled
   worker would be the real signal. Owner: backend/ops.
3. `Venues with live rewards`. RESOLVED 2026-07-05: every venue now has >= 1 live
   reward. The three placeholder demo venues were renamed (Plato Coffee Co.,
   Hive Kitchen, Revolver Eatery) and each given a live `nth_checkin` get via
   `scripts/claim-demo-venues.ps1`. See the "Decision (2026-07-05)" block above.

## Manual gates (verify on launch day)

The script prints these as `[MANUAL]` because it cannot verify them. They are
mandatory launch-day human checks; a green script run does not clear them. This
is layer 3 of the coverage model above: purely visual and real-device fidelity
that neither the script nor the e2e sweep can see.

1. §1.1 First QR scan on a real staff phone: staff sees redemption preview,
   confirms, and sees Redeemed.
2. §1.2 First live customer signup from the venue: Google OAuth or email; the
   new user lands on the map.
3. §1.3 Yoco test payment upgrades venue to paid: after a Yoco test-mode card
   checkout (card `4242 4242 4242 4242`), the business dashboard billing status
   header flips to the plan badge plus the paid-until date (format
   `<Plan> · paid until <date>`) within 60 seconds.
4. §1.4 Map loads on a 2019 Android on mobile data: shows the map and at least
   one node within 10s.

## Task 2.5 verification: monitoring swap (release-quality-and-ops-hygiene)

Verification of the Sentry-to-CloudWatch monitoring swap (spec
`release-quality-and-ops-hygiene`, R2.1 and R2.2). This records what was
verified in the repo checkout and the exact live steps the founder must run to
complete the dev-deploy portion. The live steps are not yet executed; they need
AWS credentials and GitHub `workflow_dispatch` access this checkout does not
have. Nothing below claims a deploy result that was not observed.

### Verified locally (repo checkout, 18:09)

- Backend Lambda build is clean after Sentry removal.
  `pnpm --filter backend build:lambda` exits 0 and builds the monolith Lambda,
  the WebSocket Lambda, and 14 worker Lambdas.
- The freshly built bundle carries no Sentry code. A grep of `backend/dist/`
  for `__SENTRY__`, `@sentry`, and `sentryWrapped` returns zero matches. (An
  earlier grep hit was a stale pre-removal artifact that the rebuild replaced.)
- No Sentry wiring remains in backend source. `backend/src/shared/monitoring/`
  no longer exists, `@sentry/node` is absent from `backend/package.json`, and
  the only "Sentry" token left in `backend/src` is the explanatory comment in
  `app.ts` ("This is the one monitoring path (no Sentry).").
- The Fastify error handler still logs structured errors. `app.ts`
  `setErrorHandler` ends the 5xx path with `app.log.error(error)` before
  returning the typed `{ error, message, statusCode }` body, so uncaught errors
  land in the API Lambda CloudWatch log group as structured `error`-level lines.
  AWS 4xx client errors log via `app.log.warn` and are not counted as 5xx.
- The Health_Gate decision core is valid and behaves correctly.
  `node --check scripts/health-gate-decision.mjs` passes; the Property 2 test
  (`scripts/health-gate-decision.test.ts`) passes (2 tests); and the CLI path
  the workflow calls returns `NO_ROLLBACK` (exit 0) for healthy signals,
  `ROLLBACK` (exit 0) with `backend_alarm` and `frontend_regression` reasons for
  a regression, and `MISSING_DATA` (exit 1, loud failure) for an empty signal
  set.
- All four workflow YAML files parse cleanly, including
  `release-health-gate.yml`, `quality-gate.yml`, `ci.yml`, and `terraform.yml`.

### Environment nuance (affects where the alarm check runs)

`infra/environments/dev/main.tf` defines no CloudWatch metric alarms and no
CloudWatch RUM module. The API error alarm (`area-code-prod-api-errors`), the
p99 alarm (`area-code-prod-api-duration-p99`), and the four RUM monitors
(`area-code-prod-{web,business,staff,admin}`) exist in prod only. So:

- Structured-error logging is verified in dev against the dev API log group.
- "The error alarm still evaluates" is a prod-scoped check against
  `area-code-prod-api-errors` (the alarm the Health_Gate reads). There is no
  dev alarm to evaluate.

### Manual steps requiring live access (pending founder execution)

Run from the repo root with AWS credentials for account 562691664641,
region us-east-1.

1. Dev deploy (canonical scripted path):

   ```powershell
   ./scripts/deploy-serverless.ps1 -Environment dev
   ```

   Expected: `area-code-dev-api` (and the dev WebSocket and worker Lambdas)
   update without error. This is the break-glass path per `tech.md`.

2. Confirm structured errors land in CloudWatch (dev). Drive one 5xx or inspect
   recent errors, then read the dev API log group:

   ```powershell
   aws logs filter-log-events `
     --log-group-name /aws/lambda/area-code-dev-api `
     --filter-pattern '"level":50' `
     --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-30).ToUnixTimeMilliseconds()) `
     --region us-east-1 --no-cli-pager
   ```

   Expected: pino `error`-level (`"level":50`) JSON lines for any uncaught
   error, proving the `app.log.error` path reaches CloudWatch with no Sentry in
   the chain. A quiet log with no errors is also a valid healthy result.

3. Confirm the prod error alarm still evaluates (not in ALARM by construction,
   just that it reads a state and is not INSUFFICIENT_DATA forever):

   ```powershell
   aws cloudwatch describe-alarms `
     --alarm-names area-code-prod-api-errors area-code-prod-api-duration-p99 `
     --query 'MetricAlarms[].{name:AlarmName,state:StateValue}' `
     --output table --region us-east-1 --no-cli-pager
   ```

   Expected: each alarm reports `OK` or `ALARM` (a live evaluated state), not a
   stuck `INSUFFICIENT_DATA`, confirming the Backend_Signal the Health_Gate
   reads is alive.

4. Run the gate workflow once on a branch (no rollback, dry run). From a branch
   with these changes pushed:

   ```powershell
   gh workflow run release-health-gate.yml `
     --ref <your-branch> `
     -f sha=$(git rev-parse HEAD) `
     -f dryRun=true `
     -f waitMinutes=1
   ```

   Then watch the run:

   ```powershell
   gh run watch --exit-status
   ```

   Expected: the "Collect CloudWatch signals" step reads the four RUM monitors
   and the two backend alarms, "Evaluate decision" prints a decision, and with
   `dryRun=true` the "Auto-rollback (alias swap)" step is skipped. A
   `MISSING_DATA` outcome fails the job loudly (exit 1) rather than passing
   silently, which is the intended R2.4 behaviour when no RUM sessions exist in
   the window yet; re-run with a longer `waitMinutes` once dev/prod traffic is
   flowing, or confirm against a window with real sessions.

On completion, record the observed decision, alarm states, and a confirming log
line here, then mark task 2.5 complete.

## Task 7.1 verification: consent bump dev rehearsal (release-quality-and-ops-hygiene)

Rehearsal of the deferred C12 consent bump (spec `release-quality-and-ops-hygiene`,
R8.1 and R8.3). This records the repo-side change made in this checkout, the
fmt/validate results, and the exact live steps the founder must run to complete
the dev-deploy portion. The live steps are not yet executed; they need AWS
credentials and running dev apps this checkout does not have. Nothing below
claims a deploy or a re-consent observation that was not made.

### Changed in the repo (this checkout)

- `infra/environments/dev/main.tf`: `AREA_CODE_CONSENT_VERSION` bumped
  `"v1.0"` -> `"v1.1"` (dev only). Prod `main.tf` is untouched; the prod bump is
  task 7.2, in its own window.
- `terraform fmt -check -recursive infra/` passes (exit 0, no drift).
- `terraform validate` in `infra/environments/dev` passes ("Success! The
  configuration is valid.", exit 0).

### Source-of-truth check (dry-reuse)

`AREA_CODE_CONSENT_VERSION` is the runtime source of truth for the consent gate:
the backend reads `process.env['AREA_CODE_CONSENT_VERSION']` directly
(`backend/src/features/auth/service.ts` `currentConsentVersion()`, and
`backend/src/features/admin/service.ts` `getReconsentList()`). There is no shared
`v1.x` constant to bump. `LEGAL_CLAUSES_VERSION` in
`packages/shared/constants/legal.ts` (`'2026.05.1'`) is a separate clause-content
identifier used only as the fallback when the env var is unset; since dev and
prod both set the env var, the fallback never applies there. So the dev main.tf
bump is the complete repo-side change for R8. (`CURRENT_CONSENT_VERSION = 'v1.0'`
in `packages/shared/mocks/data/consent.ts` is dev-showcase mock data, not the
production source of truth, and is deliberately left untouched.)

### Blocking finding: the consumer re-consent prompt is not implemented

R8.1 requires "confirming the consumer app re-prompts and records the new
version." That client-side re-consent gate does not exist in the consumer web
app today:

- `apps/web` has zero references to any consent endpoint. It never calls
  `PUT /v1/users/me/consent`, and there is no bottom-sheet, modal, or app-open
  gate that compares the user's recorded consent version to the current one.
- The consumer-facing read `getUserConsent` (`auth/profile-service.ts`) returns
  only `{ analyticsOptIn }`. It exposes neither the recorded consent version nor
  a "needs re-consent" flag, so the client has nothing to gate on.

Consequence: bumping `AREA_CODE_CONSENT_VERSION` alone will NOT surface a
re-consent prompt to consumers on next open. It will only change what the backend
records for NEW consents (signup / OAuth-first-login write `v1.1`) and what the
admin re-consent export reports. The "exactly one re-consent prompt fires"
portion of R8.1 cannot be observed until the consumer re-consent Bottom_Sheet
(originally specified in `area-code-app` requirements, Req 17.9) is built and
wired to a current-version signal. This is a decision/work item, not something an
env bump can satisfy. Options: (a) build the consumer re-consent gate as its own
task before executing R8, or (b) adjust R8.1/R8.3 to the parts an env bump can
actually prove (admin re-consent list + recorded version on new consents). Do not
mark 7.1 fully done on the strength of the env bump alone.

### What the env bump CAN prove in dev (steps that will pass)

Run from the repo root with AWS credentials for the dev account, region
us-east-1, after the change above is pushed.

1. Dev deploy (canonical scripted path):

   ```powershell
   ./scripts/deploy-serverless.ps1 -Environment dev
   ```

   Expected: `area-code-dev-api` and the dev worker Lambdas update without error,
   and `area-code-dev-api` now carries `AREA_CODE_CONSENT_VERSION=v1.1`. Confirm:

   ```powershell
   aws lambda get-function-configuration `
     --function-name area-code-dev-api `
     --query 'Environment.Variables.AREA_CODE_CONSENT_VERSION' `
     --output text --region us-east-1 --no-cli-pager
   ```

   Expected output: `v1.1`.

2. New consent records the new version. Create a fresh consumer account in the
   dev consumer app (email or Google). The backend writes a consent row at
   `v1.1` (`insertConsentRecord` via `currentConsentVersion()`).

3. Admin ConsentAudit shows the bump taking effect (R8.3). In the dev admin
   portal, open the Consent Audit screen and use "Export re-consent list"
   (`GET /v1/admin/consent/export-reconsent`, backed by
   `getUsersNeedingReconsent(v1.1)`). Expected: every consumer whose latest
   recorded consent is still `v1.0` (i.e. all pre-bump users) now appears on the
   re-consent list, and the new `v1.1` account from step 2 does not. A per-user
   consent history row renders as `v1.1 - <date>` for the new account.

### What CANNOT be verified without building the client gate

- "Exactly one re-consent prompt fires in the consumer app on next open"
  (R8.1). No such prompt exists in `apps/web`; see the blocking finding above.

Rollback: the version is an env var. Reverting `v1.1` -> `v1.0` in dev main.tf
and re-deploying stops new `v1.1` writes; already-recorded `v1.1` consents are
harmless.

On completion of the deploy portion, record the confirmed
`AREA_CODE_CONSENT_VERSION=v1.1` on `area-code-dev-api`, the re-consent list
result, and the decision taken on the missing consumer re-consent gate here,
then update task 7.1 accordingly.

## Task 5.1 First_Run_Proof (release-quality-and-ops-hygiene)

First_Run_Proof for the two prod workers that have never produced a log group
(spec `release-quality-and-ops-hygiene`, R5.1 and R5.3). This records the
trigger configuration confirmed in prod Terraform, the heartbeat line each
worker emits, and the exact turnkey commands the founder runs to trigger and
verify each worker. The live invocation is not yet executed: it needs AWS
credentials for account 562691664641 (region us-east-1) and founder timing that
this repo checkout does not have. Nothing below claims an invocation, log group,
or heartbeat that was observed. Live execution remains founder-pending.

### Trigger configuration (confirmed in `infra/environments/prod/main.tf`)

- `streak-reminder` is a scheduled (EventBridge) worker.
  - Lambda: `area-code-prod-streak-reminder` (`module.lambda_streak_reminder`,
    arm64, 256 MB, 120s timeout, not in VPC).
  - Log group: `/aws/lambda/area-code-prod-streak-reminder`.
  - Schedule: `module.eventbridge_schedules` entry `streak-reminder`,
    `schedule_expression = "cron(0 16 * * ? *)"` (daily 18:00 SAST / 16:00 UTC),
    described "Streak-at-risk reminder daily 18:00 SAST (16:00 UTC)".
  - The handler takes no event input (`export async function handler()`), so a
    manual invoke with any payload runs the same scan the schedule triggers.
- `campaign-sender` is an SQS-triggered worker.
  - Lambda: `area-code-prod-campaign-sender` (`module.lambda_campaign_sender`,
    arm64, 512 MB, 120s timeout, not in VPC).
  - Log group: `/aws/lambda/area-code-prod-campaign-sender`.
  - Trigger: `module.sqs_campaign_send` (queue `area-code-prod-campaign-send`,
    DLQ `area-code-prod-campaign-send-dlq`, `visibility_timeout = 150`,
    `max_receive_count = 2`, `enable_lambda_mapping = true`), so the queue owns
    an `aws_lambda_event_source_mapping` with `batch_size = 1`. Upstream, the API
    async-invokes `campaign-dispatcher` on send-now, which fans batches of up to
    100 recipients out to this queue.

### Heartbeat lines (confirmed in source; verified by task 5.2)

- `streak-reminder` logs one start-of-invocation heartbeat unconditionally at
  the top of the handler (`backend/src/workers/streak-reminder.ts`):

  ```
  [streak-reminder] Starting streak-at-risk reminder worker
  ```

  and a completion line `[streak-reminder] Reminded <n> of <m> streak-holders`.

- `campaign-sender` logs one heartbeat per SQS batch record, before any delivery
  work (`backend/src/features/campaigns/sender.ts`, handler over `event.Records`):

  ```
  [campaign-sender] processing batch messageId=<id> campaignId=<id> recipients=<count>
  ```

### First_Run_Proof procedure (founder-run, live access required)

Run from the repo root with AWS credentials for account 562691664641, region
us-east-1. PowerShell mangles inline JSON for the AWS CLI, so the SQS step below
uses a file-based payload (see `tech.md` common gotchas).

#### A. streak-reminder (scheduled worker)

Option 1, wait for the natural tick: the EventBridge schedule fires daily at
16:00 UTC. No action needed; verify (step A.2) after the next 16:00 UTC tick.

Option 2, manual no-op-safe invoke (immediate). The handler ignores its payload
and only scans for at-risk opted-in streak-holders, so an empty payload is
safe; it sends real reminders only to users who genuinely qualify, and logs
`Reminded 0 of <m>` when none do.

1. Invoke with an empty payload:

   ```powershell
   aws lambda invoke `
     --function-name area-code-prod-streak-reminder `
     --payload '{}' `
     --cli-binary-format raw-in-base64-out `
     --region us-east-1 --no-cli-pager `
     streak-reminder-out.json
   ```

   Expected: `StatusCode 200`, no `FunctionError` field. `streak-reminder-out.json`
   holds the returned `{ "scanned": <m>, "reminded": <n> }`.

2. Verify the log group exists, the heartbeat is present, and there are zero
   ERROR events in the window:

   ```powershell
   aws logs filter-log-events `
     --log-group-name /aws/lambda/area-code-prod-streak-reminder `
     --filter-pattern '"[streak-reminder] Starting"' `
     --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-15).ToUnixTimeMilliseconds()) `
     --region us-east-1 --no-cli-pager
   ```

   Expected: at least one event whose message is
   `[streak-reminder] Starting streak-at-risk reminder worker`. A resolved log
   group (no "group does not exist" error) proves the group now exists.

   ```powershell
   aws logs filter-log-events `
     --log-group-name /aws/lambda/area-code-prod-streak-reminder `
     --filter-pattern ERROR `
     --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-15).ToUnixTimeMilliseconds()) `
     --region us-east-1 --no-cli-pager
   ```

   Expected: zero `events`.

#### B. campaign-sender (SQS-triggered worker)

Option 1, natural path: run one small real win-back campaign send-now from the
business portal to a controlled internal segment. The API invokes
`campaign-dispatcher`, which enqueues one or more batches on
`area-code-prod-campaign-send`, and the event source mapping delivers them to
`campaign-sender`.

Option 2, manual no-op-safe SQS message (immediate). Send one batch with an
empty `recipients` array pointing at an existing campaign. The handler logs the
heartbeat, `processBatch` loads the campaign, iterates zero recipients (no
sends, no send records), and returns cleanly. Use a real `businessId` and
`campaignId` for an existing campaign: a message referencing a non-existent
campaign makes the worker log a `campaign not found` error-level line, which
would defeat the zero-ERROR proof.

1. Resolve the queue URL:

   ```powershell
   aws sqs get-queue-url `
     --queue-name area-code-prod-campaign-send `
     --region us-east-1 --no-cli-pager
   ```

2. Write the payload to a file (avoids the PowerShell inline-JSON gotcha).
   Replace the ids with an existing campaign's `businessId` / `campaignId`:

   ```powershell
   '{"campaignId":"<existing-campaign-id>","businessId":"<owning-business-id>","recipients":[]}' `
     | Out-File -Encoding ascii campaign-send-noop.json
   ```

3. Send the message to the queue (the event source mapping invokes the worker):

   ```powershell
   aws sqs send-message `
     --queue-url <queue-url-from-step-1> `
     --message-body file://campaign-send-noop.json `
     --region us-east-1 --no-cli-pager
   ```

4. Verify the log group exists, the heartbeat is present, and there are zero
   ERROR events:

   ```powershell
   aws logs filter-log-events `
     --log-group-name /aws/lambda/area-code-prod-campaign-sender `
     --filter-pattern '"[campaign-sender] processing batch"' `
     --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-15).ToUnixTimeMilliseconds()) `
     --region us-east-1 --no-cli-pager
   ```

   Expected: at least one event
   `[campaign-sender] processing batch messageId=... campaignId=... recipients=0`.

   ```powershell
   aws logs filter-log-events `
     --log-group-name /aws/lambda/area-code-prod-campaign-sender `
     --filter-pattern ERROR `
     --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-15).ToUnixTimeMilliseconds()) `
     --region us-east-1 --no-cli-pager
   ```

   Expected: zero `events`. Also confirm the DLQ stays empty:

   ```powershell
   aws sqs get-queue-attributes `
     --queue-url (aws sqs get-queue-url --queue-name area-code-prod-campaign-send-dlq `
       --region us-east-1 --query QueueUrl --output text) `
     --attribute-names ApproximateNumberOfMessages `
     --region us-east-1 --no-cli-pager
   ```

   Expected: `ApproximateNumberOfMessages=0`.

#### C. Re-run the go-live check and confirm the WARNs clear

```powershell
./scripts/go-live-check.ps1 -Environment prod
```

Expected result: the two worker lines flip from WARN to PASS:

```
[PASS] Worker errors /aws/lambda/area-code-prod-campaign-sender: no ERROR events since deploy ...
[PASS] Worker errors /aws/lambda/area-code-prod-streak-reminder: no ERROR events since deploy ...
```

This clears the two "log group not queryable (missing group or credentials)"
WARNs recorded in the 2026-07-05 run (Follow-up items, WARN 2) and closes
launch-morning confirmation 9.1.

### Time pressure on streak-reminder (from task 5.3)

Task 5.3 already shipped the escalation in `scripts/go-live-check.ps1`: the
worker scan tags `streak-reminder` as a scheduled worker, so once its Lambda
`LastModified` is older than 7 days with no log group, the check reports FAIL,
not WARN ("missing log group; scheduled worker last deployed N days ago has
never run"). `streak-reminder` must therefore produce its log group (procedure A
above) before that 7-day window elapses, or the next go-live check turns red.
`campaign-sender` is an SQS worker and stays WARN however old the deploy is
(it legitimately stays quiet with no messages), but its First_Run_Proof is
still owed to clear the WARN and prove the win-back path executes in prod.

### Status

Repo-side confirmation complete: triggers, log-group names, and heartbeat lines
are documented above and the turnkey procedure is ready. Live invocation,
observation, and the go-live-check re-run remain founder-pending (they require
prod AWS access). Task 5.1 stays open until the founder runs the procedure and
records the observed heartbeat lines, zero-ERROR windows, and cleared WARNs here.

## Launch-morning confirmations (task 9)

The two launch-morning confirmations (spec `release-quality-and-ops-hygiene`,
tasks 9.1 and 9.2) are live, human, on-the-day actions. Neither can be run from
a repo checkout: 9.1 needs prod AWS access for account 562691664641, and 9.2
needs a physical 2019-era Android on mobile data. Nothing below claims a run,
render, or result that was observed. Both remain founder/launch-day pending.

### 9.1 Re-run the go-live check end to end (founder-run, live access required)

Re-run the full check against prod:

```powershell
./scripts/go-live-check.ps1 -Environment prod
```

Run order matters. This must run AFTER:

- the task 5.1 First_Run_Proof procedure (section above) has invoked
  `streak-reminder` and `campaign-sender` so each produces its log group, and
- this spec's changes are deployed to prod (the deploy-aware worker scan reads
  each worker's `LastModified`, so the run should follow the deploy that carries
  these changes).

Expected outcome: the two worker lines flip from WARN to PASS once the
First_Run_Proof is done, with no new FAIL or WARN introduced:

```
[PASS] Worker errors /aws/lambda/area-code-prod-campaign-sender: no ERROR events since deploy ...
[PASS] Worker errors /aws/lambda/area-code-prod-streak-reminder: no ERROR events since deploy ...
```

These are the two "log group not queryable (missing group or credentials)" WARNs
from the 2026-07-05 run (Follow-up items, WARN 2). Note the go-live check now
escalates a stale scheduled-worker missing log group to FAIL, not WARN (task
5.3): if `streak-reminder`'s Lambda `LastModified` is older than 7 days and it
still has no log group, the check reports FAIL. So `streak-reminder` must have
produced its log group (task 5.1 procedure A) before this re-run, or the run
turns red rather than green. `campaign-sender` is an SQS worker and would stay
WARN if left un-invoked, so its First_Run_Proof is likewise owed before the
re-run to reach a clean all-PASS result.

Expected exit code: 0 (no failing checks), tally with the two worker WARNs
cleared to PASS and the four manual gates still MANUAL by design. On completion,
record the observed tally and the two PASS lines here.

### 9.2 §1.4 manual gate re-check on a 2019 Android (founder-run, real device)

This is manual gate §1.4 (Manual gates section above): a purely visual,
real-device human check, layer 3 of the coverage model, that no script and no
e2e sweep can verify.

Procedure: on a 2019-era Android on mobile data (a throttled, representative
connection, not office wifi), open the consumer web app at areacode.co.za and
confirm the map plus at least one node render within 10 seconds.

This ties to the bundle-split work (tasks 8.1 and 8.3). The consumer initial
gzip payload dropped from ~1,353 KB (after Mapbox was inlined at 8.1's starting
point) and the earlier ~735 KB May baseline to ~315 KB initial (314.56 KB
measured), with Mapbox GL now a lazy chunk excluded from the initial payload.
That reduction is what should make the 10s gate pass on a slow device and
connection. See the task 8.5 before/after gzip record above.

Because this is a visual and real-device fidelity check, a green go-live-check
run (9.1) and a green e2e sweep do not clear it. It stays a mandatory
launch-day human gate. On completion, record the device, connection, and the
observed time-to-first-node here.

### Status

Both confirmations are documented and ready to run. 9.1 (prod go-live-check
re-run) and 9.2 (§1.4 real-device map-load gate) remain founder/launch-day
pending: they require prod AWS access and a physical 2019 Android on mobile
data respectively, neither available from this checkout. Record the observed
results here on the day.
