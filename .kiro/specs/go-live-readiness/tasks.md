# Implementation Plan: Go-Live Readiness Verification

## Overview

Builds the one-command launch verification (`scripts/go-live-check.ps1`),
wires it into the pilot checklist, and surfaces the deployed-build parity
question (is the carousel-confinement fix `c047c94` actually live?). All
checks are read-only; nothing in this spec mutates AWS or data.

## Tasks

- [x] 1. Create `scripts/go-live-check.ps1` skeleton
  - `-Environment` parameter (default `prod`), TLS 1.2 setup, `$failures`
    counter, `Write-Check` helper printing `[PASS]/[FAIL]/[WARN]/[MANUAL]`
    lines, final exit code 1 when any FAIL. Follow the conventions of
    `scripts/assert-serverless-only.ps1` (PowerShell 5.1, no `&&`, no
    ternary, `--output json` + `ConvertFrom-Json` for AWS CLI)
  - _Requirements: 1.1, 1.4, 1.5_

- [x] 2. HTTP checks (checklist §2 items 1-2, §3)
  - [x] 2.1 API health: GET `https://api.areacode.co.za/health`, assert
        `status -eq 'ok'` and `env -eq 'prod'`
  - [x] 2.2 Nodes: GET `/v1/nodes/johannesburg`, FAIL under 5 nodes, WARN at
        exactly 5; per node assert `isActive` and lat in [-26.5, -25.9], lng
        in [27.7, 28.4]
  - [x] 2.3 Portals: HEAD the four `*.areacode.co.za` URLs, assert 200;
        GET `http://areacode.co.za` without following redirects, assert 30x
        with an https Location
  - _Requirements: 1.1_

- [x] 3. AWS state checks (read-only, us-east-1)
  - [x] 3.1 DLQ depth: `aws sqs get-queue-attributes` on
        `area-code-prod-reward-eval-dlq`, `-push-sender-dlq`,
        `-campaign-send-dlq`, `-report-generation-dlq`; assert
        `ApproximateNumberOfMessages` is 0 on each
  - [x] 3.2 API errors: `aws logs filter-log-events` on
        `/aws/lambda/area-code-prod-api`, last 24h, pattern `ERROR`,
        `--max-items 5`; FAIL when any event returned (print the first)
  - [x] 3.3 Build parity: `aws amplify list-apps` then `list-jobs` for each
        app's production branch; assert latest job `SUCCEED`; assert its
        `commitId` is `c047c94` or a descendant via
        `git merge-base --is-ancestor`; WARN when the SHA is not in the
        local clone. FAIL output must name the fix path (re-run
        `./scripts/update-all-amplify-apps.ps1` or redeploy from console)
  - [x] 3.4 Cognito consumer pool: `describe-user-pool` (password min length >= 8, MFA off) and `list-identity-providers` (Google present). Pool
        id resolved from the prod Terraform outputs or an env var, not
        hardcoded
  - _Requirements: 1.2, 1.3, 2.1, 2.2_

- [x] 4. Seed-data readiness report
  - Per Johannesburg node print name, isActive, has-coords, live reward
    count, has-First-Get (via the existing per-node rewards read). FAIL when
    no venue in the city has a First-Get reward; WARN when any venue has
    zero live rewards
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Manual-gates footer
  - Always print the four §1 blockers (staff-phone QR scan, live signup,
    Yoco test payment, 2019-Android map load) as `[MANUAL]` lines so a green
    run is never read as launch approval
  - _Requirements: 4.1, 4.2_

- [x] 6. Wire into the checklist
  - Add one line at the top of §2 and §3 of `docs/PILOT_LAUNCH_CHECKLIST.md`
    pointing at `scripts/go-live-check.ps1 -Environment prod`; keep the item
    lists as the manual fallback (no duplicated logic)
  - _Requirements: 1.5_

- [x] 7. Run it and record the result
  - Execute `scripts/go-live-check.ps1 -Environment prod` once, paste the
    full output into a new `docs/GO_LIVE_CHECK_RESULT.md` with the date, and
    list every FAIL/WARN as a follow-up item. Do not fix data issues
    (seeding, venue content) in this spec; report them
  - _Requirements: 1.4, 2.1, 3.1_

