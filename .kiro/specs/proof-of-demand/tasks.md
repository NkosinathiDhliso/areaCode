# Implementation Plan: Proof of Demand

## Overview

Four phases, in order, plus one that runs alongside. Phase 1 fixes the share
leak and builds the receipt; the receipt lands as one change (open row,
Away_Gate, `foundVia`, tests) so no dishonest check-in is ever written.
Phase 2 puts the receipt where the owner decides. Phase 3 builds Tonight on
the existing Music_Schedule and adds Going as intent, never presence.
Phase 4a (tasks 13 to 16) is the pre-UAT defect sweep, including the
phone photo upload failure; it has no dependency on the feature phases,
starts on day one, and must be complete before the UAT environment is cut.
Phase 4 ends at a scripted UAT with recorded ship gates. No new
infrastructure at any step.

Every task references its requirement. Property tests use fast-check, min
100 runs, block-statement predicates, tagged
`Feature: Proof of demand, Property N: <desc>`.

## Tasks

### Phase 0: decisions and constants

- [x] 0. Founder decisions and shared constants (R3.7, R8.9, R12)
  - [x] 0.1 Record decisions in `docs/decisions/proof-of-demand.md`
    - Attribution_Window (default 6h), `AWAY_GATE_MIN_MINUTES` (default 20),
      `GOING_PUBLIC_THRESHOLD` (default 3), reminder at slot start, Tonight
      scope business-wide, live-vibe flags provisioned or not, ship gates
      from R13.5; free-tier check-ins kept or gated, `CHECKIN_PROXIMITY_MODE`
      for UAT, demo-day rate limits, `BottomNav` safe-area
    - _Requirements: 3.7, 8.9, 9.2, 13.5, 15.9, 15.24_
  - [x] 0.2 Decide and, if yes, provision the live-vibe flags
    - `AREA_CODE_FLAG_LIVE_VIBE_ON_MAP`, `AREA_CODE_FLAG_LIVE_VIBE_DECLARATION`
      in the Terraform Lambda env; `VITE_FLAG_*` via
      `update-all-amplify-apps.ps1`; update `check-amplify-env-closure.mjs`
      allowlist and `rules/tech.md`
    - _Requirements: 8.9, 12.4, 12.5_
  - [x] 0.3 `packages/shared/constants/attribution.ts`
    - `ATTRIBUTION_WINDOW_HOURS`, `AWAY_GATE_MIN_MINUTES`,
      `AWAY_DISTANCE_METRES`, `GOING_PUBLIC_THRESHOLD`,
      `RECEIPT_MEASURED_FROM_ISO`, `OPEN_SOURCES`, `FOUND_VIA`, types
    - _Requirements: 2.2, 3.7_
  - [x] 0.4 Guard against waking dormant paths
    - Grep-based test or checklist in the decisions doc: phone-OTP gate,
      `VITE_SOCKET_URL`, retired `/gets` redirect and `DEV_MODE` fixtures are
      untouched by this spec; live-vibe flags only via 0.2
    - _Requirements: 13.7_

### Phase 1: fix the leak, build the proof

