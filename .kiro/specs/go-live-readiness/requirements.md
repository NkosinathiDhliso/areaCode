# Requirements: Go-Live Readiness Verification

## Introduction

Pre-launch state as verified on 2026-07-03:

- Code health: `pnpm typecheck` clean, `pnpm test` 1215/1215 passing across
  140 files, `pnpm guard:serverless` passing. All map camera/gesture fixes
  are committed and pushed (origin/master `c047c94`, pushed 09:49 SAST).
- Prod backend exists and is wired in us-east-1: 23 `area-code-prod-*`
  Lambdas (api, websocket, workers, auth triggers, yoco-webhook), all prod
  DynamoDB tables, HTTP + WebSocket API Gateways, SQS queues with DLQs.
- Live checks: `GET https://api.areacode.co.za/health` returns
  `{"status":"ok","env":"prod"}`; `/v1/nodes/johannesburg` returns exactly 5
  nodes (checklist minimum, no margin); all four portals return HTTP 200.

Not yet verified: whether the deployed Amplify build includes `c047c94` (a
screenshot from 08:45 SAST shows the pre-fix build with the carousel bleeding
onto the Feed tab), DLQ depths, API error logs, Cognito pool configuration,
seed-data integrity, and the four manual launch-day blockers in
`docs/PILOT_LAUNCH_CHECKLIST.md` §1.

This spec turns the automatable parts of the launch checklist into one
repeatable script so "are we ready?" becomes a command, not a guess. Manual
device/venue checks stay manual and are listed as such.

#[[docs/PILOT_LAUNCH_CHECKLIST.md]] #[[rules/serverless-only.md]]

---

## Requirement 1: One-command launch verification script

A single script SHALL run every automatable check from checklist §2 and §3
and exit non-zero with a clear per-check PASS/FAIL report.

### Acceptance Criteria

1.1. `scripts/go-live-check.ps1 -Environment prod` SHALL check, read-only:
API health returns `status ok` and `env prod`; `/v1/nodes/johannesburg`
returns >= 5 nodes, each with `isActive: true` and lat/lng inside a
Johannesburg bounding box; all four portal URLs return HTTP 200 over HTTPS;
`http://areacode.co.za` redirects 30x to HTTPS.

1.2. The script SHALL check AWS state read-only (AWS CLI, us-east-1):
`ApproximateNumberOfMessages` is 0 on all four `area-code-prod-*-dlq`
queues; the last 24h of `/aws/lambda/area-code-prod-api` logs contain no
ERROR-level events; the latest Amplify job per app on the production branch
is `SUCCEED` and its commit is `c047c94` or a descendant.

1.3. The script SHALL check the Cognito consumer pool: password policy
minimum length >= 8, MFA not required, Google identity provider configured.

1.4. Every check prints PASS or FAIL with the observed value; any FAIL makes
the exit code non-zero. No check mutates anything.

1.5. The script SHALL live in `scripts/` beside the deploy scripts and be
referenced from checklist §2/§3 so the checklist and the script cannot
drift (one home per concept).

## Requirement 2: Deployed build parity

2.1. The verification SHALL fail if any Amplify app's live build predates
`c047c94` (the carousel-confinement fix): the bug in the 08:45 screenshot is
fixed in git but launch requires it live.

2.2. If the latest Amplify job failed or never triggered, the script output
SHALL say so explicitly (the fix path is a manual re-run of
`./scripts/update-all-amplify-apps.ps1` or a redeploy from the console).

## Requirement 3: Seed-data readiness signals

3.1. The script SHALL report, per Johannesburg node: name, `isActive`,
has-coordinates, live reward count, and whether any reward is flagged
First-Get, using existing public/admin read endpoints only.

3.2. Exactly-5 nodes SHALL be reported as a warning (minimum met, no
margin); fewer than 5 is a FAIL per checklist §2.

3.3. Zero venues with a First-Get reward SHALL be a FAIL (the
casual-customer path per `rules/product.md` depends on it).

## Requirement 4: Manual gates stay manual and visible

4.1. The script output SHALL end with the §1 launch-day blockers (QR scan on
a real staff phone, first live signup, Yoco webhook test payment, map load
on a 2019 Android) printed as UNVERIFIED manual gates, so a green script is
never misread as launch approval.

4.2. The spec SHALL NOT attempt to automate §1, §4, §5, §6, or §7; those are
founder/venue actions.

## Requirement 5: UI overlay-leak regression tests (Playwright)

The go-live script proves the fixed code is deployed; it cannot prove the UI
behaves. The carousel-over-Feed leak (screenshot, 2026-07-03 08:45: the
Peek_Carousel, flick arrows, and "View details" rendered on top of the Feed
tab) is a class of bug the e2e suite must catch: portaled surfaces rendering
outside the map tab.

### Acceptance Criteria

5.1. A consumer e2e test SHALL open the map tab (carousel auto-opens), switch
to Feed, Ranks, and Profile in turn, and assert `[data-peek-carousel]` is not
visible on any of them; switching back to Map SHALL show it again.

5.2. The same sweep SHALL assert no map-owned portaled surface (search sheet,
sign-in sheet, QR scanner sheet) is visible on non-map tabs.

5.3. A test SHALL assert the non-modal Browse strip does not block the map:
with the strip open on the map tab, the sheet's portal wrapper has
`pointer-events: none` (only the sheet panel is interactive) and no backdrop
element is rendered. In Commit_Mode the backdrop and `aria-modal` return.

5.4. These tests live in `tests/e2e/tests/consumer/` beside the existing
map-discovery spec and reuse `selectors.ts`; running the consumer e2e project
is added to checklist §3 as a pre-launch step.
