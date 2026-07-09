# Design Document

## Overview

### Goals

- Ship the weekly value proof: measured attribution facts per venue, every
  tier, every Monday, on the dashboard and in the inbox.
- Keep every sentence honest: measurement verbs, suppression below sample
  floors, quiet weeks stated plainly.
- Ride the existing weekly Report_Pipeline with zero new infrastructure.
- Keep one source of truth for digest copy shared by the email and the
  dashboard card.

### Non-Goals (out of scope)

- WhatsApp delivery, open/click tracking, revenue estimation, network-density
  analyzers (journeys, benchmarks), admin digest views, consumer digests.
- Changing the full Venue Intelligence Report or its tier gating.

### Architectural Constraints (binding)

- Serverless only: existing EventBridge weekly rule, existing dispatcher and
  report-generator worker, existing app-data table, existing SES module.
- Handler to service to repository layering; digest computation lives in the
  reports feature (it is a report artifact); DynamoDB access stays in
  repositories.
- One home per concept: metric computation reuses the existing analyzer
  helpers (peak-hours day/hour, crowd first-timer logic) rather than forking
  week-window variants.
- Honest framing is enforced in code (copy builder + tests), not left to
  reviewer vigilance.
- No SMS, no phone identifiers, no consumer PII in rows or emails.

### Dependency

None hard. R5.4 upgrades to the unified tier resolver when
`billing-revenue-integrity` task 5 merges; until then `getEffectiveTier` as-is
is correct enough for the tier-aware closing line.

## Architecture

### Component map

```
EventBridge report-weekly (exists)
  └─ report dispatcher (extended: weekly pass includes every business with
     an active node, any tier)
       └─ SQS report-generation (exists)
            └─ report-generator worker (exists)
                 ├─ full weekly report (exists, tier logic unchanged)
                 └─ digest path (new):
                      computeDigest(businessId, weekStart)
                        │  reads checkins (NodeIndex GSI), redemptions,
                        │  guest-claim rows for the week window
                        ▼
                      pii-scan → put Digest_Row (conditional)
                        ▼ (only when the row is newly written)
                      buildDigestCopy(digest, tier) → SES Digest_Email
                        (skipped on Digest_Optout)

business portal
  ├─ DigestCard on BusinessDashboard (latest week)
  ├─ Digest history view (prior weeks)
  └─ SettingsPanel: Digest_Optout toggle

backend API (business feature routes, requireAuth('business'))
  ├─ GET /v1/business/digest/latest
  ├─ GET /v1/business/digest/history?cursor
  └─ PATCH /v1/business/settings { digestEmailOptOut }
```

### Digest_Week arithmetic

SAST is UTC+2 with no daylight saving, so week boundaries are fixed offsets:
`weekStart = most recent Monday 00:00 SAST strictly before the run time`,
window `[weekStart, weekStart + 7d)`. A pure `digestWeekFor(nowIso)` returns
`{ weekStartIso, windowStartUtc, windowEndUtc }` and is property tested. The
weekly EventBridge rule fires Monday 22:00 UTC per the existing schedule
inventory; the generator computes the week that just closed regardless of
exact fire time, so a delayed or manually re-run pass produces the same
Digest_Week (idempotency key stability).

### Metric computation

All from existing tables via existing or thin new repository reads:

- visits, unique visitors: check-ins on the business's active nodes in the
  window (NodeIndex GSI query per node, the dispatcher already has the
  node-listing read).
- first-time visitors: visitors in the window with no earlier check-in at any
  of the business's nodes (per-visitor earliest-check-in read, bounded by the
  week's unique-visitor count; acceptable at current scale and noted for a
  GSI revisit at scale).
- returning visitors: unique visitors minus first-timers.
- redemptions confirmed: redemption events at the business's nodes in the
  window (rewards feature read).
- First-Get issued and converted: guest-claim rows for the business's nodes,
  `issuedAt` in window for issued, `redeemedAt` in window for conversions
  (rows carry both fields already).
- busiest day and hour: reuse the peak-hours analyzer's binning on the week's
  check-ins.
- deltas: computed against the prior Digest_Row's stored metrics (never
  recomputed from raw data, so history is stable).

Suppression: absolute counts always render; percentages and week-over-week
percentage comparisons require the underlying sample >= 5 (Suppression_Floor,
matching the reports anonymization posture). Zero weeks produce the honest
quiet-week variant.

### Copy builder (Honest_Framing enforced in code)

`buildDigestCopy(digest, tier)` in the reports feature returns the ordered
list of sentences used by BOTH the email renderer and the dashboard card (the
API returns the copy alongside the raw metrics). The builder:

- draws verbs from a fixed measurement vocabulary (recorded, confirmed,
  captured, issued);