- [x] 8. Overlay-leak e2e regression tests
     (`tests/e2e/tests/consumer/overlay-confinement.spec.ts`)
  - [x] 8.1 Tab confinement: open the map tab and wait for
        `[data-peek-carousel]` (reuse `consumer.peekCarousel` from
        `support/selectors.ts`; skip like `map-discovery.spec.ts` when no
        nodes are seeded). Switch to Feed, Ranks, and Profile via the bottom
        nav and assert the carousel is NOT visible on each; switch back to
        Map and assert it is visible again. This pins the fix for the
        carousel-over-Feed leak (`c047c94`)
  - [x] 8.2 Portaled-sheet confinement: on each non-map tab assert none of
        the map-owned portaled sheets (search, sign-in, QR scanner; add
        selectors to `support/selectors.ts` if missing) are visible
  - [x] 8.3 Non-modal Browse contract: on the map tab with the strip open,
        assert the sheet portal wrapper computes `pointer-events: none` and
        no backdrop sibling exists; tap "View details" and assert Commit_Mode
        renders a backdrop and `aria-modal="true"` (pins the
        `BottomSheet modal` split from map-camera-gesture-feel R10)
  - [x] 8.4 Add "run the consumer e2e project
        (`cd tests/e2e && pnpm test -- --project=consumer`)" as a pre-launch
        line in checklist §3
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 9. Backend end-to-end sweep (extend `scripts/go-live-check.ps1`)
  - Add read-only checks for the backend surface not covered by §2/§3 so the
    script is the single source of "backend + deployment truth". Same
    `[PASS]/[FAIL]/[WARN]` contract, us-east-1, no mutations.
  - [x] 9.1 WebSocket reachability: open a read-only handshake to the prod
        WebSocket API Gateway URL (resolve from Terraform outputs or an env
        var, not hardcoded); assert the connection upgrades (101/open) then
        close immediately. WARN (not FAIL) if the URL is unresolved locally
  - [x] 9.2 All four Cognito pools: generalise the 3.4 check to run against
        consumer, business, staff, and admin pools (password min length >= 8,
        MFA off, Google IdP present where expected). Reuse one helper over the
        pool-id list; do not copy the block four times (DRY)
  - [x] 9.3 Worker error scan: run the 3.2 `filter-log-events` ERROR scan
        across the worker log groups (reward-evaluator, push-sender,
        campaign-send, report-generation, presence-expiry, pulse-decay), not
        just `-api`. FAIL when any group returns an ERROR event in the last
        24h; print the group and first event
  - _Requirements: 1.2, 1.3_

- [x] 10. Full-portal structural sweep (extend the existing e2e specs)
  - Factor one shared structural-integrity helper in `tests/e2e/support/`
    (no horizontal scroll, primary CTA reachable, no portaled overlay leaking
    across a route/tab change, axe criticals clean) and apply it to the
    authenticated shell of all four portals by extending the existing
    `business/`, `staff/`, `admin/`, and `consumer/` specs. Reuse
    `selectors.ts`; skip gracefully when a portal fixture is not seeded. Do
    not create parallel spec files where an existing one covers the portal
    (DRY, one home per concept)
  - _Requirements: 5.1, 5.2, 5.4_

- [x] 11. Document the three-layer coverage model and the visual manual gate
  - In `docs/GO_LIVE_CHECK_RESULT.md` and `docs/PILOT_LAUNCH_CHECKLIST.md`,
    state explicitly that the two automated layers, the go-live script
    (backend + deployment truth) and the e2e sweep (UI structure), catch
    structural leaks only: wrong surface visible, wrong tab, blocked
    interaction. They do NOT catch purely visual defects (misaligned glass,
    wrong colors, janky motion). The checklist §1 real-device pass therefore
    stays a mandatory human visual gate. Name all three layers so a green
    script + green e2e run is never read as launch approval on its own
  - _Requirements: 4.1, 4.2_

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "8.1", "8.2", "8.3"],
      "description": "Script skeleton and consumer overlay-leak e2e (no prerequisites)"
    },
    {
      "wave": 2,
      "tasks": ["2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "3.4", "4", "5", "9.1", "9.2", "9.3", "8.4", "10"],
      "description": "HTTP/AWS/backend checks build on the skeleton; e2e sweep and checklist line build on the consumer overlay tests"
    },
    {
      "wave": 3,
      "tasks": ["6"],
      "description": "Wire the completed checks into the checklist"
    },
    {
      "wave": 4,
      "tasks": ["7"],
      "description": "Run the script and record the result"
    },
    {
      "wave": 5,
      "tasks": ["11"],
      "description": "Document the three-layer coverage model and visual manual gate"
    }
  ]
}
```

## Notes

- All checks are read-only. Nothing in this spec mutates AWS state or data;
  it observes and reports.
- Three coverage layers, kept distinct on purpose:
  1. `scripts/go-live-check.ps1` — backend and deployment truth (health,
     nodes, portals, DLQs, logs, build parity, Cognito, WebSocket, workers).
  2. `tests/e2e` sweep — UI structure across all four portals (no leaks, CTA
     reachable, no horizontal scroll, axe criticals).
  3. Checklist §1 real-device pass — human eyes on a real phone for purely
     visual fidelity (alignment, color, motion) the first two layers cannot
     see. This stays manual and mandatory.
- Reuse over duplication: extend `go-live-check.ps1` and the existing e2e
  specs/selectors rather than forking parallel scripts or spec files.
