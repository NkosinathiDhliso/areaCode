# UAT script: proof of demand

Manual acceptance script for the proof-of-demand spec (the Receipt, Tonight,
Going). Run it on the UAT environment with real devices, real accounts and the
dev seed in place.

> **Status:** the script is complete. Every scenario below has an automated
> counterpart that runs under `pnpm test`, and the live-stack pass is still
> outstanding: nothing in this file has yet been run against a deployed dev
> environment with real devices, real SES delivery and a real Yoco checkout.
> The automated rehearsal is
> `backend/src/features/reports/__tests__/proof-of-demand-rehearsal.test.ts`
> (spec task 12.2); it states at the top exactly which steps only a human on the
> live stack can prove.

## Environment

| Setting                    | UAT value | Why                                                              |
| -------------------------- | --------- | ---------------------------------------------------------------- |
| `CHECKIN_PROXIMITY_MODE`   | `shadow`  | Decision 8: enforcement is identical to prod, divergence logged. |
| Check-in radius            | 500 m     | Legacy flat radius, enforced in `shadow`.                        |
| `ATTRIBUTION_WINDOW_HOURS` | 6         | Maximum gap between opening a venue and checking in.             |
| `AWAY_GATE_MIN_MINUTES`    | 20        | Time arm of the Away_Gate.                                       |
| `AWAY_DISTANCE_METRES`     | 500       | Distance arm. Matches the check-in radius.                       |

Because `shadow` enforces the flat 500 m radius, "away from the venue" in this
script means **more than 500 m away** at the moment the venue is opened. Closer
than that and the client sends `away: false`, so the open can only earn credit
through the 20-minute time arm.

Decisions and the values above: `docs/decisions/proof-of-demand.md`.

## Roles and accounts

Six people can run the whole script: three owners, two consumers on their own
phones, and one staff member. The remaining ten tester accounts exist so the
Going threshold and the feed have volume behind them.

| Role         | Account                                              | Surface         | What this role proves                                                          |
| ------------ | ---------------------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| Owner A      | `kudu@seed.areacode.invalid`, Kudu Bar (seed)        | business portal | live panel split and Going line, Tonight form, boost scoreboard, Monday digest |
| Owner B      | `thembi@seed.areacode.invalid`, Thembi Coffee (seed) | business portal | the suppressed branch: absolute counts render, derived figures are withheld    |
| Owner C      | `loft@seed.areacode.invalid`, Loft 46 (seed)         | business portal | Onboarding_Checklist card, the zero-Found_You branch, the trial reminder email |
| Consumer 1   | `seed-pod-t01`, phone A                              | consumer web    | share-link open, Found_You check-in, Going with the reminder opt-in            |
| Consumer 2   | `seed-pod-t02`, phone B                              | consumer web    | cold QR Walk_In                                                                |
| Consumers 3+ | `seed-pod-t03` to `seed-pod-t12`                     | consumer web    | Going volume either side of the threshold, feed activity                       |
| Staff        | invited during S6, no seeded account                 | staff validator | redemption validation, and completing the Onboarding_Checklist                 |

Tiers and windows come from the seed: Kudu Bar is Growth with an active
Boost_Window, Thembi Coffee is Starter on a paid period, Loft 46 is Starter still
on trial. All three are paid tiers, so all three venues are on the consumer map.

`seed-pod-t01` and `seed-pod-t02` are the two accounts seeded with
`tonightReminder` on, which is why they are the two phones: the Tonight_Reminder
in S4 only reaches a consumer whose notification preference allows it.

Seeded rows carry no `cognitoSub`, so a seeded account cannot be signed into as
it stands. Read "Signing in as a seeded account" below before handing a phone to
a tester.

The two-phone scenario below needs:

- one paid-tier venue with QR check-in enabled and its QR printed or on screen;
- two consumer accounts, each on its own phone, neither of which has checked in
  at that venue on the current SAST day;
- the owner signed in to the business portal with the live panel open.

## Scenarios

### S1. Two phones: Found_You from the map, Walk_In from the QR

Proves the split an owner reads is a real measurement: one consumer who found
the venue on Area Code before arriving, one who was already in the room.

Automated counterpart (same logic, mocked devices):
`backend/src/features/reports/__tests__/two-device-rehearsal.test.ts`. That test
does not cover a real handset position, a real camera scan, or the panel
re-rendering, which is why this pass is run on devices.

**Before you start:** note the SAST date and confirm the venue's live panel
reads `checkInsToday = 0`, Found_You 0 and Walk_In 0. If it does not, use the
observed numbers as the baseline and expect each count to move by exactly 1.

#### Phone A: Found_You (`map`)

1. Stand **more than 500 m** from the venue, with location permission granted.
2. Open the consumer app, Map tab, and select the venue, then tap **View
   details** to open the venue sheet. This is the Venue_Open: the app posts
   `POST /v1/nodes/{nodeId}/open` with `source: map` and `away: true`. Confirm a
   `204` in the network tab if you have DevTools attached.
3. Do **not** check in yet. Travel to the venue, and let **at least 20 minutes**
   pass between the open and the check-in, and no more than 6 hours.
