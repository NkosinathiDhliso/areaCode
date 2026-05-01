# Requirements Document

## Introduction

Venue Intelligence Reports packages Area Code's existing check-in, pulse, crowd vibe, tier, and reward data into automated weekly and monthly intelligence reports for businesses. Reports are delivered to the business dashboard (and optionally via email/WhatsApp), giving venue owners actionable insights they cannot get from any other platform — peak hours, crowd composition, music taste profiles, repeat visitor rates, competitive benchmarks, and cross-venue journey patterns. The feature is gated by business tier: growth and pro tiers receive full detailed reports, while starter and payg tiers receive a teaser summary only.

## Glossary

- **Report_Generator**: The EventBridge-triggered Lambda function that aggregates check-in data and produces intelligence reports on a weekly and monthly schedule.
- **Report**: A structured JSON document stored in the app-data DynamoDB table containing all computed metrics for a single venue over a single reporting period (week or month).
- **Teaser_Report**: A reduced version of a Report containing only high-level summary metrics (total check-ins, pulse state, top genre) without detailed breakdowns, served to starter and payg tier businesses.
- **Report_API**: The Fastify API routes under `/v1/business/me/reports` that serve report data to the business dashboard.
- **Dashboard_UI**: The React/Vite business dashboard component that renders intelligence reports.
- **Peak_Hours_Analyzer**: The module within Report_Generator that computes hourly and daily check-in distributions to identify peak traffic windows.
- **Crowd_Composer**: The module within Report_Generator that computes tier breakdown percentages (local, regular, fixture, institution, legend) from anonymized check-in data.
- **Music_Profiler**: The module within Report_Generator that aggregates genre preferences of visitors into a venue-level music taste profile using the 5-dimension archetype model (energy, cultural_rootedness, sophistication, edge, spirituality).
- **Repeat_Visitor_Calculator**: The module within Report_Generator that computes the percentage of check-ins from returning customers versus first-time visitors.
- **Trend_Comparator**: The module within Report_Generator that computes period-over-period deltas (this week vs last week, this month vs last month).
- **Benchmark_Engine**: The module within Report_Generator that computes anonymized competitive benchmarks by comparing a venue's metrics against aggregated averages for venues in the same city and category.
- **Recommendation_Engine**: The module within Report_Generator that produces actionable text recommendations based on computed metrics and detected patterns.
- **Journey_Analyzer**: The module within Report_Generator that computes anonymized cross-venue visit patterns to identify where a venue's visitors also check in.
- **Notification_Dispatcher**: The module that delivers report-ready notifications via WebSocket, email, or WhatsApp to business users.
- **Business_Tier**: The subscription level of a business account (starter, growth, pro, payg) that determines feature access.
- **Reporting_Period**: A calendar week (Monday 00:00 SAST to Sunday 23:59 SAST) or calendar month used as the time boundary for data aggregation.
- **POPIA**: Protection of Personal Information Act — South African data privacy legislation requiring that consumer data in reports be anonymized and aggregated.
- **Anonymized_Data**: Data that has been stripped of all personally identifiable information (userId, displayName, phone, email) and aggregated to group-level counts or percentages.

## Requirements

### Requirement 1: Scheduled Report Generation

**User Story:** As a business owner, I want intelligence reports generated automatically on a fixed schedule, so that I receive fresh insights every week and month without manual effort.

#### Acceptance Criteria

1. WHEN Monday 04:00 UTC (06:00 SAST) arrives, THE Report_Generator SHALL produce a weekly Report for each business that has at least one node with check-in activity in the preceding Reporting_Period.
2. WHEN the 1st day of a calendar month at 04:00 UTC (06:00 SAST) arrives, THE Report_Generator SHALL produce a monthly Report for each business that has at least one node with check-in activity in the preceding calendar month.
3. IF the Report_Generator fails to complete within 120 seconds for a single business, THEN THE Report_Generator SHALL log the error, skip that business, and continue processing the remaining businesses.
4. IF no check-in activity exists for a business in the Reporting_Period, THEN THE Report_Generator SHALL skip that business and produce no Report.
5. THE Report_Generator SHALL store each completed Report as a JSON document in the app-data DynamoDB table with partition key `REPORT#<businessId>` and sort key `<period>#<dateRange>`.

### Requirement 2: Peak Hours Analysis

**User Story:** As a business owner, I want to know which hours and days get the most check-ins, so that I can optimize staffing and promotions.

#### Acceptance Criteria

1. THE Peak_Hours_Analyzer SHALL compute check-in counts grouped by hour-of-day (0–23 SAST) and day-of-week (Monday–Sunday) for each node in the Reporting_Period.
2. THE Peak_Hours_Analyzer SHALL identify the top 3 peak hour windows (contiguous hours with the highest combined check-in count) for each node.
3. THE Peak_Hours_Analyzer SHALL include the peak day-of-week ranked by total check-in count.
4. WHEN a business has multiple nodes, THE Peak_Hours_Analyzer SHALL compute peak hours per node and an aggregate across all nodes.

