# Design Document

## Overview

This feature replaces stubbed business-analytics values with real aggregations, or with an
explicit Insufficient_Data_State the UI can render honestly. The work is deliberately
biased toward reuse: the Venue Intelligence Reports pipeline already contains correct,
property-tested pure analyzers for crowd composition, repeat visitors, peak hours, and
music profiles. The business dashboard endpoints will call those same modules instead of
carrying a second, stubbed implementation.

Two shapes of change:

1. **Live dashboard endpoints** (`business/repository.ts`) — compute from data already in
   scope (check-ins, redemptions, pulse KV) and add an Insufficient_Data_State signal.
2. **Report generator** (`reports/generator.ts` + `repository.ts`) — persist the two
   values that were being faked (per-period visitor tokens, previous pulse score), write
   the benchmark cache, and add min-data gates to two analyzers.

Guiding rules: `no-fallbacks-no-legacy.md` (one correct path, no masking defaults),
`honest-presence.md` (under-claim, never over-claim), `dry-reuse-no-duplication.md` (reuse
the analyzers), `code-style.md` (no Tailwind color classes, honest empty states).

## Architecture

```
Business dashboard (React)
  Live panel        ── GET /v1/business/me/live-stats      ── getLiveStats()
  Audience panel    ── GET /v1/business/me/audience         ── getAudienceAnalytics()
  Music insights    ── GET /v1/business/me/audience/music   ── getMusicAudience()
  Reports panel     ── GET /v1/business/me/reports/:id      ── stored Report

Backend
  business/repository.ts ──▶ reuses reports/analyzers/{crowd-composition,
                              repeat-visitors, peak-hours, music-profile}
  reports/generator.ts   ──▶ persists Visitor_Tokens + pulseScore + BIZ_METRICS_Row
  reports/repository.ts  ──▶ getPreviousReport() extended to expose stored tokens/pulse
```

Data sources that already exist and will be used:

- Check-ins per node: `getCheckInsByNode(nodeId, opts)` (already called in `getLiveStats`/`getAudienceAnalytics`).
- Pulse score: KV `pulse:{cityId}:{nodeId}` (pulse-decay worker + check-in path) / present-count aggregate (`presence` repository `getCounter`).
- Redemptions: `app-data` `REDEMPTION#` rows (with `redeemedAt`).
- User tiers / music prefs: `users` table via `BatchGet` (generator already does this in `loadUserData`).

## Components and Interfaces

### 1. Insufficient_Data_State contract

A single, shared convention so the UI treats all three endpoints the same way. Each metric
group carries an explicit availability flag rather than a magic zero:

```ts
// packages/shared/types (extend existing business analytics types)
interface AudienceAnalytics {
  totalUniqueVisitors: number
  repeatVsNew: { repeat: number; new: number } | null // null => not enough data
  tierDistribution: Record<string, number> | null // null => not enough data
  peakHours: string[] | null // null => not enough data
}
interface LiveStats {
  checkInsToday: number
  totalCheckIns: number
  pulseScore: number | null // null => unavailable, hide tile
  rewardsClaimed: number
}
interface BusinessMusicAudience {
  hasInsufficientData: boolean
  totalWithMusicPrefs: number
  genreDistribution: Record<string, number>
  archetypeBreakdown: Record<string, number>
  peakArchetypeByTime: unknown[]
}
```

Rationale: `null` (not `0`/`{}`) is the wire signal for "not computable". The UI branches on
`null`/`hasInsufficientData` to render the existing "not enough data yet" copy. This is the
honest path, not a fallback.

### 2. `getLiveStats` (H1)

