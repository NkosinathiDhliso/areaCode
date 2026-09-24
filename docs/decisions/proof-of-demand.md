# Decision: proof of demand (attribution, Tonight, Going, UAT gates)

Date: 2026-07-16

Spec: proof-of-demand, task 0.1. Requirements 3.7, 8.9, 9.2, 13.5, 15.9, 15.24,
plus the "Decisions, not defects" list at the end of Requirement 15 and R15.8.
Related: `.kiro/steering/honest-presence.md`,
`.kiro/steering/no-fallbacks-no-legacy.md`,
`.kiro/steering/dry-reuse-no-duplication.md`,
`.kiro/steering/serverless-only.md`.

## Context

The proof-of-demand spec turns "Area Code brings a venue customers" into a
measurement: a sourced Venue_Open, a server-derived `foundVia` behind an
Away_Gate, and one Receipt (Found_You plus Walk_In) rendered on every owner
surface. The design left eleven values and behaviours as founder decisions
because each one changes what a number means, what a tester hits, or what gets
provisioned. They are recorded here before any code lands so that
`packages/shared/constants/attribution.ts` (task 0.3) has one authoritative
source and no surface has to guess.

Every decision below is the design's default unless stated otherwise. Where a
value tunes honesty, the default is the conservative side: it under-claims
rather than over-claims.

## Decisions

### 1. `ATTRIBUTION_WINDOW_HOURS` = 6

The maximum gap between a Venue_Open and a check-in at the same venue for the
check-in to be eligible as Found_You.

Six hours covers one decision-to-door span for a night out (look at the venue
after work, arrive at nine) without letting a morning look claim credit for an
unrelated visit two days later. Longer windows inflate Found_You with
coincidence; shorter windows drop the real "saw it at six, went at nine" case,
which is the pitch. The window is also the KV row's TTL, so the row expires on
its own and no sweeper is needed.

### 2. `AWAY_GATE_MIN_MINUTES` = 20

A Venue_Open counts toward Found_You only if it happened at least 20 minutes
before the check-in, OR the consumer's position at open time was known and
outside the venue's check-in radius (`AWAY_DISTANCE_METRES` = 500). Time is
primary, distance is the bonus, `away === null` relies on time alone.

Twenty minutes is longer than any plausible "open the app at the bar, then
check in" sequence and shorter than a trip across town. It is the number that
makes the word "found" defensible to a sceptical owner: the person who was
already standing in the room cannot be counted. Erring high costs us some real
Found_You credit; erring low would let a walk-in be sold as demand we created,
which is the one failure this spec exists to prevent.

### 3. `GOING_PUBLIC_THRESHOLD` = 3

Consumers see a Going count only at 3 or more, and only when a Tonight exists
for that venue. Below the threshold the detail Tonight block shows "Be the
first to mark going" and the venue card shows nothing about Going.

One or two marks read as empty rather than as momentum, and a "1 going" line
does the opposite of a pull. Three is the smallest count that reads as other
people. The owner-facing live panel is unaffected and shows the true count,
including zero (R9.5).

### 4. Tonight_Reminder timing: at slot start, no lead time

The reminder fires from the existing schedule transition tick at the Dated_Slot
start, to Going rows for that node and night whose consumer has
`tonightReminder` true, once per row.

At slot start there is nothing to schedule: the tick already runs on the
transition boundary, so this adds no timer, no queue and no new Lambda
(`serverless-only.md`). A lead time (for example 60 minutes before) would need
a second fan-out point and a second boundary to compute, and "it is starting
now" is a stronger reason to move than "it starts in an hour".

### 5. Tonight scope: business-wide

A Dated_Slot published through the Tonight form applies to the business, as the
weekly Music_Schedule already does, not to one node.

This is the status quo of the schedule store. Per-node Tonight would mean a
second scoping rule alongside the weekly grid inside the same table, which is
exactly the kind of parallel path `no-fallbacks-no-legacy.md` bans. Every
business in the pilot has one venue, so per-node scope buys nothing today. If a
multi-venue business arrives, per-node scope is a follow-up spec that changes
the schedule key shape once, for weekly and dated slots together.

### 6. Live-vibe flags: not provisioned

