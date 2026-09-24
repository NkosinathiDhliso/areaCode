# Requirements Document

## Introduction

The public launch pitch is "Area Code brings a venue customers." The product
today can prove loyalty (visits recorded, first-timers, First-Get conversions)
but cannot prove demand: nothing stored connects a consumer finding a venue on
Area Code to that consumer walking in. The weekly digest is correctly
forbidden from saying "brought" (`BANNED_CAUSAL_VERBS` in
`backend/src/features/reports/digest.ts`). This spec builds the measurement
that makes the honest version of that sentence true, then puts the number in
front of the owner at the moments that decide a renewal.

Three findings from the September 2026 code audit shape the scope:

1. The venue share link (`https://areacode.co.za/node/{slug}`) has no
   consumer route and lands on the marketing landing page. The public venue
   endpoint returns `pulseScore: 0` and `ogImage: null` in prod. The main
   consumer lure is a broken link.
2. The check-in record stores six fields and no source. The `venue_selected`
   usage event is aggregated to CloudWatch by name only. "Opened, then
   checked in" cannot be computed from anything stored today.
3. "Expected tonight" and the live-vibe path are dark in prod (flags default
   false, not provisioned). The venue card carries count, pulse, glyph and
   momentum only. There is no "tonight", no get, and no "going" on any
   consumer surface.

This spec, **Proof of Demand**, delivers four phases that end at UAT:

- Phase 1: fix the share leak and build the receipt (Venue_Open,
  `foundVia`, Away_Gate, split reporting).
- Phase 2: put the receipt in the sales flow (onboarding checklist, trial
  emails and Plans panel, boost scoreboard).
- Phase 3: build the hooks (Tonight, Going, reminder push).
- Phase 4: UAT readiness (dev rehearsal, seeds, Playwright, UAT script,
  ship gates).

Relationship to sibling specs: extends `weekly-attribution-digest` (new
metrics, same copy discipline), `live-vibe-declaration` (Tonight derives its
vibe from the Music_Schedule, no second declaration store), `winback-campaigns`
(reuses the attribution single-count discipline), `presence-integrity` and
`honest-presence-*` (going is intent, never presence), `billing-revenue-integrity`
(trial and boost read models).

Out of scope, permanently for this spec: a deals or gets browse surface,
named competitor benchmarks, POS revenue or ticket-size claims, SMS or phone
signup, per-venue OG image rendering, and any outbound push to consumers who
have no relationship with the venue.

## Glossary

- **Venue_Open**: a consumer opening a venue's detail (Commit_Mode) in the
  consumer app, or arriving on a venue from a share or push deep link.
  Recorded as a short-lived KV row keyed by consumer and venue. Selecting a
  card in Browse_Mode is not a Venue_Open.
- **Open_Source**: where the Venue_Open came from: `map`, `share`, `search`,
  `push`. The first Venue_Open inside the Attribution_Window wins.
- **Attribution_Window**: the maximum time between a Venue_Open and a
  check-in at the same venue for the check-in to be eligible as Found_You.
  Founder decision, default 6 hours. One constant, one home.
- **Away_Gate**: the honesty filter. A Venue_Open counts toward Found_You
  only if it happened at least `AWAY_GATE_MIN_MINUTES` before the check-in
  (default 20), OR the consumer's position at open time was known and
  outside the venue's check-in radius. Time is primary; distance is a bonus.
  Only a boolean is ever stored.
- **Found_Via**: the enum stamped server-side on every new check-in:
  `map | share | search | push | walk_in`. Never supplied by the client.
- **Found_You**: a check-in whose Found_Via is not `walk_in`. Copy: "found
  you on Area Code and checked in". The only number allowed next to the word
  "found".
- **Walk_In**: a check-in with Found_Via `walk_in`. Copy: "already in the
  room". Real and useful for loyalty; not demand Area Code created.
- **Receipt**: the pair (Found_You, Walk_In) for a venue over a window, with
  distinct-consumer counts. Rendered on the live panel, the digest, the
  trial emails, the Plans panel and the boost scoreboard from one computation.
- **Share_Preview**: the HTML served for `/node/{slug}` to link crawlers,
  carrying Open Graph title, description (live snapshot text) and image.
- **Boost_Scoreboard**: for one Boost_Window, check-ins and Found_You inside
  the window against the same weekday and clock hours seven days earlier.
