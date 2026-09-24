# Design Document

## Overview

### Goals

- Make "N people found you on Area Code and checked in" a measurement, not a
  claim, by recording a sourced Venue_Open and stamping a server-derived
  `foundVia` on every check-in behind an Away_Gate.
- Fix the venue share link so a forwarded WhatsApp link previews the room
  alive and opens straight onto it.
- Put the Receipt in the five places an owner decides: live panel, Monday
  digest, trial emails, Plans panel, boost scoreboard. One computation.
- Give the owner one control over their night (Tonight) and one pipeline to
  watch (Going), without adding a second declaration store or letting intent
  masquerade as presence.
- Finish at a rehearsed, scripted UAT with recorded ship gates.

### Non-Goals

- Per-venue OG image rendering. Dynamic text, static or venue-photo image.
- Push to consumers with no relationship to the venue.
- Any change to `BANNED_CAUSAL_VERBS` or the digest's honest-copy posture.
- Changing map membership, ranking order, or the carousel camera contract.

### Architectural constraints (binding)

- Serverless only. No new tables, queues, schedules or Lambdas. Venue_Open,
  Going and scoreboard cache live in the app-data KV. Tonight lives in the
  existing music-schedules table as a Dated_Slot. Reminders ride the existing
  schedule transition tick.
- Handler to service to repository. `foundVia` is derived in the check-in
  service, never accepted from the client.
- One home per concept: `computeReceipt` is the only function that produces
  Found_You and Walk_In counts. Every surface calls it. Constants live in
  `packages/shared/constants/attribution.ts`.
- Honest copy enforced in code: the digest copy builder and its property
  test are extended, not paralleled. Email and dashboard render the same
  strings.
- Honest presence: Going is excluded from every aliveness input by type and
  by test.
- No coordinates persisted. `away` is a boolean computed on the client.

## Architecture

### Component map

```
consumer web (apps/web)
  /node/{slug}  ──Amplify 200 rewrite──►  GET /v1/share/node/:slug (HTML, OG tags)
                                            └─ script redirect ► /map?venue={slug}&src=share
  NodeDetailContent open ─► POST /v1/nodes/:nodeId/open { source, away }
  check-in ─────────────► POST /v1/check-in (unchanged body)
  TonightBlock + GoingButton ─► POST/DELETE /v1/nodes/:nodeId/going { date }
                              ─► push priming ► PATCH notification-preferences { tonightReminder: true }

backend (Lambda API)
  nodes/open-service.ts        putVenueOpen (KV, TTL = ATTRIBUTION_WINDOW, first wins)
  check-in/service.ts          readVenueOpen → awayGate → foundVia → createCheckIn → delete row
                               socket business:checkin{,_detail} carry foundVia
  reports/receipt.ts           computeReceipt(businessId, start, end)
  reports/digest.ts            + foundYou / walkIn / going metrics, + sentences
  business/service.ts          live-stats + foundYouToday/walkInsToday, receipt route,
                               boost scoreboard (live or cached)
  business/trial-reminder.ts   emails carry Receipt (or checklist nudge)
  music/schedule-*             Dated_Slot: date, headline, featuredRewardId
  nodes/service.ts             tonight summary in city payload + detail; goingCount
  workers/schedule-transition  at Dated_Slot start: fan out tonight_reminder to Going rows

business web (apps/business)
  OnboardingChecklistCard, LivePanel split, CheckInDetailPanel badge,
  PlansPanel receipt, BoostPanel scoreboard, TonightForm, DigestCard lines
```

### Phase 1: share leak and the receipt

#### Share route

Amplify custom rules are managed by script (`scripts/add-spa-rewrites.ps1`
and `scripts/apply-amplify-spa-rewrites.ps1` both exist; consolidate to one
per `dry-reuse-no-duplication.md` in task 1.4). Add, ahead of the SPA
fallback for the consumer app only:

```
source: /node/<*>   target: https://{API_HOST}/v1/share/node/<*>   status: 200
```

`GET /v1/share/node/:slug` (public, rate limited) renders:

