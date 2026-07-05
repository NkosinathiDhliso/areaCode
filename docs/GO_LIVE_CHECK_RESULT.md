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

- Date: 2026-07-03 13:29 SAST
- Command: `./scripts/go-live-check.ps1 -Environment prod`
- Region: us-east-1
- Exit code: 1 (three failing checks)
- Tally: 31 PASS, 3 FAIL, 3 WARN, 4 MANUAL

This run reflects the current script, including the Task 9 backend sweep
(WebSocket reachability, all four Cognito pools, worker error scan). The earlier
recording predated that sweep.

## Full output

```
==========================================
  Area Code - Go-Live Readiness Check
  Environment: prod
  Region: us-east-1
==========================================

HTTP checks
[PASS] API health: status=ok, env=prod
[WARN] Nodes count: 5 nodes (minimum met, no margin)
[PASS] Nodes active + in JHB box: all 5 node(s) active with coords in JHB box
[PASS] Portal https://areacode.co.za: HTTP 200
[PASS] Portal https://business.areacode.co.za: HTTP 200
[PASS] Portal https://staff.areacode.co.za: HTTP 200
[PASS] Portal https://admin.areacode.co.za: HTTP 200
[PASS] HTTP->HTTPS redirect: HTTP 301 -> https://areacode.co.za/

AWS state checks
[FAIL] DLQ area-code-prod-reward-eval-dlq: ApproximateNumberOfMessages=8 (expected 0)
[PASS] DLQ area-code-prod-push-sender-dlq: ApproximateNumberOfMessages=0
[PASS] DLQ area-code-prod-campaign-send-dlq: ApproximateNumberOfMessages=0
[PASS] DLQ area-code-prod-report-generation-dlq: ApproximateNumberOfMessages=0
[PASS] API error logs 24h: no ERROR events in last 24h
[PASS] Amplify area-code-staff (master): SUCCEED at c047c94 (includes c047c94)
[PASS] Amplify area-code-admin (master): SUCCEED at c047c94 (includes c047c94)
[PASS] Amplify area-code-web (master): SUCCEED at c047c94 (includes c047c94)
[PASS] Amplify area-code-business (master): SUCCEED at c047c94 (includes c047c94)

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
[FAIL] Worker errors /aws/lambda/area-code-prod-reward-evaluator: 3 ERROR event(s) in last 24h; first: 2026-07-03T05:21:16.946Z	0350d63c-c483-55a5-a43e-b4fd8c7a9c8f	ERROR	Invoke Error 	{"errorType":"Error","errorMessage":"[config] Required environment variable REWARDS_TABLE is not set","stack":["Error:...
[PASS] Worker errors /aws/lambda/area-code-prod-presence-expiry: no ERROR events in last 24h
[FAIL] Worker errors /aws/lambda/area-code-prod-pulse-decay: 5 ERROR event(s) in last 24h; first: 2026-07-02T11:28:55.208Z	ffc69e2d-6b58-4ea8-a8ac-8bad8693ccf4	ERROR	Invoke Error 	{"errorType":"Error","errorMessage":"[config] Required environment variable APP_DATA_TABLE is not set","stack":["Error...
[WARN] Worker errors /aws/lambda/area-code-prod-campaign-sender: log group not queryable (missing group or credentials)
[PASS] Worker errors /aws/lambda/area-code-prod-report-generator: no ERROR events in last 24h

Seed-data readiness
  - Plato coffe | active (implied) | has-coords=yes | live rewards=0 | First-Get=no
  - Hi | active (implied) | has-coords=yes | live rewards=0 | First-Get=no
  - RuleRev | active (implied) | has-coords=yes | live rewards=0 | First-Get=no
  - Father Coffee | active (implied) | has-coords=yes | live rewards=2 | First-Get=yes
  - Furmished | active (implied) | has-coords=yes | live rewards=1 | First-Get=no
[PASS] First-Get present: at least one Johannesburg venue has a First-Get reward
[WARN] Venues with live rewards: 3 venue(s) with zero live rewards: Plato coffe; Hi; RuleRev

Manual gates (not verifiable by script)
[MANUAL] §1.1 First QR scan on a real staff phone: staff sees redemption preview, confirms, sees Redeemed
[MANUAL] §1.2 First live customer signup from the venue: Google OAuth or email; new user lands on the map
[MANUAL] §1.3 Yoco test payment upgrades venue to paid: test-card webhook flips the venue from trial to paid within 60s
[MANUAL] §1.4 Map loads on a 2019 Android on mobile data: shows the map and at least one node within 10s

==========================================
  Result: FAIL (3 failing check(s))
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

A re-run inside 24h of the fix still shows the two worker-error FAILs because
the check scans a trailing 24h log window; they age out on their own. The
seed-data WARNs (venue count, gets coverage, placeholder venue names) and the
four manual gates remain open.

## Follow-up items (every FAIL and WARN)

These are reported, not fixed. Fixing seed-data, DLQ, worker-config, and content
issues is out of scope for the go-live-readiness spec (it observes and reports
only).

### FAIL (blocks a green run, exit code 1)

1. `DLQ area-code-prod-reward-eval-dlq: ApproximateNumberOfMessages=8`. The
   reward-evaluator dead-letter queue holds 8 messages, so 8 reward-evaluation
   events failed all redrive attempts and landed in the DLQ. Action: inspect
   the DLQ messages and the `area-code-prod-reward-evaluator` worker logs to
   find the failure cause, resolve the root cause, then redrive or purge the
   queue. Re-run this check until the depth is 0. Owner: backend/ops.
2. `Worker errors /aws/lambda/area-code-prod-reward-evaluator: 3 ERROR events`.
   First event: `[config] Required environment variable REWARDS_TABLE is not