- **Onboarding_Checklist**: the dashboard card driven by the existing
  `GET /v1/business/me/onboarding-status` (`hasNode`, `hasReward`,
  `hasStaff`, `hasQr`).
- **Tonight**: one dated programme for a venue: what is on, when it starts,
  one get. Vibe and time come from a dated Schedule_Slot in the existing
  Music_Schedule; headline and featured get are fields on that slot.
- **Dated_Slot**: a Schedule_Slot with an optional `date` (local
  `YYYY-MM-DD`) that applies once and shadows weekly slots on that date.
- **Going**: a consumer marking intent to attend a venue on a date. Intent,
  not presence. Never feeds pulse, aliveness, momentum or beams.
- **Going_Threshold**: the minimum Going count before the count is shown to
  consumers. Founder decision, default 3. Below it, "Be the first to mark
  going".
- **Tonight_Reminder**: a push sent at the Tonight slot start to consumers
  who marked Going and explicitly opted in at that moment.
- **Suppression_Floor**: 5 underlying events, as in the digest. Counts
  always render; comparisons and percentages need the floor.

## Requirements

### Requirement 1: Venue share link opens the venue and previews it live

**User Story:** As a consumer in a full room, I want the link I forward on
WhatsApp to show the venue alive and open straight onto it, so that my friend
chooses this room.

#### Acceptance Criteria

1. WHEN a browser requests `/node/{slug}` on the consumer domain, THE
   consumer app SHALL open the map with that venue as the Active_Venue in
   Browse_Mode (card leading, camera on the venue), not the landing page.
   Commit_Mode SHALL still open only from the "View details" control, per
   `map-carousel.md`; this spec adds no exception to that rule.
2. WHEN a link crawler requests `/node/{slug}`, THE Share_Preview SHALL be
   served without JavaScript, with `og:title` (venue name), `og:description`
   (live snapshot text: pulse state, live count when above zero, Tonight
   headline when present, active get count), `og:image` (venue header image
   when set, else the site default) and `og:url`.
3. THE snapshot text SHALL follow honest presence: a venue with zero live
   presence reads as quiet or "first in", never as busy.
4. `getNodePublic` SHALL read the pulse score from the pulse KV using the
   same key as `getNodeDetail` and SHALL NOT return a hard-coded zero.
5. WHEN the consumer app boots from a share link, THE arrival itself SHALL
   record a Venue_Open with Open_Source `share` for that venue once the
   consumer is authenticated (Requirement 2.1).
6. THE existing `POST /v1/nodes/:nodeId/share` weekly tally SHALL be
   unchanged; inbound opens are recorded by Requirement 2, not by the tally.
7. WHEN an unauthenticated visitor arrives from a share or push link, THE
   app SHALL stash `{ slug, source }` in sessionStorage before routing to
   login, and SHALL restore the venue and record the Venue_Open after
   authentication, reusing the mechanism the QR flow uses
   (`pendingQrCheckIn` in `App.tsx`). A login round trip SHALL never lose
   the source.

### Requirement 2: Venue_Open is recorded, short-lived, and sourced

**User Story:** As the founder, I want to know that a consumer looked at a
venue before they walked in, without building a browsing history.

#### Acceptance Criteria

1. WHEN a consumer opens a venue's detail (Commit_Mode), OR arrives on a
   venue from a share or push deep link, THE consumer app SHALL call
   `POST /v1/nodes/:nodeId/open` with `{ source, away }` where `source` is an
   Open_Source and `away` is `true`, `false` or `null` (unknown). Selecting a
   card in Browse_Mode from the map is not a Venue_Open.
2. THE `away` value SHALL be computed on the client from a fresh position
   when one is available, as `distance > AWAY_DISTANCE_METRES` (default 500,
   the maximum check-in radius, so the gate errs toward `walk_in`); the
   position itself SHALL NOT be sent.
3. THE service SHALL store `open:{userId}:{nodeId}` in the app-data KV with
   `{ source, openedAt, away }`. WHEN an unexpired row exists, THE service
   SHALL merge: keep the earliest `openedAt` and its `source`, set
   `away = existing.away || incoming.away`, and reset the TTL to the
   Attribution_Window from the latest open. A repeat open never shortens the
   window or discards an earlier away open.
4. THE row SHALL contain no coordinates, no device data and no display name.
5. THE endpoint SHALL require consumer auth and SHALL be rate limited with
   the existing sliding window.