4. At the venue, check in by GPS (the normal check-in CTA, not the QR).

Expected:

- the check-in succeeds;
- the live panel Found_You count moves from 0 to **1**;
- the check-ins panel row for this visit carries a source badge reading **from
  the map**.

#### Phone B: Walk_In (cold QR)

1. On the second phone, signed in as the second consumer, do **not** open the
   venue in the app first. If that account opened the venue within the last
   6 hours, use a different account: the row lives for the Attribution_Window.
2. At the venue, scan the printed QR and complete the check-in.

Expected:

- the check-in succeeds;
- the live panel Walk_In count moves from 0 to **1**;
- the check-ins panel row for this visit carries **no** source badge.

#### Expected numbers and copy

With both phones done, on a venue that had no other check-ins that SAST day:

| Field           | Expected |
| --------------- | -------- |
| `checkInsToday` | 2        |
| `foundYouToday` | 1        |
| `walkInsToday`  | 1        |

The live panel renders these two sentences verbatim:

```
1 person found you on Area Code and checked in today.
1 person who was already in the room also checked in.
```

Both sentences are generated, so read them exactly. A second walk-in would
change the second line to "2 people who were already in the room also checked
in."; a second Found_You would change the first to "2 people found you on Area
Code and checked in today."

Both counts must also move **live**, without a reload: the `business:checkin`
event carries the source. Reload afterwards to confirm the poll
(`GET /v1/business/me/live-stats`) reports the same two numbers.

#### If a count does not move as expected

- **Phone A reads as a Walk_In.** Check, in order: the open returned `204`; the
  check-in happened at least 20 minutes after the open; the open happened more
  than 500 m out (inside that, `away` is `false` and only the time arm counts);
  the gap was under 6 hours.
- **Phone A's badge is missing but the count moved.** The stamp is right and the
  badge render is the defect. Record it against R4.4.
- **Phone B reads as Found_You.** That account had an unconsumed Venue_Open for
  this venue. Note when it opened the venue; the row is only consumed by a
  check-in or by its own expiry.
- **Nothing moves until reload.** Socket delivery, not attribution. Record it
  against R4.3.
- **A check-in is refused at the door.** Record the distance and the reported
  GPS accuracy; `shadow` mode logs where the adaptive radius would have
  differed.

#### Record for each run

Date and time (SAST), phone and OS, browser, distance at open, minutes between
open and check-in, the three counts observed, the two sentences copied verbatim,
and pass or fail.

### S2. Share link: the preview and the landing

Proves the leak this spec opened with is closed: a venue link forwarded in a
group chat previews the room and lands the person on that venue, with the source
recorded (R1.1, R1.2, R1.7, R12.2).

Automated counterpart: act 1 of
`backend/src/features/reports/__tests__/proof-of-demand-rehearsal.test.ts`. It
cannot cover a real crawler unfurling the card or a browser following the
redirect, which is why this pass is run by hand.

1. Open the business portal as Owner A and copy the venue's share link, or build
   it by hand: `https://areacode.co.za/node/kudu-bar-seed`.
2. Paste it into a WhatsApp chat with yourself and wait for the card to render.
   Do not send it yet.
3. Send it, then tap the card on a phone that is **signed out** of the consumer
   app.
4. Sign in when prompted.
5. Repeat step 3 on a phone that is already signed in.

Expected, on the WhatsApp card:

- the title is the venue name, exactly `Kudu Bar (seed)`;
- the description is the live snapshot line, in this shape and order:

```
Kudu Bar (seed) · Active · 3 here now · Amapiano all night, Kabza tribute set tonight from 18:00 · 1 get live
```

The numbers in that line are live, so read the shape, not the digits. The rules
behind it are fixed and each is a pass or fail on its own: the venue name always
leads; a venue with nobody in it reads `Quiet right now`, or `Be the first in`
when it has no pulse either, and **never** `Active`, `Buzzing` or `Popping`; the
live count appears only when it is above zero; the Tonight clause carries the
owner's headline and the local start time; the get clause is last.

Expected, on the landing:

- the app opens on the Map tab with the venue as the active card in the browse
  strip, not on the venue detail sheet and not on a blank map;
- the signed-out phone lands on the same venue **after** sign-in, not on the
  default map;
- the URL carries `src=share` (`/map?venue=kudu-bar-seed&src=share`);
- a Venue_Open is recorded once per landing, so the next check-in by that
  account inside 6 hours can read as Found_You from a shared link.

With JavaScript disabled the page shows the venue name, the snapshot line and one
link reading `Open Kudu Bar (seed) on Area Code`.

Record: the rendered card as a screenshot, the tier of the phone's messaging app,
whether the signed-out path preserved the venue, and the `src` value on the
landing URL.

### S3. Tonight on the card and on the venue detail

Proves the anticipation magnet works on an empty room: a reason to go there
tonight, published by the owner and read by a stranger (R8.3, R8.5 to R8.8).

1. As Owner A, open **Tonight** on the dashboard and confirm today's night is
   published: the headline, the 18:00 to 23:30 window, and the featured get.
