# Implementation Plan: Venue Intelligence Reports

## Overview

This plan implements automated weekly and monthly intelligence reports for business owners. The work is organized bottom-up: core types and pure analyzer functions first (with property tests), then the generation pipeline (dispatcher + worker Lambda), API routes with tier gating, infrastructure (Terraform), and finally the dashboard UI. Each task builds on the previous, and checkpoints validate incremental progress.

## Tasks

- [x] 1. Define report types, Zod schemas, and anonymization utilities
  - [x] 1.1 Create report types and Zod schemas
    - Create `backend/src/features/reports/types.ts`
    - Define TypeScript interfaces: `Report`, `TeaserReport`, `ReportSummary`, `AnonymizedCheckIn`, `PeakHoursResult`, `CrowdCompositionResult`, `MusicProfileResult`, `RepeatVisitorResult`, `TrendResult`, `TrendDelta`, `BenchmarkResult`, `BenchmarkComparison`, `JourneyResult`, `RecommendationResult`, `GenerateReportMessage`, `DispatchEvent`, `ReportMetrics`
    - Define Zod schemas for `Report` (v1) and `TeaserReport` with `schemaVersion` field
    - Define Zod schemas for API query params (`cursor`, `period` filter)
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 1.2 Create anonymization utility
    - Create `backend/src/features/reports/anonymize.ts`
    - Implement `anonymizeCheckIns(rawCheckIns, periodStart, salt)` that strips PII (userId, displayName, phone, email, avatarUrl) and produces `AnonymizedCheckIn[]` with SHA-256 hashed `visitorToken`
    - Convert timestamps to SAST (UTC+2) for `hourOfDay` and `dayOfWeek` fields
    - _Requirements: 13.1, 3.3, 5.3_

  - [x] 1.3 Create PII scanner
    - Create `backend/src/features/reports/pii-scanner.ts`
    - Implement `scanForPii(reportJson: string): PiiScanResult` that scans serialized JSON for known PII patterns (UUID userId, cognitoSub, displayName, phone regex, email regex, avatarUrl)
    - Return `{ clean: boolean, violations: string[] }` with field paths of any PII found
    - _Requirements: 13.2, 13.3_

  - [x]* 1.4 Write property test for report serialization round-trip
    - **Property 13: Report Serialization Round-Trip**
    - Create `backend/src/features/reports/__tests__/report-serialization.property.test.ts`
    - Use fast-check to generate arbitrary valid `Report` objects conforming to v1 schema
    - Assert: `JSON.parse(JSON.stringify(report))` deeply equals original
    - **Validates: Requirements 14.1, 14.4**

  - [x]* 1.5 Write property test for PII scanner correctness
    - **Property 5: PII Scanner Correctness**
    - Create `backend/src/features/reports/__tests__/pii-scanner.property.test.ts`
    - Generate JSON documents with/without injected PII patterns (UUID, email, phone, displayName, avatarUrl)
    - Assert: documents with PII → `clean: false`; documents with only aggregated data → `clean: true`
    - **Validates: Requirements 3.3, 5.3, 13.1, 13.2**

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement peak hours and crowd composition analyzers
  - [x] 3.1 Implement peak hours analyzer
    - Create `backend/src/features/reports/analyzers/peak-hours.ts`
    - Implement `analyzePeakHours(checkIns: AnonymizedCheckIn[]): PeakHoursResult`
    - Compute hourly distribution (0–23 SAST), daily distribution (Monday–Sunday)
    - Identify top 3 contiguous peak hour windows by combined count
    - Identify peak day of week
    - Support per-node and aggregate computation when multiple nodes exist
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x]* 3.2 Write property test for peak hours distribution invariant
    - **Property 2: Peak Hours Distribution and Aggregation Invariant**
    - Create `backend/src/features/reports/__tests__/analyzers/peak-hours.property.test.ts`
    - Assert: sum of hourly distribution = total check-ins, sum of daily distribution = total check-ins, peak day = day with max count, aggregate hourly = sum of per-node hourly
    - **Validates: Requirements 2.1, 2.3, 2.4**

  - [x]* 3.3 Write property test for peak hours top windows correctness
    - **Property 3: Peak Hours Top Windows Correctness**
    - In same test file as 3.2
    - Assert: each top-3 window has combined count ≥ any other contiguous window of same length not in top 3
    - **Validates: Requirements 2.2**

  - [x] 3.4 Implement crowd composition analyzer
    - Create `backend/src/features/reports/analyzers/crowd-composition.ts`
    - Implement `analyzeCrowdComposition(checkIns: AnonymizedCheckIn[]): CrowdCompositionResult`
    - Compute tier percentages (local, regular, fixture, institution, legend)
    - Compute unique visitor count per tier and total unique visitors
    - Use only anonymized data (visitorToken, not userId)
    - _Requirements: 3.1, 3.2, 3.3_

  - [x]* 3.5 Write property test for crowd composition invariant
    - **Property 4: Crowd Composition Invariant**
    - Create `backend/src/features/reports/__tests__/analyzers/crowd-composition.property.test.ts`
    - Assert: tier percentages sum to 100 (±1% rounding), each percentage = (tier count / total) × 100, sum of unique per-tier = total unique
    - **Validates: Requirements 3.1, 3.2**