`AREA_CODE_FLAG_LIVE_VIBE_ON_MAP`, `AREA_CODE_FLAG_LIVE_VIBE_DECLARATION` and
their `VITE_FLAG_*` counterparts stay unprovisioned in prod for this spec.
Task 0.2 is therefore a no-op on Terraform, `update-all-amplify-apps.ps1`, the
`check-amplify-env-closure.mjs` allowlist and `rules/tech.md`.

The Tonight headline, start time and featured get render regardless of those
flags (R8.9), so nothing in this spec is blocked. `VITE_FLAG_*` keys are
already allowlisted as dev/runtime overrides that default to false, which is
the behaviour we want during UAT. Provisioning a flag we do not need would add
two Terraform wiring points and two Amplify keys to the closure checks for no
change in what a tester sees, and R13.7 requires that no task here wakes a
dormant path as a side effect. Turning the live-vibe surfaces on is its own
decision, made against its own spec.

### 7. Free-tier venues accepting check-ins while off the map: keep

A free-tier venue is excluded from the consumer map (see
`docs/decisions/map-membership.md`) but still accepts GPS and QR check-ins.
That stays.

The check-in is a true event: the person was there. Refusing it would make
presence, pulse and the user's own loyalty history less accurate than reality,
which `honest-presence.md` forbids. Membership is about reach, which is the paid
product; presence is about truth, which is not for sale. A free-tier venue that
pays gets its accumulated loyalty history intact, which is a better upgrade
story than an empty one. The Receipt keeps this honest by construction: a
check-in with no eligible Venue_Open is a Walk_In, and a venue that is not on
the map can barely produce anything else.

### 8. `CHECKIN_PROXIMITY_MODE` for UAT: `shadow`

The UAT environment runs `shadow`, not `legacy` and not `adaptive`.

`shadow` enforces the legacy flat 500 m radius exactly as today and only logs
where the adaptive decision would have diverged. Enforcement behaviour during
UAT is therefore identical to prod, so no tester is failed by a radius change
mid-script, and we come out of the week with the real Android accuracy
distribution (30 to 100 m is the range we expect) needed to retune
`CHECKIN_BASE_RADIUS_M` and `CHECKIN_ACCURACY_SLOP_CAP_M` before `adaptive` is
ever enforced. `adaptive` is not an option this cycle: its radius is untuned
against real handsets, and a false rejection at the door is the most expensive
bug a tester can hit.

### 9. Demo-day route limits: raise who's-here, keep check-in

- Who's-here (`GET /v1/nodes/:nodeId/who-is-here`): raise from 20 per 600 s to
  60 per 600 s, in all environments.
- Check-in (`POST /v1/check-in`): unchanged at 10 per 60 s.

On a demo day a tester opens a dozen venue sheets in ten minutes, and each open
reads who's-here. Twenty per ten minutes throttles ordinary curiosity, and the
`429` is indistinguishable from a broken screen. Sixty still bounds scraping of
a privacy-sensitive read. The check-in limit stays: ten check-ins a minute is
far above any human pattern and it is the abuse control for the one write that
mints rewards.

Both limits stay hard-coded constants at the route. A UAT-only env override
would be a second source of truth for the same number and a config default that
masks misconfiguration, both banned by `no-fallbacks-no-legacy.md`. The `429`
copy per limiter is specified in R15.9 and is a defect fix, not a decision.

### 10. `BottomNav` bottom safe-area: keep the bar flush

`BottomNav` keeps `height: var(--nav-height)` with no
`env(safe-area-inset-bottom)` margin or padding. The accepted trade-off is
documented in the component: the lowest sliver of the tab row sits in the
system gesture zone.

Adding the inset puts a strip of `--bg-base` below the bar on a notched iPhone,
which reads as a rendering gap, and it costs vertical space on a screen that
must fit in 100dvh with no scroll. Icons are centred in the 49 px bar, so the
tap centre already clears the home indicator, and the indicator floats over the
bar in the same colour. `ToastOverlay` is a different case and does gain
`env(safe-area-inset-bottom)` under R15.24, because a toast anchored at the
very bottom is otherwise partly occluded.

Verification, not a re-decision: the UAT script includes a tap-accuracy pass on
a notched iPhone (each of the four tabs, first tap, no long-press). If a tab
proves unreliable to hit, the fix is to raise `--nav-height` and keep the bar
flush, not to add the inset.

