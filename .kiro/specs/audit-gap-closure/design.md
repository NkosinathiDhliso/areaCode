# Design Document

## Overview

Closes the remaining July 2026 audit gaps in six independent work streams: fail-fast security
config (R1), the two consumer hot-path scaling fixes (R2, R3), consented usage
instrumentation (R4), enforced architecture limits and hygiene (R5), CI supply-chain and load
checks (R6), and decision records plus founder-run ops verifications (R7, R8).

Out of scope, in flight in separate sessions: the DynamoDB `Limit` + `FilterExpression`
false-miss fixes, the admin consent partition-key fix, and the staff digest opt-out
phantom-row fix. Nothing here touches those code paths except where noted.

## Architecture

```
R1 config    check-in/business/music services, campaigns/unsubscribe.ts, auth/profile-service.ts
             [requireEnv for QR + unsub secrets; single consent-version source; timingSafeEqual]

R2 nodes     GET /v1/nodes/:city -> getNodesByCitySlug
             [Scan -> CityIndex GSI query] [per-node kvGet loop -> batch read]
             [assembled payload cached in KV, TTL 30-60s, key nodes:city:{slug}]

R3 fanout    shared/websocket/broadcast.ts
             [paginate RoomIndex/UserIndex] [allSettled + concurrency cap ~25]
             [reached-count = successes only]

R4 events    apps/web event beacon (opt-in gated) -> POST /v1/events (batch, rate limited,
             allowlist) -> CloudWatch EMF metrics -> RUNBOOK funnel queries

R5 lint      eslint max-lines(400) + lines-baseline.json ratchet; hygiene deletions/comments

R6 ci        quality gate + pnpm audit step; scripts/load-smoke (k6), workflow_dispatch

R7/R8 docs   docs/decisions/*.md; RUNBOOK PITR rehearsal; GO_LIVE_CHECK_RESULT evidence
```

## Components and Interfaces

### 1. Fail-fast security config (R1)

- Add a module-level accessor per secret, following the `requireEnv` pattern already used in
  `reports/generator.ts`. QR consumers (`check-in/service.ts:62`, `business/service.ts:996`
  and `:1002`, `music/service.ts:170` and `:238`) call `qrHmacSecret()` which throws when the
  env var is missing outside DEV_MODE.
- `campaigns/unsubscribe.ts` `signingSecret()` drops the literal fallback; chain becomes
  `AREA_CODE_UNSUB_SECRET ?? AREA_CODE_QR_HMAC_SECRET`, then throw outside DEV_MODE.
- QR verification compares digests with `timingSafeEqual` over equal-length buffers (reuse the
  shape in `unsubscribe.ts:87`).
- `currentConsentVersion()` throws outside DEV_MODE when `AREA_CODE_CONSENT_VERSION` is
  absent. `LEGAL_CLAUSES_VERSION` remains the clause-content identifier only; the import is
  removed from the version accessor. DEV_MODE keeps a dev default so local runs work.
- Startup validation: the app's existing config check gains these keys so a bad deploy crashes
  at cold start, not first request.

### 2. City_Nodes_Read (R2)

- Terraform (dev + prod): add `CityIndex` GSI to the nodes table, hash key `cityId`,
  projection ALL. Pay-per-request, no capacity to manage.
- `getNodesByCitySlug`: replace the Scan with a `Query` on `CityIndex`
  (`cityId = :cityId`, filter `isActive`), paginated.
- Pulse scores: replace the per-node `kvGet` loop with one `BatchGetCommand` against the KV
  table (chunked at 100 keys), keeping key shape `pulse:{cityId}:{nodeId}`.
- Payload cache: `kvGet('nodes:city:{slug}')` first; on miss, assemble, `kvSet` with TTL 45s.
  The cache stores the final response array. Business-tier membership changes take effect
  within the TTL, which is inside the tolerance already accepted for tier demotion (grace
  windows are days, not seconds). Live counts stay honest via sockets (R2.4).
- No response-shape change; `vibeRank` inputs untouched.

### 3. Room_Fanout (R3)

- Extract `queryAllConnections(index, keyExpr, values)` that loops `LastEvaluatedKey`.
- Fan-out: chunk connections and post with a concurrency cap (a simple pool of 25 in-flight
  `PostToConnection` calls; no new dependency). Collect results with `allSettled`.
- Per-broadcast summary log: `posted=<n> gone=<n> failed=<n> room=<id>`. Failures do not
  throw; the function returns the success count so `sendNotification`'s push fallback logic
  keeps working.

