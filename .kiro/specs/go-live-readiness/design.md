# Design: Go-Live Readiness Verification

## Shape

One PowerShell script, `scripts/go-live-check.ps1`, mirroring the style of
the existing `scripts/assert-serverless-only.ps1` and
`scripts/deploy-serverless.ps1`: parameterised `-Environment` (prod default),
sequential named checks, coloured PASS/FAIL lines, `exit 1` if any check
failed. Read-only by construction: HTTP GETs and AWS CLI `list/get/describe`
calls only, never `put/update/delete/invoke`.

## Known-good reference state (verified 2026-07-03, us-east-1)

The script asserts against this shape rather than re-deriving it:

- Lambdas: `area-code-prod-api`, `area-code-prod-websocket`, workers
  (presence-expiry, pulse-decay, reward-evaluator, campaign-_, report-_,
  cleanup, partition-manager, leaderboard-reset, schedule-transition-tick,
  yoco-webhook) and the six Cognito auth triggers.
- DLQs: `area-code-prod-reward-eval-dlq`, `area-code-prod-push-sender-dlq`,
  `area-code-prod-campaign-send-dlq`, `area-code-prod-report-generation-dlq`.
- Endpoints: `https://api.areacode.co.za` (HTTP API),
  four Amplify portals (consumer, business, staff, admin).

## Checks and their commands

| Check             | How                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| API health        | `Invoke-RestMethod https://api.areacode.co.za/health`, assert `status -eq 'ok'` and `env -eq 'prod'`     |
| Nodes seeded      | `Invoke-RestMethod .../v1/nodes/johannesburg`, assert count >= 5, each isActive + lat/lng in JHB box     |
| Portals up        | `Invoke-WebRequest -Method Head` on the four URLs, assert 200; plain-HTTP URL asserts 30x Location https |
| DLQs empty        | `aws sqs get-queue-attributes --attribute-names ApproximateNumberOfMessages`, assert 0                   |
| API errors 24h    | `aws logs filter-log-events --log-group-name /aws/lambda/area-code-prod-api --filter-pattern ERROR`      |
| Build parity      | `aws amplify list-apps` + `list-jobs` (production branch), assert latest job SUCCEED, commit >= c047c94  |
| Cognito consumer  | `aws cognito-idp describe-user-pool` + `list-identity-providers`, assert policy + Google IdP             |
| First-Get present | From the nodes payload + per-node rewards read, assert >= 1 reward flagged First-Get across the city     |

Johannesburg bounding box: lat -26.5 to -25.9, lng 27.7 to 28.4 (generous,
catches swapped/zeroed coordinates, not survey-grade).

### Backend end-to-end sweep (worker error scan window)

The backend sweep adds a WebSocket handshake, all four Cognito pools, and an
ERROR scan across the worker log groups. The worker scan does not use a blind
24h window: it scans from the later of (24h ago) and the worker's last deploy
time (`aws lambda get-function-configuration` LastModified). A worker fixed and
redeployed emits its last pre-fix ERROR before the deploy, so a fixed 24h window
reports a false FAIL for up to a day against code that no longer runs. Scoping to
"since deploy" makes a verified fix read PASS immediately and honestly. When the
deploy time cannot be read (no permission, missing function, unparseable
timestamp), the scan keeps the full 24h window rather than narrowing on an
unproven assumption. The spec-pinned API error scan (Req 1.2) stays at a fixed
24h: it is the always-on request path, where a full day of real-traffic errors
is the intended signal.

Commit-ancestry for build parity: compare the Amplify job `commitId` with
`git merge-base --is-ancestor c047c94 <commitId>` when the commit exists
locally; if unknown, report the SHA and mark the check WARN, not PASS.

## PowerShell 5.1 constraints (binding for the implementer)

No `&&`/`||`, no ternary. Set
`[Net.ServicePointManager]::SecurityProtocol = Tls12` before any HTTPS call.
AWS CLI output parsed via `--output json` + `ConvertFrom-Json` (returns
PSCustomObject). Do not redirect native stderr with `2>&1`.

## Output contract

Each check: `[PASS] name: observed` or `[FAIL] name: observed (expected ...)`
or `[WARN]`. Footer always prints the four §1 manual gates as
`[MANUAL] not verifiable by script`. Exit code: 1 if any FAIL, else 0
(WARNs do not fail the run).

## Checklist integration

`docs/PILOT_LAUNCH_CHECKLIST.md` §2 and §3 get one added line at the top:
run `scripts/go-live-check.ps1 -Environment prod` to execute every scripted
item; the per-item list stays for manual fallback. No duplicated logic.
