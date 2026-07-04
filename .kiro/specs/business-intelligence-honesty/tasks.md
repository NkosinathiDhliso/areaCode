# Implementation Plan: Business Intelligence Honesty

## Overview

This plan replaces stubbed business-analytics values with real aggregations or an explicit
Insufficient_Data_State the UI renders honestly. Work is organized so the shared contract
lands first, then the three live dashboard endpoints (reusing the report analyzers), then the
report-generator fixes (repeat visitors, pulse trend, benchmark cache), then the analyzer
min-data gates, and finally the cross-cutting guardrail test. Each task cites the audit
finding and requirement it closes.

## Tasks

- [x] 1. Establish the Insufficient_Data_State contract in shared types
  - Make metric groups nullable: `LiveStats.pulseScore: number | null`; `AudienceData.repeatVsNew`/`tierDistribution`/`peakHours` nullable; keep `BusinessMusicAudience.hasInsufficientData`.
  - Keep field names the panels already use to minimize churn.
  - _Requirements: 1.5, 2.5, 3.3_

- [x] 2. Honest business Live_Stats (H1)
  - [x] 2.1 Compute `pulseScore` and `rewardsClaimed` in `getLiveStats`
    - Aggregate `pulse:{cityId}:{nodeId}` across business nodes; return `null` when no pulse row exists.
    - Count same-day redeemed `REDEMPTION#` rows for the business's nodes for `rewardsClaimed`.
    - Remove the hardcoded `pulseScore: 0, rewardsClaimed: 0`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 2.2 Render the Pulse tile only when available in `LivePanel.tsx`
    - Hide the tile when `pulseScore === null`; render `Math.round(pulseScore)` otherwise.
    - _Requirements: 1.5_
  - [ ]\* 2.3 Repository test for `getLiveStats`
    - Stub `documentClient`/KV; assert computed pulse/rewards and the `null` path.
    - _Requirements: 1.1, 1.3, 1.4_

- [x] 3. Honest Audience_Analytics (H2, M2)
  - [x] 3.1 Compute `getAudienceAnalytics` via reused analyzers
    - Enrich period check-ins with tier (BatchGet `users`, mirror generator `loadUserData`).
    - Call `analyzeCrowdComposition` → `tierDistribution`; `analyzeRepeatVisitors` → `repeatVsNew`; `analyzePeakHours` → `peakHours`.
    - Return `null` groups below the display threshold; remove hardcoded empties/`repeat: 0`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 3.2 Sort `getRecentRedemptions` by `redeemedAt` desc
    - Replace unsorted `Scan().slice(0,20)` with an ordered read or in-memory sort before slice.
    - _Requirements: 2.6_
  - [x] 3.3 AudiencePanel renders honest empty states
    - Branch on `null` groups to show the existing "not enough data yet" copy.
    - _Requirements: 2.5_
  - [ ]\* 3.4 Tests for audience analytics
    - Repository test: known check-ins → expected distribution/repeat/peak; threshold → `null`. Panel test (jsdom): empty vs populated.
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [x] 4. Honest Music_Audience (M1)
  - [x] 4.1 Compute `getMusicAudience` via `analyzeMusicProfile`
    - Load visitors' music prefs; map analyzer output to `BusinessMusicAudience`; propagate `hasInsufficientData`. Remove the pure-stub return.
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]\* 4.2 Test music audience
    - Known prefs → expected genres/archetypes; below-min → `hasInsufficientData: true`.
    - _Requirements: 3.1, 3.3_

- [x] 5. Report repeat-visitor rate (H3)
  - [x] 5.1 Persist per-period Visitor_Tokens
    - Store hashed period tokens (inline or a `REPORT_TOKENS#` companion row with TTL); extend the Zod schema; expose via `getPreviousReport`. Use a period-stable salt or store the raw hashed set so intersection is meaningful.
    - _Requirements: 4.1_
  - [x] 5.2 Use real previous tokens in the generator
    - Set `previousVisitorTokens` from the prior Report; delete the unconditional `= new Set()` reset; signal "unavailable" when no prior tokens exist.
    - _Requirements: 4.2, 4.3, 4.4_
  - [x] 5.3 Suppress repeat-rate + its trend when unavailable
    - Report_API/Dashboard_UI omit the metric instead of showing 0%.
    - _Requirements: 4.5_
  - [ ]\* 5.4 Generator test for repeat visitors
    - Prior tokens → non-zero repeat rate; no prior → suppressed, not 0%.
    - _Requirements: 4.2, 4.4_

