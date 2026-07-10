# Requirements Document

## Introduction

This spec closes the remaining gaps from the July 2026 full-platform audit: security config
that fails open instead of crashing, the two scaling choke points on the consumer hot path,
missing product-usage instrumentation, unenforced architecture limits, missing supply-chain
and load checks, and two product contradictions that need a recorded decision.

Three audit findings are already being fixed in separate in-flight sessions and are OUT OF
SCOPE here (do not duplicate them): the DynamoDB `Limit` + `FilterExpression` false-miss
family, the admin consent reads querying the wrong partition key, and the staff digest
opt-out phantom-row write. This spec assumes those land first.

Binding rules throughout: `no-fallbacks-no-legacy.md` (required config crashes, no masking
defaults), `serverless-only.md` (no new always-on infra, no new vendors), `honest-presence.md`
and POPIA (instrumentation is consented, aggregate, and never a location trail), and
`code-style.md` (the limits this spec starts enforcing).

## Glossary

- **QR_Secret**: `AREA_CODE_QR_HMAC_SECRET`, the HMAC key behind check-in QR validation, business QR minting, and the music OAuth state (`check-in/service.ts`, `business/service.ts`, `music/service.ts`).
- **Unsub_Secret**: The campaign unsubscribe token signing key (`campaigns/unsubscribe.ts` `signingSecret()`).
- **Consent_Version_Source**: `currentConsentVersion()` in `auth/profile-service.ts`, today `AREA_CODE_CONSENT_VERSION ?? LEGAL_CLAUSES_VERSION`.
- **City_Nodes_Read**: `GET /v1/nodes/:city`, backed by `nodes/repository.ts` `getNodesByCitySlug`, today a full nodes-table Scan plus a per-node pulse `kvGet` loop.
- **Room_Fanout**: `broadcastToRoom` / `broadcastToUser` in `shared/websocket/broadcast.ts`.
- **Usage_Event**: A named, consented, PII-free product analytics event (e.g. `beam_tap`, `checkin_complete`) with coarse properties only.
- **Funnel**: An ordered set of Usage_Events answering one product question, e.g. the Constellation ship gate `beam_tap -> zoom_commit -> checkin_complete`.
- **Lines_Baseline**: The frozen list of files currently over the `code-style.md` size limits, exempted from the new lint rule so the rule can ratchet instead of big-bang.
- **Decision_Record**: A short dated markdown record in `docs/decisions/` stating a product or architecture decision, its options, and the choice.

## Requirements

### Requirement 1: Fail-fast security config (QR, unsubscribe, consent version)

**User Story:** As an operator, I want a misdeployed secret to crash loudly, so that QR
check-ins and unsubscribe links are never signed with an empty or in-repo key.

#### Acceptance Criteria

1. WHEN any QR_Secret consumer computes or verifies an HMAC, THE system SHALL obtain the secret via the `requireEnv` pattern and SHALL NOT fall back to `''`.
2. IF QR_Secret is absent in production, THEN verification SHALL fail closed and minting SHALL fail loudly, never HMAC over an empty string.
3. THE Unsub_Secret chain SHALL NOT contain the hardcoded `'dev-campaign-unsubscribe-secret'` literal; in production a missing secret SHALL fail fast.
4. QR signature comparison SHALL use `timingSafeEqual` (matching `unsubscribe.ts`), not `===` string comparison.
5. THE Consent_Version_Source SHALL have exactly one source of truth: IF `AREA_CODE_CONSENT_VERSION` is absent in production, THEN the consent read and write paths SHALL fail loudly rather than fall back to `LEGAL_CLAUSES_VERSION`, whose format (`2026.05.1`) is incomparable with recorded versions (`v1.0`) and would prompt every user to re-consent.
6. `AREA_CODE_FROM_EMAIL`, `AREA_CODE_BUSINESS_URL`, and the unsubscribe API base URL MAY keep prod-correct defaults only if a Decision_Record states why; otherwise they follow the same fail-fast rule.
7. DEV_MODE behaviour is unchanged: dev keeps working without the prod secrets.

### Requirement 2: City_Nodes_Read scales

**User Story:** As a consumer opening the map, I want the city payload to stay fast and cheap
as venue count and traffic grow, so that the hottest read is not a full table scan.

#### Acceptance Criteria

1. THE City_Nodes_Read SHALL NOT perform an unanchored full-table Scan; it SHALL read via an anchored access path (a `CityIndex` GSI on the nodes table, keyed by `cityId`).
2. THE per-node pulse lookup SHALL NOT issue one `kvGet` per node; it SHALL batch (e.g. `BatchGetItem`) or read a single per-city aggregate.
3. THE assembled city payload SHALL be cached in the existing KV store with a short TTL (30 to 60 seconds), keyed per city, so concurrent map loads share one assembly.
4. Cache staleness SHALL never exceed the TTL, and live pulse/presence updates continue to flow over WebSocket, so honest-presence guarantees are unaffected.
5. Terraform SHALL define the GSI for dev and prod; no manual resource creation.
6. Response shape and ranking inputs SHALL be unchanged (clients and `vibeRank` see the same fields).

### Requirement 3: Room_Fanout robustness

**User Story:** As a consumer in a busy city room, I want events to reach every connection,
so that fan-out does not silently drop subscribers past one query page or one bad socket.

#### Acceptance Criteria

1. `broadcastToRoom` and `broadcastToUser` SHALL paginate over `LastEvaluatedKey` so every connection row is read.
2. Fan-out SHALL use `Promise.allSettled` (or equivalent) with a bounded concurrency cap, so one failed `PostToConnection` neither rejects the batch nor stampedes the API Gateway limit.
3. `GoneException` handling SHALL be unchanged (stale connections ignored, TTL cleans up).
4. Non-Gone per-connection failures SHALL be counted and logged once per broadcast, not thrown to the caller.
5. The returned reached-count SHALL count only successful posts, since callers use it to decide push fallback.

