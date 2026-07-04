# Requirements Document

## Introduction

Several business-facing analytics surfaces were built with more ambition than their
backend implementations currently support. Backend repository methods and the report
generator return hardcoded `0` / empty-object / empty-array values where a real
aggregation was intended, and the UI renders those as confident, complete figures. A
`DEV_MODE` / `VITE_DEV_MOCK` branch returns rich, realistic data in every case, so the
gap is invisible in development and demos and only surfaces (often subtly wrong) in
production.

This feature closes those gaps for the business intelligence surfaces — the Live panel,
the Audience panel (including music insights), and the paid Venue Intelligence Reports.
The binding principle (`no-fallbacks-no-legacy.md`, `honest-presence.md`): there is exactly
one correct path per metric. A metric is either computed from real data or the surface
shows an honest "not enough data yet" state. A hardcoded `0`/`{}`/`[]` presented as a real
value is never acceptable. Where an aggregation already exists in the Venue Intelligence
Reports analyzers, it is reused rather than reimplemented (`dry-reuse-no-duplication.md`).

Covers audit findings H1, H2, H3, H4, M1, M2, M3, M4 from `docs/DATA_INTEGRITY_AUDIT.md`.

## Glossary

- **Live_Stats**: The payload behind `GET /v1/business/me/live-stats`, rendered by the business Live panel. Fields: `checkInsToday`, `rewardsClaimed`, `pulseScore`, `totalCheckIns`.
- **Audience_Analytics**: The payload behind `GET /v1/business/me/audience`. Fields: `tierDistribution`, `repeatVsNew`, `totalUniqueVisitors`, `peakHours`.
- **Music_Audience**: The payload behind `GET /v1/business/me/audience/music`, rendered by `MusicInsightsSection`.
- **Report**: A Venue Intelligence Report document produced by the Report_Generator (`backend/src/features/reports/generator.ts`).
- **Report_Analyzers**: The pure aggregation modules in `backend/src/features/reports/analyzers/*` (peak-hours, crowd-composition, music-profile, repeat-visitors, trends, benchmarks, journey, recommendations).
- **Pulse_Score**: The venue aliveness score derived from the decaying pulse KV (`pulse:{cityId}:{nodeId}`) maintained by the pulse-decay and check-in paths.
- **Visitor_Token**: A per-period anonymized hash of a userId used by the report pipeline in place of a raw identifier.
- **Insufficient_Data_State**: An explicit signal (a boolean flag on the payload, or omission of the metric) that tells the UI a metric cannot yet be honestly computed, so the UI renders a "not enough data yet" state instead of a number.
- **DEV_MODE**: The backend dev guard (`AREA_CODE_ENV === 'dev'` without `AREA_CODE_FORCE_LIVE`); the only place synthetic data may be returned.
- **BIZ_METRICS_Row**: A cached per-business period-metrics row at `app-data` `pk=BIZ_METRICS#{businessId}`, `sk=LATEST`, read by the benchmark analyzer.

## Requirements

### Requirement 1: Honest business Live_Stats (H1)

**User Story:** As a business owner, I want the Live panel's Pulse and rewards figures to reflect reality, so that I can trust how alive my venue looks right now.

#### Acceptance Criteria