### 11. Check-in detail partition moves to the SAST calendar date (R15.8)

New writes use `BIZ_CHECKIN#{businessId}#{sastDate}`. Because the day is part
of the partition key, existing UTC-keyed rows are not rewritten:
`getCheckInDetails(date)` queries the SAST key and, for dates before
`RECEIPT_MEASURED_FROM_ISO`, also the old UTC key and merges.

Concretely, a SAST day starts at 22:00 UTC the previous day, so the first two
hours of SAST day D were UTC-keyed under D-1. The dual read queries the D and
D-1 partitions and filters every row to the SAST day by its own timestamp, so a
pre-deploy check-in is reported on exactly one day and never on two. It returns
one page of 50 with no cursor, because a pre-deploy date is a closed day.

This is recorded because it is a key-shape change, not a code tidy. A South
African owner's "today" ends at midnight SAST; a UTC partition moved the
boundary two hours into the next evening, which is exactly when a venue is
busiest. The dual read is bounded by a dated constant rather than being an
open-ended compatibility path, so it has a defined end: once
`RECEIPT_MEASURED_FROM_ISO` is older than the retention window the UTC branch
is deleted.

### 12. A Tonight may run past midnight, resolved against one shared night

Added 2026-07-24, after the feature shipped. This one is a defect in the model,
not a tuning value, so it is recorded with the problem it closes.

**The problem: two definitions of a night.** Going defined a night as 04:00 to
04:00 (`GOING_NIGHT_ROLLOVER_HOUR_SAST = 4`), so a mark at 01:30 on Saturday
belonged to Friday's night. Tonight defined a night as the calendar date:
`resolveTonightSlot` and `resolveActiveSlot` both filtered on
`slot.date === clock.date`. At 00:01 on Saturday a consumer still held their
Friday Going mark, but Friday's headline had already vanished from the venue
card, the detail Tonight block and the share snapshot, one hour after the
Tonight_Reminder told them the night was starting. The map went quiet about a
venue at the hour it was fullest, and a venue whose set genuinely ran to 02:00
could not say so.

**The approach.** One night, one row, resolution by night:

1. **One shared constant.** `NIGHT_ROLLOVER_HOUR_SAST = 4` and `nightFor(instant)`
   live in `packages/shared/lib/sast.ts`, the one home for SAST arithmetic, and
   are re-exported through `backend/src/shared/time/sast.ts`. The rollover is no
   longer Going's: it is the product's definition of a night. `going.ts` imports
   it and keeps `goingNightFor` as a thin wrapper, because that name says which
   rows it keys.
2. **One row per night, `endTime` stays human.** A Dated_Slot is still a single
   row and `endTime` is still an `HH:mm` string, so `02:00` reads as "ends at
   2am" to an owner and in the stored row. The DERIVED `endTimeMin` carries the
   day crossing: for a slot with a `date`, an end at or before the start derives
   `hhmmToMinutes(endTime) + 1440`, so 21:00 to 02:00 is `[1260, 1560)`. The
   validator's own contract already says the minute fields are derived and are
   overwritten on parse, so that is where the crossing belongs. The wire shape
   is unchanged.
3. **Bounded by the rollover.** A dated slot may end at most at the rollover the
   following morning (`DATED_SLOT_MAX_END_MIN`, 1680), derived from
   `NIGHT_ROLLOVER_HOUR_SAST` so there is one number rather than two that can
   drift. A night can never outlive the night it names. Beyond it the validator
   rejects with `dated_slot_end_past_rollover`.
4. **Weekly slots unchanged.** The strict `startTimeMin >= endTimeMin` rejection
   stays for a slot with no `date`, and `MusicSchedulePanel`'s
   Cross_Midnight_Pair is untouched. A weekly slot recurs per weekday and has no
   date to anchor a crossing to, so "FRI 21:00 to 02:00" cannot say which
   Saturday morning it means and genuinely must be two weekday slots. A dated
   slot names its night, which is what makes one row possible. Two
   representations of two different things, not two paths for one thing.