- [x] 4. Implement music profile, repeat visitors, and trends analyzers
  - [x] 4.1 Implement music profile analyzer
    - Create `backend/src/features/reports/analyzers/music-profile.ts`
    - Implement `analyzeMusicProfile(visitorIds, musicPrefsMap): MusicProfileResult`
    - Aggregate genre weights across 5 archetype dimensions (energy, cultural_rootedness, sophistication, edge, spirituality)
    - Rank top 5 genres by visitor count
    - Return `hasInsufficientData: true` when fewer than 5 visitors have music preferences
    - _Requirements: 4.1, 4.2, 4.3_

  - [x]* 4.2 Write property test for music profile aggregation
    - **Property 6: Music Profile Aggregation Correctness**
    - Create `backend/src/features/reports/__tests__/analyzers/music-profile.property.test.ts`
    - Assert: each dimension = average across visitors, top genres sorted descending by count with length ≤ 5, insufficient data when < 5 visitors
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 4.3 Implement repeat visitors analyzer
    - Create `backend/src/features/reports/analyzers/repeat-visitors.ts`
    - Implement `analyzeRepeatVisitors(currentPeriodVisitors, previousPeriodVisitors): RepeatVisitorResult`
    - Compute repeat rate as |intersection| / |current| × 100
    - Compute first-time visitor count as |current| − |intersection|
    - _Requirements: 5.1, 5.2, 5.3_

  - [x]* 4.4 Write property test for repeat visitor rate
    - **Property 7: Repeat Visitor Rate Computation**
    - Create `backend/src/features/reports/__tests__/analyzers/repeat-visitors.property.test.ts`
    - Assert: repeatRate = |intersection(current, previous)| / |current| × 100, firstTimeCount = |current| − |intersection|
    - **Validates: Requirements 5.1, 5.2**

  - [x] 4.5 Implement trends analyzer
    - Create `backend/src/features/reports/analyzers/trends.ts`
    - Implement `analyzeTrends(currentMetrics, previousMetrics): TrendResult`
    - Compute percentage change for total check-ins, unique visitors, repeat visitor rate, pulse score
    - Label each delta as "up" (>1%), "down" (<-1%), or "flat" (±1%)
    - Return `hasPriorData: false` when previousMetrics is null
    - _Requirements: 6.1, 6.2, 6.3_

  - [x]* 4.6 Write property test for trend computation
    - **Property 8: Trend Computation Correctness**
    - Create `backend/src/features/reports/__tests__/analyzers/trends.property.test.ts`
    - Assert: percentChange = (current − previous) / previous × 100, direction labels correct per ±1% threshold, hasPriorData false when previous is null
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement benchmarks, journey, and recommendations analyzers
  - [x] 6.1 Implement benchmarks analyzer
    - Create `backend/src/features/reports/analyzers/benchmarks.ts`
    - Implement `analyzeBenchmarks(venueMetrics, categoryVenueMetrics): BenchmarkResult`
    - Compute city+category averages for check-ins, unique visitors, repeat rate, pulse score
    - Express venue position as percentage above/below average
    - Return `hasInsufficientData: true` when fewer than 3 venues in same city+category
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]* 6.2 Write property test for benchmark computation
    - **Property 9: Benchmark Computation Correctness**
    - Create `backend/src/features/reports/__tests__/analyzers/benchmarks.property.test.ts`
    - Assert: average = sum / count, percentAboveBelow = (venue − avg) / avg × 100, insufficient data when < 3 venues
    - **Validates: Requirements 7.1, 7.2, 7.4**

  - [x] 6.3 Implement journey analyzer
    - Create `backend/src/features/reports/analyzers/journey.ts`
    - Implement `analyzeJourney(venueVisitorTokens, allVenueVisitorMap): JourneyResult`
    - Compute top 5 overlapping venues by shared unique visitor count
    - Express overlap as percentage of venue's unique visitors
    - Generate up to 2 partnership suggestions from highest-overlap venues
    - Return `hasInsufficientData: true` when fewer than 10 unique visitors
    - Reference other venues by name only — no individual visitor paths
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 6.4 Write property test for journey analysis
    - **Property 11: Journey Analysis Correctness**
    - Create `backend/src/features/reports/__tests__/analyzers/journey.property.test.ts`
    - Assert: top venues sorted descending by overlap count, length ≤ 5, overlap % = overlapCount / venueUnique × 100, partnerships ≤ 2, insufficient data when < 10 visitors
    - **Validates: Requirements 9.1, 9.2, 9.4, 9.5**

  - [x] 6.5 Implement recommendations engine
    - Create `backend/src/features/reports/analyzers/recommendations.ts`
    - Implement `generateRecommendations(report: ReportSections): RecommendationResult`
    - Generate 1–5 recommendations based on computed metrics
    - Peak-hours recommendation when top window > 2× average hourly count
    - Music recommendation when crowd archetype differs from tier composition
    - Retention alert when repeat rate drops > 10 percentage points
    - Each recommendation is a single sentence with specific numbers
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 6.6 Write property test for recommendation bounds and conditions
    - **Property 10: Recommendation Generation Bounds and Conditions**
    - Create `backend/src/features/reports/__tests__/analyzers/recommendations.property.test.ts`
    - Assert: 1–5 recommendations, each is single sentence with ≥1 number, peak-hours rec present when top window > 2× avg, retention alert when drop > 10pp
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5**

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement report generation pipeline (dispatcher + worker)
  - [x] 8.1 Implement report dispatcher Lambda
    - Create `backend/src/features/reports/dispatcher.ts`
    - Handle EventBridge trigger with `periodType` (weekly/monthly)
    - Compute `periodStart` and `periodEnd` based on SAST calendar boundaries (Monday 00:00 SAST for weekly, 1st of month for monthly)
    - Query businesses table, filter to those with nodes that have check-in activity in the period
    - Send one SQS message per qualifying business with `{ businessId, periodType, periodStart, periodEnd }`
    - Skip businesses with zero check-ins in the period
    - _Requirements: 1.1, 1.2, 1.4_

  - [ ]* 8.2 Write property test for business activity filtering
    - **Property 1: Business Activity Filtering**
    - Create `backend/src/features/reports/__tests__/dispatcher.property.test.ts`
    - Assert: messages produced for exactly the businesses with ≥1 check-in, no messages for zero-activity businesses
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [x] 8.3 Implement report generator worker Lambda
    - Create `backend/src/features/reports/generator.ts`
    - Handle SQS event containing `GenerateReportMessage`
    - Load check-ins for all business nodes in the period via NodeIndex GSI
    - Anonymize check-ins using `anonymizeCheckIns()`
    - Call each analyzer module in sequence: peakHours, crowdComposition, musicProfile, repeatVisitors, trends, benchmarks, journey, recommendations
    - Load previous period report from app-data table for trend comparison
    - Load category venue metrics for benchmarks via LocationIndex GSI
    - Assemble full `Report` object with `schemaVersion: 'v1'`
    - Run PII scanner on serialized JSON — reject and log if PII detected
    - Store report in app-data table with pk `REPORT#<businessId>`, sk `<periodType>#<periodStart>`, GSI1 keys, and TTL (12 months)
    - Enforce 120-second timeout per business; log error and skip on failure
    - Send WebSocket notification and queue email notification via SQS push-sender
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 12.1, 12.2, 12.3, 13.1, 13.2, 13.3, 14.1, 14.2_

  - [x] 8.4 Create DynamoDB repository for reports
    - Create `backend/src/features/reports/repository.ts`
    - Implement `storeReport(report)` — PutItem to app-data table with correct pk/sk/GSI1 keys and TTL
    - Implement `getReport(businessId, reportId)` — GetItem from app-data table
    - Implement `listReports(businessId, cursor?, period?)` — Query GSI1 with `REPORTS#<businessId>`, ScanIndexForward=false, pagination via cursor
    - Implement `getPreviousReport(businessId, periodType, periodStart)` — GetItem with computed previous period sk
    - _Requirements: 1.5, 11.1, 11.2, 11.3_