- `<title>` and `og:title`: venue name.
- `og:description`: `buildShareSnapshot(node, pulse, presence, tonight)`,
  a pure function in `nodes/share-snapshot.ts`. Examples:
  "Buzzing · 12 here now · Amapiano tonight from 21:00 · 1 get live",
  "Quiet right now · Amapiano tonight from 21:00", "Be the first in".
  It uses the existing pulse state labels and the presence count; zero
  presence never reads as busy.
- `og:image`: node header image URL when set, else
  `https://www.areacode.co.za/og-image.png`.
- `og:url`: `https://areacode.co.za/node/{slug}`.
- `<script>location.replace('/map?venue={slug}&src=share')</script>` and a
  `<noscript>` link to the same path.

`getNodePublic` reads pulse with the same KV key as `getNodeDetail` and adds
`liveCheckInCount` from the presence read and `tonight` from the schedule
summary. The hard-coded `pulseScore: 0` is removed (no-fallbacks rule).

WhatsApp caches the preview at share time; the snapshot is a moment, and the
copy is written as one ("12 here now" at share time), which is honest.

`pathToRoute` gains `/node/{slug}` and `/map?venue=` handling. Both resolve
to the map route and write `{ slug, source }` to sessionStorage under
`pendingVenueArrival`, the same pattern as `pendingQrCheckIn` in `App.tsx`.
If the visitor is unauthenticated they go to login as today; the effect
that resumes `pendingQrCheckIn` after sign-in gains a sibling that resumes
`pendingVenueArrival`. Once authenticated and on the map, the first-paint
effect resolves slug to id from the city payload, calls `setFocusNodeId`
(the existing Focus_Signal path: fly to `MAP_ARRIVAL_ZOOM`, open Browse_Mode
with the venue as Active_Venue), records the Venue_Open with the stashed
source, and clears the stash. Commit_Mode still opens only from "View
details" (`map-carousel.md`); a share arrival lands on the card, not the
sheet, and no exception to the rule is added.

#### Venue_Open

Client: two triggers call `recordVenueOpen(nodeId, source, away)`:

- Deep-link arrival (share, push): fired by the arrival effect above with
  the stashed source, after auth. This is the only way `share` and `push`
  are ever recorded.
- Commit_Mode open: `NodeDetailContent` mount effect, once per open, with
  `search` when the selection came from the search input, else `map`.

Selecting a card in Browse_Mode is not a Venue_Open; it is too cheap a
signal and would flood the KV with every carousel step.

`away` is computed from the `mapStore` user position if fresh (the freshness
rule `vibeRank` already uses) via the shared haversine:
`away = distance > AWAY_DISTANCE_METRES` (500, the maximum check-in radius,
so unknown or borderline positions err toward `walk_in`); `null` when no
fresh position. Position never leaves the device.

Server: `POST /v1/nodes/:nodeId/open`, consumer auth, Zod body
`{ source: enum, away: boolean | null }`, rate limited. Service reads
`open:{userId}:{nodeId}`; if absent, writes `{ source, openedAt: now, away }`;
if present, merges `{ source: existing.source, openedAt: existing.openedAt,
away: existing.away || incoming.away }`. Either way the TTL is reset to
`ATTRIBUTION_WINDOW_HOURS * 3600` from now, so a consumer who opened at
14:00 and again at 19:00 still has a row at 20:30 while the time gate uses
the earliest open. Emits usage event `venue_open` with `{ source }` only
(`source` added to the props allowlist).

#### Away_Gate and `foundVia`

`packages/shared/constants/attribution.ts`:

```ts
export const ATTRIBUTION_WINDOW_HOURS = 6
export const AWAY_GATE_MIN_MINUTES = 20
export const AWAY_DISTANCE_METRES = 500
export const GOING_PUBLIC_THRESHOLD = 3
export const RECEIPT_MEASURED_FROM_ISO = '<set at Phase 1 deploy>'
export const FOUND_VIA = ['map', 'share', 'search', 'push', 'walk_in'] as const
export type FoundVia = (typeof FOUND_VIA)[number]
```

`check-in/attribution.ts` (pure):