6. THE existing `venue_selected` usage event SHALL continue to emit; this
   spec adds an aggregate `venue_open` event carrying `source` only, with
   `source` added to the usage-event props allowlist
   (`packages/shared/constants/usage-events.ts`).

### Requirement 3: Found_Via is stamped with the Away_Gate, in one change

**User Story:** As a sceptical owner, I want "found you" to exclude the
person who opened the app at my bar to check in, so that the number is one I
can trust.

#### Acceptance Criteria

1. WHEN a check-in is created, THE check-in service SHALL read
   `open:{userId}:{nodeId}` and SHALL stamp `foundVia` as the row's `source`
   only if the Away_Gate passes; otherwise `walk_in`. No row means `walk_in`.
   QR check-ins and offline replays follow the same rule; a QR scan with no
   prior open is a Walk_In by construction.
2. THE Away_Gate SHALL pass when `checkInInstant - openedAt >= AWAY_GATE_MIN_MINUTES`
   OR `away === true`. `away === null` SHALL rely on the time gate alone.
   `checkInInstant` is `capturedAt` for an offline replay, else now.
3. THE Venue_Open row SHALL be deleted after the stamp (consumed once).
4. `foundVia`, the Away_Gate and the stamp SHALL ship in one change with one
   test suite; no check-in SHALL ever be written with `foundVia` before the
   Away_Gate is enforced.
5. `foundVia` SHALL be server-derived only. THE body schema SHALL strip
   unknown keys (Zod default) and the service SHALL never read `foundVia`
   from the request; a test SHALL assert a client-supplied value is ignored.
   The schema SHALL NOT be made `strict()`, so existing clients that send
   extra fields keep working.
6. THE `business:checkin` and `business:checkin_detail` socket payloads
   SHALL carry `foundVia`.
7. THE Attribution_Window and `AWAY_GATE_MIN_MINUTES` SHALL live in one
   shared constants module used by the service and every read model.

### Requirement 4: The Receipt is split everywhere the owner reads a number

**User Story:** As an owner, I want every surface to show two honest counts,
"found you here" and "already in the room", so that Monday tells me how many
people found me.

#### Acceptance Criteria

1. THE Receipt SHALL be computed by one function in the reports feature,
   `computeReceipt(businessId, windowStart, windowEnd)`, returning distinct
   consumers with at least one Found_You check-in and distinct consumers with
   only Walk_In check-ins in the window, plus per-source breakdown.
2. `foundYouVisitors + walkInVisitors` SHALL equal unique visitors for the
   same window (conservation property).
3. THE live panel (`GET /v1/business/me/live-stats`) SHALL add
   `foundYouToday` and `walkInsToday`, and SHALL update live from the socket
   payload of Requirement 3.6.
4. THE check-ins panel SHALL show a Found_You badge with the source on each
   row that has one.
5. THE weekly digest SHALL add `foundYouVisitors`, `walkInVisitors`,
   `foundYouFirstTimers` (Found_You visitors whose first-ever check-in at
   the business falls in the week, the "had never been in before" clause)
   and the per-source breakdown as Attribution_Metrics, rendered as two
   separate lines with the headline on Found_You. New fields SHALL be
   optional in `digestRowSchema` so stored history rows still parse.
6. `BANNED_CAUSAL_VERBS` SHALL be unchanged; the honest-copy property test
   SHALL cover the new sentences. "Found you" is a measurement sentence.
7. WHEN Found_You is zero for the window, THE copy SHALL say so plainly with
   one constructive next step (share the venue, publish Tonight), never a
   padded number.
8. Per-source percentages SHALL be withheld below the Suppression_Floor.

### Requirement 5: Onboarding_Checklist on the dashboard

**User Story:** As a new owner in a 14-day trial, I want to see what stands
between me and my first check-in, so that I print the QR on day one.

#### Acceptance Criteria

1. THE business dashboard SHALL render an Onboarding_Checklist card driven
   by the existing `GET /v1/business/me/onboarding-status`, one row per
   flag, each row deep-linking to the panel that completes it.
2. THE card SHALL render first while any flag is false and SHALL not render
   once all four are true.
3. THE card SHALL be the fallback content of the trial emails when Found_You
   is zero (Requirement 6.3).

### Requirement 6: The Receipt in the renewal moments

**User Story:** As an owner about to lose my trial, I want to see how many
people found me during it next to the button that keeps the numbers running.

#### Acceptance Criteria

1. THE trial reminder emails at 3 days and 1 day SHALL include the Receipt
   for the trial window: "N people found you on Area Code and checked in
   during your trial. M were already in the room."
