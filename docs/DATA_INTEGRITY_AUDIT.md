# Data Integrity Audit — Ambition vs. Implementation Gaps

Date: 2026-07-04
Scope: Full repo — frontend (web/business/admin/staff), backend features, workers/cron,
reports pipeline, integrations (Yoco), caching, internal/admin tools.
Method: Directory/route inventory, smell-pattern grep, data-lineage tracing
(source → compute → store → API → UI), test review, shared-fallback fan-out.
Ground rule applied: discovery only, no code changed. False negatives treated as
worse than false positives — uncertain items are flagged "verify" rather than dropped.

This document is the single source of truth for the silver-bullet remediation. Each
finding maps to exactly one correct path (per `no-fallbacks-no-legacy.md`): either wire
the real computation, or show an honest empty/loading state — never a fabricated number.

---

## Summary

| Severity | Count | IDs                        |
| -------- | ----- | -------------------------- |
| Critical | 0     | —                          |
| High     | 7     | H1, H2, H3, H4, H5, H6, H7 |
| Medium   | 5     | M1, M2, M3, M4, M5         |
| Low      | 2     | L1, L2                     |
| Verify   | 0     | — (V1 resolved → H7)       |

> Update (post-verification): every High finding was re-confirmed line-by-line, the
> Mediums/Lows spot-checked, and V1 resolved. The erasure processor **does** exist
> (`workers/cleanup.ts:148-197`) but has a POPIA gap, now tracked as **H7** below.

Headline: no money-movement or health/safety **calculation** is wrong. Yoco checkout,
booster price-floor enforcement, and the booster audit trail are correct and idempotent.
The consumer honest-presence stack (presence-expiry, `useNodePulse`, `CrowdVibeSection`,
live-archetype-evaluator) is genuinely honest and under-claims correctly.

The risk is concentrated in **business intelligence surfaces** (paid Venue Intelligence
Reports + business dashboard analytics) and one **consumer feature** (Ranks leaderboard),
where values were stubbed to `0`/`{}`/`[]` mid-build and are now shipped as if real. In
every one of these cases a `DEV_MODE` branch returns rich, realistic data, so the feature
looks complete in demos and only reads as broken (or worse, subtly wrong) in production.

Recurring root-cause pattern to fix once, everywhere:

- Backend repository/generator returns a hardcoded `0` / empty object / empty array where
  a real aggregation was intended, with no signal to the UI that the value is absent.
- The UI renders that value as a confident, complete figure.
- The `DEV_MODE`/`VITE_DEV_MOCK` path masks the gap during development and demos.

---

## HIGH

### H1 — Business "Pulse" live stat is hardcoded to 0

- **Where:** `backend/src/features/business/repository.ts:248` (`getLiveStats`) → rendered `apps/business/src/screens/panels/LivePanel.tsx:93`
- **Feature:** Business dashboard → Live panel (the primary "how alive is my venue right now" screen).
- **Now:** `getLiveStats` returns `{ checkInsToday, rewardsClaimed: 0, pulseScore: 0, totalCheckIns }`. `checkInsToday`/`totalCheckIns` are computed from real check-ins; `pulseScore` and `rewardsClaimed` are constant `0`. `LivePanel` renders `Math.round(stats.pulseScore)` under a comment calling it "the honest 'how alive' readout." The `service.ts` `DEV_MODE` branch returns `pulseScore: 45`, masking this.
- **Why wrong:** The number presented as live aliveness is a literal constant, not derived from any pulse/presence data.
- **User belief/impact:** A busy venue owner sees "Pulse: 0," concludes the product is broken or their venue is dead. Direct violation of `honest-presence.md`.
- **Severity reasoning:** High — most-viewed paid surface, prominent, contradicts the product's core promise.
- **Silver-bullet fix:** Compute `pulseScore` from the same decaying pulse KV the map uses (`pulse:{cityId}:{nodeId}`) and `rewardsClaimed` from redemptions for the business's nodes today. If a value genuinely can't be sourced, remove the tile rather than render 0. (`rewardsClaimed` is separately tracked client-side from socket events starting at 0 each mount — also see it resets on reload.)