### Requirement 3: Crowd Composition

**User Story:** As a business owner, I want to see the tier breakdown of my visitors, so that I can understand my customer loyalty profile.

#### Acceptance Criteria

1. THE Crowd_Composer SHALL compute the percentage of check-ins from each tier (local, regular, fixture, institution, legend) for each node in the Reporting_Period.
2. THE Crowd_Composer SHALL compute the total unique visitor count per tier for each node.
3. THE Crowd_Composer SHALL use only Anonymized_Data — no individual user identifiers appear in the output.

### Requirement 4: Music Taste Profile

**User Story:** As a business owner, I want to see the aggregated music preferences of my visitors, so that I can tailor my venue's music and events.

#### Acceptance Criteria

1. THE Music_Profiler SHALL aggregate genre weights across the 5 archetype dimensions (energy, cultural_rootedness, sophistication, edge, spirituality) for visitors who checked in during the Reporting_Period.
2. THE Music_Profiler SHALL rank the top 5 genres by visitor count for each node.
3. WHEN fewer than 5 visitors have music preferences in the Reporting_Period, THE Music_Profiler SHALL omit the music profile section and indicate insufficient data.

### Requirement 5: Repeat Visitor Rate

**User Story:** As a business owner, I want to know what percentage of my check-ins come from returning customers, so that I can measure customer retention.

#### Acceptance Criteria

1. THE Repeat_Visitor_Calculator SHALL compute the repeat visitor rate as the percentage of unique visitors in the Reporting_Period who also checked in during the previous equivalent period.
2. THE Repeat_Visitor_Calculator SHALL compute the first-time visitor count (unique visitors with no prior check-in at the node).
3. THE Repeat_Visitor_Calculator SHALL use only Anonymized_Data — counting unique anonymized visitor tokens, not exposing individual identities.

### Requirement 6: Trend Comparison

**User Story:** As a business owner, I want to see how my metrics compare to the previous period, so that I can track whether my venue is growing or declining.

#### Acceptance Criteria

1. THE Trend_Comparator SHALL compute the percentage change for total check-ins, unique visitors, repeat visitor rate, and pulse score between the current Reporting_Period and the previous equivalent period.
2. THE Trend_Comparator SHALL label each metric delta as "up", "down", or "flat" (within ±1% tolerance).
3. IF no data exists for the previous period, THEN THE Trend_Comparator SHALL label the comparison as "no_prior_data" and omit percentage deltas.

### Requirement 7: Competitive Benchmarks

**User Story:** As a business owner, I want to see how my venue compares to similar venues in my city, so that I can understand my competitive position.

#### Acceptance Criteria

1. THE Benchmark_Engine SHALL compute city-level and category-level averages for total check-ins, unique visitors, repeat visitor rate, and pulse score across all venues in the same city and category.
2. THE Benchmark_Engine SHALL express the business's position relative to the benchmark as a percentage above or below the average.
3. THE Benchmark_Engine SHALL use only Anonymized_Data — benchmark averages are computed from aggregated metrics and no individual venue names or identifiers are exposed to other businesses.
4. WHEN fewer than 3 venues exist in the same city and category, THE Benchmark_Engine SHALL omit the benchmark section and indicate insufficient comparison data.

### Requirement 8: Actionable Recommendations

**User Story:** As a business owner, I want to receive plain-language recommendations based on my data, so that I can take concrete actions to improve my venue's performance.

#### Acceptance Criteria

1. THE Recommendation_Engine SHALL generate at least 1 and at most 5 text recommendations per Report based on the computed metrics.
2. THE Recommendation_Engine SHALL generate a peak-hours recommendation WHEN a clear peak pattern is detected (top hour window has more than 2x the average hourly check-in count).
3. THE Recommendation_Engine SHALL generate a music recommendation WHEN the venue's crowd archetype profile differs significantly from the tier composition (e.g., high fixture-tier visitors but low sophistication score).
4. THE Recommendation_Engine SHALL generate a retention alert WHEN the repeat visitor rate drops by more than 10 percentage points compared to the previous period.
5. THE Recommendation_Engine SHALL express each recommendation as a single sentence referencing specific numbers from the Report.

### Requirement 9: Cross-Venue Journey Insights

**User Story:** As a business owner, I want to know where my visitors also check in, so that I can identify partnership opportunities and understand my customer journey.

#### Acceptance Criteria