2. THE Plans panel upgrade CTA SHALL show the same Receipt for the trial
   window from `GET /v1/business/receipt?window=trial`.
3. WHEN Found_You for the trial window is zero, THE email and the panel SHALL
   show the Onboarding_Checklist nudge (whichever flags are false) or, when
   all flags are true, the share and Tonight next step, never "0 people found
   you" as the headline.
4. THE renewal reminder for paid businesses SHALL include the Receipt for
   the paid period using the same function.
5. ALL Receipt copy in emails SHALL pass the honest-copy property test.

### Requirement 7: Boost_Scoreboard

**User Story:** As an owner who paid for a boost, I want to see what the
window did against the same hours last week, so that the second boost is a
decision, not a hope.

#### Acceptance Criteria

1. `GET /v1/business/boosts/:boostId/scoreboard` SHALL return check-ins,
   Found_You and Walk_In inside the Boost_Window, and the same three for the
   same weekday and clock window seven days earlier.
2. WHILE the window is open, THE scoreboard SHALL compute live; WHEN the
   window has closed, THE result SHALL be cached in the app-data KV and never
   recomputed (history is stable).
3. THE deltas SHALL be withheld below the Suppression_Floor; counts always
   render.
4. THE BoostPanel active and history lists SHALL render the scoreboard per
   purchase with Found_You as the highlighted line.
5. THE scoreboard SHALL never describe the boost as having "brought" or
   "driven" anyone; it reports counts in and out of the window.

### Requirement 8: Tonight, one card, one store

**User Story:** As an owner on a quiet Tuesday, I want to publish what is on
tonight, when it starts and one get in under a minute, and see it on the map
as the reason to leave the house.

#### Acceptance Criteria

1. `ScheduleSlot` SHALL gain optional `date` (local `YYYY-MM-DD`), optional
   `headline` (max 60 chars) and optional `featuredRewardId`. A slot with
   `date` is a Dated_Slot and SHALL shadow weekly slots on that local date.
2. THE schedule validator, the active-slot resolver and `nextTransitionAt`
   computation SHALL treat Dated_Slots as first-class; the Declared_Vibe
   SHALL continue to derive solely from the Music_Schedule. This spec SHALL
   NOT introduce a second declaration store.
3. THE business portal SHALL provide a Tonight form (date defaults to
   today, genres or DJ, start and end, headline, one get from the business's
   active rewards) that writes one Dated_Slot through the existing schedule
   API. The weekly `MusicSchedulePanel` SHALL remain for the weekly grid.
4. `featuredRewardId` SHALL reference an existing active reward owned by the
   business; the schedule API SHALL reject any other id.
5. THE city nodes payload and the node detail SHALL include a `tonight`
   summary per node when a slot is active or upcoming today: headline,
   start time (local), archetype (via the existing mapping), featured
   reward title. THE reward title SHALL be omitted at read time if the
   featured reward is no longer active. WHEN a schedule is upserted, THE
   service SHALL invalidate the KV-cached city payload for the business's
   city so a published Tonight appears on the map within one request, not
   after the cache TTL.
6. THE consumer venue card SHALL render one Tonight line under the live
   count when present. Distance SHALL remain absent from the card.
7. THE consumer venue detail SHALL render a Tonight block above the crowd
   vibe section with the Going control of Requirement 9.
8. WHILE Live_Presence_Count is below the Presence_Floor, THE Tonight block
   SHALL label the vibe as expected, never as the crowd now
   (live-vibe-declaration R1.3).
9. THE founder SHALL decide before Phase 3 starts whether the live-vibe flags
   are provisioned in prod; the Tonight headline, time and get SHALL render
   regardless of those flags.

### Requirement 9: Going, the pipeline before the door

**User Story:** As a consumer, I want to mark that I am going tonight and be
reminded when it starts; as an owner, I want to see that count before doors.

#### Acceptance Criteria

1. `POST /v1/nodes/:nodeId/going { date }` SHALL write two rows in the
   app-data table in one transaction: the venue row `GOING#{nodeId}#{date}`
   / `USER#{userId}` (for counting) and the mirror row `USER#{userId}` /
   `GOING#{date}#{nodeId}` (for erasure lookups). Both SHALL carry a TTL of
   the Monday 12:00 SAST six hours after the digest pass that covers the
   row's night, never earlier, so the Monday digest still reads the week's
   Going rows when it runs. `DELETE` SHALL remove both.
   `date` is the Going night, computed by one pure helper with a 04:00 SAST
   rollover (a mark at 01:30 Saturday belongs to Friday); for a Tonight slot
   the night is the slot's `date`.
