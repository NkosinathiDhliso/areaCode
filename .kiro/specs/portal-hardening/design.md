# Design Document

## Overview

Portal Hardening is five independent fixes that close gaps between current behaviour and the
project's binding rules. None is a new feature; each is a defect against a steering rule. The
items are independent and can land in any order. This document follows the bugfix design format,
treating the five items as one batch of related defects (A–E) and addressing each within every
section.

A note on the "wire backend to frontend" question that seeded this design: no item creates a new
backend route for new frontend. Where this spec adds a frontend caller (item D "surface"), it
wires the admin UI to an endpoint that **already exists** on the backend. The direction is always
"built-but-unsurfaced route gains a caller," never "new screen needs a new route built for it."

## Glossary

- **DEV_MODE**: the existing guard, true only when `AREA_CODE_ENV === 'dev'` and
  `AREA_CODE_FORCE_LIVE` is unset; the single permitted gate for synthetic data.
- **Manager**: a business member with the `manager` role who authenticates through the staff
  Cognito pool and holds the business management permissions.
- **Plain staff**: a staff member whose only business permission is `redeem_codes`; uses the
  staff app, not the business portal.
- **Dead_Endpoint**: a registered backend route with no production frontend caller.
- **Canonical redemption code**: 6 uppercase characters from the alphabet
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (omits I, O, 0, 1), produced by `generateRedemptionCode` in
  `backend/src/workers/reward-evaluator.ts`.

## Bug Details

### A. Fabricated trending data on the public landing

`apps/web/src/screens/AuthLanding.tsx` defines `FALLBACK_TRENDING` (two invented venues with
invented check-in counts). The trending query is
`queryFn: () => api.get('/v1/nodes/trending').catch(() => ({ items: FALLBACK_TRENDING }))`, and the
render does `trendingData?.items ?? FALLBACK_TRENDING`. On any failure, a public, pre-auth page
shows fake live activity, with no `DEV_MODE` guard. Violates `no-fallbacks-no-legacy.md` (no prod
mock data, no masking `.catch`) and the spirit of `honest-presence.md`.

### B. Manager cannot delete a music-schedule slot

`backend/src/features/music/handler.ts`: POST `/v1/business/:businessId/music-schedule` is
`requireAuth('business','staff')`; DELETE `/.../:slotId` is `requireAuth('business')` only. A
Manager authenticates through the staff pool, so they can add a slot but the delete control 403s.

### C. Business read routes lack server-side permission parity

`GET /v1/business/me/audience/music` (music handler) enforces
`requireBusinessPermission('view_audience')`, but its sibling `GET /v1/business/me/audience`
(business handler) and several other business reads are `requireAuth('business','staff')` only.
Authorization relies on the client hiding a tab rather than the server denying. Tenant isolation
is intact (each resolves its own `businessId`), so this is a layered-authorization gap, not a data
leak.

### D. Dead / unsurfaced admin endpoints

`backend/src/features/admin/handler.ts` has reads with no frontend caller:
`GET /v1/admin/users/:userId`, `GET /v1/admin/users/:userId/check-ins`,
`GET /v1/admin/businesses/:businessId`, `GET /v1/admin/consent/:userId`; two duplicate-purpose
reconsent routes (`GET /v1/admin/consent/export-reconsent` and
`GET /v1/admin/consent/reconsent-list`, both calling `service.getReconsentList`); and the
security-sensitive `POST /v1/admin/impersonate`. `no-fallbacks-no-legacy.md` requires each to be
surfaced or removed.

### E. Staff portal polish

1. `GET /v1/staff/first-get/:rewardId/preview` (`backend/.../staff/handler.ts`) has no caller; the
   issuer goes load→confirm and already holds the reward title/description from
   `GET /v1/staff/first-get`.
2. `apps/staff/src/components/MyRank.tsx` renders `🥇 🥈 🥉` medal emoji, violating `code-style.md`
   (no emoji in system UI).
3. `packages/features/staff/StaffValidator.tsx` manual input is `maxLength={6} inputMode="numeric"`,
   so the numeric keypad cannot type the letters that make up most canonical codes.

## Expected Behavior

- **A.** When trending data fails or is empty in production, the landing shows an honest empty
  state (the "Trending Now" card is simply absent) and never renders invented venues or counts.
  Genuine data renders unchanged, including the existing Live badge.
- **B.** A Manager (staff pool) may delete a music-schedule slot for their own business, on the
  same role basis as create, while cross-business deletes stay forbidden and per-business
  authorization is unchanged.