- [x] 6. Report pulse-score trend (H4)
  - [x] 6.1 Persist and read back previous `pulseScore`
    - Store `pulseScore` on the Report; set `previousMetrics.pulseScore` from prior Report; delete the hardcoded `0`.
    - _Requirements: 5.1, 5.2_
  - [x] 6.2 Mark "no prior data" for pulse trend when absent
    - Flag so the UI does not render `+100%` from a 0 baseline.
    - _Requirements: 5.3_
  - [ ]\* 6.3 Generator test for pulse trend
    - Prior pulse flows through; missing prior → "no prior data", never +100% from 0.
    - _Requirements: 5.2, 5.3_

- [x] 7. Benchmarks cache (M3)
  - [x] 7.1 Write BIZ_METRICS_Row at end of report generation
    - `PutItem` `pk=BIZ_METRICS#{businessId}`, `sk=LATEST` with the four metrics.
    - _Requirements: 6.1, 6.2_
  - [x] 7.2 Confirm hidden-state when < 3 rows; reconcile upgrade copy if writer deferred
    - _Requirements: 6.3, 6.4_
  - [ ]\* 7.3 Generator test asserts BIZ_METRICS_Row written
    - _Requirements: 6.1_

- [x] 8. Analyzer min-data gates (M4)
  - [x] 8.1 Add `hasInsufficientData` to peak-hours and crowd-composition
    - Thresholds mirror existing analyzers; `findPeakDay` returns "no peak day" when all zero.
    - _Requirements: 7.1, 7.2, 7.4_
  - [x] 8.2 Suppress peak-hours recommendation below threshold
    - _Requirements: 7.3_
  - [ ]\* 8.3 Property/unit tests for the new gates
    - Single-check-in → insufficient; `findPeakDay` empty case; recommendation suppressed.
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 9. Cross-cutting guardrail test (R8)
  - Assert non-DEV `getLiveStats`/`getAudienceAnalytics`/`getMusicAudience` metric fields are derived, not the DEV_MODE constants.
  - Assert the generator flows previous pulse + previous tokens (no hardcoded `0`, no unconditional empty set). Runs in `pnpm test`.
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 10. Final checkpoint — verify
  - `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm guard:serverless`.
  - _Requirements: all_

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1", "3.2", "8.1"],
      "description": "Shared nullable contract, standalone redemption sort, analyzer min-data gates"
    },
    {
      "id": 1,
      "tasks": ["2.1", "3.1", "4.1", "5.1", "7.1", "8.2"],
      "description": "Compute endpoints from real data; persist report tokens + benchmark cache"
    },
    {
      "id": 2,
      "tasks": ["2.2", "3.3", "5.2", "6.1", "7.2"],
      "description": "UI honest states; wire previous tokens and previous pulse into generator"
    },
    { "id": 3, "tasks": ["5.3", "6.2"], "description": "Suppress unavailable repeat-rate and pulse trend in API/UI" },
    {
      "id": 4,
      "tasks": ["2.3", "3.4", "4.2", "5.4", "6.3", "7.3", "8.3", "9"],
      "description": "Tests and cross-cutting guardrail"
    },
    { "id": 5, "tasks": ["10"], "description": "Full verification sweep" }
  ]
}
```

## Notes

- Tasks marked with `*` are optional tests and can be deferred for a faster first cut, but R8's guardrail (task 9) is not optional — it is the anti-regression net.
- Reuse over reimplementation: tasks 3, 4 call the existing `reports/analyzers/*` modules; do not fork a second aggregation (`dry-reuse-no-duplication.md`).
- Honest path only: nullable/`hasInsufficientData` is the wire signal for "not computable"; never emit a hardcoded `0`/`{}`/`[]` as a real value (`no-fallbacks-no-legacy.md`, `honest-presence.md`).
- Styling: honest empty states use existing copy and CSS-variable tokens only (no Tailwind color classes) per `code-style.md`.
- DEV_MODE branches stay for local dev but must never be the production source; task 9 enforces this.
