# Requirements Document

## Introduction

Portal Hardening is a batch of independent correctness, security-hygiene, and steering-
compliance fixes surfaced by the platform audit. None is a new feature; each closes a gap
between what the code does and what the project's binding rules require. The items are
grouped here so they share one requirements/design/tasks cycle, but they are independent and
can ship in any order.

The five items, with the evidence each is based on:

- **A. No fabricated trending data in production.** `apps/web/src/screens/AuthLanding.tsx`
  defines `FALLBACK_TRENDING` (invented venue names and check-in counts) and renders it from
  the `.catch()` of the trending query with no `DEV_MODE` guard. This violates
  `no-fallbacks-no-legacy.md` (no mock data in prod) and the spirit of `honest-presence.md`
  on a public, pre-auth surface.
- **B. Music-slot deletion permission parity for managers.**
  `DELETE /v1/business/:businessId/music-schedule/:slotId`
  (`backend/src/features/music/handler.ts:242`) is gated `requireAuth('business')` only, but
  the sibling `POST` (`music/handler.ts:218`) allows `('business','staff')`. Managers
  authenticate via the staff pool, so the delete control (`MusicSchedulePanel`) 403s for a
  manager who can otherwise edit the schedule.
- **C. Server-side view-permission enforcement parity.**
  `GET /v1/business/me/audience` (`backend/src/features/business/handler.ts:121`) has no
  `requireBusinessPermission('view_audience')`, while its sibling
  `GET /v1/business/me/audience/music` (`backend/src/features/music/handler.ts:165`) does.
  The same defense-in-depth gap exists on other `requireAuth`-only business read routes
  (live-stats, check-ins, rewards, rewards/summary, metrics, staff\*, qr). Tenant isolation is
  intact (each resolves its own businessId), so this is layered authorization, not a data
  leak.
- **D. Dead / unsurfaced admin endpoints.** Several admin endpoints have no frontend caller:
  `POST /v1/admin/impersonate` (`admin/handler.ts:223`), `GET /v1/admin/users/:userId`
  (`:101`), `GET /v1/admin/users/:userId/check-ins` (`:111`), `GET /v1/admin/businesses/:businessId`
  (`:147`), `GET /v1/admin/consent/:userId` (`:233`), and duplicate-purpose reconsent routes.
  `no-fallbacks-no-legacy.md` requires each to be either surfaced or removed; some
  (impersonation) are security-sensitive and require an explicit keep/remove decision.
- **E. Staff portal polish.** (1) `GET /v1/staff/first-get/:rewardId/preview`
  (`backend/src/features/staff/handler.ts:89`) has no caller — the issuer goes load→confirm.
  (2) `apps/staff/src/components/MyRank.tsx:82` renders medal emojis, violating
  `code-style.md` (no emojis in system UI). (3) The manual redemption-code input in
  `packages/features/staff/StaffValidator.tsx` is `maxLength={6}` numeric while scanned codes
  are uppercased alphanumerics, so a longer or alphabetic code cannot be typed.

### Constraints

- Behaviour-preserving where not explicitly changing behaviour; every change is verified by
  `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`.
- Removals follow `no-fallbacks-no-legacy.md`: dead code is deleted in place, not
  deprecated; a removal that breaks the build was load-bearing and must be understood first.
- Security-sensitive removals (impersonation) are flagged for explicit confirmation, not
  silently deleted.
- No phone/SMS/OTP path is added or revived anywhere (`no-sms-no-phone-auth.md`).
- Permission changes are least-privilege and fail-closed.

## Glossary

- **DEV_MODE**: the existing guard, true only when `AREA_CODE_ENV === 'dev'` and
  `AREA_CODE_FORCE_LIVE` is unset; the single permitted gate for synthetic data.
- **Manager**: a business member with the `manager` role who authenticates through the staff
  Cognito pool and holds the business management permissions.
- **view_audience / manage_billing / etc.**: business member permissions enforced server-side
  by `requireBusinessPermission` (`backend/src/shared/middleware/business-role.ts`).
- **Dead_Endpoint**: a registered backend route with no production frontend caller.

## Requirements

### Requirement 1: No fabricated trending data in production

**User Story:** As a first-time visitor to the public landing, I want any "live" venue
signal to be real, so that the app never shows me invented activity.

#### Acceptance Criteria

1. WHEN the trending query on the auth landing fails or returns no data in production, THE
   web app SHALL present an honest empty/quiet state and SHALL NOT render fabricated venue
   names or check-in counts.
2. THE web app SHALL NOT ship `FALLBACK_TRENDING` (or any hardcoded venue list with invented
   counts) on a code path reachable in production; any synthetic sample data SHALL exist only
   behind a `DEV_MODE` guard or be removed.
3. WHERE genuine trending data is available, THE web app SHALL render it unchanged, including
   the existing live-data badge behaviour.
4. THE landing SHALL continue to render without error when trending data is unavailable (no
   blank crash, no thrown error past the query boundary).

### Requirement 2: Music-slot deletion permission parity for managers