2. THE node detail SHALL return `goingCount` and, when a bearer token is
   present, `viewerGoing`. THE venue card SHALL show the Going count only
   when at or above the Going_Threshold AND a Tonight exists for that venue;
   otherwise the card shows nothing about Going. THE detail Tonight block
   SHALL always offer the Going control; the prompt "Be the first to mark
   going" SHALL appear only in the detail block and only when a Tonight
   exists. The card never gains a second "be the first" line.
3. Consumer copy SHALL say "marked going", never "will arrive" or "coming".
4. Going SHALL NOT be an input to pulse score, aliveness, momentum, beam
   brightness or `vibeRank`; a property test SHALL hold those outputs fixed
   under any Going count.
5. THE live panel SHALL show "N marked going tonight" per venue, updated by a
   `business:going` socket event; the owner sees zero honestly.
6. WHEN a consumer marks Going for a venue with a Tonight start time, THE app
   SHALL offer "Remind me when it starts". Accepting SHALL run the existing
   push priming and set the new preference `tonightReminder` to true for
   that consumer (explicit opt-in at the moment of intent, default false).
7. THE Tonight_Reminder SHALL be sent by the existing schedule transition
   tick at slot start to Going rows for that node and date whose consumer has
   `tonightReminder` true, once per row.
8. THE weekly digest SHALL add "N marked going before doors, M of them
   checked in" as a measured line, subject to the Suppression_Floor for the
   ratio.
9. Going rows SHALL carry `userId` only for dedupe, reminder delivery and
   erasure, and SHALL expire within 7 days. THE erasure worker SHALL query
   the mirror rows (`pk USER#{userId}`, `sk begins_with GOING#`) and delete
   both rows of each pair; no scan.
10. WHEN an owner deletes or edits the Tonight slot, existing Going rows
    SHALL remain (intent was real); the reminder SHALL fire only if a slot
    start still occurs for that node and night.

### Requirement 10: Pitch and copy guardrails

**User Story:** As the founder, I want the do-not list enforced in code where
it can be, so that one inflated Monday never happens.

#### Acceptance Criteria

1. NO gets or deals browse surface SHALL be added; the existing
   `no-global-events-feed.test.ts` SHALL stay green.
2. Benchmarks SHALL remain anonymous; no surface in this spec SHALL name
   another venue.
3. NO surface SHALL render revenue, ticket size or spend; the digest copy
   test SHALL reject the words `revenue`, `ticket`, `spend`.
4. NO SMS and no phone identifiers SHALL be introduced
   (`no-sms-no-phone-auth.md`).
5. NO push SHALL be sent to a consumer about a venue they have not checked
   in at, marked Going for, or been messaged by under an existing campaign
   consent. The Tonight_Reminder is gated on Requirement 9.6.
6. Business-facing marketing copy (business landing and Plans panel) SHALL
   describe reach to strangers as the map, Tonight on the card, WhatsApp
   shares and friends, and SHALL pass the same banned-verb test as the
   digest.

### Requirement 11: Privacy (POPIA)

#### Acceptance Criteria

1. Venue_Open rows SHALL never store coordinates; `away` is the only spatial
   fact and it is a boolean.
2. `foundVia` on the check-in SHALL be an enum only; it SHALL carry no share
   token, referrer URL or campaign id.
3. THE Receipt, digest, scoreboard and live panel SHALL expose aggregate
   counts only; no consumer identity SHALL appear in any new owner-facing
   payload beyond what the check-ins panel already shows.
4. THE existing reports PII scanner SHALL run on the digest payload including
   the new metrics.

### Requirement 12: Serverless integration

#### Acceptance Criteria

1. NO new tables, queues, schedules or Lambdas SHALL be added. Venue_Open,
   Going, scoreboard cache and Tonight ride the app-data table and the
   existing music-schedules table; reminders ride the existing transition
   tick.
2. THE Share_Preview SHALL be one HTML route on the existing API Lambda
   (`GET /v1/share/node/:slug`), reached by an Amplify custom rule that
   rewrites `/node/<*>` on the consumer app to that route with status 200,
   ordered before the SPA fallback. The rule SHALL be applied by the existing
   Amplify custom-rules script, not by hand. THE route is public and SHALL be
   rate limited with the same key the existing public node route
   (`GET /v1/nodes/:nodeSlug/public`) uses.