- [x] 9. Implement report API routes with tier gating
  - [x] 9.1 Create report API handler
    - Create `backend/src/features/reports/handler.ts`
    - Implement `GET /v1/business/me/reports` — paginated list of report summaries, sorted by date descending, requires business Cognito auth
    - Implement `GET /v1/business/me/reports/:reportId` — full report content, verify report belongs to authenticated business
    - Register routes in `backend/src/app.ts` (import and `app.register(reportRoutes)`)
    - _Requirements: 11.1, 11.2, 11.4_

  - [x] 9.2 Implement tier gating logic
    - Create `backend/src/features/reports/tier-gating.ts`
    - Implement `filterByTier(report: Report, tier: string): Report | TeaserReport`
    - For growth/pro tiers: return full report with all sections
    - For starter/payg tiers: return `TeaserReport` with only summary (totalCheckIns, pulseState, topGenre, headlineRecommendation) plus `upgradeMessage`
    - When business upgrades, previously generated full reports become immediately accessible (no re-generation needed — full reports are always stored)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x]* 9.3 Write property test for tier gating correctness
    - **Property 12: Tier Gating Correctness**
    - Create `backend/src/features/reports/__tests__/tier-gating.property.test.ts`
    - Assert: growth/pro → all sections present, starter/payg → only summary + upgradeMessage
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [x]* 9.4 Write integration tests for report API routes
    - Create `backend/src/features/reports/__tests__/handler.integration.test.ts`
    - Test auth requirement, pagination, tier gating response shape, 404 for missing reports, 403 for wrong business
    - _Requirements: 11.1, 11.2, 11.4, 10.1, 10.2_

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Add Terraform infrastructure for report generation
  - [x] 11.1 Add report-dispatcher Lambda to Terraform
    - Add `module "lambda_report_dispatcher"` in `infra/environments/dev/main.tf`
    - Use existing `../../modules/lambda` module with arm64, timeout=30, memory=256
    - Add VPC config, environment variables for table names and SQS queue URL
    - Add DynamoDB read access IAM policy for businesses, nodes, checkins tables
    - Add SQS send access IAM policy for report-generation queue
    - _Requirements: 1.1, 1.2_

  - [x] 11.2 Add report-generator Lambda to Terraform
    - Add `module "lambda_report_generator"` in `infra/environments/dev/main.tf`
    - Use existing `../../modules/lambda` module with arm64, timeout=120, memory=512
    - Add VPC config, environment variables for all table names, SQS queue URLs, anonymization salt
    - Add DynamoDB read/write access IAM policy for all relevant tables
    - Add SQS send access for push-sender queue
    - Add WebSocket API management access for notifications
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 11.3 Add SQS report-generation queue to Terraform
    - Add `module "sqs_report_generation"` using existing `../../modules/sqs` module
    - Set visibility_timeout=150 (> Lambda 120s timeout), max_receive_count=2
    - Wire Lambda event source mapping to report-generator Lambda
    - _Requirements: 1.3_

  - [x] 11.4 Add EventBridge schedules for report generation
    - Add two entries to the `eventbridge_schedules` module:
      - `report-weekly`: `cron(0 4 ? * MON *)` — Monday 04:00 UTC (06:00 SAST)
      - `report-monthly`: `cron(0 4 1 * ? *)` — 1st of month 04:00 UTC (06:00 SAST)
    - Both trigger the report-dispatcher Lambda
    - _Requirements: 1.1, 1.2_

  - [x] 11.5 Add IAM policies for report Lambdas
    - Add DynamoDB access policy for report-dispatcher (read businesses, nodes, checkins)
    - Add DynamoDB access policy for report-generator (read/write all tables including app-data)
    - Add SQS send policy for report-dispatcher → report-generation queue
    - Add SQS receive/delete policy for report-generator ← report-generation queue
    - Add SQS send policy for report-generator → push-sender queue
    - _Requirements: 1.1, 1.5, 12.1, 12.2_

