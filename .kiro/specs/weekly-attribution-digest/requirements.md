# Requirements Document

## Introduction

The July 2026 market-viability review found that the single highest-leverage
feature for venue-owner willingness to pay is a weekly, plain-language proof
of value: what Area Code measurably did for the venue this week, delivered
where the owner already looks. The full Venue Intelligence Report already
exists (weekly, analyzer-backed, tier-gated), but it is a paid artifact and
its network-powered sections need density the platform does not have yet.
What is missing is the lightweight, every-tier artifact that makes the R299
subscription feel earned every single Monday, and that gives starter-tier
venues a weekly taste of what the paid report adds.

This spec, **Weekly Attribution Digest**, adds that artifact: a short
per-venue summary computed from data the platform already records (check-ins,
first-timers, redemptions, First-Get conversions), stored durably, rendered
on the business dashboard, and emailed to the owner every Monday morning.

Honesty is a hard constraint. The digest reports measured facts ("23 visits
recorded through Area Code, 4 walk-ins became members via First-Get") and
never causal claims ("Area Code brought you 23 visits"). A quiet week reads
as an honest quiet week with a constructive nudge, never padded numbers. This
is the same discipline as `honest-presence.md`, applied to the business-facing
surface, and it is what keeps the digest credible enough to sell.

Relationship to sibling specs: independent of `billing-revenue-integrity`,
`cross-portal-lifecycle-alignment`, and `release-quality-and-ops-hygiene`.
It complements the billing spec commercially: the digest is the weekly value
proof that makes the renewal email land.

Out of scope: WhatsApp delivery (roadmap Q4, no integration exists), email
open or click tracking, consumer-facing digests, admin digest dashboards,
POS revenue attribution, and any new analyzer that needs cross-venue network
density (journeys, benchmarks).

## Glossary

- **Digest**: the weekly per-business summary artifact defined by this spec.
- **Digest_Week**: the seven-day window Monday 00:00 to the following Monday
  00:00, South African Standard Time (UTC+2, no DST), identified by the ISO
  date of its opening Monday.
- **Digest_Row**: the persisted Digest for one business and one Digest_Week,
  in the app-data table. Pk `DIGEST#<businessId>`, sk `WEEK#<weekStartIso>`.
- **Attribution_Metric**: a fact computed from platform-recorded events for
  the business's active nodes during a Digest_Week: visits recorded, unique
  visitors, first-time visitors, returning visitors, redemptions confirmed,
  First-Get codes issued, First-Get conversions (codes redeemed into
  signups), busiest day and hour.
- **Honest_Framing**: the copy rule that every digest sentence states a
  measurement ("recorded", "confirmed", "captured"), never causation
  ("brought", "drove", "generated"), and that low or zero weeks are stated
  plainly with a constructive next step.
- **Suppression_Floor**: the minimum sample below which composition
  percentages are withheld (absolute counts of the business's own events are
  always shown; percentages and comparisons need at least 5 underlying
  events, matching the reports anonymization posture).
- **Digest_Email**: the SES email rendering of the Digest, sent to the
  business account email on Monday morning SAST.
- **Digest_Optout**: a per-business preference disabling the Digest_Email
  (the dashboard card always renders).
- **Report_Pipeline**: the existing weekly EventBridge rule, report
  dispatcher, report-generation SQS queue, and report-generator worker.

## Requirements

### Requirement 1: Digest computation from recorded data

**User Story:** As a venue owner, I want a weekly summary of what Area Code
recorded at my venue, so that I can see the platform working without reading
a full report.

#### Acceptance Criteria

1. WHEN the Report_Pipeline runs its weekly pass, THE digest generator SHALL
   compute one Digest per business that has at least one active node,
   regardless of tier, covering the just-closed Digest_Week.
2. EACH Digest SHALL contain the Attribution_Metrics computed only from
   events already recorded by the platform (check-ins, redemptions,
   guest-claim rows), with week-over-week deltas against the prior
   Digest_Week where one exists.
3. THE first-time visitor metric SHALL count consumers whose first recorded
   check-in at any of the business's nodes falls inside the Digest_Week.
4. THE First-Get conversion metric SHALL count guest-claim tokens issued at
   the business's nodes that were redeemed into a signup during the
   Digest_Week, regardless of when the token was issued.
5. WHEN a metric's underlying sample is below the Suppression_Floor, THE
   Digest SHALL show the absolute count but SHALL withhold derived
   percentages and comparisons for that metric.
6. THE Digest SHALL contain no consumer names, identifiers, or any other
   consumer PII; the existing reports PII scanner SHALL run against the
   digest payload before persistence.

### Requirement 2: Honest framing, including quiet weeks

**User Story:** As the founder, I want every digest sentence to survive a
sceptical venue owner reading it at the till, so that the digest builds the
trust the subscription depends on.

#### Acceptance Criteria

1. ALL digest copy SHALL follow Honest_Framing: measurement verbs only, no
   causal claims about foot traffic Area Code did not measurably originate.
2. First-Get conversions MAY be described as captured by Area Code (the
   mechanism is the attribution), visits SHALL be described as recorded, not
   caused.
3. WHEN a Digest_Week has zero recorded visits, THE Digest SHALL say so
   plainly and SHALL include one constructive, non-blaming next step (for
   example pointing at the staff till pitch or the First-Get poster), never
   an inflated or padded number.
4. THE Digest SHALL NOT render any metric the platform did not record (no
   estimated revenue, no projected traffic).

### Requirement 3: Durable storage and idempotent generation

**User Story:** As an operator, I want digest generation to be replay-safe
and its history durable, so that a worker retry never double-writes and an
owner can look back.

#### Acceptance Criteria

1. THE digest generator SHALL persist exactly one Digest_Row per business per
   Digest_Week, idempotent under Report_Pipeline retries (conditional write;
   an existing row for the same week is a no-op that also suppresses a
   duplicate Digest_Email).
2. Digest_Rows SHALL be retained for 12 months and removed by the existing
   cleanup worker thereafter.
3. IF digest generation fails for one business, THEN THE failure SHALL be
   logged and SHALL NOT abort the pipeline run for other businesses.

### Requirement 4: Delivery to the dashboard and inbox

**User Story:** As a venue owner, I want the digest in my Monday inbox and on
my dashboard, so that the value proof reaches me without me hunting for it.

#### Acceptance Criteria

1. THE business dashboard SHALL render the latest Digest as a card, with a
   history view of prior weeks from Digest_Rows.
2. AFTER a Digest_Row is persisted, THE digest generator SHALL send the
   Digest_Email via the existing SES module to the business account email,
   unless Digest_Optout is set.
3. THE Digest_Email SHALL render the same metrics and copy as the dashboard
   card (one source of truth for the copy strings), plain layout, no consumer
   PII, subject line stating the venue name and the headline count.
4. IF the email send fails, THEN THE failure SHALL be logged and the
   Digest_Row SHALL remain (a missed email never loses the digest).
5. THE business settings SHALL expose the Digest_Optout toggle, defaulting to
   emails on, and the preference SHALL take effect from the next weekly run.

### Requirement 5: Tier-aware close, one digest for everyone

**User Story:** As the founder, I want every tier to get the digest with a
tier-appropriate closing line, so that starter venues feel the value they are
missing and paid venues are pointed at the depth they own.

#### Acceptance Criteria

1. Businesses on every tier (including starter and lapsed-to-starter) SHALL
   receive the same Attribution_Metrics; the digest SHALL NOT be tier-gated.
2. WHEN the business resolves to starter, THE digest close SHALL name one
   concrete thing the full report adds (for example peak-hours analysis) with
   an upgrade pointer, in Honest_Framing (no invented numbers from the locked
   report).
3. WHEN the business resolves to growth or pro, THE digest close SHALL link
   to the full weekly report surface instead.
4. THE tier SHALL be resolved with the unified tier resolver from
   `billing-revenue-integrity` once merged; until then the existing
   `getEffectiveTier` is used as-is.

### Requirement 6: Serverless integration with the existing pipeline

**User Story:** As the infra owner, I want the digest to ride the existing
weekly machinery, so that no new always-on resources or schedules appear.

#### Acceptance Criteria

1. THE digest SHALL be generated inside the existing Report_Pipeline weekly
   run (dispatcher fan-out and report-generator worker), with the dispatcher
   extended to include every business with an active node in the weekly pass
   if it does not already.
2. NO new tables, queues, schedules, or Lambdas SHALL be added; Digest_Rows
   live in the app-data table.
3. THE digest generation SHALL add no SMS and no phone identifiers anywhere,
   per `no-sms-no-phone-auth.md`.