2. On a consumer phone, open the Map tab and find the venue in the browse strip.
3. Tap **View details**.

Expected on the venue card, as one line under the live count, never above it and
never with a distance:

```
Tonight · Amapiano all night, Kabza tribute set from 18:00 · Free welcome drink
```

Expected on the venue detail, above the Crowd Vibe section, labelled:

```
Expected tonight
```

The label reads `In the room now` instead only when the backend has resolved the
venue to a live crowd. Anything else, including both live-vibe flags being dark,
reads `Expected tonight`. The headline, the time and the get render either way.

A venue with nothing published for today renders **no** Tonight line and no
placeholder. Check that on Loft 46 after deleting its slot.

Record: both screenshots, the label observed, and whether any distance appeared
on the card.

### S4. Going: the threshold, and the reminder at slot start

Proves intent is recorded and surfaced as intent, and that the person who asked
to be told is told once (R9.1 to R9.7, R9.10).

Automated counterparts: acts 3 and 7 of the rehearsal test. They cannot cover a
push notification arriving on a handset or the minute tick firing in EventBridge.

1. On phone A (`seed-pod-t01`), open the venue detail and read the Going control
   before touching it.
2. Tap it.
3. Accept the reminder offer that appears.
4. Wait for 18:00 SAST, the seeded slot start, with the app closed.
5. Open the venue detail for Thembi Coffee, then for Loft 46, without marking.

Expected copy, verbatim:

| State                                              | Where         | Copy                                                       |
| -------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| Not marked, somebody else has                      | detail        | `Mark going tonight`                                       |
| Not marked, nobody has, and a Tonight is published | detail        | `Be the first to mark going`                               |
| Marked by this consumer                            | detail        | `You marked going tonight`                                 |
| Count, at or above the threshold                   | card + detail | `5 marked going tonight`, the number then the phrase       |
| Reminder offer                                     | detail        | `Remind me when it starts` and `No thanks`                 |
| Reminder accepted, push available                  | detail        | `We will tell you when it starts.`                         |
| Reminder accepted, push unavailable                | detail        | the same promise plus the in-app caveat, never a silent no |

Expected counts, with `GOING_PUBLIC_THRESHOLD` at 3:

- Kudu Bar starts at 5 marks and becomes 6 after phone A. The venue **card**
  shows the count because the venue is above the threshold and has a Tonight.
- Thembi Coffee has 2 marks. The card shows **nothing** about Going, and gains no
  "be the first" line either. The detail still offers the control.
- Loft 46 has 0 marks and reads `Be the first to mark going` on the detail only.

Expected reminder, at the slot start:

- exactly one notification, titled `Tonight at Kudu Bar (seed)`, reading
  `Amapiano all night, Kabza tribute set is starting now at Kudu Bar (seed).`;
- no second notification on any later minute;
- nothing arrives on phone B, which never marked going;
- nothing arrives for a consumer who marked going but declined the reminder.

The wording is about the room, never about a person. Anything reading "coming",
"on the way" or "will arrive" is a failure of R9.3.

Delete the slot before 18:00 in a second run: the mark survives, and **no**
reminder is sent (R9.10).

Record: the control copy at each state, the two counts before and after, the
notification text verbatim, the minute it arrived, and whether any duplicate
followed.

### S5. The live panel: four counts on one screen

Proves the owner reads a split they can act on, and that it moves without a
reload (R4.3, R9.5, R15.10).

Automated counterpart: act 4 of the rehearsal test.

As Owner A, open the live panel and leave it open for the whole of S1 to S4. It
must show, at once: check-ins today, the Found_You count, the Walk_In count, and
the Going line per venue.

Expected, on the seeded day before any tester activity:

| Venue         | Line 1                                                        | Line 2                                                        | Going line               |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| Kudu Bar      | `2 people found you on Area Code and checked in today.`       | `2 people who were already in the room also checked in.`      | `5 marked going tonight` |
| Thembi Coffee | `1 person found you on Area Code and checked in today.`       | `1 person who was already in the room also checked in.`       | `2 marked going tonight` |
| Loft 46       | `No one has found you on Area Code and checked in today yet.` | `No check-ins were recorded from people already in the room.` | none                     |

After S2 to S4 at Kudu Bar, each of the first three numbers has moved by exactly
one and the Going line reads `6 marked going tonight`.

A measured zero renders. A venue whose Going partition could not be counted is
**absent** from the panel rather than shown as zero: unmeasured is not zero. Loft
46 has no Going line at all because nothing has been marked there.

Record: the four counts before and after, whether each moved live or only on
reload, and the two sentences verbatim.

### S6. Onboarding_Checklist card

Proves a new owner is told the one thing to do next instead of being shown an
empty dashboard (R5.1, R5.2).

1. Sign in as Owner C (Loft 46, on trial). The card is the first thing on the
   dashboard.
2. Tap `Open` on the staff row and invite a staff member.
3. Return to the dashboard.

Expected:

- the card is titled `Finish your setup` and carries a progress reading in the
  form `3 of 4 done`;
- three rows are complete (venue, get, QR) and one is not, reading
  `Invite a staff member to validate redemptions` with an `Open` control that
  deep-links to the staff panel;