- Keep real `checkInsToday` / `totalCheckIns`.
- `pulseScore`: read `pulse:{cityId}:{nodeId}` for each business node and take the **max**
  across nodes (the business's most-alive venue) — never a sum, which would break the
  score's 0–N scale for multi-node businesses. If no node has a pulse row, return `null`.
  A per-node breakdown may be returned alongside, but the headline `pulseScore` is the max.
- `rewardsClaimed`: count `REDEMPTION#` rows for the business's nodes with `redeemedAt`
  (or `claimedAt`) on the current SAST day. Reuse the redemption read path.
- Remove the hardcoded `pulseScore: 0, rewardsClaimed: 0`.

### 3. `getAudienceAnalytics` + `getRecentRedemptions` (H2, M2)

- Load the period's check-ins (already done). Feed them to:
  - `analyzeCrowdComposition` → `tierDistribution` (+ counts). [reuse]
  - `analyzePeakHours` → `peakHours` (top windows formatted as the panel expects). [reuse]
  - `repeatVsNew`: compute directly from the loaded history — group distinct users by
    check-in count; `repeat` = count of users with >1 check-in, `new` = count with exactly
    one. Do **not** use `analyzeRepeatVisitors` here: that tool computes a cross-period token
    intersection (a different question) and depends on the report's per-period token salt.
    Keep `analyzeRepeatVisitors` for the report pipeline only.
- Enrich check-ins with tier via `BatchGet` on `users` (mirror the generator's `loadUserData`).
- Below the display threshold, set the corresponding group to `null`.
- `getRecentRedemptions`: replace the unsorted `Scan().slice(0,20)` with a query ordered by
  `redeemedAt` desc (GSI or sort-key), or sort in memory before slicing as an interim step.

### 4. `getMusicAudience` (M1)

- Load period visitors' music prefs (`BatchGet` users, same projection the generator uses).
- Call `analyzeMusicProfile(visitorTokens, musicPrefsMap)`; map its output to the
  `BusinessMusicAudience` shape. Propagate `hasInsufficientData`.

### 5. Report generator: repeat visitors (H3) + pulse trend (H4)

- **Persist tokens:** when storing a Report, also store that period's `visitorTokens`
  (hashed, no PII) — either inline on the Report or a companion `REPORT_TOKENS#` row with a
  TTL. `getPreviousReport` returns them.
- **Compute previous set:** in `generateReportInternal`, set `previousVisitorTokens` from the
  prior Report's stored tokens. Delete the `= new Set()` reset. If tokens are salted with
  `periodStart` (rotating), switch the token salt to a period-stable value OR store the raw
  hashed set per period so intersection is meaningful.
- **Persist pulse:** store `summary`-level or metrics-level `pulseScore` on the Report.
  Set `previousMetrics.pulseScore` from the prior Report. Delete the `pulseScore: 0`.
- Where prior data is missing, mark those metrics "no prior data" so trends/UI suppress them.

### 6. Benchmarks cache (M3)

- At the end of a successful `generateReportInternal`, `PutItem` a `BIZ_METRICS#{businessId}`
  / `LATEST` row with the four metrics. `loadCategoryVenueMetrics` already reads this shape.
- No behavior change when < 3 comparable rows exist (stays hidden — honest).
- Decision gate: if wiring the writer is deferred, instead soften `UPGRADE_MESSAGE` in
  `tier-gating.ts` so benchmarks are not promised. Requirements allow either, not both.

### 7. Analyzer min-data gates (M4)

- `peak-hours.ts`: add `hasInsufficientData` (below a MIN_CHECKINS threshold) to
  `PeakHoursResult`; return it. `findPeakDay` returns `null`/"no peak day" when all zero.
- `crowd-composition.ts`: add `hasInsufficientData` below a MIN_VISITORS threshold.
- `recommendations.ts`: `generatePeakHoursRecommendation` returns null when peak hours are
  insufficient.
- Generator/UI treat these like the existing null-able sections.

### 8. Guardrail test (R8)

- A Vitest suite that:
  - Imports the three repository functions, forces non-DEV, stubs the DynamoDB client to
    return a known non-trivial dataset, and asserts the returned metric fields are derived
    (not equal to the DEV_MODE constants like `pulseScore: 45`, `totalUniqueVisitors: 247`).
  - Statically asserts the generator does not contain the two known anti-patterns (a focused
    unit test around `generateReportInternal` behavior with a stubbed previous report:
    previous pulse flows through; previous tokens flow through).

## Data Models

- **Report (extended):** add `visitorTokensRef` or inline `periodVisitorTokens: string[]`
  (hashed), and ensure `pulseScore` is stored at a stable path (e.g. `summary.pulseScore`
  or a `metrics` block). Bump nothing that breaks `reportSchema`; extend the Zod schema.
- **REPORT_TOKENS# row (option):** `pk=REPORT_TOKENS#{businessId}`, `sk={periodType}#{periodStart}`, `tokens: string[]`, `ttl`.
- **BIZ_METRICS_Row:** `pk=BIZ_METRICS#{businessId}`, `sk=LATEST`, `{ totalCheckIns, uniqueVisitors, repeatVisitorRate, pulseScore, updatedAt }`.

## Error Handling

- All DynamoDB reads that back a metric must surface failure (throw/log) rather than
  substitute a silent zero (`no-fallbacks`). The honest "not computable" path is a distinct,
  intentional branch keyed on genuine absence of data, not on a caught error.
- Report generation stays best-effort per business (existing behavior): a failure logs and
  skips that business; it must not write a partial Report with faked metrics.

## Correctness Properties

### Property 1: No hardcoded production metrics

Outside DEV_MODE, the metric fields of `getLiveStats`, `getAudienceAnalytics`, and
`getMusicAudience` are derived from input data and are not equal to the DEV_MODE constants
(`pulseScore: 45`, `totalUniqueVisitors: 247`, etc.) for a non-trivial dataset.
**Validates: Requirements 8.1**

### Property 2: Honest-absence signalling

For every metric group, the payload either carries a computed value or an explicit
Insufficient_Data_State (`null` / `hasInsufficientData: true`) — never a hardcoded `0`/`{}`/`[]`
presented as a real value.
**Validates: Requirements 1.4, 1.5, 2.5, 3.3, 7.1, 7.2**

### Property 3: Multi-node pulse scale

For a business with N nodes, the reported `pulseScore` equals the maximum per-node pulse
(not a sum), so it stays on the single-node 0–N scale.
**Validates: Requirements 1.2**

### Property 4: Dashboard repeat definition

`repeatVsNew.repeat` equals the count of distinct users with more than one check-in in the
loaded history, and `new` equals the count with exactly one; the two sum to distinct users.
**Validates: Requirements 2.1**

### Property 5: Report previous-value fidelity

When a prior Report exists, the repeat-visitor and pulse-score trends are computed against the
stored previous values (non-empty token set, real previous pulse); when it does not, those
metrics are marked unavailable rather than rendered as `0%` / `+100%`.
**Validates: Requirements 4.2, 4.4, 5.2, 5.3**

## Testing Strategy

- **Unit/property (Vitest, node):** reuse existing analyzer property tests; add cases for the
  new min-data gates (peak-hours, crowd-composition) and `findPeakDay` empty case.
- **Repository tests:** stub `documentClient` to feed known check-ins/redemptions; assert
  `getLiveStats`/`getAudienceAnalytics`/`getMusicAudience` compute expected values and emit
  `null`/`hasInsufficientData` below thresholds.
- **Generator tests:** stubbed previous Report → assert previous pulse and previous tokens
  flow into trends/repeat-visitors; assert BIZ_METRICS_Row is written.
- **Guardrail (R8):** the anti-regression suite above, in `pnpm test`.
- **Frontend:** component tests that the panels render the "not enough data yet" state on
  `null`/`hasInsufficientData` and render numbers otherwise (jsdom per-file).
- No network/WebGL; mock the API client and stores per the testing steering rules.