- [x] 1. Venue share link (R1, R12.2, R12.3)
  - [x] 1.1 `buildShareSnapshot` pure function in
        `backend/src/features/nodes/share-snapshot.ts`
    - Pulse state label, live count when > 0, Tonight headline when present,
      active get count; zero presence reads quiet or first in; venue name
      always present; under 200 chars
    - _Requirements: 1.2, 1.3_
  - [x] 1.2 Write property test for the share snapshot
    - Property 4: never busy at zero presence, name present, length bound
    - _Requirements: 1.3_
  - [x] 1.3 `GET /v1/share/node/:slug` HTML route on the API Lambda
    - Public, rate limited; OG title, description, image (header image or
      site default), url; script redirect to `/map?venue={slug}&src=share`
      and a `<noscript>` link; `Cache-Control: public, max-age=300`
    - _Requirements: 1.2, 12.2, 12.3_
  - [x] 1.4 Amplify custom rule for the consumer app
    - Consolidate `add-spa-rewrites.ps1` and `apply-amplify-spa-rewrites.ps1`
      into one script; add `/node/<*>` 200 rewrite to the share route ahead
      of the SPA fallback for the web app only; document in `docs/DEPLOY.md`
    - _Requirements: 12.2_
  - [x] 1.5 `getNodePublic` reads pulse from KV and presence count
    - Same key as `getNodeDetail`; remove the hard-coded `pulseScore: 0`;
      add `liveCheckInCount` and `tonight` (null until task 9)
    - _Requirements: 1.4_
  - [x] 1.6 Consumer routing for `/node/{slug}` and `/map?venue=`
    - `pathToRoute` handles both and stashes `{ slug, source }` in
      sessionStorage `pendingVenueArrival` (same pattern as
      `pendingQrCheckIn`); a sibling resume effect in `App.tsx` restores it
      after sign-in; the first-paint effect resolves slug and calls
      `setFocusNodeId` (existing Focus_Signal path into Browse_Mode with the
      venue as Active_Venue), records the Venue_Open with the stashed source,
      clears the stash. No Commit_Mode auto-open.
    - _Requirements: 1.1, 1.5, 1.7, 12.3_
  - [x] 1.7 Playwright (consumer): open `/node/{slug}` logged out, sign in,
        land on the venue card in Browse_Mode with the source preserved; and
        the same logged in
    - _Requirements: 1.1, 1.7_

- [x] 2. Venue_Open, Away_Gate and `foundVia` (R2, R3, R11), one PR
  - [x] 2.1 `resolveFoundVia` pure function in
        `backend/src/features/check-in/attribution.ts`
    - No row, expired row, or both gates failing ? `walk_in`; `away === true`
      or age >= `AWAY_GATE_MIN_MINUTES` ? source
    - _Requirements: 3.1, 3.2_
  - [x] 2.2 Write property test for `resolveFoundVia`
    - Property 1: gate semantics, purity, never a client value
    - _Requirements: 3.1, 3.2, 3.5_
  - [x] 2.3 `POST /v1/nodes/:nodeId/open`
    - Consumer auth, Zod `{ source, away: boolean | null }`, rate limit;
      service merges into `open:{userId}:{nodeId}` (earliest `openedAt` and
      source kept, `away` ORed, TTL reset to `ATTRIBUTION_WINDOW_HOURS`);
      usage event `venue_open { source }` with `source` added to the props
      allowlist; property test 1b for the merge
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 11.1_
  - [x] 2.4 Stamp `foundVia` in the check-in service
    - Read row after proximity and cooldown, resolve with
      `checkInInstant = capturedAt ?? now`, pass to `createCheckIn`, delete
      row best effort; `CheckIn.foundVia` typed; body schema left non-strict,
      service never reads `foundVia` from the body, unit test posts one and
      asserts it is ignored; socket payloads carry `foundVia`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 11.2_
  - [x] 2.5 Consumer client: record the open
    - `recordVenueOpen` in `packages/shared/lib/api`; two triggers: the
      arrival effect from 1.6 (share, push) and the `NodeDetailContent`
      mount effect (`search` or `map`), once per open; card selection in
      Browse_Mode is not an open; `away = distance > AWAY_DISTANCE_METRES`
      from a fresh position via shared haversine, `null` when unknown;
      position never sent
    - _Requirements: 2.1, 2.2_
  - [x] 2.6 Push deep links carry `src=push`
    - Notification click URLs for `friend_checkin`, `reward_new`, campaign
      push include `?src=push`; `entrySource` reads it
    - _Requirements: 2.1_

