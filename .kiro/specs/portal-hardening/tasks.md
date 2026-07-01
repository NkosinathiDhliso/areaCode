# Implementation Plan

## Overview

Five independent fixes (A–E), each closing a gap against a binding steering rule. They share no
code and can land in any order. Each authorization change (B, C, impersonation keep-branch) ships
with a test asserting both the allowed and forbidden case. The whole batch must pass
`pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check` before it is complete.

One item is gated on a decision: Task 4.4 (impersonation keep/remove) needs your sign-off before it
is implemented. The rest of item D proceeds without it.

## Tasks

- [x] 1. Item A: remove fabricated trending data
- [x] 1.1 Delete `FALLBACK_TRENDING` and its references in `apps/web/src/screens/AuthLanding.tsx`
  - Remove the constant; change `queryFn` to `() => api.get<{ items: TrendingSpot[] }>('/v1/nodes/trending')` (no `.catch`); set `const trending = trendingData?.items ?? []`; set `hasLiveData = trendingData?.items !== undefined`. The existing `trending.length > 0` guard renders the honest empty state.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
- [x] 1.2 Component test for the honest empty state
  - jsdom test: query rejects -> none of the old fallback venue names render, the Trending card is absent, hero and About still render; query resolves with items -> items render with the Live badge. Assert `FALLBACK_TRENDING` no longer exists in the file.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Item B: music-slot delete parity
- [x] 2.1 Widen the DELETE role list in `backend/src/features/music/handler.ts`
  - Change the DELETE `/v1/business/:businessId/music-schedule/:slotId` `preHandler` from `requireAuth('business')` to `requireAuth('business','staff')`. Leave `authoriseScheduleAccess` unchanged. Update the route-group comment that says "DELETE stays business-only."
  - _Requirements: 2.1, 2.2, 2.3_
- [x] 2.2 Handler test for delete authorization (allowed and forbidden)
  - Staff-pool JWT with matching `businessId` -> 200; staff-pool JWT with a different `businessId` -> 403 via `authoriseScheduleAccess`; business-pool owner -> 200.
  - _Requirements: 2.1, 2.2, 2.4, 6.4_

- [x] 3. Item C: business read permission parity
- [x] 3.1 Add `requireBusinessPermission` to the gated business reads in `backend/src/features/business/handler.ts`
  - Append the mapped permission after `requireAuth('business','staff')` per the design table: `view_audience` (me/audience), `view_live` (live-stats), `view_check_ins` (check-ins), `view_rewards` (rewards, rewards/summary, recent-redemptions), `view_metrics` (rewards/:rewardId/metrics), `view_staff` (staff list, staff/invites, staff/:staffId/redemptions), `view_qr` (nodes/:nodeId/qr, nodes/current/qr). Do not touch handler bodies.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
- [x] 3.2 Leave the documented permission-free routes ungated
  - Confirm `staff/leaderboard`, `me`, `me/role`, `me/onboarding-status`, `me/nodes`, and `plans` keep their current preHandlers (no permission added), per the design rationale.
  - _Requirements: 3.2_
- [x] 3.3 Handler tests for each gated route (allowed and forbidden) plus the leaderboard regression
  - Per gated route: owner -> 200, manager -> 200, a member lacking the perm -> 403 with no data body. Add a regression test that `GET /v1/business/staff/leaderboard` still returns 200 for a plain-staff session.
  - _Requirements: 3.1, 3.3, 3.5, 6.4_

- [x] 4. Item D: dead / unsurfaced admin endpoints
- [x] 4.1 Surface the four detail reads in the admin app
  - Add a user-detail drill-down (from existing consumer search) that calls `GET /v1/admin/users/:userId`, `GET /v1/admin/users/:userId/check-ins`, and `GET /v1/admin/consent/:userId`; add a business-detail drill-down (from existing business search) that calls `GET /v1/admin/businesses/:businessId`. Reuse the existing `api` client and screens; one caller each, no second data path. Endpoints keep `requireAuth('admin')`.
  - _Requirements: 4.1, 4.3, 4.6_