### Requirement 4: Consented usage instrumentation

**User Story:** As the founder, I want the core funnels measured, so that after launch I can
tell whether the product is working and whether the Constellation ship gate passed.

#### Acceptance Criteria

1. THE consumer web app SHALL emit Usage_Events for: signup funnel (auth gate shown, signup started, signup completed), check-in funnel (venue selected, check-in CTA shown, check-in completed), Constellation Funnel (`beam_tap`, `zoom_commit`, `checkin_complete`), and First-Get (token entered, token redeemed).
2. Usage_Events SHALL be emitted ONLY when the signed-in user's `analyticsOptIn` is true; anonymous sessions emit nothing.
3. Usage_Events SHALL carry no PII and no coordinates: no userId in the event payload beyond a per-session random id, no location, no venue-plus-user join that reconstructs a movement trail (POPIA posture).
4. Delivery SHALL be serverless and vendor-free: a batched `POST /v1/events` endpoint, rate limited, writing CloudWatch EMF metrics (counts per event name per day), with no new always-on infrastructure and no third-party analytics vendor.
5. THE backend SHALL validate event names against an allowlist and drop unknown names.
6. A funnel readout (CloudWatch metric math or a documented Logs Insights query) SHALL be recorded in the RUNBOOK so the Constellation ship gate is answerable.
7. IF the event endpoint is down or the request fails, THEN the client SHALL drop events silently; instrumentation never degrades the app.

### Requirement 5: Architecture limits enforced

**User Story:** As an engineer, I want the documented code limits enforced by tooling, so that
the 400-line hard limit stops being violated silently.

#### Acceptance Criteria

1. ESLint SHALL enforce `max-lines` (400) on source files, with the current violators frozen in a Lines_Baseline exemption list.
2. THE Lines_Baseline SHALL only shrink: CI fails if a new file exceeds the limit or an exempted file grows past its recorded count.
3. THE contradictory comment in `nodes/repository.ts` (orphan nodes "always visible" vs the code hiding them) SHALL be corrected to match the behaviour chosen in Requirement 7's Decision_Record.
4. THE dead export `getRedemptionByRewardAndUser` (`rewards/dynamodb-repository.ts`) SHALL be deleted.
5. Corrupt-row `JSON.parse` catches in `reports/repository.ts` and `campaigns/repository.ts` SHALL log an error identifying the row key before returning null, so silent data corruption becomes visible.

### Requirement 6: Supply-chain and load checks in CI

**User Story:** As the founder, I want dependency vulnerabilities and load regressions caught
by automation, so that neither requires me to remember to check.

#### Acceptance Criteria

1. CI SHALL run a dependency audit (`pnpm audit --audit-level high` or equivalent) on every push to master and fail on high or critical findings, with a documented ignore mechanism for accepted risks.
2. A load smoke script (k6 or artillery, checked into `scripts/`) SHALL exercise the dev API: city nodes read and a check-in burst, with pass thresholds on p95 latency and error rate.
3. THE load smoke SHALL be manually triggered (workflow_dispatch or a documented script run), not per-push, to respect the dev budget.
4. Results of the first load smoke run SHALL be recorded in `docs/GO_LIVE_CHECK_RESULT.md`.

### Requirement 7: Decision records for the open contradictions

**User Story:** As the founder, I want the audit's product contradictions decided on paper,
so that code, comments, and product docs stop assuming different answers.

#### Acceptance Criteria

1. A Decision_Record SHALL state the map-membership rule: whether the consumer map shows only paid-tier venues (status quo), all venues with paid tiers advantaged only within ranking caps, or another model; it SHALL note the tension with `discovery-dna-vibe-over-convenience.md` and the flywheel, and the free-tier business onboarding experience.
2. Code comments and `rules/product.md` SHALL be reconciled to the recorded decision (behaviour change itself, if any, is a follow-up spec).
3. A Decision_Record SHALL resolve the Digest_Row `emailSent` field: either flip it after a successful send with a second write, or remove the field; the chosen option SHALL be implemented in this spec.
4. A Decision_Record SHALL state the API region posture: stay in us-east-1 or plan af-south-1, informed by a measured latency comparison (one scripted probe from a SA vantage point or documented RUM data).

### Requirement 8: Ops verifications

**User Story:** As an operator, I want the audit's "verify once" items closed with recorded
evidence, so that assumptions about prod behaviour are facts.

#### Acceptance Criteria

1. THE rate limiter's client identity SHALL be verified in prod: evidence (a log line showing distinct `request.ip` values for distinct sources) recorded in `docs/GO_LIVE_CHECK_RESULT.md`. IF `request.ip` is constant, THEN the limiter SHALL be fixed to read the API Gateway source IP before launch.
2. A PITR restore rehearsal SHALL be performed once against a dev table and the procedure recorded in `docs/RUNBOOK.md` (restore to a point in time, verify row-level recovery, tear down the restored table).
3. Both verifications are founder-run live steps; the spec ships the turnkey commands and the doc sections they fill in.

### Requirement 9: Verification

**User Story:** As an engineer, I want the changes proven by the standard suite, so that the
hardening cannot silently regress.

#### Acceptance Criteria

1. `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm guard:serverless` SHALL pass.
2. New pure logic (fan-out pagination/concurrency, event allowlist, cache TTL behaviour) SHALL have unit tests; property tests follow the repo convention where a core is genuinely property-shaped.
3. Terraform changes SHALL pass `terraform fmt -check` and `terraform validate`; prod apply only via `deploy-serverless.ps1`.
