# Implementation Plan: Weekly Attribution Digest

## Overview

Bottom-up: pure week arithmetic and copy builder first (they carry the
honesty guarantees), then metric computation, then persistence and the
pipeline hook, then delivery, then the two portal surfaces. No new
infrastructure at any step; the only schedule is the existing weekly rule.
Independent of the three sibling specs; task 6.2 swaps in the unified tier
resolver when billing-revenue-integrity task 5 has merged, and works with the
current `getEffectiveTier` until then.

## Tasks

- [x] 1. Pure digest core (R1, R2)
  - [x] 1.1 `digestWeekFor` week arithmetic in
        `backend/src/features/reports/digest.ts`
    - Monday 00:00 SAST boundaries as fixed UTC+2 offsets, stable week id for
      any instant in the same week
    - _Requirements: 1.1_
  - [x] 1.2 Write property test for week arithmetic
    - Property 1: Monday start, 7-day window, same-week stability
    - _Requirements: 1.1_
  - [x] 1.3 `buildDigestCopy` honest copy builder
    - Measurement-verb vocabulary, suppression-aware rendering, zero-visits
      branch with exactly one next step, tier-aware close variants
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.2, 5.3_
  - [x] 1.4 Write property test for honest copy
    - Property 3: no causal verbs, no suppressed percentages, honest zero
      branch
    - _Requirements: 2.1, 2.3_

- [x] 2. Metric computation (R1)
  - [x] 2.1 `computeDigest(businessId, weekStart)`
    - Visits and unique visitors from the check-ins NodeIndex reads;
      first-timers via earliest-check-in checks; redemptions from the rewards
      read; First-Get issued and converted from guest-claim rows (`issuedAt`,
      `redeemedAt`); busiest day and hour via the peak-hours binning helper;
      deltas from the prior Digest_Row only
    - Suppression list per the floor (counts always, percentages need >= 5)
    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [x] 2.2 Write property test for metric conservation
    - Property 2: firstTimers + returning = unique, unique <= visits,
      non-negative integers
    - _Requirements: 1.2, 1.3_

- [x] 3. Persistence and schema (R3)
  - [x] 3.1 `digestRowSchema` and repository functions
    - `putDigestRow` conditional write returning `written | duplicate`,
      `getLatestDigest`, `queryDigestHistory` with cursor
    - _Requirements: 3.1_
  - [x] 3.2 PII scan before persistence
    - Run the existing reports pii-scanner on the digest payload; throw on
      findings
    - _Requirements: 1.6_
  - [x] 3.3 12-month retention pass in the cleanup worker
    - Same pattern as the existing audited-row retention
    - _Requirements: 3.2_

- [x] 4. Pipeline integration (R3, R6)
  - [x] 4.1 Dispatcher includes every business with an active node in the
        weekly pass
    - Full-report tier logic untouched; digest needs the wider fan-out
    - _Requirements: 1.1, 6.1_
  - [x] 4.2 Digest path in the report-generator worker
    - Compute, scan, conditional put; per-business failures logged and
      skipped; email attempted only on `written`
    - _Requirements: 3.1, 3.3, 6.1, 6.2_
  - [x] 4.3 Write property test for generation idempotence
    - Property 4: one row and at most one email attempt per business-week
      under replay
    - _Requirements: 3.1_

- [x] 5. Email delivery (R4)
  - [x] 5.1 Digest_Email renderer on the shared SES module
    - Subject with venue name and headline count; body from `buildDigestCopy`
      output; no consumer PII; send failure logged, row retained
    - _Requirements: 4.2, 4.3, 4.4_
  - [x] 5.2 Digest_Optout preference
    - `digestEmailOptOut` on the business row, settings PATCH route, honoured
      by the generator from the next run
    - _Requirements: 4.5_

- [x] 6. Business API surface (R4, R5)
  - [x] 6.1 `GET /v1/business/digest/latest` and
        `GET /v1/business/digest/history`
    - `requireAuth('business')`, metrics plus copy strings in the response,
      cursor pagination on history
    - _Requirements: 4.1_
  - [x] 6.2 Tier-aware close resolution
    - Current `getEffectiveTier` now; swap to the unified resolver when
      billing-revenue-integrity task 5 merges
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Business portal surfaces (R4)
  - [x] 7.1 `DigestCard` on BusinessDashboard
    - Latest digest, deltas when present, quiet-week state, tier close;
      renders API copy strings only; jsdom tests for the four states
    - _Requirements: 4.1_
  - [x] 7.2 Digest history view
    - Reverse-chronological list behind the card
    - _Requirements: 4.1_
  - [x] 7.3 Digest_Optout toggle in SettingsPanel
    - Disabled while saving; jsdom test
    - _Requirements: 4.5_

- [x] 8. Dev rehearsal (R6)
  - [x] 8.1 Run the weekly pass in dev end to end
    - Verify Digest_Row, dev SES email, dashboard card, opt-out suppression,
      and a replayed run producing no duplicates
    - _Requirements: 3.1, 4.2, 6.1_

- [x] 9. End-to-end check
  - [x] 9.1 Playwright (business project): dashboard renders the digest card
        for a seeded business with a stored Digest_Row, including the quiet-week
        variant