- [x] 3. Receipt and split reporting (R4, R11.3, R11.4)
  - [x] 3.1 `computeReceipt` in `backend/src/features/reports/receipt.ts`
    - Distinct Found_You and Walk_In visitors, `foundYouFirstTimers` from
      an optional `earliestCheckInByUser` map, `bySource`, suppression list;
      pre-spec check-ins read as `walk_in`; "measured from" annotation when
      the window starts before `RECEIPT_MEASURED_FROM_ISO`
    - _Requirements: 4.1, 4.2, 4.5, 4.8_
  - [x] 3.2 Write property test for Receipt conservation
    - Property 2: `foundYou + walkIn === unique`,
      `foundYouFirstTimers <= foundYou`, `bySource` sums to `foundYou`,
      non-negative integers
    - _Requirements: 4.2_
  - [x] 3.3 `buildReceiptCopy(receipt, checklist)` in the reports feature
    - Headline on Found_You, second line on Walk_In, per-source clause above
      the floor, zero branch with one next step (share, Tonight, or the
      checklist flag that is false); measurement verbs only
    - _Requirements: 4.6, 4.7, 6.3_
  - [x] 3.4 Extend the honest-copy property test
    - Property 3: banned verbs unchanged and still absent; reject
      `revenue|ticket|spend|will arrive|coming`; zero branch has exactly one
      next step
    - _Requirements: 4.6, 4.7, 10.3_
  - [x] 3.5 Digest metrics and sentences
    - `computeDigest` takes `uniqueVisitors` from the Receipt and adds
      `foundYouVisitors`, `walkInVisitors`, `foundYouFirstTimers`,
      `bySource`, all optional in `digestRowSchema`; `buildDigestCopy` uses
      `buildReceiptCopy`; PII scan covers new fields; history rows still
      parse (test)
    - _Requirements: 4.5, 4.6, 4.7, 11.4_
  - [x] 3.6 Live stats split
    - `getLiveStats` adds `foundYouToday`, `walkInsToday` (SAST day);
      `LivePanel` renders two lines and increments on `business:checkin`;
      jsdom test
    - _Requirements: 4.3_
  - [x] 3.7 Check-ins panel badge
    - `CheckInDetailPanel` shows the source badge when `foundVia !== 'walk_in'`
    - _Requirements: 4.4_
  - [x] 3.8 Dev rehearsal, two phones
    - Open from the map at home, travel, check in ? Found_You (`map`); open
      at the bar and check in inside 20 min ? Walk_In; open via share link ?
      Found_You (`share`); confirm live panel, badge and socket counts
    - _Requirements: 3.1, 3.2, 4.3_

### Phase 2: the receipt in the sales flow

- [x] 4. Onboarding_Checklist (R5)
  - [x] 4.1 `OnboardingChecklistCard` on `BusinessDashboard`
    - Driven by `GET /v1/business/me/onboarding-status`; rows venue, reward,
      staff, QR deep-link to their panels; first card while any flag false;
      hidden when complete; jsdom test for the five states
    - _Requirements: 5.1, 5.2_

- [x] 5. Receipt in trial and renewal moments (R6)
  - [x] 5.1 `GET /v1/business/receipt?window=trial|paid|week`
    - Window from `trialEndsAt - TRIAL_DAYS`, `paidUntil`, or Digest_Week;
      returns Receipt plus copy from `buildReceiptCopy`
    - _Requirements: 6.2_
  - [x] 5.2 `PlansPanel` receipt above the upgrade CTA
    - Copy strings from the API only; zero state per R6.3; jsdom test
    - _Requirements: 6.2, 6.3_
  - [x] 5.3 Trial reminder emails carry the Receipt
    - `trial-reminder.ts` computes the trial-window Receipt and renders
      through `buildReceiptCopy`; checklist nudge when Found_You is zero;
      SES template updated in `shared/email/ses.ts`
    - _Requirements: 6.1, 6.3, 6.5_
  - [x] 5.4 Renewal reminder carries the paid-period Receipt
    - _Requirements: 6.4, 6.5_