3. THE Share_Preview HTML SHALL redirect script-capable clients to
   `/map?venue={slug}&src=share`; `pathToRoute` SHALL handle `/map` with a
   `venue` query and `/node/{slug}` directly for clients that bypass the
   rewrite.
4. Any new env var SHALL be added to the closure checks
   (`check-table-closure.mjs`, `check-amplify-env-closure.mjs`) and to
   `rules/tech.md`.
5. IF the founder provisions the live-vibe flags, THE Terraform Lambda env
   and `update-all-amplify-apps.ps1` SHALL be the only mechanism.

### Requirement 13: UAT readiness

**User Story:** As the founder, I want to walk three owners and a dozen consumers
through the whole loop in dev and see the Monday line appear, before anyone
pays.

#### Acceptance Criteria

1. A dev seed SHALL create three businesses (one in trial, one Growth with an
   active boost, one Starter), each with a venue, a reward and a QR, and a
   Tonight slot for the current day, plus at least 12 consumer accounts with
   no prior check-ins (enough to produce a headline count of 9 with 6
   first-timers at one venue, and Walk_Ins at the others).
2. A dev rehearsal SHALL produce, end to end: a share link that previews and
   opens the venue; a Found_You check-in; a Walk_In check-in; a Going mark
   with a reminder delivered at slot start; a live panel showing all four
   counts; a boost scoreboard; a digest with the new lines; a trial email
   carrying the Receipt.
3. Playwright (consumer and business projects) SHALL cover: share link open,
   Tonight line on the card, Going toggle and threshold copy, live panel
   split, checklist card, Plans panel Receipt, boost scoreboard.
4. A UAT script `docs/UAT_PROOF_OF_DEMAND.md` SHALL list each scenario, the
   exact expected copy, and the expected numbers from the seed.
5. Ship gates SHALL be recorded in `docs/decisions/proof-of-demand.md`:
   Found_You non-zero for at least two of the three seeded venues in
   rehearsal; zero causal verbs across all owner-facing copy; `pnpm
typecheck`, `pnpm test`, `pnpm lint`, `pnpm guard:serverless`, both
   closure checks and the e2e suite green.
6. The Monday line the rehearsal must produce has this shape, with the
   numbers taken from the seed run and recorded in the UAT script, not
   hard-coded: "{foundYou} people found you on Area Code and checked in.
   {foundYouFirstTimers} had never been in before. {going} marked going
   before doors, {goingCheckedIn} of them checked in." The seed SHALL be
   sized so the headline is at least 9 at one venue.
7. NO task in this spec SHALL enable a dormant or retired path as a side
   effect: the live-vibe flags are provisioned only by the explicit decision
   in task 0.2; phone-OTP routes, `VITE_SOCKET_URL`, and any `DEV_MODE`
   fixture stay untouched and out of prod paths (`no-sms-no-phone-auth.md`,
   `no-fallbacks-no-legacy.md`).

### Requirement 14: Business photo upload works from a phone

**User Story:** As an owner adding my venue photo from my phone, I want the
upload to work with the photo my camera produced, or to be told exactly why
it cannot, so that I do not have to find a laptop.

Reported: upload fails on phones and works on desktop. Two causes are
confirmed in code and one is environmental.

- `NodeEditorPanel.tsx` gates on `file.type` being exactly `image/jpeg` or
  `image/png`. Android pickers often report `''` or
  `application/octet-stream`; iPhones in High Efficiency mode report
  `image/heic`. Desktop pickers report the MIME reliably. The owner sees
  "Only JPG or PNG allowed." for a photo that is a JPG.
- `compressImageFile` decodes with `createImageBitmap(file, { imageOrientation })`.
  HEIC cannot be decoded by Chrome on Android, and very large camera
  originals can fail to decode on low-memory phones. The failure surfaces as
  the raw `DOMException` text.
- The S3 media bucket CORS allows only the four apex hosts. The API allows
  the four `amplifyapp.com` origins as well. An owner on the Amplify default
  URL gets a CORS failure on the presigned PUT ("S3 upload failed" or
  "Failed to fetch") while API calls succeed.

#### Acceptance Criteria