- **C.** Each business read enforces the permission matching its data, fail-closed, without
  altering tenant isolation; owners retain every read; routes the staff app legitimately calls
  remain reachable.
- **D.** Every admin endpoint is either surfaced (gains a caller, keeps its auth gate) or removed
  (route + now-dead handler/service code deleted), with impersonation decided explicitly.
- **E.** The First-Get preview path is gone or wired; the leaderboard conveys rank without emoji;
  any code that can be scanned can also be typed.

## Hypothesized Root Cause

- **A.** A `.catch` fallback and a `?? FALLBACK_TRENDING` default were added to keep the card from
  ever being empty, trading honesty for a non-empty UI. Root cause: a masking fallback where an
  empty state was the correct behaviour.
- **B.** The DELETE route was written before Managers authenticated via the staff pool, so its
  role list was never widened to match POST. Root cause: drift between sibling routes.
- **C.** Permission middleware was added to newer routes (audience/music) but not retrofitted to
  the older business reads. Root cause: incomplete rollout of `requireBusinessPermission`.
- **D.** Endpoints were built ahead of (or after removal of) their UI and never cleaned up. Root
  cause: orphaned surface with no owner; plus a duplicate route for one capability.
- **E.** (1) preview built speculatively, superseded by the list endpoint that already returns the
  reward; (2) emoji used as rank glyphs before the no-emoji rule; (3) input assumed numeric codes.

## Fix Implementation

### A. Remove fabricated trending data

1. Delete the `FALLBACK_TRENDING` constant. No `DEV_MODE` gate is needed: an empty state is correct
   in all environments, so the constant is removed, not guarded.
2. `queryFn` becomes `() => api.get<{ items: TrendingSpot[] }>('/v1/nodes/trending')` (no `.catch`).
   On failure `data` stays `undefined`. Keep `retry: 1` and `staleTime`.
3. `const trending = trendingData?.items ?? []`. The existing `trending.length > 0` guard hides the
   card when empty (honest empty state); hero, how-it-works, and about still render.
4. `hasLiveData = trendingData?.items !== undefined` so the Live badge shows only with real data.

### B. Music-slot delete parity

Change the DELETE `preHandler` role list to `requireAuth('business','staff')`, matching POST/GET.
`authoriseScheduleAccess` already grants `staff` when `auth.businessId === pathBusinessId` and
denies by default, so per-business scoping and create/delete parity hold with no other change.
Update the route-group comment that says "DELETE stays business-only."

### C. View-permission parity

Append `requireBusinessPermission('<perm>')` after `requireAuth('business','staff')` per route.
Permission set is from `business/types.ts`: `owner` holds all; `manager` holds all view/manage
except billing/ownership; `staff` holds only `redeem_codes` (so `requireBusinessPermission` throws
for plain staff).