- [x] 4.2 Deduplicate the reconsent routes
  - Grep for callers of `GET /v1/admin/consent/export-reconsent` and `GET /v1/admin/consent/reconsent-list`. Keep the one with a live caller; if neither, keep `reconsent-list`. Remove the other route (it shares `service.getReconsentList`, so the service stays). Surface the survivor in the admin consent screen.
  - _Requirements: 4.1, 4.2, 4.5, 4.6_
- [x] 4.3 Surfacing tests
  - Admin-app test (or smoke) that each detail view issues its call and renders; assert exactly one reconsent route remains in the route table.
  - _Requirements: 4.1, 4.5_
- [x] 4.4 DECISION GATE: impersonation keep or remove (`POST /v1/admin/impersonate`)
  - Blocked on user sign-off. Default: REMOVE the route, `impersonateBodySchema`, and `startImpersonation` plus any helpers only it uses, then verify typecheck + build + tests pass with them gone. Alternative if kept: gate to `super_admin` (mirror the IAM `if (role !== 'super_admin') throw 403`) and write an admin audit-log row on every impersonation start. If kept, add allowed/forbidden tests for the sub-role gate.
  - _Requirements: 4.4, 4.5, 6.4_

- [x] 5. Item E: staff portal polish
- [x] 5.1 Remove the unused First-Get preview route
  - Delete `GET /v1/staff/first-get/:rewardId/preview` in `backend/src/features/staff/handler.ts`. Keep `firstGetIdParamsSchema` (the `confirm` route still uses it). Verify no caller exists and build/tests pass.
  - _Requirements: 5.1, 5.4_
- [x] 5.2 Remove medal emoji from `apps/staff/src/components/MyRank.tsx`
  - Drop the `🥇 🥈 🥉` glyphs; keep the existing `#{idx + 1}` text and the current-user accent highlight. No layout/token change.
  - _Requirements: 5.2_
- [x] 5.3 Fix the staff validator manual input in `packages/features/staff/StaffValidator.tsx`
  - Change `inputMode="numeric"` to `inputMode="text"`; add `autoCapitalize="characters"` and `autoComplete="off"`; keep `maxLength={6}`. Leave the existing `[a-zA-Z0-9]`/uppercase `onChange` and the scan path unchanged.
  - _Requirements: 5.3, 5.4_
- [x] 5.4 Staff polish tests
  - Validator jsdom test: input accepts A-Z and 2-9, caps at 6, uppercases. MyRank test: rendered top-3 contains no emoji code points. Route-table assertion that the preview route is absent.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Batch verification
- [x] 6.1 Run the full gate
  - `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check` all pass. Confirm no phone/SMS/OTP path was added or referenced and no duplicate/fallback was introduced.
  - _Requirements: 6.1, 6.2, 6.3_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "4.2", "4.4", "5.1", "5.2", "5.3"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2", "4.3", "5.4"] },
    { "id": 2, "tasks": ["3.3"] },
    { "id": 3, "tasks": ["6.1"] }
  ]
}
```

- Items A, B, C, D, E are mutually independent and can be done in any order or in parallel.
- Within each item, the implementation task precedes its test task.
- Task 4.4 is independent of 4.1–4.3 and is gated on a user decision; 6.1 runs after every other
  task (including whichever branch 4.4 takes) is complete.

## Notes

- **Decision gate (4.4).** Impersonation keep/remove is not implemented until the user signs off.
  Default is remove. If kept, it gains a `super_admin` gate and audit logging plus allowed/forbidden
  tests.
- **Do not break the staff app (Item C).** `GET /v1/business/staff/leaderboard` and the
  music-schedule routes are reachable by the staff app for plain-staff sessions; the leaderboard
  stays permission-free by design (Task 3.2). Verify before gating anything not in the design table.
- **No new backend (Item D).** "Surface" means adding a frontend caller to an existing route, never
  creating a route. Removals delete the route plus now-dead handler/service code in place, per
  `no-fallbacks-no-legacy.md`.
- **Reconsent dedupe (4.2).** Confirm the survivor's caller before deleting the duplicate so the
  build never loses its only path to `getReconsentList`.
- **No phone/SMS/OTP.** Item E touches the email-free First-Get token flow only to remove an unused
  read; it does not add or revive any phone path (`no-sms-no-phone-auth.md`).