- [x] 6. Boost_Scoreboard (R7)
  - [x] 6.1 `computeBoostScoreboard` in
        `backend/src/features/business/boost-scoreboard.ts`
    - Window and baseline (same clock window minus 7 days) counts of
      check-ins, Found_You, Walk_In via check-ins by node and range; deltas
      suppressed below the floor
    - _Requirements: 7.1, 7.3, 7.5_
  - [x] 6.2 Write property test for the scoreboard
    - Property 7: baseline offset exactly 7 days, suppression below floor,
      no causal verb in labels
    - _Requirements: 7.1, 7.3, 7.5_
  - [x] 6.3 `GET /v1/business/boosts/:boostId/scoreboard`
    - Live while open; cached at `boost:score:{pk}:{sk}` once closed;
      12-month retention alongside the boost row in the cleanup worker
    - _Requirements: 7.1, 7.2_
  - [x] 6.4 `BoostPanel` renders the scoreboard per purchase
    - Found_You highlighted; jsdom test for open, closed and suppressed
    - _Requirements: 7.4_

### Phase 3: build the hooks

- [x] 7. Dated_Slot on the Music_Schedule (R8.1, R8.2, R8.4)
  - [x] 7.1 Extend `ScheduleSlot` with `date`, `headline`, `featuredRewardId`
    - `packages/shared/types`; validator rules (dated slots shadow weekly,
      no overlap among dated slots on one date, date within 14 days,
      headline max 60)
    - _Requirements: 8.1, 8.2_
  - [x] 7.2 Active-slot resolution and `nextTransitionAt` include dated slots
    - Prefer the dated slot on its date; live-archetype evaluator unchanged
      in precedence, only in slot source
    - _Requirements: 8.2_
  - [x] 7.3 Write property test for Dated_Slot shadowing
    - Property 6: resolver prefers dated on its date, weekly elsewhere;
      `nextTransitionAt` is the soonest boundary across both
    - _Requirements: 8.2_
  - [x] 7.4 Schedule service validates `featuredRewardId`
    - Must be an active reward of the same business, else 400
    - _Requirements: 8.4_

- [x] 8. Tonight, owner side (R8.3)
  - [x] 8.1 `TonightForm` panel in the business portal
    - Date default today, mode and genres or DJ, start and end, headline,
      one get from active rewards; writes a Dated_Slot via the schedule API;
      shows the promise or crowd status line; jsdom test for validation and
      submit disabled state
    - _Requirements: 8.3_
  - [x] 8.2 Navigation entry "Tonight" on the dashboard
    - `MusicSchedulePanel` stays for the weekly grid
    - _Requirements: 8.3_

- [x] 9. Tonight, consumer side (R8.5 to R8.8)
  - [x] 9.1 `summariseTonight` in `backend/src/features/nodes/tonight-summary.ts`
    - Headline, local start, archetype via existing mapping, reward title
      omitted when the featured reward is no longer active; null when
      nothing active or upcoming today
    - _Requirements: 8.5_
  - [x] 9.2 Include `tonight` in city payload, node detail, node public
    - `assembleCityPayload` with one batched schedule read per distinct
      `businessId`, `getNodeDetail`, `getNodePublic`; schedule upsert
      invalidates `nodes:city:{slug}` for the business's city
    - _Requirements: 8.5, 1.2_
  - [x] 9.3 `VenueCard` Tonight line
    - `VenueCardVM.tonight`; one line under the live count; no distance
    - _Requirements: 8.6_
  - [x] 9.4 `TonightBlock` in `NodeDetailContent`
    - Above `CrowdVibeSection`; "Expected tonight" label below the
      Presence_Floor; renders headline, time, get regardless of flags
    - _Requirements: 8.7, 8.8, 8.9_
  - [x] 9.5 Share snapshot includes the Tonight headline
    - _Requirements: 1.2_