1. THE Journey_Analyzer SHALL compute the top 5 other venues (by overlapping unique visitor count) where the business's visitors also checked in during the Reporting_Period.
2. THE Journey_Analyzer SHALL express each cross-venue relationship as a percentage of the business's unique visitors who also visited the other venue.
3. THE Journey_Analyzer SHALL use only Anonymized_Data — other venue names are included but no individual visitor identities are exposed.
4. WHEN fewer than 10 unique visitors exist for the business in the Reporting_Period, THE Journey_Analyzer SHALL omit the journey section and indicate insufficient data.
5. THE Journey_Analyzer SHALL suggest up to 2 partnership opportunities based on the highest-overlap venues.

### Requirement 10: Business Tier Gating

**User Story:** As a product owner, I want reports gated by business tier, so that detailed intelligence is a value driver for paid plans.

#### Acceptance Criteria

1. WHILE a business is on the growth or pro tier, THE Report_API SHALL return the full detailed Report including all sections (peak hours, crowd composition, music profile, repeat visitors, trends, benchmarks, recommendations, journey insights).
2. WHILE a business is on the starter or payg tier, THE Report_API SHALL return only the Teaser_Report containing: total check-ins, pulse state, top genre, and a single headline recommendation.
3. THE Teaser_Report SHALL include a call-to-action message indicating that detailed breakdowns are available on the growth tier.
4. WHEN a business upgrades from starter/payg to growth/pro, THE Report_API SHALL immediately grant access to all previously generated full Reports for that business.

### Requirement 11: Report Storage and Retrieval

**User Story:** As a business owner, I want to access my current and past reports from the dashboard, so that I can review historical trends.

#### Acceptance Criteria

1. THE Report_API SHALL expose a `GET /v1/business/me/reports` endpoint that returns a paginated list of available Reports for the authenticated business, sorted by date descending.
2. THE Report_API SHALL expose a `GET /v1/business/me/reports/:reportId` endpoint that returns the full content of a single Report.
3. THE Report_API SHALL retain Reports in DynamoDB for 12 months from the report generation date using a TTL attribute.
4. THE Report_API SHALL require business Cognito authentication and verify that the requested Report belongs to the authenticated business.

### Requirement 12: Report Notification

**User Story:** As a business owner, I want to be notified when a new report is ready, so that I do not have to check the dashboard manually.

#### Acceptance Criteria

1. WHEN a Report is generated, THE Notification_Dispatcher SHALL send a WebSocket event to the business user's active session indicating a new report is available.
2. WHEN a Report is generated and the business has opted into email notifications, THE Notification_Dispatcher SHALL queue an email containing a summary and a link to the full report on the dashboard.
3. IF the WebSocket delivery fails, THEN THE Notification_Dispatcher SHALL log the failure and rely on the email fallback without retrying the WebSocket.

### Requirement 13: POPIA Compliance

**User Story:** As a product owner, I want all consumer data in reports to be anonymized and aggregated, so that the platform complies with POPIA.

#### Acceptance Criteria

1. THE Report_Generator SHALL process check-in data using only anonymized aggregation — counting unique visitors by hashed tokens, not by userId, displayName, phone, or email.
2. THE Report_Generator SHALL verify that no Report document contains any field matching a known PII pattern (userId, cognitoSub, displayName, phone, email, avatarUrl).
3. IF a Report document fails the PII verification check, THEN THE Report_Generator SHALL reject the report, log an alert, and skip storage.
4. THE Journey_Analyzer SHALL reference other venues by name only — visitor overlap counts are expressed as percentages, and no individual visitor paths are reconstructable from the stored data.

### Requirement 14: Report Data Serialization

**User Story:** As a developer, I want reports stored in a well-defined JSON schema, so that the dashboard can reliably parse and render them.

#### Acceptance Criteria

1. THE Report_Generator SHALL serialize each Report as a JSON document conforming to a versioned schema (initial version: `v1`).
2. THE Report_Generator SHALL include a `schemaVersion` field in every Report document.
3. THE Report_API SHALL parse stored Report JSON and return it to the Dashboard_UI.
4. FOR ALL valid Report objects, serializing to JSON then parsing back SHALL produce an equivalent object (round-trip property).

### Requirement 15: Dashboard Report Display

**User Story:** As a business owner, I want to view my intelligence reports in the business dashboard, so that I can consume insights visually.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL display a "Reports" section in the business dashboard navigation.
2. THE Dashboard_UI SHALL render the most recent Report with visual charts for peak hours (bar chart), crowd composition (pie/donut chart), and music profile (radar chart).
3. THE Dashboard_UI SHALL display trend comparisons with directional indicators (up arrow, down arrow, flat dash) and percentage values.
4. THE Dashboard_UI SHALL display recommendations as a numbered list with contextual icons.
5. WHILE the business is on the starter or payg tier, THE Dashboard_UI SHALL render the Teaser_Report with blurred placeholders for locked sections and an upgrade prompt.
6. THE Dashboard_UI SHALL allow navigation between weekly and monthly reports and between historical report dates.