- once the staff member is invited the card **disappears** rather than sitting
  there at four of four.

The other two row texts, for the states you will see on a fresh business, are
`Add your venue so it appears on the map` and
`Publish one get so a first-timer has a reason to walk in`.

Record: the progress reading, which rows were open, and whether the card hid
itself once complete.

### S7. Plans panel Receipt

Proves the upgrade decision is made against a measurement, not a pitch (R6.2,
R6.3).

1. As Owner C (on trial), open **Plans**. The Receipt sits above the plan cards.
2. As Owner B (on a paid period), open **Plans**.

Expected as Owner C, whose trial window recorded no Found_You:

```
No one has found you on Area Code and checked in during your trial.
2 people who were already in the room also checked in.
Invite a staff member so redemptions get validated at the till.
```

That third line is the single next step, and it names the checklist flag that is
actually false. Unlike the Monday digest, this surface reads the
Onboarding_Checklist, so complete the checklist in S6 and the line becomes
`Share your venue link with your regulars, and publish what is on tonight.` A
`Finish this step` control sits beside it.

Expected as Owner B, whose window is the current paid period and therefore wider
than the seeded week, so read the shape rather than the digits:

```
N people found you on Area Code and checked in during your paid period.
M people who were already in the room also checked in.
```

The window phrase must be `during your paid period`, and with a Found_You count
below the Suppression_Floor of 5 there is **no** first-timer clause and **no**
`Recorded sources:` clause: the sample is too small to carry either, so they are
omitted rather than shown at low confidence. Cross-check `N` and `M` against the
same owner's live panel and Monday digest; three different numbers for the same
visits is a failure of R4.1.

A failed Receipt read must show an error and must **not** disable the plan
buttons below it.

Record: the sentences verbatim, the window phrase, and whether the plan buttons
stayed usable.

### S8. Boost scoreboard

Proves a paid window reports what it recorded, next to the same hours a week
earlier, and claims nothing (R7.1 to R7.5).

Automated counterpart: act 5 of the rehearsal test. The seed deliberately writes
no purchase row, so this pass needs a real dev Yoco checkout.

1. As Owner A, buy a 2 hour boost through the dev checkout.
2. Wait for the window to close.
3. Open the boost panel and read the scoreboard on that purchase.
4. Reload and read it again.

Expected, in this order, with the counts from your own window:

```
2 found you on Area Code and checked in during the window.
In the window: 4 check-ins from 4 people · 2 found you · 2 already in the room
Same hours last week: 0 check-ins from 0 people · 0 found you · 0 already in the room
Too few check-ins in one of the two windows to compare them.
```

A window with nothing in it reads
`No one found you on Area Code during this window.` and
`No check-ins were recorded in this window.` A window still running adds
`This window is still open, so these counts can still change.`

The comparison line appears **only** when both windows clear the
Suppression_Floor, and then reads
`Against last week: +3 found you, +5 check-ins`, with a signed number. A quieter
window than last week shows a negative, which is a real answer.

Nothing on this card may say the boost brought, drove, generated or boosted
anyone. A closed window must read identically on the reload: it is history, not a
fresh calculation.

Record: all four lines verbatim, the window bounds, and whether the reload
changed a single digit.

### S9. The Monday digest: the acceptance artifact

Proves the whole week lands as one honest paragraph in the owner's inbox and on
the dashboard card (R4.5 to R4.7, R9.8, R13.6).

Automated counterparts: acts 6 and 8 of the rehearsal test, plus
`digest-pipeline-rehearsal.test.ts`. Neither covers SES delivery or the
EventBridge Monday trigger.

The weekly pass fires Monday 06:00 SAST. On that Monday, for each of the three
owners, read the Digest_Email and the dashboard digest card side by side.

Expected: the copy opens with the Receipt lines recorded under "Exact expected
Monday digest copy" above, then carries the Going line, then the tier close. The
card and the email render the **same** ordered lines; a difference between them
is a failure of R4.6.

The Going line reads, for a week above the Suppression_Floor:

```
6 marked going before doors, 1 of them checked in.
```

Below the floor the overlap is withheld and the absolute count still renders:
`4 marked going before doors.` A week that recorded no Going at all reads
`0 marked going before doors.`, which is a measured zero, not a claim. The line
is an overlap, never a forecast: anything reading "coming" or "will arrive" is a
failure.

The tier close is
`Your full weekly report has the complete breakdown. Open it from your dashboard.`
for Kudu Bar on Growth, and
`The full weekly report adds peak-hours analysis. Upgrade to unlock it.` for the
two Starter businesses.

The digest reads **no** Onboarding_Checklist, so Loft 46's zero-Found_You next
step is the share-and-Tonight line, not the staff line. The staff line is what the
Plans panel (S7) and the trial email (S10) show, because those two do read the
checklist.

Record: both the email and the card copy verbatim, the delivery time, the week
start, and whether the two agreed line for line.

### S10. Trial reminder email

Proves the owner deciding whether to pay is shown a measurement first (R6.1,
R6.3, R6.5).