- [x] 10. Going (R9)
  - [x] 10.1 Going rows and routes
    - `goingNightFor(nowIso)` pure helper (04:00 SAST rollover) with
      property test 2b; `POST`/`DELETE /v1/nodes/:nodeId/going { date }`
      writes and deletes the venue row and the `USER#{userId}` mirror row in
      one transaction, TTL next Monday 06:00 SAST after the digest pass;
      `Select: COUNT` query; `goingCount` on detail, `viewerGoing` only with
      a bearer token, `goingCount` on the city payload
    - _Requirements: 9.1, 9.2, 9.9_
  - [x] 10.2 Write property test for Going isolation
    - Property 5: pulse, momentum, beam brightness and `vibeRank` order
      invariant under any Going count
    - _Requirements: 9.4_
  - [x] 10.3 Going control and threshold copy on card and detail
    - "marked going" wording; card shows the count iff
      `>= GOING_PUBLIC_THRESHOLD` AND `tonight` present, else nothing;
      detail block always offers the control, "Be the first to mark going"
      only there and only with a Tonight; property test 8 on the copy
      function
    - _Requirements: 9.2, 9.3_
  - [x] 10.4 `business:going` socket event and LivePanel line
    - "N marked going tonight" per venue, zero shown honestly
    - _Requirements: 9.5_
  - [x] 10.5 Reminder opt-in at the moment of intent
    - `tonightReminder` preference (default false); "Remind me when it
      starts" sheet after marking Going when a start time exists; reuses
      `NotificationPrimingSheet`; sets `remindAt` on the row
    - _Requirements: 9.6, 10.5_
  - [x] 10.6 Tonight_Reminder in the schedule transition tick
    - On Dated_Slot start, query Going rows with `remindAt` and not
      `reminded`, send `tonight_reminder` via `sendNotification`
      (preference-gated), mark `reminded`; once per row; no reminder when
      the slot was deleted; unit test
    - _Requirements: 9.7, 9.10_
  - [x] 10.7 Digest going line
    - Read the week's Going rows (still live per the TTL rule), join to that
      night's check-ins by `userId` in memory, aggregate only; "N marked
      going before doors, M of them checked in"; ratio suppressed below the
      floor; covered by the honest-copy test
    - _Requirements: 9.8_
  - [x] 10.8 Erasure worker deletes Going rows for an erased user
    - Query `pk USER#{userId}`, `begins_with(sk, 'GOING#')`, delete each
      mirror row and the venue row it points to; unit test with two nights
    - _Requirements: 9.9_

- [x] 11. Guardrails (R10)
  - [x] 11.1 Business marketing copy in one i18n file, covered by the
        honest-copy test
    - Reach to strangers described as map, Tonight on the card, WhatsApp
      shares, friends; no `brought|drove|generated|boosted|revenue|ticket|spend`
    - _Requirements: 10.3, 10.6_
  - [x] 11.2 Assert no new browse surface and no named benchmark
    - `no-global-events-feed.test.ts` green; grep test that no new route
      under `/v1/rewards` or `/v1/nodes` returns a cross-venue list beyond
      `near-me` and the city payload
    - _Requirements: 10.1, 10.2_

### Phase 4a: fix before the UAT environment (independent of Phases 1 to 3, start day one)

- [x] 13. Business photo upload from a phone (R14)
  - [x] 13.1 `sniffImageFormat(file)` in `packages/shared/lib/imageCompression.ts`
    - Reads the first 12 bytes; returns `jpeg | png | webp | heic | unknown`;
      property test 9
    - _Requirements: 14.1, 14.2_
  - [x] 13.2 Replace `createImageBitmap` with the `<img>` decode path
    - `URL.createObjectURL` + `img.decode()` + canvas + `toBlob(image/jpeg)`;
      revoke the object URL in `finally`; the old path is removed, not kept
    - _Requirements: 14.4_
  - [x] 13.3 `mapUploadError(err, format)` and the copy table
    - Format, HEIC decode, too large, network or CORS, server; no raw
      `err.message`; unit tests per branch
    - _Requirements: 14.3, 14.5_
  - [x] 13.4 `NodeEditorPanel` uses the sniff, `accept="image/*"`, and the
        mapped copy
    - Update `nodeEditorPhoto.test.tsx` and `bugfix-exploration.test.tsx`
      expectations for the new gate
    - _Requirements: 14.1, 14.5, 14.7_
  - [x] 13.5 Terraform: one CORS origin list for API and S3 media bucket
    - `local.app_cors_origins` in prod and dev `main.tf`; `terraform plan`
      shows only the S3 CORS change; apply
    - _Requirements: 14.6_
  - [x] 13.6 Phone test matrix recorded in the UAT script
    - iOS High Efficiency, iOS Most Compatible, iOS Files, Android Chrome
      gallery, Android Files, 48MP original, PNG screenshot, Amplify default
      URL on a phone
    - _Requirements: 14.8_