5. **Resolution by night, not by calendar date.** `resolveActiveSlot` and
   `resolveTonightSlot` project the instant onto the night a dated slot names
   (`minutesIntoDatedNight`), so the comparison may exceed 1439. At 01:00 on
   Saturday a Friday slot running 21:00 to 02:00 is read at minute 1500 of
   Friday's night and is still active; a Saturday-dated evening slot is not.
   Exactly one slot is active at any instant (Property 6), the weekly pass still
   runs in the gaps, and "running beats upcoming" with `startsAt: null` while
   running is unchanged.
6. **Overlap and transitions.** Dated slots are now compared in absolute time
   across adjacent dates, because a night reaching past midnight can collide
   with the next date's slot even though the dates differ. The transition tick
   resolves a crossing end boundary to the correct next-day instant, so the
   Tonight_Reminder still fires once, at the real start (a start never crosses).

**Why not the Cross_Midnight_Pair alternative.** Reusing the weekly mechanism,
two dated rows ending 23:59 and starting 00:00, was rejected on three counts.
It duplicates the headline and the featured get across two rows, so the two can
disagree and an owner editing one night edits two things. It makes the night
ambiguous exactly where the night is the key: the reminder and the weekly digest
would have to decide which of the two dates a mark, a send and a Receipt line
belong to, and Going has already answered that with the rollover. And the second
half is a stale-headline bug waiting to happen: a row dated Saturday starting
00:00 reads as Saturday's Tonight for the whole of Saturday evening, so Friday's
headline would advertise itself again a day later.

**Consequences.** `ScheduleValidationCode` gains
`dated_slot_end_past_rollover`, which the Tonight form maps to its time field.
`ScheduleSlot.endTimeMin` is no longer bounded by 1439 for a dated slot, which
the type's comment now says. A lineup entry is NOT crossed: an entry after
midnight inside a dated slot still fails as `lineup_entry_outside_slot`, which
costs nothing today because Tonight is a blanket-genre slot and DJ lineups live
on the weekly grid. The business-portal Tonight form (letting an owner pick an
end time past midnight, and the copy around it) is a follow-up task; the model,
the validator and every reader are done here.

## Ship gates (R13.5)

The spec ships when all of the following hold. These are gates, not targets.

1. Found_You is non-zero for at least two of the three seeded venues in the dev
   rehearsal (R13.2).
2. Zero causal verbs across all owner-facing copy: the honest-copy property test
   covers every new sentence on the live panel, the digest, the trial emails,
   the Plans panel and the boost scoreboard, and `BANNED_CAUSAL_VERBS` is
   unchanged.
3. `pnpm typecheck` green.
4. `pnpm test` green, including the fast-check properties at min 100 runs.
5. `pnpm lint` green.
6. `pnpm guard:serverless` green.
7. Both closure checks green: `scripts/check-table-closure.mjs` and
   `scripts/check-amplify-env-closure.mjs`.
8. The e2e suite green (`cd tests/e2e && pnpm test`) across all four portals.
9. Phase 4a (the pre-UAT defect sweep, tasks 13 to 16, including the phone photo
   upload failure) complete before the UAT environment is cut.
10. `docs/UAT_PROOF_OF_DEMAND.md` records the exact expected copy and the
    expected numbers from the seed run, with the Monday headline at least 9 at
    one venue.

### Recorded results (task 12.5)

Run at the close of the spec, on the implementation as it stands. Nine of the
ten gates pass; gate 8 is not run and is the one blocker that needs an
environment rather than a code change.

| Gate                                   | Result                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Found_You non-zero at 2 of 3 venues | PASS. Seed: Kudu Bar 9, Thembi Coffee 3, Loft 46 zero                        |
| 2. Zero causal verbs in owner copy     | PASS. Honest-copy property test green, `BANNED_CAUSAL_VERBS` unchanged       |
| 3. `pnpm typecheck`                    | PASS                                                                         |
| 4. `pnpm test`                         | PASS. 324 files, 2688 tests                                                  |
| 5. `pnpm lint`                         | PASS. 0 errors; `eslint . --max-warnings 173` passes at exactly 173 warnings |
| 6. `pnpm guard:serverless`             | PASS                                                                         |
| 7. Both closure checks                 | PASS. `check-table-closure.mjs` and `check-amplify-env-closure.mjs`          |
| 8. `tests/e2e` across four portals     | NOT RUN. Needs a live stack and a seeded environment                         |
| 9. Phase 4a complete before UAT cut    | PASS. Tasks 13 to 16 all complete, including the phone photo upload path     |
| 10. UAT doc records copy and numbers   | PASS. `docs/UAT_PROOF_OF_DEMAND.md`, Monday headline 9 at Kudu Bar           |