- has an explicit zero-visits branch with one constructive next step;
- appends the tier-aware close (starter: one named locked capability plus
  upgrade pointer; growth/pro: link to the full report).

A test asserts no output sentence contains causal verbs (brought, drove,
generated, boosted) over the whole input space of the property run.

## Components and Interfaces

### Backend: `backend/src/features/reports/`

- `digest.ts` (new): `digestWeekFor`, `computeDigest`, `buildDigestCopy`.
  Pure logic separated from I/O so all three are property testable.
- `repository.ts`: `putDigestRow` (conditional on
  `attribute_not_exists(pk)` for the week sk, returns `written | duplicate`),
  `getLatestDigest`, `queryDigestHistory` (newest first, cursor), reads reuse
  existing check-in and guest-claim query helpers.
- `generator.ts`: after the existing weekly report work per business, run the
  digest path. Email only when the row write returns `written` (retry
  suppression, R3.1). Failures per business logged and skipped (R3.3).
- `dispatcher.ts`: weekly pass includes every business with at least one
  active node regardless of tier (the digest needs them; the full-report
  generation keeps its own tier logic).
- Cleanup worker: drop Digest_Rows older than 12 months (same pattern as the
  booster retention pass).

### Backend: business feature

- Routes for latest, history, and the `digestEmailOptOut` settings patch, all
  `requireAuth('business')`, camelCase JSON, typed errors.
- Business_Row gains `digestEmailOptOut?: boolean` (default absent = emails
  on).

### Email

- One renderer in the reports feature using the shared SES module: subject
  `"<Venue name>: <headline count> visits recorded this week"`, body is the
  copy-builder sentences plus the tier close. Plain HTML consistent with the
  existing SES emails. No consumer PII; the pii-scanner runs on the payload
  before persistence, which the email renders from.

### Frontend: `apps/business`

- `DigestCard` on BusinessDashboard: headline metrics, deltas when present,
  quiet-week state, tier close. Renders from the API copy strings; no copy
  duplication in the client.
- Digest history list (behind the card, simple reverse-chronological view).
- SettingsPanel: Digest_Optout toggle with saving state (disabled during the
  call).

## Data Models

### `Digest_Row` (app-data table)

| field       | type   | value                                    |
| ----------- | ------ | ---------------------------------------- |
| pk          | string | `DIGEST#<businessId>`                    |
| sk          | string | `WEEK#<weekStartIso date>`               |
| businessId  | string | 1-64                                     |
| weekStart   | string | ISO date of the opening Monday (SAST)    |
| metrics     | map    | Attribution_Metrics, integers            |
| deltas      | map    | signed integers vs prior week, optional  |
| suppressed  | list   | metric names below the Suppression_Floor |
| tierAtBuild | string | tier snapshot used for the close         |
| emailSent   | bool   | Digest_Email dispatched                  |
| createdAt   | string | ISO 8601 ms UTC                          |

Zod schema `digestRowSchema` in reports types; 12-month retention via the
cleanup worker; no TTL attribute (consistent with the other audited rows).

### Access patterns

- Latest: Query pk, `ScanIndexForward=false`, limit 1.
- History: same query, cursor pagination.
- Generation idempotency: conditional put on the week sk.

## Correctness Properties

### Property 1: Digest_Week arithmetic

For any instant, `digestWeekFor` returns a Monday-00:00-SAST week start
strictly before the instant, a 7-day window, and is constant across all
instants inside the same SAST week (idempotency key stability). Min 100 runs.

### Property 2: Metric conservation

For any generated set of check-in events, firstTimers + returningVisitors =
uniqueVisitors, uniqueVisitors <= visits, and every metric is a non-negative
integer. Min 100 runs.

### Property 3: Honest copy

For any metrics vector (including all-zero), `buildDigestCopy` output
contains no causal verb from the banned list, renders no percentage for a
metric in `suppressed`, and the zero-visits branch contains exactly one next
step and no numeric claims. Min 100 runs.

### Property 4: Generation idempotence

For any replay schedule of the weekly pass over the same week, exactly one
Digest_Row exists per business-week and at most one email dispatch is
attempted. Mirrors the billing activation idempotence style.

## Testing Strategy

- Property tests 1-4 (fast-check, tagged
  `Feature: weekly-attribution-digest, Property N`, block-statement
  predicates, min 100 runs).
- Unit tests: repository conditional write, per-business failure isolation in
  the generator, opt-out suppresses email but not the row, pii-scanner runs
  on the digest payload.
- Component tests (jsdom): DigestCard states (normal, deltas, quiet week,
  starter close vs paid close), Settings toggle disabled-while-saving.
- Dev-environment rehearsal: run the weekly pass in dev, verify row, email
  (dev SES sandbox), and dashboard card before enabling in prod.