### H2 — Audience analytics: repeat count hardcoded 0, tier distribution and peak hours empty

- **Where:** `backend/src/features/business/repository.ts:285-290` (`getAudienceAnalytics`) → rendered `apps/business/src/screens/panels/AudiencePanel.tsx:75-82`
- **Feature:** Business dashboard → Audience panel.
- **Now:** Returns `tierDistribution: {}`, `repeatVsNew: { repeat: 0, new: uniqueUserIds.size }`, `peakHours: []`. Only `totalUniqueVisitors` is real. Panel renders once a venue passes 20 unique visitors, then shows "Repeat: 0 / New: N" and an empty Tier Distribution box. `service.ts` `DEV_MODE` returns fully populated data.
- **Why wrong:** `repeat` is a constant 0 — every visitor is labeled "New" regardless of actual returns. Tier distribution renders nothing.
- **User belief/impact:** Business concludes it has zero loyalty ("nobody comes back") and may spend on discounts/campaigns based on a fabricated signal.
- **Severity reasoning:** High — paid analytics, presented as complete, systematically wrong.
- **Silver-bullet fix:** Compute repeat-vs-new and tier distribution from check-in history (the data is already loaded via `getCheckInsByNode` in the same function). Reuse the report pipeline's `crowd-composition.ts` / `repeat-visitors.ts` logic (one home per concept). Until wired, gate the repeat/new + tier cards behind an honest "not enough history yet" state.

### H3 — Venue Intelligence Report: repeat-visitor rate is structurally always 0%

- **Where:** `backend/src/features/reports/generator.ts:481-489`
- **Feature:** Venue Intelligence Report (paid Growth/Pro) → repeat visitors, trends, retention recommendation.
- **Now:** `previousVisitorTokens` is initialised empty and re-assigned `new Set<string>()` even when a previous report exists (`// Will result in 0% repeat rate without prior raw data`). Visitor tokens are salted with `periodStart`, so they rotate every period and could never intersect across periods anyway.
- **Why wrong:** `analyzeRepeatVisitors` always sees an empty previous set → `repeatRate` always 0, `firstTimeVisitorCount` always equals total. Flows into the `repeatVisitorRate` trend and gates the retention recommendation (which therefore never fires).
- **User belief/impact:** Paying businesses are told 0% of visitors return, every period — a confident lie about retention, the metric most likely to drive spend.
- **Severity reasoning:** High — paid product, core metric, always wrong, presented as exact.
- **Silver-bullet fix:** Persist per-period visitor tokens (or a period-stable hashed id) so consecutive periods can intersect; compute `previousVisitorTokens` from stored data. Until fixed, suppress the repeat-rate output and its trend rather than emit 0%.

### H4 — Venue Intelligence Report: pulse-score trend fabricates "+100% up" every period

- **Where:** `backend/src/features/reports/generator.ts:506` (`pulseScore: 0` in `previousMetrics`) → rendered `apps/business/src/screens/panels/ReportsPanel.tsx:540-556`
- **Feature:** Venue Intelligence Report → Trends card.
- **Now:** `previousMetrics.pulseScore` is hardcoded `0` (`// Will be computed from previous report data` — never done). `analyzeTrends`' divide-by-zero branch turns previous=0 + current>0 into `percentChange: 100, direction: 'up'`.
- **Why wrong:** Whenever prior data exists and current pulse > 0, the report shows Pulse Score "↑ 100%" — an artifact of the hardcoded 0, not a real change. It sits indistinguishably next to the two legitimate trends (`totalCheckIns`, `uniqueVisitors`, which use real stored previous values).
- **User belief/impact:** Businesses believe venue energy doubled every reporting period. Fabricated momentum on the trust-critical signal.
- **Severity reasoning:** High.
- **Silver-bullet fix:** Store the previous period's pulse score on the report and read it back into `previousMetrics.pulseScore`; or drop `pulseScore` from the trend set until it's persisted.

### H5 — Admin dashboard counts silently undercount past ~1MB per table

