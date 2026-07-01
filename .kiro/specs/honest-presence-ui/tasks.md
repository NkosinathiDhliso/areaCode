# Implementation Plan: Honest Presence UI

## Overview

This plan wires the consumer web UI onto the already-complete `presence-integrity` backend.
It is shared-first: the session presence store, the check-out hook, and the seeding hook land
in `packages/shared` so the mobile app inherits them, then the web venue surface and map load
consume them. No backend files change. Tests are Vitest; component/hook tests opt into jsdom
per file (`// @vitest-environment jsdom` first line), mock the shared API client, drive
Zustand stores via `setState`, and reset in `beforeEach` (per `tech.md`). No network, no
WebGL.

All work consumes the existing `POST /v1/check-out`, `GET /v1/nodes/:nodeId/presence`, and
`node:presence_update` surfaces unchanged (R5).

## Tasks

- [x] 1. Session presence store (shared)
  - [x] 1.1 Create `presenceStore`
    - Add `packages/shared/stores/presenceStore.ts`: Zustand store
      `activePresence: Record<string, { checkedInAt: number }>` with `setPresent(nodeId)`,
      `clearPresent(nodeId)`, `clear()`, and an `isPresent(nodeId)` read; not persisted
    - _Requirements: 3.1, 3.3, 5.1_
  - [x] 1.2 Unit-test the store
    - `setPresent`/`clearPresent`/`clear` transitions; `isPresent` true only after set and
      false after clear; fresh store reports no node present
    - _Requirements: 3.1, 3.3_

- [x] 2. Shared check-out hook
  - [x] 2.1 Create `useCheckOut`
    - Add `packages/shared/hooks/useCheckOut.ts` mirroring `useCheckIn`: `isPending`, `error`,
      `checkOut(nodeId)` calling `api.post<CheckOutResponse>('/v1/check-out', { nodeId })` via
      the shared client; in-flight guard; on `checked_out` and `no_active_presence` call
      `presenceStore.clearPresent(nodeId)`; map 429/401/403/5xx/network to specific messages
      and surface via `useErrorStore` (reuse the `useCheckIn` `friendlyMessage` shape, extract
      a shared helper if clean)
    - Ensure `CheckOutResponse` is importable from `packages/shared/types`; add the type
      mirror there if missing (no backend change)
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 5.1, 5.3_
  - [x] 2.2 Unit-test the hook
    - success clears presence; `no_active_presence` clears and shows no error; each of
      429/401/403/5xx maps to its specific message; in-flight guard prevents a second request
    - _Requirements: 2.2, 2.3, 2.4_

- [x] 3. Check-out CTA in the venue surface
  - [x] 3.1 Add the Check_Out_CTA to `NodeDetailContent`
    - Edit `apps/web/src/components/NodeDetailContent.tsx`: add `onCheckOut` and
      `isCheckingOut` props (symmetry with `onCheckIn`/`isCheckingIn`); read
      `presenceStore.isPresent(node.id)`; WHERE present, render the check-out button as the
      primary action (`t('node.checkOut')`, neutral token style, `rounded-xl`, `py-4`,
      `active:scale-95`, ≥44px), disabled+loading while `isCheckingOut`; ELSE render the
      existing check-in CTA unchanged; accessible name + disabled state; no emoji/em dash; no
      crowd-attribution copy
    - Add the `node.checkOut` (and any success-line) i18n keys used
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 6.1, 6.2, 6.3, 6.4_
  - [x] 3.2 Wire the handler and presence-set at the check-in site
    - In the Commit_Mode parent that owns `onCheckIn` (`apps/web/src/screens/MapScreen.tsx` /
      `PeekCarousel` wiring): instantiate `useCheckOut`, pass `onCheckOut`/`isCheckingOut`
      into `NodeDetailContent`; on a successful check-in (here and in
      `apps/web/src/screens/QrCheckIn.tsx`) call `presenceStore.setPresent(nodeId)`
    - Call `presenceStore.clear()` on consumer logout (alongside the existing
      `clearFriendsPresence` path)
    - _Requirements: 3.1, 3.3, 2.2, 2.5_
  - [x] 3.3 Component test for CTA visibility and states
    - CTA shown only when `isPresent`; check-in CTA shown otherwise; disabled while
      `isCheckingOut`; label has no emoji/em dash; accessible name present
    - _Requirements: 1.1, 1.2, 1.4, 6.1_

- [x] 4. First-paint presence seeding
  - [x] 4.1 Create `usePresenceSeeding`
    - Add `apps/web/src/hooks/usePresenceSeeding.ts`: given loaded nodes, select seed targets
      (`pickSeedTargets`: top `RECOMMENDED_LIMIT` (20, from `carouselConstants.ts`) by
      `vibeRank`), fan out `GET /v1/nodes/:id/presence` with a concurrency cap (≈5), write
      `mapStore.setLivePresenceCount(id, livePresenceCount)`; one-shot per nodes payload;
      per-node `catch` that leaves the node unseeded and never throws; honest 0 written as 0
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4_
  - [x] 4.2 Call seeding from the map load
    - In `apps/web/src/screens/MapScreen.tsx`, invoke `usePresenceSeeding(nodes)` after the
      `GET /v1/nodes/:citySlug` query resolves; ensure it does not block render
    - _Requirements: 4.1, 4.2_
  - [x] 4.3 Unit-test the seeding hook
    - seeds only the top-N (bound respected); writes `setLivePresenceCount` with the read
      value including 0; per-node failure leaves that node unseeded and does not throw; one
      request per target per payload (no polling)
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - [x] 4.4 Property test for seed-target selection (optional)
    - **Property 5: Bounded, one-shot, failure-isolated seeding** — `pickSeedTargets` never
      returns more than the cap and never duplicates a node for any node set
    - **Validates: Requirements 4.5**

- [x] 5. Checkpoint - verify and gate
  - Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`; confirm no new
    backend files changed and no second live-count path or transport was introduced (R5.1,
    R5.4); confirm no phone/SMS/OTP code was added (R5.3); ask the user if questions arise

## Notes

- Tasks marked `*` are optional test sub-tasks and can be skipped for a faster MVP, but the
  store, hook, and seeding cores are cheap to cover and recommended.
- Open decisions carried from design (confirm before or during task 4.1 / 3.1):
  1. Seed set = top 20 by `vibeRank`, concurrency 5 (R4.5) — or strictly in-viewport.
  2. Check-out replaces the check-in button while present (R1) — or both shown.
  3. No backend contract change; surviving-reload CTA is out of scope (R5.2).
- One home per concept: presence-self state lives only in `presenceStore`; the live count
  continues to flow solely through `mapStore.checkInCounts` via `setLivePresenceCount`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1", "4.2", "4.3", "4.4"] },
    { "id": 2, "tasks": ["3.2"] },
    { "id": 3, "tasks": ["3.3", "5"] }
  ]
}
```