1. Put Owner C's `trialEndsAt` inside the reminder window.
2. Run the trial reminder pass.
3. Read the email in the dev SES inbox.

Expected: the Receipt lines for the trial window, worded exactly as the Plans
panel words them in S7, including the checklist nudge when Found_You is zero.
The same sentences, from the same builder, in the same order. A number in the
email that the Plans panel does not show, or vice versa, is a failure.

Record: the email as received, and the Plans panel beside it.

## Phone photo upload matrix (R14.8)

The business header photo is uploaded from the owner's phone: the browser
downscales and re-encodes the file to JPEG, asks the API for a presigned URL and
PUTs the bytes straight to S3. Three things used to break that on a phone and
each has a row below: the MIME label from the picker, the HEIC decode, and the
CORS agreement between the API and the media bucket.

Run every row on a real handset, signed in to the business portal, with the node
editor open on a venue you own. The gate is the file's leading bytes, not its
MIME type or its extension, so a photo named `.jpg` that is really HEIC behaves
as HEIC.

Automated counterparts (same logic, no devices):
`packages/shared/lib/__tests__/imageCompression.test.ts` and
`apps/business/src/screens/panels/__tests__/nodeEditorPhoto.test.tsx`. They cannot
cover a real picker, a real WebKit HEIC decode or a real S3 preflight, which is
why this pass is run on phones.

| #   | Device and browser                                                 | What to select                                                   | Expected result                                                                         | Copy line         |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| P1  | iPhone, Safari in browser, Camera Formats = **High Efficiency**    | New camera photo from Photos (HEIC, picker reports `image/heic`) | Upload succeeds. WebKit decodes HEIC, the stored file is JPEG, the header photo renders | `Photo uploaded.` |
| P2  | iPhone, Safari in browser, Camera Formats = **Most Compatible**    | New camera photo from Photos (JPEG)                              | Upload succeeds                                                                         | `Photo uploaded.` |
| P3  | iPhone, Safari in browser                                          | A JPG via **Browse** (iOS Files app / iCloud Drive)              | Upload succeeds                                                                         | `Photo uploaded.` |
| P4  | iPhone, **installed PWA** (Add to Home Screen, launched from icon) | The same High Efficiency photo as P1                             | Identical to P1. Standalone display mode changes nothing: same engine, same origin      | `Photo uploaded.` |
| P5  | Android, Chrome, gallery picker                                    | New camera photo (picker reports an **empty MIME type**)         | The picker shows camera photos at all (`accept="image/*"`), and the upload succeeds     | `Photo uploaded.` |
| P6  | Android, Chrome, **Files** app picker                              | A JPG from Downloads                                             | Upload succeeds                                                                         | `Photo uploaded.` |
| P7  | Android, Chrome                                                    | A **HEIC** file copied off an iPhone                             | Rejected after the decode attempt, not at the gate. No `DOMException` text on screen    | `heic-decode`     |
| P8  | **Older Android WebView** with no `img.decode()` (in-app browser)  | Any JPG                                                          | One clear line, no crash and no raw error. Record the WebView version                   | `decode`          |
| P9  | Android mid-range, Chrome                                          | A **48MP original** under 25MB                                   | Upload succeeds and the stored file is downscaled, not the original bytes               | `Photo uploaded.` |
| P10 | Any phone                                                          | A photo **over 25MB**                                            | Rejected before any decode or network call                                              | `too-large`       |
| P11 | Any phone                                                          | A **PNG screenshot**                                             | Upload succeeds, stored as JPEG                                                         | `Photo uploaded.` |
| P12 | Any phone                                                          | A non-photo file renamed `.jpg` (for example a text file)        | Rejected at the byte-sniff gate, no presign request is made                             | `format`          |
| P13 | Any phone, portal opened on the **Amplify default URL**            | Any valid JPG                                                    | Upload succeeds. This is the 13.5 regression check: API and bucket share one list       | `Photo uploaded.` |
| P14 | Any phone, portal opened on an origin **outside** the shared list  | Any valid JPG                                                    | The presigned PUT is blocked by the browser while API calls still succeed               | `network`         |

### Exact expected copy

The copy lines above are the keys of `UPLOAD_ERROR_COPY` in
`packages/shared/lib/imageCompression.ts`. Read the message on the phone against
this table verbatim. Anything else, including any `DOMException` or
"Failed to fetch" text, is a failure of R14.5.

| Key           | Exact copy                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `format`      | That file isn't a photo we can use. Pick a JPG or PNG.                                                          |
| `heic-decode` | This photo format can't be read in this browser. In your camera settings choose Most Compatible, or pick a JPG. |
| `decode`      | This photo couldn't be read. Try a smaller one.                                                                 |
| `too-large`   | Image must be under 25MB.                                                                                       |
| `network`     | Upload blocked. Open the portal at business.areacode.co.za and try again.                                       |
| `server`      | Upload failed on our side. Please try again in a moment.                                                        |
| `unknown`     | Upload failed. Try again, or pick a different photo.                                                            |

Success shows `Photo uploaded.` and clears after three seconds.

### Reading the CORS rows