**User Story:** As a venue manager, I want to delete a music-schedule slot I am allowed to
create, so that schedule management is not half-broken for my role.

#### Acceptance Criteria

1. WHEN a Manager authenticated through the staff pool deletes a music-schedule slot for
   their own business, THE backend SHALL authorize the request on the same role basis as the
   create route (`business` and `staff`), and SHALL NOT reject it solely because the role is
   `staff`.
2. THE delete route SHALL continue to enforce the existing per-business authorization
   (`authoriseScheduleAccess`), so a Manager SHALL only delete slots for their own business
   and a cross-business delete SHALL remain forbidden.
3. THE create and delete music-schedule routes SHALL enforce a consistent role basis, so a
   role that can add a slot can remove a slot for the same business.
4. WHERE a non-permitted role attempts the delete, THE backend SHALL fail closed with a
   forbidden response.

### Requirement 3: Server-side view-permission enforcement parity

**User Story:** As the platform, I want business read endpoints to enforce the same
permissions server-side as their siblings, so that authorization is defense-in-depth and not
reliant on the client hiding a tab.

#### Acceptance Criteria

1. THE `GET /v1/business/me/audience` route SHALL enforce `requireBusinessPermission('view_audience')`,
   matching its sibling `GET /v1/business/me/audience/music`.
2. THE business read routes that currently rely on `requireAuth` only (audience, live-stats,
   check-ins, rewards, rewards/summary, reward metrics, staff list/leaderboard/redemptions,
   node QR) SHALL each enforce the permission that matches their data, consistent with the
   business permission model, OR the design SHALL document explicitly why a given route is
   intentionally permission-free.
3. THE permission checks SHALL be least-privilege and fail-closed: a member lacking the
   required permission SHALL receive a forbidden response and no data.
4. THE changes SHALL NOT alter tenant isolation (each route SHALL continue to resolve and
   scope to the caller's own businessId).
5. THE owner role SHALL retain access to every business read it has today (no owner-visible
   regression), since owners hold the full permission set.

### Requirement 4: Resolve dead / unsurfaced admin endpoints

**User Story:** As a maintainer, I want every admin endpoint to be either used or removed, so
that there is no orphaned, unowned, or unaudited surface.

#### Acceptance Criteria

1. THE spec SHALL enumerate each Dead_Endpoint in the admin feature and classify it as either
   "surface in the admin UI" or "remove", with the classification recorded in the design.
2. WHERE a Dead_Endpoint is classified "remove", THE backend SHALL delete the route and its
   now-unreachable handler/service code in place (no deprecation shim), consistent with
   `no-fallbacks-no-legacy.md`.
3. WHERE a Dead_Endpoint is classified "surface", THE admin frontend SHALL gain a caller and
   the endpoint SHALL retain its existing `requireAuth('admin')` and any sub-role gate.
4. THE impersonation endpoint (`POST /v1/admin/impersonate`) SHALL be treated as
   security-sensitive: its keep-or-remove decision SHALL be confirmed with the user before
   implementation, and IF kept, its design SHALL state the intended admin sub-role gate and
   audit-logging behaviour.
5. WHEN a Dead_Endpoint is removed, THE removal SHALL be verified by typecheck, build, and
   tests passing, confirming nothing else depended on it.
6. THE changes SHALL NOT remove any endpoint that has a production frontend caller.

### Requirement 5: Staff portal polish

**User Story:** As venue staff, I want the validator UI to be consistent with platform
standards and free of dead paths, so that the tool is clean and predictable.

#### Acceptance Criteria

1. THE First-Get preview endpoint (`GET /v1/staff/first-get/:rewardId/preview`) SHALL be
   either wired into the issuer flow (a preview step before minting) or removed, consistent
   with `no-fallbacks-no-legacy.md`, and the design SHALL record which.
2. THE staff leaderboard (`MyRank`) SHALL convey rank without emoji in system UI, consistent
   with `code-style.md`, using text or token-styled rank indicators.
3. THE manual redemption-code input in the staff validator SHALL accept the canonical
   redemption-code length and character set (the design SHALL state the canonical format) so
   that any valid code that can be scanned can also be typed, and the input's `maxLength` and
   `inputMode` SHALL match that format.
4. THE staff redeem preview→confirm flow SHALL remain functionally unchanged by these polish
   edits (no regression to the working validation path).

### Requirement 6: Verification and non-regression

**User Story:** As the team, I want these fixes to be provably safe, so that hardening does
not introduce new breakage.

#### Acceptance Criteria

1. THE full set of changes SHALL pass `pnpm typecheck`, `pnpm test`, `pnpm lint`, and
   `pnpm format:check` before being considered complete.
2. THE changes SHALL NOT introduce a second implementation, fallback, or compatibility shim
   for any capability that already has one (`dry-reuse-no-duplication.md`,
   `no-fallbacks-no-legacy.md`).
3. THE changes SHALL NOT add, revive, or reference any phone/SMS/OTP path
   (`no-sms-no-phone-auth.md`).
4. WHERE a change alters an authorization gate, THE behaviour SHALL be covered by a test
   asserting both the allowed and the forbidden case.