- [x] 14. Backend defects (R15.1 to R15.9)
  - [x] 14.1 `shared/time/sast.ts`: `startOfSastDayIso`, `sastDateString`,
        `secondsUntilNextSastMidnight`; move the three inline
        `SAST_OFFSET_MS` copies onto it; property test 10
    - _Requirements: 15.1, 15.2, 15.8_
  - [x] 14.2 `getLiveStats` counts the SAST day with a paginated
        `getCheckInsByNodeSince`; `totalCheckIns` from a maintained per-node
        counter incremented at check-in (backfill script for existing nodes)
    - _Requirements: 15.1_
  - [x] 14.3 `checkin:today` expires at next SAST midnight
    - `kvIncr` absolute expiry option; check-in service passes it
    - _Requirements: 15.2_
  - [x] 14.4 Check-out clears cooldown and recomputes pulse
    - `computePulse(daily, live)` shared by check-in and check-out; delete
      `cooldown:{userId}:{nodeId}`; tests for both
    - _Requirements: 15.3_
  - [x] 14.5 Presence read takes branded `EpochSeconds`; fix near-me callers
    - Unit test asserts a live record counts in near-me ranking
    - _Requirements: 15.4_
  - [x] 14.6 `nodes/cache.ts` `invalidateCityPayload(nodeId)` called from
        every node write, including the Yoco boost webhook path and the
        schedule upsert; enumeration test
    - _Requirements: 15.5_
  - [x] 14.7 Seed `liveCheckInCount` in `assembleCityPayload` from presence
        counters in the same batched read; remove the DEV pulse-derived count
    - _Requirements: 15.6_
  - [x] 14.8 Loud logging on map assembly failures
    - Error-level log with city slug in `assembleCityPayload` catch and the
      `findBusinessById` catch in `getNodesByCitySlug`
    - _Requirements: 15.7_
  - [x] 14.9 Business check-in detail keyed by SAST date, dual-read for
        pre-deploy dates; decision recorded
    - _Requirements: 15.8_
  - [x] 14.10 Specific `429` copy per limiter; UAT limits per decision 0.1
    - _Requirements: 15.9_

- [x] 15. Portal defects (R15.10 to R15.18)
  - [x] 15.1 `LivePanel`: `rewardsClaimed` from poll, `checkInsToday` bumps
        on socket, re-seed from poll on reconnect; jsdom test
    - _Requirements: 15.10_
  - [x] 15.2 `useBoostCheckoutReturn` lands on `yocoCheckoutId` from the
        return URL; baseline logic removed; test with a webhook that lands
        before the first poll
    - _Requirements: 15.11_
  - [x] 15.3 `CheckInDetailPanel` "today" is the SAST date
    - _Requirements: 15.12_
  - [x] 15.4 `describeApiError` in `packages/shared/lib/api`; replace every
        `err.message` / `error_description` render in `NodeEditorPanel`,
        `StaffInvite`, the three OAuth callbacks and the manager path;
        property test 11
    - _Requirements: 15.13_
  - [x] 15.5 Narrow-screen overflow: `RewardMetricsPanel` scroll wrapper and
        truncation, `SettingsPanel` invite emails, admin business emails
    - _Requirements: 15.14_
  - [x] 15.6 One SAST date-time formatter for owner and admin surfaces;
        `SetTierDialog` parses datetime-local as SAST
    - _Requirements: 15.15_
  - [x] 15.7 `StaffValidator` camera error branches by `err.name`,
        `stopCamera()` on every failure, in-flight scan lock; unit tests
    - _Requirements: 15.16, 15.17_
  - [x] 15.8 `FirstGetIssuer` print blocked message with copy action
    - _Requirements: 15.18_