- [x] 12. Implement dashboard ReportsPanel UI
  - [x] 12.1 Add "reports" panel to business dashboard navigation
    - Add `'reports'` to the `DashboardPanel` type in `packages/shared/stores/businessStore.ts`
    - Add `reports` entry to `PANELS` array and `PANEL_LABELS` in `BusinessDashboard.tsx`
    - Add lazy import for `ReportsPanel` and case in `renderPanel()` switch
    - Add i18n translation key `biz.panel.reports` to business locale files
    - _Requirements: 15.1_

  - [x] 12.2 Create ReportsPanel component
    - Create `apps/business/src/screens/panels/ReportsPanel.tsx`
    - Fetch reports list via `GET /v1/business/me/reports` using `@tanstack/react-query`
    - Implement report selector: weekly/monthly toggle and date navigation
    - Display summary cards (total check-ins, pulse state, top genre)
    - Display trend comparisons with directional indicators (↑ ↓ —) and percentage values
    - Display recommendations as a numbered list with contextual icons
    - Display journey insights section (when available)
    - For starter/payg tiers: render teaser with blurred placeholders for locked sections and upgrade prompt
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 12.3 Add chart components for report visualization
    - Install `recharts` in `apps/business/package.json` (if not already present)
    - Create peak hours bar chart component using recharts `BarChart`
    - Create crowd composition donut chart using recharts `PieChart`
    - Create music profile radar chart using recharts `RadarChart`
    - Integrate charts into ReportsPanel, conditionally rendered based on data availability
    - _Requirements: 15.2_

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All Lambda functions use arm64 architecture and PAY_PER_REQUEST DynamoDB — no always-on resources
- The design uses TypeScript throughout — all implementation tasks use TypeScript
- Full reports are always generated and stored; tier gating filters at the API layer so upgrades instantly unlock history