1. THE client SHALL determine the image format from the file's leading
   bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`, HEIC
   `ftyp` with `heic|heix|hevc|mif1`), not from `file.type`; `file.type`
   SHALL be ignored for the gate.
2. JPEG, PNG and WebP inputs SHALL be accepted; the compressed output stays
   `image/jpeg`, so the presign body schema is unchanged.
3. HEIC input SHALL be attempted; WHEN decode fails, THE message SHALL be
   "This photo format can't be read in this browser. In your camera settings
   choose Most Compatible, or pick a JPG." not a `DOMException` string.
4. `compressImageFile` SHALL use one decode path that works on iOS Safari,
   Android Chrome and desktop: `HTMLImageElement` via `URL.createObjectURL`
   with `img.decode()`, drawn to a canvas (browsers apply EXIF orientation to
   `drawImage` of an `<img>` since Safari 13.4 and Chrome 81). The
   `createImageBitmap` path SHALL be removed, not kept beside it.
5. Every upload failure SHALL map to plain copy by cause: format, too large
   to decode, network or CORS ("Upload blocked. Open the portal at
   business.areacode.co.za and try again."), server. Raw `err.message` SHALL
   not be shown.
6. THE S3 media bucket CORS origins SHALL be the same list the API uses
   (apex hosts plus `additional_cors_origins`), defined once in Terraform
   and referenced by both.
7. THE `accept` attribute SHALL be `image/*` so Android pickers do not hide
   camera photos with unusual MIME labels; the byte sniff is the gate.
8. A test matrix SHALL be run and recorded in the UAT script: iOS Safari
   camera (High Efficiency and Most Compatible), iOS Files app, Android
   Chrome gallery, Android Files app, a 48MP original, a PNG screenshot, and
   the Amplify default URL on a phone.

### Requirement 15: Defects to fix before the UAT environment

**User Story:** As the founder, I want the small bugs a tester will hit in
the first ten minutes fixed before the UAT build, so that feedback is about
the product and not about the scaffolding.

Confirmed in code during the September 2026 sweep. Each item is a defect,
not a feature. Grouped by surface; ordered by how likely a tester hits it.

#### Backend, wrong numbers and stale data

1. `getLiveStats` SHALL count check-ins for the current SAST day (using the
   same `startOfSastDayIso` its `rewardsClaimed` already uses), paginating
   `getCheckInsByNode` to completion instead of the default `Limit: 50`.
   `totalCheckIns` SHALL be a real total (paginated or a maintained counter),
   never capped at 50 per venue.
2. THE `checkin:today:{nodeId}` counter SHALL expire at the next 00:00 SAST,
   not 24 hours after its first increment, so pulse and toasts stop citing
   yesterday's count the next morning.
3. Check-out SHALL clear the check-in cooldown key for that user and venue
   and SHALL recompute and store the pulse score from the new presence
   count, so a visible departure lowers the beam and an immediate re-check-in
   does not return `429`.
4. `rewards/repository.ts` near-me SHALL pass epoch seconds to
   `getLivePresenceCount` and `friendsPresentByNode`, matching the check-in
   path; a unit test SHALL assert a live record is counted.
5. ONE helper `invalidateCityPayload(nodeId)` SHALL exist and SHALL be
   called from every node write: `updateNode`, header image upload, process
   and delete, boost window set (including the Yoco webhook), tier change
   and grace demotion, node activation, reward create and deactivate, and
   schedule upsert (Requirement 8.5 reuses it). Social links already call
   it; that call SHALL use the same helper.
6. `assembleCityPayload` SHALL seed `liveCheckInCount` from the presence
   counters in the same batched read as pulse, so first paint shows real
   live counts instead of "Be the first in" on a busy venue until the socket
   arrives. The DEV branch that derives live count from pulse SHALL be
   replaced by the same real read against dev data.
7. `assembleCityPayload` and `getNodesByCitySlug` SHALL log at error level
   with the city slug when the pulse batch read or a `findBusinessById`
   lookup fails, instead of a bare `catch { return nodes }` or
   `.catch(() => null)`. The map may still render; the failure SHALL be
   visible in CloudWatch.
8. THE business check-in detail partition and its "today" default SHALL use
   the SAST calendar date. Because the day is part of the partition key,
   THE change SHALL be made with a read that queries both the SAST and UTC
   keys for dates before the deploy date, and a note in
   `docs/decisions/proof-of-demand.md`.
9. THE `429` responses SHALL carry specific copy per limiter: check-in
   cooldown (already specific), route rate limit ("Too many check-in
   attempts, wait N seconds"), who's-here ("Slow down a moment"). THE
   who's-here limit SHALL be raised for the UAT environment (decision in
   0.1).

#### Business portal

10. `LivePanel` SHALL render `rewardsClaimed` from the poll and SHALL bump
    `checkInsToday` on `business:checkin`, not only the avatar strip. The
    counters SHALL re-seed from the poll after a reconnect so a backgrounded
    iOS tab does not double count.
11. `useBoostCheckoutReturn` SHALL detect the landed purchase by
    `yocoCheckoutId` carried on the return URL, not by a count baseline taken
    at first poll, so a webhook that lands before the first poll does not
    show "still processing" forever.
12. `CheckInDetailPanel` "today" SHALL be the SAST date, sharing the helper
    from item 8.
13. Every `catch` that sets UI copy from `err.message` or from Cognito
    `error_description` (`NodeEditorPanel`, `StaffInvite`, the three OAuth
    callbacks, `BusinessOAuthCallback` manager path) SHALL map `statusCode`
    and known error codes to plain copy and SHALL fall back to one generic
    sentence. Technical text SHALL never render.
14. `RewardMetricsPanel` SHALL scroll horizontally under 400px and truncate
    titles; `SettingsPanel` invite emails and admin business emails SHALL
    truncate with `min-w-0`.
15. Dates and times shown to owners and admins (`StaffRedemptionPanel`,
    `SettingsPanel` trial and invite dates, `SetTierDialog` datetime-local)
    SHALL be formatted and parsed in `Africa/Johannesburg` through the one
    shared formatter.

#### Staff app

16. `StaffValidator.startCamera` SHALL distinguish `NotAllowedError`
    (denied), `NotFoundError` (no camera), `NotReadableError` (in use) and a
    `play()` failure, with copy for each, and SHALL call `stopCamera()` on
    every failure path so the camera indicator never stays on.
17. THE scan loop SHALL hold an in-flight flag so overlapping `detect` calls
    cannot both fire `handleCodeScanned`; the first result wins and the
    interval is cleared before the handler runs.
18. `FirstGetIssuer` print SHALL show "Printing is blocked in this browser.
    Copy the code instead." when `window.open` returns null, with the copy
    action visible.

#### Consumer web

19. `sessionStorage` and `localStorage` access in `startConsumerGoogleOAuth`,
    `ConsumerOAuthCallback`, and the new `pendingVenueArrival` stash SHALL go
    through one `safeStorage` helper in `packages/shared/lib` that returns
    `null` in private mode; Google sign-in in Safari private mode SHALL show
    "Sign-in needs storage enabled. Turn off Private Browsing and try again."
20. `NotificationPrimingSheet` SHALL tell the truth: on iOS Safari without
    an installed PWA it SHALL say "Add Area Code to your Home Screen to get
    notifications" instead of closing silently; WHEN the VAPID key is absent
    or subscribe fails it SHALL show an error, never close as if it
    succeeded.
21. `DirectionsSheet` SHALL not arm the 600 ms HTTPS fallback when a native
    scheme was opened; it SHALL offer the web link as a visible second
    action instead of navigating the SPA away.
22. `NodeDetailContent` share SHALL check `navigator.clipboard` exists
    before calling it and SHALL show "Copy not available here" otherwise.
23. `useCheckInFlow.activateCheckIn` SHALL set `submittingRef` before
    `requestLocation()` so a double tap cannot start two geolocation
    attempts; the CTA SHALL be disabled from the first tap.
24. Touch targets SHALL be at least 44px: map controls (`w-10 h-10`),
    proximity nudge dismiss and CTA, feed milestone share.
    `ToastOverlay` bottom anchor SHALL add `env(safe-area-inset-bottom)`.
    THE `BottomNav` safe-area trade-off SHALL be re-decided in 0.1 with a
    notched iPhone in hand.
25. THE pin emoji in `LeaderboardScreen` and `main.tsx` boot fallback SHALL
    be removed (`code-style.md`). Timers in `NodeDetailContent` and
    `StreamingSection` SHALL be cleared on unmount.

#### Decisions, not defects (record in 0.1)

- Free-tier venues accept GPS and QR check-ins while excluded from the map.
  Keep (honest presence, loyalty still works) or gate. Default: keep.
- `CHECKIN_PROXIMITY_MODE` for UAT: `legacy` or `shadow`, not `adaptive`,
  unless the adaptive radius is retuned for 30 to 100 m Android accuracy.
- Who's-here and check-in route limits for a demo day.