```ts
export function resolveFoundVia(
  open: { source: OpenSource; openedAt: string; away: boolean | null } | null,
  checkInInstantIso: string,
): FoundVia
```

Rules: no row → `walk_in`; `openedAt` after the instant or older than the
window → `walk_in` (TTL normally guarantees this, the check is defensive);
`away === true` → source; `instant - openedAt >= AWAY_GATE_MIN_MINUTES` →
source; else `walk_in`. `checkInInstant` is `capturedAt` for an offline
replay, else now; a replay whose row expired while the phone was offline is
a `walk_in`, which errs in the honest direction.

`check-in/service.ts`: after proximity and cooldown pass, read the row,
resolve `foundVia`, pass it into `createCheckIn`, delete the row (best effort,
logged). QR check-ins go through the same code and have no row unless the
consumer opened the venue earlier, so a scan at the till is a `walk_in` by
construction. `CheckIn` gains `foundVia: FoundVia`. The body schema is left
non-strict (Zod strips unknown keys, and existing clients may send extras);
the service never reads `foundVia` from the body, and a unit test posts one
and asserts the stored value is server-derived. Socket
`BusinessCheckinPayload` and `BusinessCheckinDetailPayload` gain `foundVia`.

Shipping rule: tasks 2.1 to 2.4 land as one PR with the property tests; no
intermediate state writes `foundVia` without the gate.

#### Receipt

`reports/receipt.ts`:

```ts
export interface Receipt {
  foundYouVisitors: number
  walkInVisitors: number
  uniqueVisitors: number
  foundYouFirstTimers: number
  bySource: Record<Exclude<FoundVia, 'walk_in'>, number>
  suppressed: string[]
}
export async function computeReceipt(
  businessId,
  windowStartIso,
  windowEndIso,
  earliestCheckInByUser?: Map<string, string>,
): Promise<Receipt>
```

Reads check-ins for the business's active nodes in the window via the
existing NodeIndex reads (same as `computeDigest`), groups by user: a user
with any non-`walk_in` check-in is Found_You; all others are Walk_In.
Conservation: `foundYouVisitors + walkInVisitors === uniqueVisitors`.
`bySource` counts distinct users by their first Found_You source in the
window. `foundYouFirstTimers` intersects Found_You users with the digest's
existing first-timer set (`earliestCheckInByUser`, passed in by the digest
so the read happens once; other callers may omit it and get `0` with the
field listed in `suppressed`). Percentages suppressed below the floor.

`computeDigest` takes `uniqueVisitors` from the Receipt rather than a second
read, so the conservation property is structural, not coincidental.

Check-ins created before this spec have no `foundVia`; `computeReceipt`
treats absence as `walk_in`. Any window that starts before
`RECEIPT_MEASURED_FROM_ISO` carries a one-line annotation "measured from
{date}" so a partial week never reads as zero demand. New digest fields are
optional in `digestRowSchema` so stored history rows still parse.

#### Surfaces

- `getLiveStats` adds `foundYouToday`, `walkInsToday` (today in SAST, from
  `computeReceipt`). `LivePanel` renders two lines under check-ins today and
  increments the matching one on `business:checkin`.
- `CheckInDetailPanel` renders a small badge with the source label when
  `foundVia !== 'walk_in'`.
- `computeDigest` calls `computeReceipt` for the Digest_Week and adds the
  metrics; `buildDigestCopy` adds two sentences (headline on Found_You, second
  line on Walk_In) and a per-source clause when above the floor. Zero
  Found_You takes the quiet branch with a next step: share the venue or
  publish Tonight.

### Phase 2: the receipt in the sales flow

- `OnboardingChecklistCard` (`apps/business/src/components/panels/`), first
  card on the dashboard while any flag is false. Rows: venue, reward, staff,
  QR; each navigates to its panel. Hidden when complete. jsdom test for the
  five states.
- `GET /v1/business/receipt?window=trial|paid|week` on the business feature;
  resolves the window from `trialEndsAt - TRIAL_DAYS`, `paidUntil`, or the
  current Digest_Week. `PlansPanel` renders the Receipt above the upgrade CTA
  with the zero-state rule (checklist nudge, else share and Tonight).