Also green, enforced by CI rather than listed as a gate: `prettier --check .`,
`pnpm --filter backend build:lambda`, and `pnpm guard:rules` (the generated AI
rule mirrors are in sync after task 12.6).

### Outstanding before the UAT week opens

None of these are code work. They are recorded so nothing here is mistaken for
done.

1. **e2e against a seeded live stack** (gate 8). The suite is written and in
   `tests/e2e`; it has never run against this spec's surfaces. Whoever cuts the
   UAT environment runs `cd tests/e2e && pnpm test` after the seed.
2. **Real-device passes.** Three, all needing hardware:
   - the two-phone attribution rehearsal, scenario S1 (Found_You from the map at
     home, Walk_In at the bar, Found_You from a share link);
   - the phone photo upload matrix, rows P1 to P14 (task 13.6, R14.8);
   - live-stack rehearsal scenarios S2 to S10.
3. **Two operator actions.** An operator must `terraform plan` then `apply` for
   dev and prod: task 13.5 consolidated the CORS origin list into
   `local.app_cors_origins`, and until it is applied, matrix row P13 fails. The
   operator must also run `./scripts/apply-amplify-spa-rewrites.ps1` so the
   `/node/<*>` share rewrite from task 1.4 takes effect; the share link is a
   404 on the SPA fallback until then.

### Known debt carried out of this spec

`pnpm lint:lines` fails: 26 files exceed their frozen 400-line ratchet baseline,
several of them grown by this spec. The ratchet is not in CI and not in the git
hooks, but the 400-line hard limit is a stated rule in `rules/code-style.md`, so
this is debt, not a passing state. The files, with current lines against their
frozen baseline:

- `apps/admin/src/screens/BusinessManagement.tsx` 458 > 450
- `apps/business/src/screens/MusicSchedulePanel.tsx` 1552 > 1551
- `apps/business/src/screens/panels/CampaignsPanel.tsx` 505 > 504
- `apps/business/src/screens/panels/NodeEditorPanel.tsx` 596 > 541
- `apps/business/src/screens/panels/ReportsPanel.tsx` 676 > 675
- `apps/business/src/screens/panels/SettingsPanel.tsx` 454 > 445
- `apps/web/src/components/NodeDetailContent.tsx` 677 > 579
- `apps/web/src/screens/MapScreen.tsx` 788 > 775
- `packages/features/staff/StaffValidator.tsx` 460 > 410
- `packages/shared/lib/schedule-validator.ts` 566 > 422
- `packages/shared/lib/websocket.ts` 459 > 448
- `packages/shared/types/index.ts` 926 > 677
- `backend/src/features/admin/repository.ts` 763 > 761
- `backend/src/features/admin/service.ts` 1014 > 1002
- `backend/src/features/business/handler.ts` 896 > 828
- `backend/src/features/business/repository.ts` 1917 > 1657
- `backend/src/features/business/service.ts` 2231 > 1985
- `backend/src/features/check-in/service.ts` 657 > 564
- `backend/src/features/nodes/service.ts` 808 > 629
- `backend/src/features/presence/repository.ts` 522 > 491
- `backend/src/features/reports/digest.ts` 603 > 408
- `backend/src/features/reports/generator.ts` 1069 > 940
- `backend/src/features/reports/types.ts` 521 > 483
- `backend/src/features/rewards/service.ts` 639 > 628
- `backend/src/features/business/types.ts` 478 > 473
- `backend/src/workers/cleanup.ts` 554 > 485

Splitting these is its own spec: the ratchet only ever shrinks, so each file has
to come down under 400 lines rather than have its baseline raised. Four files
(`RewardsPanel.tsx`, `auth/service.ts`, `reports/repository.ts`,
`rewards/repository.ts`) shrank and can be ratcheted down with
`pnpm lint:lines:update`.

Second piece of debt, narrower and more urgent: the ESLint warning count sits at
exactly the 173 cap that `quality-gate.yml` enforces. Any new warning fails CI,
so the next change either clears a warning first or arrives with none.