### 4. Usage instrumentation (R4)

- Client: `packages/shared/lib/usageEvents.ts`, one home. `trackEvent(name, props?)` buffers
  events and flushes at most every 15s or 20 events via `api.post('/v1/events', {events})`.
  Gated hard: no-ops unless the consent read (already fetched by ReconsentGate's endpoint)
  reports `analyticsOptIn === true`. Failures are swallowed (R4.7). Session id is
  `crypto.randomUUID()` held in memory only.
- Event names (allowlist, one shared constant): `auth_gate_shown`, `signup_started`,
  `signup_completed`, `venue_selected`, `checkin_cta_shown`, `checkin_completed`, `beam_tap`,
  `zoom_commit`, `firstget_token_entered`, `firstget_token_redeemed`.
- Backend: `features/events/` (handler, service). Handler order per `tech.md`: consumer JWT,
  Zod body (max 20 events, name in allowlist, props limited to a small typed set with no
  free-text), rate limit (`events`, 30/60s), service emits one EMF metric line per event name
  (namespace `AreaCode/Usage`, dimension `event`). No new table, no new vendor.
- Wire points reuse existing seams: `selectionStore` (venue selected), the check-in success
  path, `useMapMarkers` beam tap, the cold-open/zoom commit in `useCarouselSelection`,
  AuthLanding, and the First-Get claim screen.
- RUNBOOK gains a "Funnel readout" section with the metric-math expressions for the
  Constellation Funnel and signup funnel.

### 5. Architecture limits (R5)

- ESLint: enable `max-lines: ['error', {max: 400, skipBlankLines: false, skipComments: false}]`
  for `src` globs. Current violators are listed in `eslint-lines-baseline.cjs` (generated
  once) as per-file overrides with their frozen line counts; a small script regenerates and
  fails if any count grew or a new file appears.
- Hygiene edits: fix the `nodes/repository.ts` comment to the R7.1 decision; delete
  `getRedemptionByRewardAndUser`; add `console.error` with the row key to the two
  corrupt-JSON catches.

### 6. CI checks (R6)

- `quality-gate.yml` gains a `pnpm audit --audit-level high` step (workspace root), with
  `pnpm audit --ignore` advisories recorded in a committed `audit-ignore.json` and a comment
  per entry.
- `scripts/load-smoke.js` (k6): 2 scenarios, `GET /v1/nodes/johannesburg` at 50 rps for 2
  minutes and a dev-token check-in burst at 10 rps; thresholds p95 < 800ms, errors < 1%.
  Run against dev via `k6 run` locally or a `workflow_dispatch` job. Documented in DEPLOY.md.

### 7. Decisions and ops (R7, R8)

- `docs/decisions/` gains three records: `map-membership.md`, `digest-email-sent-field.md`,
  `api-region.md`. Template: context, options, decision, consequences, date.
- `emailSent`: recommended option is a second best-effort `UpdateCommand` setting
  `emailSent: true` after a successful send (conditional on the row existing); the conditional
  put that guards idempotence is unchanged, so Property 4 holds. If the founder chooses
  removal instead, drop the field from `DigestRow` and the schema.
- RUNBOOK gains the PITR rehearsal procedure (restore dev users table to T-15min, verify one
  row, delete restored table). GO_LIVE_CHECK_RESULT gains the rate-limiter IP evidence
  section with the exact `aws logs filter-log-events` command.

## Error Handling

- All new config accessors throw typed startup errors outside DEV_MODE; nothing degrades.
- The events endpoint returns 204 always on accepted batches; invalid batches get the typed 400. Client swallows all beacon errors.
- Fan-out failures are logged and counted, never thrown (R3.4).

## Testing Strategy

- Unit: config accessors (throw when unset outside DEV_MODE, dev default in DEV_MODE),
  timingSafeEqual verify paths, fan-out pagination and success-count semantics (stubbed
  client), event allowlist and batch validation, nodes cache hit/miss and TTL, baseline
  ratchet script.
- Property (repo convention, min 100 runs, block-statement predicates): fan-out reached-count
  equals successful posts for arbitrary success/failure vectors; event batch validation never
  accepts an off-allowlist name.
- Existing suites must stay green; the nodes read keeps its response shape so map/carousel
  tests are unaffected.
- e2e: no new Playwright coverage required; the beacon is invisible to structural checks.