- `trial-reminder.ts` and the renewal reminder call `computeReceipt` and
  render through one `buildReceiptCopy(receipt, checklist)` in the reports
  feature, which the digest builder also uses for its two lines. One copy
  home, one test.
- Boost scoreboard: `business/boost-scoreboard.ts` computes
  `{ window: {checkIns, foundYou, walkIns}, baseline: {...}, delta?, suppressed }`
  from check-ins by node and time range; baseline window is the same clock
  window minus 7 days. Open windows compute on read; closed windows are
  cached at `boost:score:{boostPk}:{boostSk}` with no TTL (12-month retention
  via the cleanup worker alongside the boost row). `BoostPanel` renders per
  purchase.

### Phase 3: Tonight and Going

#### Tonight as a Dated_Slot

`ScheduleSlot` gains `date?: string`, `headline?: string`,
`featuredRewardId?: string`. The Music_Schedule stays the one declaration
store, per live-vibe-declaration R1.4. Changes:

- `schedule-validator.ts`: dated slots may overlap weekly slots (they shadow
  them on that date) but not each other on the same date; `date` must be a
  valid local date not more than 14 days ahead; `headline` max 60 chars.
- Active-slot resolution (used by the live-archetype evaluator and the
  `tonight` summary): for a local instant, prefer a Dated_Slot on that date
  covering the instant; else the weekly slot.
- `nextTransitionAt`: include dated slot boundaries.
- Service: `featuredRewardId` must be an active reward of the same business,
  else 400.

Multi-venue businesses: the schedule is per business today and applies to all
its nodes. Tonight inherits that scope. A per-node scope is a founder decision
recorded in `docs/decisions/proof-of-demand.md`; the default is business scope.

`TonightForm` in the business portal: date (default today), mode and genres
or DJ, start and end, headline, one get (select from active rewards). Submits
through the existing schedule upsert. Shows the current status line
(promise or crowd) from `node.lastBranch` as `MusicSchedulePanel` does.

`nodes/tonight-summary.ts`: `summariseTonight(schedule, nowLocal, reward)`
returns `{ headline, startsAt, archetypeId, rewardTitle? } | null` when a
slot is active or starts later today; `rewardTitle` is omitted when the
featured reward is no longer active at read time. Included per node in
`assembleCityPayload` (one batched schedule read keyed by the distinct
`businessId`s in the city, not one read per node) and in `getNodeDetail` and
`getNodePublic`. The schedule upsert service deletes the city payload cache
key (`nodes:city:{slug}`) for the business's city so a freshly published
Tonight is on the map on the next request rather than after the cache TTL.

Consumer: `VenueCardVM` gains `tonight?` and `goingCount`. `VenueCard`
renders one line: "Tonight · {archetype} from {HH:mm} · {rewardTitle}".
`NodeDetailContent` gains `TonightBlock` above `CrowdVibeSection` with the
label rule from live-vibe-declaration ("Expected tonight" below the floor).

Flags: headline, time and get render without the live-vibe flags. The glyph
promise label uses the existing flag path. Provisioning the flags in prod is
a Phase 3 prerequisite decision (task 0.2).

#### Going

Rows, written as one `TransactWriteItems` pair and deleted as a pair:

- Venue row: `pk GOING#{nodeId}#{date}`, `sk USER#{userId}`,
  `{ markedAt, remindAt?, reminded? }`. Counting: `Select: COUNT` on the pk.
- Mirror row: `pk USER#{userId}`, `sk GOING#{date}#{nodeId}`. Erasure: the
  cleanup worker already deletes by `pk USER#{userId}`; it adds a
  `begins_with(sk, 'GOING#')` query and deletes each venue row it points to.
  No scan.

TTL on both rows: the Monday 12:00 SAST six hours after the digest pass that
covers the row's night, so the digest (Monday 22:00 UTC rule, computing the
just-closed week) can read the week's Going rows before they expire. Rows
therefore live at most 8 days.