## Dormant paths: what must stay asleep (R13.7)

No task in this spec may wake a dormant or retired path as a side effect. The
check is executable, not a habit: `scripts/assert-dormant-paths.test.ts` runs in
`pnpm test` (ship gate 4) and fails on any of the five items below. Read it
before changing anything it names.

| Dormant path              | What the guard asserts                                                                                                                             | Owner rule                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Phone-OTP routes          | `PHONE_OTP_DISABLED` derives from a non-dev env, `rejectIfPhoneOtpDisabled` returns `410`, and all eight dormant routes are still gated            | `no-sms-no-phone-auth.md` |
| `VITE_SOCKET_URL`         | absent from `apps/`, `packages/`, `backend/src` and from `update-all-amplify-apps.ps1`; `VITE_WEBSOCKET_URL` is the only websocket key read        | `tech.md`                 |
| Standalone gets/deals tab | `/gets` appears once in `App.tsx`, as the redirect to the map, nowhere else in the consumer app; `BottomNav` stays at four tabs                    | `product.md`              |
| `DEV_MODE` fixtures       | `DEV_MODE` has one home (`shared/config/env.ts`), no file shadows it, and the `getLiveStats` fixture stays behind the guard as the first statement | `code-style.md`           |
| Live-vibe flags           | no `AREA_CODE_FLAG_*` in Terraform, no `VITE_FLAG_*` in the Amplify script, both flags default to `false`                                          | decision 6 above          |

Two notes on scope, so the guard is not mistaken for something broader:

- It complements the existing locks rather than replacing them.
  `scripts/assert-phone-otp-disabled.ps1` (`pnpm guard:no-sms`) checks the
  ESLint rules and runs in `quality-gate.yml`;
  `backend/src/features/rewards/__tests__/no-global-events-feed.test.ts` checks
  the rewards route surface. This one checks the repo-wide text of the retired
  paths and the unprovisioned flags, which neither covers.
- Its first `describe` block asserts the scanner reaches real source. Every
  other check is a "must be absent" assertion, and those are vacuous if the walk
  finds nothing, so that block is load-bearing.

Known pre-existing mentions of `VITE_SOCKET_URL` that the guard deliberately
does NOT cover, because removing them is a deploy-script change and not this
spec's business: `scripts/update-amplify-api-url.{ps1,sh}` still set the key,
and `.env.example` still lists it. They are rot under
`no-fallbacks-no-legacy.md` and want their own cleanup; nothing in this spec
reads the key, so no path is woken by leaving them.

## Consequences

- Task 0.3 writes these values once in
  `packages/shared/constants/attribution.ts`: `ATTRIBUTION_WINDOW_HOURS = 6`,
  `AWAY_GATE_MIN_MINUTES = 20`, `AWAY_DISTANCE_METRES = 500`,
  `GOING_PUBLIC_THRESHOLD = 3`. The check-in service and every read model import
  them; no surface redefines a threshold (R3.7).
- Task 0.2 provisions nothing. It records that the live-vibe flags were
  considered and left off, and touches no Terraform, Amplify or closure-check
  file.
- Task 0.4 turns the "do not wake anything" paragraph of the design into
  `scripts/assert-dormant-paths.test.ts`, so R13.7 is checked on every test run
  rather than remembered. The table above is the human-readable index of what
  it locks.
- Task 1.4 consolidates `scripts/add-spa-rewrites.ps1` and
  `scripts/apply-amplify-spa-rewrites.ps1` into one script before adding the
  `/node/<*>` rewrite, per `dry-reuse-no-duplication.md`. Two scripts managing
  the same Amplify custom rules is the duplication that rule exists to remove.
- No behaviour change for free-tier check-ins, `BottomNav` layout, or the
  check-in route limit. The who's-here limit triples. The UAT environment sets
  `CHECKIN_PROXIMITY_MODE=shadow`, which does not change enforcement.
- Revisit triggers: a multi-venue business arriving makes Tonight scope a
  follow-up spec; UAT accuracy data makes `adaptive` proximity a follow-up
  decision; a failed tap-accuracy pass raises `--nav-height`; turning the
  live-vibe surfaces on is decided against the live-vibe specs, not here.