set`. The reward-evaluator worker is throwing at startup because a required
   table-name env var is missing, which is almost certainly the root cause of
   the reward-eval DLQ backlog above. Action: set `REWARDS_TABLE` on the
   `area-code-prod-reward-evaluator` Lambda via Terraform (table-name env vars
   must always be set in prod, see `no-fallbacks-no-legacy.md`), redeploy, then
   re-run. Owner: backend/ops.
3. `Worker errors /aws/lambda/area-code-prod-pulse-decay: 5 ERROR events`.
   First event: `[config] Required environment variable APP_DATA_TABLE is not
set`. The pulse-decay worker is throwing at startup because `APP_DATA_TABLE`
   is missing. Action: set `APP_DATA_TABLE` on the `area-code-prod-pulse-decay`
   Lambda via Terraform, redeploy, then re-run. Owner: backend/ops.

### WARN (does not fail the run, resolve before or track into launch)

1. `Nodes count: 5 nodes (minimum met, no margin)`. Johannesburg has exactly
   the checklist minimum of 5 nodes and no spare. Action: seed additional
   Johannesburg venues so a single deactivation does not drop the city below
   the minimum. Owner: content/seeding.
2. `Worker errors /aws/lambda/area-code-prod-campaign-sender: log group not
queryable`. The campaign-sender log group could not be read (missing group
   or credentials), so its 24h error state is unverified, not clean. Action:
   confirm the worker's log group name and that the run has CloudWatch Logs read
   permission for it, then re-run. Owner: backend/ops.
3. `Venues with live rewards: 3 venue(s) with zero live rewards: Plato coffe;
Hi; RuleRev`. Three of five venues have no live rewards, so the reward
   layer is thin at launch. Action: publish at least one live reward per venue
   (and review the placeholder-looking names "Hi" and "RuleRev"). Owner:
   content/seeding.

## Manual gates (verify on launch day)

The script prints these as `[MANUAL]` because it cannot verify them. They are
mandatory launch-day human checks; a green script run does not clear them. This
is layer 3 of the coverage model above: purely visual and real-device fidelity
that neither the script nor the e2e sweep can see.

1. §1.1 First QR scan on a real staff phone: staff sees redemption preview,
   confirms, and sees Redeemed.
2. §1.2 First live customer signup from the venue: Google OAuth or email; the
   new user lands on the map.
3. §1.3 Yoco test payment upgrades venue to paid: the test-card webhook flips
   the venue from trial to paid within 60s.
4. §1.4 Map loads on a 2019 Android on mobile data: shows the map and at least
   one node within 10s.