P13 and P14 are the two halves of one check. The upload is a presigned PUT to
`area-code-prod-media`, so the bucket's CORS rule and the API's allowed origins
must list the same hosts. They are now one Terraform list,
`local.app_cors_origins` in `infra/environments/{dev,prod}/main.tf`, passed to
both the API Gateway module and the S3 media module (task 13.5, R14.6).

So P13 must pass: the Amplify default URLs are on the shared list. P14 is the
negative control, and the only honest way to produce it is an origin that is on
neither list. If P13 shows the `network` line, the shared list has not been
applied to the environment under test.

### Record for each row

Row, date (SAST), device and OS version, browser and version, installed as a
PWA or in browser, the origin host, the camera format setting, the file name,
size and megapixels, the message observed verbatim, whether the header photo
rendered afterwards, and pass or fail.

## Expected numbers from the seed

Produced by `backend/src/scripts/seed-proof-of-demand.ts` (spec task 12.1). The
seed is dev only: it refuses to run unless `AREA_CODE_ENV` is set explicitly and
is not `prod`, and it refuses if any target table name looks like a production
table.

```bash
cd backend
AREA_CODE_ENV=dev npm run seed:proof-of-demand -- --dry-run   # preview, no writes
AREA_CODE_ENV=dev npm run seed:proof-of-demand                 # apply
```

It is idempotent. Every seeded id is deterministic, so a re-run replaces the same
rows rather than doubling them, and counters are set to the derived value rather
than incremented. A clean dry run reports 135 rows.

Ids come in two shapes. `nodeId` and `rewardId` are UUIDs, because the routes that
take them in a URL path validate them as UUIDs (`nodeIdParamsSchema`,
`rewardIdParamsSchema`): a readable id there would make every venue detail, Going
mark and redemption answer `400 Invalid UUID`. They are derived by `seedUuid` from
the seed prefix and the venue key, so they are fixed across runs and recomputable.
Every other seeded id stays readable and prefixed `seed-pod-`, which is what tells
a seeded row apart from a tester's real one.

The three venue ids, for reading a row straight out of DynamoDB or hitting a route
by hand:

| Venue         | `nodeId`                               |
| ------------- | -------------------------------------- |
| Kudu Bar      | `9392a64f-ca2d-573d-bc1c-2a5af5245616` |
| Thembi Coffee | `12733236-a53e-5e54-bf94-3a9d4da01344` |
| Loft 46       | `8dde3f6e-3f15-5cd6-b160-0475f21a8dce` |

### What it creates

| Thing            | Count | Detail                                                                                                                                                  |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Businesses       | 3     | One Growth with an active Boost_Window, one Starter on a paid period, one Starter still on trial. All three tiers are paid, so all three are on the map |
| Venues           | 3     | Johannesburg, active, verified, QR check-in on, one active get each                                                                                     |
| Tonight          | 3     | One Dated_Slot per venue for today, 18:00 to 23:30 SAST, each featuring that venue's get                                                                |
| History accounts | 20    | `seed-pod-h-{venue}-{f01,w01,...}`. These produce the seeded week and today's counts                                                                    |
| Tester accounts  | 12    | `seed-pod-t01` to `seed-pod-t12`, with NO check-ins. `t01` and `t02` carry `tonightReminder` true                                                       |

The testers are deliberately empty of history: a tester must be able to produce
the first Found_You at a venue during UAT, and a seeded visit would make them a
returning consumer and change the first-timer count.

Lifecycle dates are offsets from SAST midnight on the day you run the seed:
Kudu Bar `paidUntil` +21 days and node `boostUntil` +3 days, Thembi Coffee
`paidUntil` +9 days, Loft 46 `trialEndsAt` +3 days.

### When the seeded activity lands

- **The week:** one check-in per history consumer at 20:00 SAST, spread over the
  seven nights of the last fully closed Digest_Week. That is the week a weekly
  pass run during the rehearsal reports.
- **Earlier visits:** the three returning Kudu consumers also have a check-in
  three days before that week, which is what makes first-timers a subset rather
  than the whole Found_You set.
- **Today:** Kudu at 01:00, 01:20, 01:35 and 01:55 SAST; Thembi at 07:30 and
  07:50 SAST. Fixed wall-clock times, so the rows keep the same sort keys on a
  re-run. The seed refuses to run before the last of them has passed, so it never
  writes a visit that has not happened.

### Per-venue expected figures

| Venue         | Week Found_You | Week Walk_In | Week unique | First-timers | Recorded sources                 | Today check-ins | Today Found_You | Today Walk_In | Live now | Pulse score | Going tonight |
| ------------- | -------------- | ------------ | ----------- | ------------ | -------------------------------- | --------------- | --------------- | ------------- | -------- | ----------- | ------------- |
| Kudu Bar      | 9              | 4            | 13          | 6            | map 5, share 2, search 1, push 1 | 4               | 2               | 2             | 3        | 26 (active) | 5             |
| Thembi Coffee | 3              | 2            | 5           | 3            | map 2, share 1                   | 2               | 1               | 1             | 1        | 12 (active) | 2             |
| Loft 46       | 0              | 2            | 2           | 0            | none                             | 0               | 0               | 0             | 0        | 0 (dormant) | 0             |