1. WHEN `GET /v1/business/me/live-stats` is served outside DEV_MODE, THE system SHALL compute `pulseScore` from the venue's live Pulse_Score source (the decaying pulse KV / present-count aggregate the consumer map uses), never a hardcoded constant.
2. WHEN a business has multiple nodes, THE system SHALL report `pulseScore` as the maximum per-node Pulse_Score (the business's most-alive venue), NOT a sum, so the value stays on the same 0–N scale the consumer map uses for a single node. (A per-node breakdown MAY additionally be returned, but the headline `pulseScore` is the max.)
3. WHEN `GET /v1/business/me/live-stats` is served outside DEV_MODE, THE system SHALL compute `rewardsClaimed` from real redemption/claim data for the business's nodes for the current day, never a hardcoded constant.
4. IF a `pulseScore` value cannot be sourced for a node, THEN THE system SHALL treat it as absent (contributing 0 to an aggregate is allowed only when the underlying pulse is genuinely 0) and SHALL NOT emit a fabricated non-zero value.
5. THE Live panel SHALL render the Pulse tile only when `pulseScore` is a computed value; WHEN pulse is unavailable, THE panel SHALL omit the tile rather than display `0`.
6. THE DEV_MODE Live_Stats response SHALL remain available for local development but SHALL NOT be the source of production values.

### Requirement 2: Honest Audience_Analytics (H2, M2)

**User Story:** As a business owner, I want the Audience panel's repeat-vs-new, tier distribution, and peak hours to be computed from my real check-ins, so that I do not make decisions on fabricated loyalty numbers.

#### Acceptance Criteria

1. WHEN `GET /v1/business/me/audience` is served outside DEV*MODE, THE system SHALL compute `repeatVsNew` using the **dashboard definition of repeat**: within the loaded check-in history for the business's nodes, a \_repeat* visitor is a distinct user with more than one check-in, and a _new_ visitor is a distinct user with exactly one; it SHALL never return a hardcoded `repeat: 0`. THE system SHALL NOT reuse the report's cross-period token-intersection (`analyzeRepeatVisitors`) for this dashboard metric, because that answers a different question (period-over-period return) and depends on per-period token salting.
2. WHEN `GET /v1/business/me/audience` is served outside DEV_MODE, THE system SHALL compute `tierDistribution` from the tiers of visitors in the period, never an empty object.
3. WHEN `GET /v1/business/me/audience` is served outside DEV_MODE, THE system SHALL compute `peakHours` from the check-in time distribution, never an empty array, OR omit the field and signal Insufficient_Data_State when there is not enough data.
4. WHERE a tier or time aggregation equivalent already exists in Report_Analyzers (`crowd-composition`, `peak-hours`), THE system SHALL reuse that module rather than reimplement it. This reuse clause applies to `tierDistribution` and `peakHours` only; `repeatVsNew` uses the dashboard definition in 2.1.
5. IF the period has fewer visitors than the panel's display threshold, THEN THE system SHALL signal Insufficient_Data_State so the Audience panel shows its "not enough data yet" state rather than partial or zeroed numbers.
6. WHEN `getRecentRedemptions` returns recent redemptions, THE system SHALL order them by redemption time descending, never returning an unsorted Scan slice.

### Requirement 3: Honest Music_Audience (M1)

**User Story:** As a business owner, I want music insights to populate when my crowd has music preferences, so that the feature delivers the taste intelligence it advertises.

#### Acceptance Criteria

1. WHEN `GET /v1/business/me/audience/music` is served outside DEV_MODE, THE system SHALL compute `totalWithMusicPrefs`, `genreDistribution`, and `archetypeBreakdown` from real visitor music data, never returning a pure stub of zeros/empties.
2. WHERE the Music_Profiler aggregation exists in `Report_Analyzers/music-profile`, THE system SHALL reuse it rather than reimplement genre/archetype aggregation.
3. IF fewer than the minimum number of visitors have music preferences, THEN THE Music_Audience response SHALL signal Insufficient_Data_State so `MusicInsightsSection` shows its "not enough music data" state honestly (not as a stubbed permanent empty).

### Requirement 4: Correct repeat-visitor rate in Reports (H3)

**User Story:** As a paying business owner, I want my report's repeat-visitor rate to reflect actual returning customers, so that I can trust my retention data.

#### Acceptance Criteria

1. THE Report_Generator SHALL persist per-period Visitor_Tokens (or a period-stable hashed identifier) for each Report so that consecutive periods can be intersected.
2. WHEN generating a Report for which a previous Reporting_Period Report exists, THE Report_Generator SHALL compute `previousVisitorTokens` from stored data and pass a non-empty set to the repeat-visitor analyzer when returning visitors exist.
3. THE Report_Generator SHALL NOT unconditionally reset `previousVisitorTokens` to an empty set when prior data exists.
4. IF no prior-period visitor data is available, THEN THE Report SHALL signal that repeat rate is unavailable for that period rather than presenting `0%` as a computed value.
5. THE repeat-visitor rate and its trend SHALL be suppressed in the Report_API/Dashboard_UI when Insufficient_Data_State applies.

### Requirement 5: Correct pulse-score trend in Reports (H4)

**User Story:** As a paying business owner, I want the pulse-score trend to compare against the real previous period, so that I am not shown a fabricated increase.

#### Acceptance Criteria

1. THE Report_Generator SHALL persist each Report's `pulseScore` so it is available as the previous value in the next period.
2. WHEN computing trends for a Report with a prior Report, THE Report_Generator SHALL set `previousMetrics.pulseScore` from the stored prior value, never a hardcoded `0`.
3. IF a prior `pulseScore` is genuinely unavailable, THEN THE Trend_Comparator output for `pulseScore` SHALL be marked "no prior data" and the Dashboard_UI SHALL NOT render a `+100% up` delta derived from a `0` baseline.

### Requirement 6: Competitive benchmarks populate (M3)

**User Story:** As a Growth/Pro business owner, I want the competitive benchmarks I was promised on upgrade to actually appear, so that the paid feature delivers.

#### Acceptance Criteria

1. THE Report_Generator SHALL write a BIZ_METRICS_Row (`pk=BIZ_METRICS#{businessId}`, `sk=LATEST`) capturing the business's period metrics (`totalCheckIns`, `uniqueVisitors`, `repeatVisitorRate`, `pulseScore`) at the end of each successful Report generation.
2. WHEN the Benchmark_Engine loads category venue metrics, THE system SHALL read the BIZ_METRICS_Rows written by Requirement 6.1.
3. IF fewer than the minimum comparable venues have a BIZ_METRICS_Row, THEN THE benchmarks section SHALL remain in Insufficient_Data_State (hidden) — this is the honest fallback, not a defect.
4. IF benchmarks cannot be delivered for the current tiers/scale, THEN the upgrade copy in `tier-gating.ts` SHALL be updated to not promise a feature that never renders. (Choose 6.1–6.2 wiring OR this copy change, not both permanently.)

### Requirement 7: Minimum-data gates on report analyzers (M4)

**User Story:** As a business owner with a brand-new or quiet venue, I do not want confident staffing/crowd claims generated from a single check-in, so that guidance is trustworthy.

#### Acceptance Criteria

1. THE Peak_Hours_Analyzer SHALL expose an Insufficient_Data_State when the period's check-in count is below a defined minimum, mirroring the existing gates on `music-profile` (5), `benchmarks` (3), and `journey` (10).
2. THE Crowd_Composer SHALL expose an Insufficient_Data_State below a defined minimum visitor count rather than emitting tier percentages such as "100%" from a single check-in.
3. WHEN peak-hours data is in Insufficient_Data_State, THE Recommendation_Engine SHALL NOT emit a peak-hours recommendation.
4. WHEN `findPeakDay` has no check-ins, THE result SHALL be reported as "no peak day" rather than defaulting to `Monday`.

### Requirement 8: Guardrail against recurrence (cross-cutting)

**User Story:** As an engineer, I want a test that fails if a production analytics method returns the same hardcoded shape as its DEV_MODE branch, so that this class of defect cannot silently reappear.

#### Acceptance Criteria

1. THE system SHALL include an automated test asserting that, outside DEV_MODE, the metric fields of `getLiveStats`, `getAudienceAnalytics`, and `getMusicAudience` are not returned as the hardcoded constants their DEV_MODE branches use.
2. THE test SHALL assert that the Report_Generator does not hardcode `previousMetrics.pulseScore` to `0` and does not unconditionally empty `previousVisitorTokens` when prior data exists.
3. THE guardrail SHALL run in the standard `pnpm test` suite.