- **Where:** `backend/src/features/admin/repository.ts:470-560` (`getDashboardMetrics`)
- **Feature:** Admin dashboard totals: consumers, businesses, all-time + today check-ins, active rewards, pending reports, **pending erasures**, **unreviewed abuse flags**.
- **Now:** Every count is a single `ScanCommand` with `Select: 'COUNT'` and no `LastEvaluatedKey` pagination loop; result cached 60s. DynamoDB Scan `Count` only reflects items scanned within one ~1MB page. The filtered counts (today's check-ins, pending reports/erasures, abuse flags) only count matches within the first scanned page.
- **Why wrong:** Once a table exceeds ~1MB (checkins first, then users), totals cap at a partial count and are presented as complete platform totals.
- **User belief/impact:** Operators under-read growth; more seriously, **`pendingErasures`** (POPIA data-subject obligation) and **`unreviewedAbuseFlags`** (safety/moderation backlog) can appear smaller than reality — a compliance and safety blind spot, not just vanity metrics.
- **Severity reasoning:** High (the compliance/safety counts elevate it; vanity counts alone would be Medium).
- **Silver-bullet fix:** Paginate each count over `LastEvaluatedKey` and sum; or maintain incremental counters updated on write. For erasures/abuse flags, prioritise correctness over the 60s cache.

### H6 — Consumer "Ranks" leaderboard is never populated in production

- **Where:** read `backend/src/features/social/repository.ts:204-230` (`getLeaderboardTop50`, key `LEADERBOARD#{cityId}`); dead writer `backend/src/features/check-in/dynamodb-repository.ts:214-238` (`updateLeaderboardEntry`, key `LEADERBOARD#{cityId}#{weekEnding}`); reset/pre-reset `backend/src/workers/leaderboard-reset.ts` (key `LEADERBOARD#{cityId}`); DEV mask `backend/src/features/social/service.ts:265-336`.
- **Feature:** Consumer app → Ranks tab (one of the four core tabs) via `GET /v1/leaderboard/:citySlug`.
- **Now:** The consumer read queries partition `LEADERBOARD#{cityId}`. **Nothing writes that key.** The only leaderboard writer, `updateLeaderboardEntry`, writes a _different_ key (`LEADERBOARD#{cityId}#{weekEnding}`) and has **zero call sites** — it and its sibling `getLeaderboard` are dead code. So in production `getLeaderboardTop50` returns `[]` and every user gets `userRank: null`. The `DEV_MODE` branch returns 5 rich fake entries plus a fake `userRank: { rank: 12, checkInCount: 8 }`, so it looks fully functional in dev/demo.
- **Secondary effects:** `leaderboard-reset` handler and `preResetHandler` query the same empty partition (`Limit: 50`) — they are perpetual no-ops (persist 0 history rows, send 0 pre-reset notifications). Even if populated, the `Limit: 50` on the reset would leave rank-51+ entries un-reset (stale carry-over) — moot until a writer exists, but fix alongside.
- **Why wrong:** Read key and write key never match; the writer is dead code; no incrementer runs on check-in.
- **User belief/impact:** The entire Ranks feature shows an empty leaderboard and "no rank" for everyone in production, while appearing complete in demos. Undermines a headline engagement loop.
- **Severity reasoning:** High — a whole advertised consumer tab is silently non-functional in prod, masked by fake data. (Verify against a live prod `app-data` table to confirm zero `LEADERBOARD#{cityId}` items — but the code path is unambiguous.)
- **Silver-bullet fix:** Pick one leaderboard model and delete the other (per `no-fallbacks`/`dry-reuse`). Recommended: on check-in, increment a `LEADERBOARD#{cityId}` entry for the current week (single source), have `getLeaderboardTop50` and the reset worker read/clear that same key, and remove the dead week-keyed `updateLeaderboardEntry`/`getLeaderboard`. Then remove the `Limit: 50` cap on reset (or reset by deleting the whole partition).

---

## MEDIUM

### M1 — Music audience insights fully stubbed (feature can never populate)

- **Where:** `backend/src/features/business/repository.ts:295-301` (`getMusicAudience`) → `apps/business/src/components/MusicInsightsSection.tsx`
- **Now:** Returns `totalWithMusicPrefs: 0` and empty distributions. UI gates on min data, so it perpetually shows "not enough music data."
- **Why wrong:** Advertised insight tile wired to a stub; can never populate regardless of real user music data.
- **Impact:** Businesses believe none of their crowd shares music taste (a headline selling point) or that the feature is broken. Fails safe (no fake numbers) but silently non-functional.
- **Severity:** Medium (fails closed).
- **Silver-bullet fix:** Implement the aggregation from users' `musicGenres`/archetype fields — reuse the report pipeline's `music-profile.ts`. Until built, hide the tile.

### M2 — "Recent redemptions" is an unsorted Scan slice

- **Where:** `backend/src/features/business/repository.ts:306-313` (`getRecentRedemptions`, commented "Simplified")
- **Now:** `Scan` of `REDEMPTION#` items with `.slice(0, 20)` and no sort by `redeemedAt`.
- **Why wrong:** DynamoDB Scan order is not chronological, so "recent" is an arbitrary 20, not the latest 20.
- **Impact:** Owners/staff see stale or out-of-order redemptions and may miss recent activity or fraud.
- **Severity:** Medium.
- **Silver-bullet fix:** Query a time-sorted key/GSI with `ScanIndexForward: false`, or at minimum sort by `redeemedAt` before slicing.

### M3 — Competitive benchmarks can never populate (read cache is never written)

- **Where:** `backend/src/features/reports/generator.ts:216-247` (`loadCategoryVenueMetrics` reads `BIZ_METRICS#{businessId}` / `LATEST`); upgrade promise in `backend/src/features/reports/tier-gating.ts` (`UPGRADE_MESSAGE`)
- **Now:** Nothing anywhere writes `BIZ_METRICS#…` rows (grep confirms only this read). So competitor metrics load empty → fewer than 3 venues → `benchmarks.hasInsufficientData` → section nulled and hidden.
- **Why wrong:** "Competitive benchmarks" is explicitly sold in the Growth upgrade CTA but can never render for anyone.
- **Impact:** A business upgrades partly for benchmarks and never sees them, with no explanation. Fails closed, but it's a monetised promise that silently never delivers.
- **Severity:** Medium.
- **Silver-bullet fix:** Add the writer that snapshots each business's period metrics to `BIZ_METRICS#…/LATEST` (natural home: end of `generateReportInternal`), or remove benchmarks from the upgrade copy until built.

### M4 — Peak-hours and crowd-composition have no minimum-data gate

- **Where:** `backend/src/features/reports/analyzers/peak-hours.ts` (no `hasInsufficientData`; `findPeakDay` defaults to `'Monday'`), `analyzers/crowd-composition.ts` (no min gate), `analyzers/recommendations.ts` (`generatePeakHoursRecommendation`)
- **Now:** Unlike `music-profile` (min 5), `benchmarks` (min 3), and `journey` (min 10), these emit confident output from any non-empty input. One check-in yields e.g. "Your venue peaks Monday 20:00-20:00 with 24x the average traffic — ensure full staffing," and crowd composition reads "100% [tier]."
- **Why wrong:** Single-sample distributions are presented with the same confidence as high-volume ones; the peak multiplier (`count / avg-per-24h`) inflates tiny samples.
- **Impact:** New venues told to staff up for a "peak" that is one person, or that their crowd is homogeneous. Over-confident guidance from noise.
- **Severity:** Medium.
- **Silver-bullet fix:** Add a minimum check-in/visitor threshold to peak-hours and crowd-composition (mirror the other analyzers' `hasInsufficientData` pattern), and suppress the peak-hours recommendation below threshold.

### M5 — Reward evaluator silently swallows all mint errors (earned reward can be lost)

- **Where:** `backend/src/workers/reward-evaluator.ts` (`evaluateRewards`, `try { repo.createRedemption(...) } catch { continue }`)
- **Now:** The `catch { continue }` is intended as an "already claimed" idempotency guard (conditional-put conflict), but it swallows **every** error, including transient DynamoDB throttling/timeouts. There is no log and no retry.
- **Why wrong:** A real infrastructure failure is indistinguishable from "already claimed," so a user who qualified for a reward silently never receives it, with no trace.
- **Impact:** Consumers occasionally lose a reward they earned (a check-in perk), eroding trust in the rewards loop; support has no signal it happened.
- **Severity:** Medium (SQS gives some retry at the message level, but the per-reward loop `continue` defeats it for that reward).
- **Silver-bullet fix:** Narrow the catch to the conditional-check exception (treat only that as "already claimed"); log-and-rethrow other errors so SQS retries the message. Mirror the precise `isConditionalCheckFailedError` pattern already used in `business/repository.ts`.

---

## LOW

### L1 — Hardcoded Amplify URL fallback for business app links

- **Where:** `backend/src/features/business/service.ts` (`getBusinessAppUrl` → `?? 'https://dbp54yxhyjvk0.amplifyapp.com'`)
- **Now:** If `BUSINESS_APP_URL` is unset, Yoco success/cancel/failure redirect URLs point at a hardcoded raw Amplify domain instead of `areacode.co.za`.
- **Impact:** A misconfigured env sends paying customers to an off-brand URL post-checkout. Violates `no-fallbacks-no-legacy.md` (required config should fail fast).
- **Severity:** Low (works when env is set).
- **Silver-bullet fix:** Require the env var at startup; crash if missing.

### L2 — Yoco webhook secret falls back to empty/dev key

- **Where:** `backend/src/features/business/service.ts` (`processYocoWebhook`: `YOCO_WEBHOOK_SECRET ?? YOCO_DEV_SECRET_KEY ?? ''`)
- **Now:** If the webhook secret is unset in prod, signature verification uses the dev key or `''`. With `''`, `expected` is still a non-empty HMAC, so the `!expected` guard does not catch it.
- **Impact:** A misconfigured prod could reject all webhooks (payments never upgrade tiers) or verify against an unintended key. Not confirmed exploitable; the fallback chain is fragile for a payment path.
- **Severity:** Low.
- **Silver-bullet fix:** Require `YOCO_WEBHOOK_SECRET` explicitly in prod; never fall back to the dev key for signature verification.

---

### H7 — Data erasure leaves check-in history behind (POPIA gap) and scans are unpaginated

- **Where:** `backend/src/workers/cleanup.ts:148-197` (erasure processor)
- **Feature:** POPIA right-to-be-forgotten. Supersedes the original V1 ("processor not located"). The processor exists and runs on the cleanup schedule for `ERASURE#` requests older than 30 days.
- **Now:** For each pending erasure it (1) `deleteUser(userId)` from the `users` table, (2) `Scan`s `app-data` for items where `pk`/`sk` `contains(userId)` and deletes them, (3) marks the request `completed`. It **never deletes the user's rows from the `checkins` table** (nor `websocket-connections`). Redemptions/presence/social rows in `app-data` are caught by the contains-scan; check-ins are a separate table and are not.
- **Why wrong:** After a "completed" erasure, the `checkins` table still holds rows carrying that `userId` — retained personal data for a user who exercised deletion. Additionally, both the erasure-request `Scan` and the per-user `contains(pk/sk)` `Scan` are single-page (no `LastEvaluatedKey` loop — same defect as H5), so a large pending backlog or a heavy user's rows beyond the first ~1MB page are silently missed.
- **User belief/impact:** The platform reports an erasure as complete while personal data survives — a direct POPIA compliance exposure. A heavy user may have app-data rows left behind entirely.
- **Severity reasoning:** High — compliance/legal, and the "completed" status actively misrepresents the deletion as thorough.
- **Silver-bullet fix:** Extend the processor to delete the user's `checkins` (query `NodeIndex`/a user GSI, or scan-and-delete by `userId`) and any `websocket-connections`; paginate both scans over `LastEvaluatedKey`; and consider anchoring the app-data lookup on real keys (`USER#{id}` prefix / GSI) instead of an unanchored `contains()` full-table scan. Only mark `completed` after all tables are confirmed clear.

### V1 — Resolved

The erasure processor was located (`workers/cleanup.ts:148-197`); it is not the "no processor / Critical" scenario. Its concrete gaps are tracked as **H7** above.

---

## Verified clean / good patterns (keep, and use as the template)

- **Mock layer** (`packages/shared/mocks/*`) is gated by `VITE_DEV_MOCK` / `EXPO_PUBLIC_DEV_MOCK` in every app entry (`apps/*/src/main.tsx`, `apps/mobile/app/_layout.tsx`); it never loads in production builds.
- **Honest presence (consumer):** `workers/presence-expiry.ts` expires stale check-ins and reconciles the cached counter to the authoritative count; `useNodePulse.ts` prefers the true `node:presence_update`; `CrowdVibeSection.tsx` and the crowd-vibe read hide at `totalCheckedIn === 0`.
- **live-archetype-evaluator.ts** is the model to copy: on read failure/timeout it logs loudly then returns the honest under-claim (count 0), never a silent fake.
- **Payments/booster:** Yoco checkout, price-floor enforcement, and the two-step idempotent booster audit choreography (`business/repository.ts`) are correct and fail-closed.
- **Rewards near-me** (`rewards/repository.ts` + `ranking.ts`) ranks vibe-first with proximity as a pure tiebreaker, per discovery DNA; aliveness/liveCount are honest.
- **Campaign audience estimate** (`CampaignsPanel.tsx`) honestly labels itself "based on a recent sample of check-ins" — this disclosure is the pattern the stubbed analytics above should adopt.

---

## Silver-bullet remediation plan (suggested order)

The cheap, uniform mitigation for every High finding is identical: replace the stubbed
`0`/`{}`/`[]` and fabricated trends with an explicit "not available yet" state so nothing
renders a confident wrong number, then wire the real computation behind it.

1. **H3 + H4** (paid report: repeat-rate always 0, pulse trend always +100%) — same feature, both actively lie to paying customers. Persist per-period visitor tokens and previous pulse score.
2. **H1 + H2** (business dashboard Pulse=0, repeat=0, empty tier/peak) — most-viewed business surface; compute from check-ins already loaded in the same functions.
3. **H6** (consumer Ranks leaderboard dead in prod) — consolidate to one leaderboard key, add the check-in incrementer, delete the dead week-keyed writer.
4. **H5 + H7** (admin undercount + erasure gaps) — paginate scans everywhere; delete `checkins` on erasure; prioritise `pendingErasures`/`unreviewedAbuseFlags` for compliance/safety.
5. **M1–M5** — wire up or gate behind honest empty states; narrow the reward-evaluator catch.
6. **L1–L2** — make required config fail fast; never fall back to dev secrets/URLs in prod.

### Spec grouping (matches how the work ships)

The findings cluster into three `.kiro/specs/` features:

1. **`business-intelligence-honesty`** (H1–H4, M1–M4) — shared root cause (stubbed values shown as real) and fix pattern (honest "not enough data yet" state first, then wire the real aggregation, reusing the report analyzers per DRY). Includes the cross-cutting guardrail test.
2. **`leaderboard-consolidation`** (H6) — one key model, a check-in incrementer, delete the dead week-keyed writer, fix the reset worker. Cleanest early win (a whole consumer tab).
3. **`data-integrity-ops-hardening`** (H5, H7, M5, L1, L2) — pagination/counters, checkins-table erasure, narrow the reward-evaluator catch to conditional-check failures, fail-fast config.

Cross-cutting guardrail to prevent recurrence: any `DEV_MODE` branch that returns rich data
must have a production counterpart that either computes the real value or returns an
explicit "unavailable" signal the UI can render honestly — never a hardcoded `0`/`{}`/`[]`
presented as real. Consider a lightweight test that asserts production repository methods do
not return the same hardcoded shapes as their `DEV_MODE` branches for metric fields.