Kudu Bar is the venue that satisfies the R13.5 gate of a Monday headline of at
least 9. Found_You is non-zero at two of the three venues, which satisfies the
other gate.

Thembi Coffee's first-timer and per-source figures are **withheld** on every
owner surface: the sample (3) is below the Suppression_Floor of 5, so those
clauses are omitted rather than rendered at low confidence. The absolute counts
still render. Loft 46 is the zero-Found_You branch.

Pulse is `computePulse(check-ins today, people still in the room)`, the same
formula check-in and check-out share: `4 * 5 + 3 * 2 = 26` and `2 * 5 + 1 * 2 =
12`. Nothing in the seed picks a pulse score.

### Exact expected Monday digest copy

Read these verbatim. They are generated by `buildReceiptCopy`, so a single word
out of place is a defect against R4.6.

Kudu Bar:

```
9 people found you on Area Code and checked in this week.
4 people who were already in the room also checked in.
6 of them had never been in before.
Recorded sources: 5 from the map, 2 from a shared link, 1 from search, 1 from a notification.
```

Thembi Coffee:

```
3 people found you on Area Code and checked in this week.
2 people who were already in the room also checked in.
```

Loft 46:

```
No one has found you on Area Code and checked in this week yet.
2 people who were already in the room also checked in.
Share your venue link with your regulars, and publish what is on tonight.
```

The Loft 46 third line is the zero branch's single next step. The digest passes
**no** Onboarding_Checklist, so the step is the share-and-Tonight line rather than
a checklist item. The Plans panel and the trial reminder email do read the
checklist, and on this seed they show
`Invite a staff member so redemptions get validated at the till.` instead, because
the seed creates no staff account while the venue, get and QR rows are all true.
The same week therefore reads differently on the two surfaces by design; S7 and S9
each state the line to expect.

**Measurement annotation.** Any Digest_Week that opens before
`RECEIPT_MEASURED_FROM_ISO` (Monday 28 Sept 2026, 00:00 SAST) carries one extra
line after the ones above:

```
Area Code has recorded how people found you since 28 Sept 2026, so part of this window predates the measurement.
```

That is correct behaviour, not a defect (R4.8). It disappears for every week
opening on or after 28 Sept 2026, so plan the UAT week accordingly if you want the
digest without it.

### Exact expected live panel copy

The two sentences on the live panel for the current SAST day:

| Venue         | Line 1                                                        | Line 2                                                        |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Kudu Bar      | `2 people found you on Area Code and checked in today.`       | `2 people who were already in the room also checked in.`      |
| Thembi Coffee | `1 person found you on Area Code and checked in today.`       | `1 person who was already in the room also checked in.`       |
| Loft 46       | `No one has found you on Area Code and checked in today yet.` | `No check-ins were recorded from people already in the room.` |

Each seeded Found_You check-in also carries a source badge on its row in the
check-ins panel; the Walk_In rows carry none.

### Going and Tonight thresholds

`GOING_PUBLIC_THRESHOLD` is 3, so the three venues cover all three states:

- **Kudu Bar, 5 marks.** Above the threshold and a Tonight exists, so the venue
  card shows the count and the detail Tonight block shows it too.
- **Thembi Coffee, 2 marks.** Below the threshold, so the card shows nothing
  about Going. The detail block still offers the control.
- **Loft 46, 0 marks.** The detail block reads "Be the first to mark going".

The marks belong to history consumers, never to the twelve testers, so a tester
arrives with the control unmarked and can toggle it during the script.

### Live Venue_Open rows

The seed leaves three unconsumed Venue_Open rows, opened 45 minutes before the
run with `away: true`: two at Kudu Bar (`map` and `share`) and one at Thembi
Coffee (`map`). These are looks that have not become visits, so the row shape, the
6 hour TTL and the Away_Gate are inspectable without waiting for a tester. A
check-in consumes its own row, so the seeded history leaves none behind, and no
tester has one: a tester's Found_You credit must be earned by their own app.

### What the seed deliberately does NOT create

- **Staff accounts.** The Onboarding_Checklist staff row stays false, which is
  what makes the Loft 46 next step "Invite a staff member". Invite one from the
  portal if you want to see the checklist complete and hide itself.
- **Boost purchase rows.** Kudu Bar's node carries an active `boostUntil`, which
  is the Boost_Window the map reads, but there is no purchase audit row. The
  Boost_Scoreboard needs one, so produce it with a dev checkout during the
  rehearsal (task 12.2).
- **Going marks on past nights.** A mark expires the Monday after the digest pass
  that covers its night, so seeding marks into the closed week would write rows
  that are already expired. The digest Going line is therefore exercised by
  marking going and checking in on a rehearsal night, not by the seed.
- **Cognito users.** The seed writes DynamoDB rows only, so no seeded account can
  be signed into as-is: a user row is reached from a session by its `cognitoSub`,
  and the seeded rows carry none. See the note below.

### Signing in as a seeded account