`date` is the Going night from one pure helper `goingNightFor(nowIso)`: the
SAST calendar date, rolling over at 04:00 (a mark at 01:30 Saturday is
Friday's night). When the consumer marks Going from a Tonight block, the
night is the slot's `date`.

`goingCount` on node detail; `viewerGoing` only when a bearer token is
present (the detail route is public). `goingCount` on the city payload is
refreshed on the payload's cache TTL (acceptable staleness for a card line).

Surfacing rule (`GOING_PUBLIC_THRESHOLD = 3`):

- Card: the count renders only when `goingCount >= threshold` AND the node
  has a `tonight` summary. Otherwise the card says nothing about Going. The
  card already carries "Be the first in" for zero presence; it never gains
  a second "be the first" line, and quiet venues get no extra prompt on the
  map (`discovery-dna-vibe-over-convenience.md`).
- Detail `TonightBlock`: always offers the Going control. Below threshold
  and with a Tonight present it reads "Be the first to mark going"; without
  a Tonight it is just "Mark going tonight".
- Owner: the true count, including zero.

Deleting or editing the Tonight slot leaves Going rows in place; the
reminder fires only if a slot start still occurs for that node and night.

Isolation from aliveness: `pulseScore` inputs (`dailyCount`,
`livePresenceCount`) and `vibeRank` inputs are typed; Going is not among
them. Property test: for any node payload and any Going count, `pulseScore`,
`momentum`, beam brightness and the `vibeRank` order are unchanged.

Socket: `business:going { nodeId, date, goingCount }` emitted on toggle;
`LivePanel` shows "N marked going tonight".

Reminder: on marking Going for a node whose Tonight slot has a future start,
the sheet offers "Remind me when it starts". Accepting runs
`NotificationPrimingSheet` if permission is not granted, then PATCHes
`tonightReminder: true` (new key in `notification-preferences.ts`, default
false) and sets `remindAt` on the Going row. The schedule transition tick,
which already fires at slot boundaries via `nextTransitionAt`, adds: on a
Dated_Slot start, query Going rows for that node and date with `remindAt`
set and `reminded` false, send `tonight_reminder` through `sendNotification`
(socket primary, push fallback, preference-gated), mark `reminded`. Once
per row.

Digest line: "N marked going before doors, M of them checked in" from the
week's Going rows (still live on the Monday pass per the TTL rule above),
joined to that night's check-ins by `userId` in memory, aggregate only.
Ratio suppressed below the floor.

### Copy and guardrails

`buildReceiptCopy` and the extended `buildDigestCopy` share the vocabulary
list and the banned list. The honest-copy property test adds `revenue`,
`ticket`, `spend`, `will arrive`, `coming` to the rejected set for the new
sentences. Business marketing strings (business landing, Plans panel) are
moved to one i18n file and covered by the same test.

### Privacy

- Venue_Open: no coordinates, boolean `away`, TTL 6h, consumed on check-in.
- `foundVia`: enum only.
- Going: `userId` only, TTL at most 8 days, erasure worker deletes both rows
  of each pair via the `USER#{userId}` mirror query (no scan).
- Digest payload runs the existing PII scanner.

### Do not wake anything

Nothing in this spec enables a dormant path as a side effect. The live-vibe
flags are provisioned only by the explicit decision in task 0.2. Phone-OTP
routes, `VITE_SOCKET_URL`, `DEV_MODE` fixtures (including the mocked
`getLiveStats` values) and the retired gets tab stay exactly as they are;
the dev branch of `getLiveStats` gains the two new fields so dev renders,
nothing more.

### Phase 4a: photo upload on phones (R14)

One decode path, byte-sniffed gate, plain copy, CORS parity.

```
NodeEditorPanel.handlePhotoSelected
  sniffImageFormat(file)            // first 12 bytes → 'jpeg' | 'png' | 'webp' | 'heic' | 'unknown'
  ├─ unknown → "That file isn't a photo we can use. Pick a JPG or PNG."
  └─ compressImageFile(file)        // <img> + createObjectURL + decode() → canvas → toBlob(image/jpeg)
       ├─ decode fails, format heic → Most Compatible copy (R14.3)
       ├─ decode fails, other      → "This photo couldn't be read. Try a smaller one."
       └─ ok → presign → PUT → process (best effort, unchanged)
  mapUploadError(err)               // TypeError/Failed to fetch → CORS copy; 4xx/5xx → server copy
```

`sniffImageFormat` and `mapUploadError` are pure and unit tested; the
`<img>` decode replaces `createImageBitmap` outright (one path,
`no-fallbacks-no-legacy.md`). `imageCompression.ts` keeps the same exported
names so `nodeEditorPhoto.test.tsx` and the bugfix exploration tests keep
compiling; their assertions are updated where the gate changed.

Terraform: a `local.app_cors_origins` list in `infra/environments/prod/main.tf`
(and dev) feeds both the API CORS config and `module "s3_media"
allowed_origins`, so the bucket and the API can never disagree again.

### Phase 4a: defect sweep, non-obvious fixes (R15)

- **Live stats (R15.1).** Add `getCheckInsByNodeSince(nodeId, sinceIso)`
  that paginates to completion; `getLiveStats` calls it with
  `startOfSastDayIso()`. `totalCheckIns` moves to a maintained per-node
  counter incremented at check-in (the users table already keeps one per
  user; mirror the pattern on the node row) so the dashboard never pays a
  full history scan.
- **Midnight TTL (R15.2).** `kvIncr(key, ttlSeconds)` gains an optional
  absolute expiry; the check-in service passes `secondsUntilNextSastMidnight()`
  from a shared SAST helper (`shared/time/sast.ts`, one home; the three
  existing inline `SAST_OFFSET_MS` copies in `business/repository.ts`,
  `pulse-decay.ts` and `digest.ts` move to it).
- **Check-out (R15.3).** After `endPresenceByCheckOut`, delete
  `cooldown:{userId}:{nodeId}` and write `pulse:{cityId}:{nodeId}` with the
  same formula the check-in path uses, lifted into one `computePulse(daily,
live)` function both call.
- **Seconds vs milliseconds (R15.4).** `getLivePresenceCount(nodeId, nowSeconds)`
  gets a branded `EpochSeconds` parameter type so the compiler catches the
  next mismatch; callers pass `Math.floor(Date.now() / 1000)`.
- **Cache invalidation (R15.5).** `nodes/cache.ts` exports
  `invalidateCityPayload(nodeId)` (resolve city slug, `kvDel(nodes:city:{slug})`).
  The webhook path resolves the node from the boost purchase row. A unit test
  enumerates the write functions and asserts each calls it.
- **First-paint live counts (R15.6).** Presence already maintains a per-node
  counter (`setCounter`); `assembleCityPayload` batch-reads
  `presence:count:{nodeId}` alongside the pulse keys in the same
  `kvBatchGet`. Absent key means zero, honestly.
- **SAST day partition (R15.8).** `BIZ_CHECKIN#{businessId}#{sastDate}` for
  new writes; `getCheckInDetails(date)` queries the SAST key and, for dates
  before `RECEIPT_MEASURED_FROM_ISO`, also the UTC key and merges. Recorded
  as a decision because it is a key-shape change.
- **Boost return (R15.11).** The Yoco success URL already carries the
  checkout id back to the portal; `useBoostCheckoutReturn` reads it from the
  query string and lands when a purchase row with that `yocoCheckoutId`
  appears. The baseline logic is deleted.
- **Error copy (R15.13).** One `describeApiError(err)` in
  `packages/shared/lib/api` maps `statusCode` and `error` code to copy;
  callers stop reading `err.message`. Cognito `error_description` is logged,
  never rendered.
- **Staff camera (R15.16, R15.17).** `startCamera` branches on `err.name`;
  every branch calls `stopCamera()`. The scan interval sets `inFlightRef`
  around `detect()` and checks `stoppedRef` before calling
  `handleCodeScanned`.
- **Storage (R15.19).** `packages/shared/lib/safeStorage.ts` wraps
  `sessionStorage` and `localStorage` get/set/remove in try/catch and returns
  `null`/`false`; the OAuth start shows the private-mode message when `set`
  returns false. `pendingQrCheckIn` and the new `pendingVenueArrival` both
  use it.
- **Notification priming (R15.20).** Detect iOS Safari without
  `window.navigator.standalone` and show the Home Screen instruction; treat
  a missing VAPID key as a configuration error surfaced in the sheet.

## Testing strategy

Property tests (fast-check, min 100 runs, block-statement predicates):

- Feature: Proof of demand, Property 1: `resolveFoundVia` returns `walk_in`
  whenever the row is absent, expired, or fails both gates; returns the
  source otherwise; is pure.
- Property 1b: Venue_Open merge keeps the earliest `openedAt` and source,
  ORs `away`, and never shortens the TTL.
- Property 2: Receipt conservation, `foundYou + walkIn === unique`,
  `foundYouFirstTimers <= foundYou`, all non-negative integers, `bySource`
  sums to `foundYou`.
- Property 2b: `goingNightFor` maps every instant in `[04:00, 04:00 + 24h)`
  SAST to the same night date.
- Property 3: Honest copy, no banned verb, no `revenue|ticket|spend`, no
  `will arrive|coming`, zero Found_You takes the quiet branch with exactly
  one next step.
- Property 4: Share snapshot never reads as busy with zero presence; always
  contains the venue name; under 200 chars.
- Property 5: Going isolation, aliveness and ranking outputs invariant under
  Going count.
- Property 6: Dated_Slot shadowing, resolver prefers the dated slot on its
  date and the weekly slot elsewhere; `nextTransitionAt` is the soonest
  boundary across both.
- Property 7: Boost scoreboard baseline is exactly the same clock window 7
  days earlier; deltas suppressed below the floor.
- Property 8: Going threshold copy, count shown iff `>= threshold`.
- Property 9: `sniffImageFormat` classifies any byte prefix deterministically
  and never returns `jpeg|png|webp|heic` for a prefix lacking the magic.
- Property 10: `secondsUntilNextSastMidnight(now)` is in `(0, 86400]` and
  `now + result` lands exactly on a 00:00 SAST boundary.
- Property 11: `describeApiError` never returns a string containing
  `DOMException`, `TypeError`, `error_description`, a URL, or a stack frame.

jsdom component tests: `OnboardingChecklistCard` states, `LivePanel` split
and socket increments, `PlansPanel` receipt and zero state, `BoostPanel`
scoreboard, `TonightForm` validation, `VenueCard` Tonight line, `TonightBlock`
label rule and Going control.

Playwright: consumer share link open, card Tonight line, Going toggle;
business checklist, live split, receipt, scoreboard.

## Rollout and UAT

0. Phase 4a (photo upload and the defect sweep) has no dependency on
   Phases 1 to 3 and starts in parallel on day one. It must be complete
   before the UAT environment is cut; testers hit these in the first ten
   minutes.
1. Phase 0 decisions recorded, then Phase 1 in two PRs: share route (1.x)
   and receipt (2.x plus 3.x). Deploy to dev, rehearse the Found_You and
   Walk_In paths with two phones.
2. Phase 2 in one PR per surface. Verify a trial email in dev SES.
3. Phase 3: Dated_Slot first (schema and resolver, no UI), then Tonight
   surfaces, then Going, then the reminder.
4. Phase 4: seed, rehearsal, Playwright, UAT script, ship gates. UAT runs
   with three real owners on dev for one week; the Monday digest of that
   week is the acceptance artifact.

## Founder decisions (record in `docs/decisions/proof-of-demand.md`)

- `ATTRIBUTION_WINDOW_HOURS` default 6, `AWAY_GATE_MIN_MINUTES` default 20,
  `GOING_PUBLIC_THRESHOLD` default 3.
- Live-vibe flags provisioned in prod or not before Phase 3.
- Tonight scope: business-wide (default) or per node.
- Reminder timing: at slot start (default) or a lead time.
- Consolidate the two Amplify rewrite scripts into one.
- Free-tier venues accepting check-ins while off the map: keep (default) or
  gate.
- `CHECKIN_PROXIMITY_MODE` for UAT: `legacy` or `shadow`.
- Who's-here and check-in route limits for a demo day.
- `BottomNav` bottom safe-area: keep the flush trade-off or add the inset.