- [x] 16. Consumer web defects (R15.19 to R15.25)
  - [x] 16.1 `packages/shared/lib/safeStorage.ts`; migrate OAuth start and
        callback, `pendingQrCheckIn`, and use it for `pendingVenueArrival`;
        private-mode message on sign-in
    - _Requirements: 15.19_
  - [x] 16.2 `NotificationPrimingSheet` honest states: iOS non-PWA
        instruction, missing VAPID and subscribe failure shown as errors
    - _Requirements: 15.20_
  - [x] 16.3 `DirectionsSheet` no auto HTTPS fallback; web link as a visible
        second action
    - _Requirements: 15.21_
  - [x] 16.4 Clipboard existence check in `NodeDetailContent` share
    - _Requirements: 15.22_
  - [x] 16.5 `useCheckInFlow.activateCheckIn` sets `submittingRef` before
        `requestLocation()`; CTA disabled from first tap; test
    - _Requirements: 15.23_
  - [x] 16.6 44px targets: `MapControls`, `ProximityNudgeBanner`,
        `FeedItemRow` share; `ToastOverlay` safe-area; `BottomNav` per
        decision 0.1
    - _Requirements: 15.24_
  - [x] 16.7 Remove pin emoji (`LeaderboardScreen`, `main.tsx`); clear
        timers on unmount in `NodeDetailContent` and `StreamingSection`
    - _Requirements: 15.25_

### Phase 4: UAT readiness

- [x] 12. Seed, rehearsal, e2e, script, gates (R13)
  - [x] 12.1 Dev seed script
    - Three businesses (trial, Growth with active boost, Starter), each with
      venue, reward, QR, Tonight slot for today; at least 12 consumer
      accounts with no prior check-ins, two with `tonightReminder`; sized so
      one venue reaches a Found_You headline of at least 9 with 6
      first-timers
    - _Requirements: 13.1_
  - [x] 12.2 End-to-end dev rehearsal
    - Share link previews and opens (logged out and logged in); Found_You
      and Walk_In check-ins; Going with reminder at slot start; live panel
      four counts; scoreboard; digest with new lines (run the weekly pass);
      trial email in dev SES; record the produced numbers into the UAT
      script for R13.6
    - _Requirements: 13.2, 13.6_
  - [x] 12.3 Playwright coverage
    - Consumer: share link open, Tonight line, Going toggle and threshold
      copy. Business: checklist card, live split, Plans receipt, scoreboard
    - _Requirements: 13.3_
  - [x] 12.4 `docs/UAT_PROOF_OF_DEMAND.md`
    - Scenario list, exact expected copy, expected numbers from the seed,
      owner and consumer roles, one-week UAT plan with the Monday digest as
      the acceptance artifact
    - _Requirements: 13.4_
  - [x] 12.5 Ship gates recorded and checked
    - Tasks 13 to 16 complete and the R14.8 phone matrix recorded;
      Found_You non-zero for two of the three seeded venues; zero causal
      verbs across owner-facing copy; `pnpm typecheck`, `pnpm test`,
      `pnpm lint`, `pnpm format:check`, `pnpm guard:serverless`, both closure
      checks, `tests/e2e` green; `docs/decisions/proof-of-demand.md` updated
    - _Requirements: 13.5, 12.4_
  - [x] 12.6 `pnpm sync:rules` if any rule file changed; update
        `rules/product.md` with the Receipt, Tonight and Going product rules
    - _Requirements: 12.4_