The twelve tester rows exist for the paths the server drives: the
`tonightReminder` preference the transition tick reads, the Going rows, and any
Playwright or script-level flow that addresses a consumer by id. For a human
tester on a phone, either create the account in the consumer Cognito pool with
the same email and stamp its `cognitoSub` onto the seeded row, or have the tester
self-sign-up with a fresh email, which gives a check-in-free account by
construction. Do not reuse an account that has checked in at a seeded venue: it
would stop being a first-timer and the Found_You figures above would move.

## One-week UAT plan

The acceptance artifact is the **second** Monday digest: the one that reports the
week the testers actually produced, not the week the seed wrote. Everything below
exists to make that one email trustworthy.

The plan runs Sunday to the Monday after next. Start on a Sunday so the UAT week
is a whole Digest_Week, Monday 00:00 SAST to Sunday 23:59 SAST, which is the
window the pass reports.

### Sunday, day 0: cut the environment

- Deploy the branch under test and confirm `GET /health` reports the expected
  commit.
- Confirm the environment settings in the table at the top of this file,
  `CHECKIN_PROXIMITY_MODE` in particular.
- Run the seed dry, read the row count, then run it for real. It must be run
  after 07:50 SAST or it refuses.
- Read the per-venue figures in "Expected numbers from the seed" against the three
  owners' live panels. A mismatch here is a seed or read defect and must be fixed
  before testers arrive, not worked around.
- Clear the phone photo matrix (P1 to P14). It has no dependency on the week, and
  an owner who cannot upload a photo cannot finish the checklist.
- Confirm a seeded venue answers on its UUID: `GET /v1/nodes/{nodeId}/detail` on
  the Kudu Bar id above must return the venue, not a `400`.

### Monday, day 1: the first digest, and the owner surfaces

- The weekly pass fires at 06:00 SAST over the seeded week. Read it as **S9**
  against the seeded expectations. This is a rehearsal of the artifact, not the
  artifact: no tester has done anything yet.
- Run **S6** (checklist card) as Owner C, and stop before inviting the staff
  member so the zero branch in S7 still points at the staff step.
- Run **S7** (Plans panel Receipt) as Owner C and Owner B.
- Run **S10** (trial reminder email) as Owner C.

### Tuesday, day 2: the share link and attribution

- Run **S2** (share link) on both a signed-out and a signed-in phone.
- Run **S1** (two phones: Found_You and Walk_In). Keep Owner A's live panel open
  throughout and run **S5** against it.
- Have the remaining testers open the venue from the map or from search and check
  in over the course of the day, so the week has volume behind it. Each tester
  should check in at more than one venue.

### Wednesday, day 3: Tonight and Going

- As Owner A, publish Tonight for the evening and run **S3** on a consumer phone.
- Run **S4** end to end, including waiting out the slot start with the app closed.
- Delete a published slot before its start on one venue and confirm no reminder
  is sent for it while the marks survive.

### Thursday, day 4: the paid surface

- As Owner A, buy a 2 hour boost through the dev checkout during a busy window.
- After it closes, run **S8** (boost scoreboard), then reload and read it again.
- Invite the staff member as Owner C and confirm the checklist card hides itself,
  then re-read S7 and confirm the zero-branch next step has moved to the share and
  Tonight line.

### Friday and Saturday, days 5 and 6: volume and honesty

- Testers use the app as consumers, with no script. The point is a real week of
  check-ins, check-outs and expiry behind Sunday's numbers.
- Every day, read each owner's live panel once and confirm the Found_You and
  Walk_In counts still add up to the check-in total. A day where they do not is a
  failure of R4.2 and must be recorded the day it happens.
- At least one tester marks going and does **not** turn up, so the Monday overlap
  is genuinely smaller than the marks.

### Sunday, day 7: close the week

- No new activity after 23:59 SAST. Note each venue's final Found_You, Walk_In and
  Going figures from the live panel: those are what the Monday line must agree
  with.

### Monday, day 8: the acceptance artifact

The pass fires at 06:00 SAST. For each of the three owners, read the Digest_Email
and the dashboard digest card together and check, in this order:

1. The Found_You headline names the number the owner watched accumulate on the
   live panel all week. If the two disagree, the spec has not shipped.
2. The Walk_In line and the Found_You headline add up to the unique visitors.
3. The first-timer and per-source clauses render where the sample clears the floor
   and are absent where it does not. An absent clause is a pass.
4. The Going line names the marks and the measured overlap, and the overlap is
   smaller than the marks.
5. Not one causal verb across any of it: no brought, drove, generated, boosted,
   revenue, ticket or spend.
6. The email and the card read line for line identically.

Sign-off is all six, for all three owners, plus an empty Issues table or every row
in it closed. Record the digest copy verbatim in the Issues table's place in the
run log, whichever way it goes: a failed digest is the most valuable artifact this
week can produce.

**Plan the calendar.** A Digest_Week opening before Monday 28 September 2026
carries the measurement annotation described above. It is correct behaviour, but
it is one extra line for a tester to read past, so pick a UAT week that opens on
or after that date if you want the digest clean.

## Issues

| #   | Scenario | What happened | Requirement | Status |
| --- | -------- | ------------- | ----------- | ------ |