| Route                                         | Decision            | Permission                                                                                                 |
| --------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /v1/business/me/audience`                | gate                | `view_audience`                                                                                            |
| `GET /v1/business/me/live-stats`              | gate                | `view_live`                                                                                                |
| `GET /v1/business/check-ins`                  | gate                | `view_check_ins`                                                                                           |
| `GET /v1/business/rewards`                    | gate                | `view_rewards`                                                                                             |
| `GET /v1/business/rewards/summary`            | gate                | `view_rewards`                                                                                             |
| `GET /v1/business/rewards/:rewardId/metrics`  | gate                | `view_metrics`                                                                                             |
| `GET /v1/business/me/recent-redemptions`      | gate                | `view_rewards`                                                                                             |
| `GET /v1/business/staff` (list)               | gate                | `view_staff`                                                                                               |
| `GET /v1/business/staff/invites`              | gate                | `view_staff`                                                                                               |
| `GET /v1/business/staff/:staffId/redemptions` | gate                | `view_staff`                                                                                               |
| `GET /v1/business/nodes/:nodeId/qr`           | gate                | `view_qr`                                                                                                  |
| `GET /v1/business/nodes/current/qr`           | gate                | `view_qr`                                                                                                  |
| `GET /v1/business/staff/leaderboard`          | **permission-free** | staff-app MyRank caller (plain staff); gating would 403 and break the widget                               |
| `GET /v1/business/me`                         | **permission-free** | portal-shell identity bootstrap                                                                            |
| `GET /v1/business/me/role`                    | **permission-free** | returns the caller's own role/permissions                                                                  |
| `GET /v1/business/me/onboarding-status`       | **permission-free** | portal-shell bootstrap                                                                                     |
| `GET /v1/business/me/nodes`                   | **permission-free** | portal-shell node selector; no `view_nodes` permission exists; plain staff never reach the business portal |
| `GET /v1/business/plans`                      | **permission-free** | already public (no auth)                                                                                   |

Handlers that read `auth.userId` for `businessId` are unchanged: owner sessions keep
`businessId === auth.userId`, and manager resolution already happens where needed. Tenant scoping
untouched; owners regress on nothing; checks fail closed.

### D. Dead admin endpoints

**Surface (add one admin-UI caller to the existing route, keep `requireAuth('admin')`):**
`GET /v1/admin/users/:userId` and `.../check-ins` and `GET /v1/admin/consent/:userId` feed a
user-detail drill-down opened from the existing consumer search; `GET /v1/admin/businesses/:businessId`
feeds a business-detail drill-down from the existing business search. No new backend; no second
data path.

**Deduplicate reconsent:** keep `GET /v1/admin/consent/reconsent-list`, remove
`GET /v1/admin/consent/export-reconsent`, surface the survivor in the admin consent screen.
Implementation first greps for an existing caller of either; if `export-reconsent` is the one with
a live caller, keep it and remove `reconsent-list` instead. Exactly one survives.

**Impersonation (OPEN DECISION — needs sign-off, per R4.4):**

- _Remove (recommended default):_ delete the route, `impersonateBodySchema`, and
  `startImpersonation` plus any helpers only it uses; verify nothing else references them.
- _Keep + harden:_ gate to `super_admin` (mirror the IAM routes' `if (role !== 'super_admin')
throw 403`) and write an audit-log row via the existing admin audit mechanism on every start.

This is the only item blocking completion of D; the rest of D proceeds independently.

### E. Staff polish

1. **Preview:** remove `GET /v1/staff/first-get/:rewardId/preview`. The issuer already has the
   reward title/description from `GET /v1/staff/first-get`; the preview is a redundant read.
   `firstGetIdParamsSchema` stays (the `confirm` route still uses it).
2. **Emoji:** drop `🥇 🥈 🥉` in `MyRank.tsx`; rank stays conveyed by the existing `#{idx + 1}`
   text and the accent highlight for the current user. Redeem path untouched.
3. **Input:** `inputMode="numeric"` → `inputMode="text"`, add `autoCapitalize="characters"` and
   `autoComplete="off"`; keep `maxLength={6}` (canonical length). The existing `onChange`
   `[a-zA-Z0-9]`/uppercase filter and the scan path are unchanged.

## Correctness Properties

### Property 1: No fabricated trending (item A)

For all query outcomes, no string from the removed `FALLBACK_TRENDING` ever renders; the trending
card renders iff `trending.length > 0`.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Delete/create role parity (item B)

For any session S and path businessId P, delete is authorized iff
(`S.role === 'business' && S.userId === P`) or (`S.role === 'staff' && S.businessId === P`),
identical to the POST predicate.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 3: Permission-gated reads (item C)

For each gated route, a session is served iff it holds the mapped permission; owners hold all
mapped permissions; `leaderboard` remains served for plain staff.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 4: No orphaned admin surface (item D)

After the batch, every admin route is reachable from the UI or absent from the route table;
`getReconsentList` retains exactly one route; build and tests pass with removed code gone.

**Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6**

### Property 5: Typable canonical codes and clean staff UI (item E)

Any 6-char string over `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` is enterable in the validator; the
leaderboard render contains no emoji code points; the preview route is absent.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

## Testing Strategy

- **A.** jsdom component test: query rejects → no old-fallback venue names, card absent, page still
  renders hero/about; query resolves → items render with Live badge. Grep that `FALLBACK_TRENDING`
  is gone.
- **B.** Handler test: staff JWT matching `businessId` → 200; staff JWT mismatched → 403; owner → 200. Allowed and forbidden both asserted (R6.4).
- **C.** Per gated route: owner → 200, manager → 200, member lacking the perm → 403 with no data.
  Regression test that `GET /v1/business/staff/leaderboard` → 200 for plain staff.
- **D.** Surfaced routes: admin-app test that the detail view issues the call and renders. Removed
  routes: typecheck + build + tests pass with route and handler/service gone (R4.5); no route with
  a production caller removed (R4.6).
- **E.** Validator jsdom test: accepts A–Z and 2–9, caps at 6, uppercases. MyRank test: no emoji in
  rendered top-3. Route-table assertion that the preview route is absent.
- **Batch gate:** `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check` all pass (R6.1).
