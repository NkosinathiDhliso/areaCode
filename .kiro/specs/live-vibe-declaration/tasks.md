# Implementation Plan

## Overview

Implements the silver-bullet "presence is truth" model as a contained change to the existing pure resolver and `live-archetype-evaluator` Lambda, plus honest labelling in three existing UI surfaces. No new tables, no new always-on infra, no new currency. The core decision (Task 1) is pure and fully property-tested (Task 2) before any I/O is wired (Tasks 3–4), so the risky logic is locked down first. UI (Tasks 6–8) and the feature flag (Task 9) can proceed in parallel once the shared types land (Task 1.1).

## Tasks

- [x] 1. Extend the shared types and resolver (pure core)
- [x] 1.1 Add `declared_promise` and `crowd_live` to `LiveArchetypeBranch`
  - Update the union in `packages/shared/types/index.ts` and keep `backend/src/shared/socket/types.ts` in sync (both already mirror each other).
  - _Requirements: 1.1, 2.1, 4.2_
- [x] 1.2 Extend `LiveArchetypeInputs` with the presence-gate fields
  - Add optional `presenceFloor`, `presenceGrace`, `qualifyingPresenceCount`, and `previousBranch` to `LiveArchetypeInputs` in `packages/shared/lib/liveArchetype.ts`. All optional so the flag-off path is unchanged.
  - _Requirements: 4.1, 10.3_
- [x] 1.3 Implement the presence-is-truth precedence in `resolveLiveArchetype`
  - When `presenceFloor` is defined: compute `effectiveFloor` (apply `presenceGrace` downward only when `previousBranch === 'crowd_live'`); if `qualifyingPresenceCount >= effectiveFloor` and `pickCheckInMode` yields a crowd, return `crowd_live`; else if an Active_Slot exists return `declared_promise`; else fall through to the existing `default`/`eclectic_fallback` tail. When `presenceFloor` is undefined, run the existing body verbatim.
  - Reuse `pickCheckInMode`, `resolveActiveSlot`, and the catalog helpers; do not duplicate them.
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1_

- [x] 2. Property-based tests for the resolver
- [x] 2.1 Add properties P1–P5 to the existing `liveArchetype.test.ts` harness
  - One catalog archetype always; idempotence; never `crowd_live` below `effectiveFloor`; never `declared_promise` at/above floor with a qualifying crowd; presence-grace holds branch within `[floor − grace, floor)`.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
- [x] 2.2 Add the flag-off regression lock (P6) and glyph-identity assertion (P7)
  - With `presenceFloor === undefined`, output equals the pre-feature resolver across the generated input space; assert the resolver reads/writes no beam visual field.
  - _Requirements: 10.3, 4.3_

- [x] 3. Honest present-count read in the evaluator
- [x] 3.1 Add `readHonestPresenceCount(nodeId)`
  - One `GetItem` against the presence-integrity present-count aggregate (the value behind `node:presence_update` / `mapStore.checkInCounts`). On failure/throttle resolve to `0` (room not proven), never throw — mirror `queryRecentCheckIns`.
  - _Requirements: 2.3, 7.1, 7.2_
- [x] 3.2 Read and persist `previousBranch`
  - Extend `readNodeArchetypeFields` to also read `lastBranch`; add a `lastBranch` write beside `writeLastArchetypeId` on change.
  - _Requirements: 3.1, 3.3_

- [x] 4. Wire the evaluator to the resolver behind the flag
- [x] 4.1 Read flag + config and pass the new inputs
  - Read `live_vibe_declaration` and the `Presence_Floor` (3) / `Presence_Grace` (1) config; pass `presenceFloor`/`presenceGrace` only when the flag is on (else `undefined`), plus `qualifyingPresenceCount` and `previousBranch`, into `resolveLiveArchetype`.
  - Keep the existing only-on-change `node:archetype_change` emission and coalescing (≤ 1 / 10 000 ms).
  - _Requirements: 4.2, 9.1, 9.2, 9.3, 10.1, 10.2, 10.4_
- [x] 4.2 Evaluator unit tests (mocked I/O)
  - Present-count maps to the resolver input; emission only on archetype change; `lastBranch` persisted; bounded read count; failure paths fall through without throwing.
  - _Requirements: 2.4, 9.3_

- [x] 5. Data model field
- [x] 5.1 Add optional `lastBranch` to the Node row contract
  - Document the optional `lastBranch?: LiveArchetypeBranch | null` field beside `lastArchetypeId`; no new table, no migration (absent ⇒ `null`).
  - _Requirements: 3.1_

- [x] 6. Business declaration surface (`MusicSchedulePanel`)
- [x] 6.1 Show promise-vs-crowd status from the resolved branch
  - In `apps/business` `MusicSchedulePanel`, render a status line: `declared_promise` → "Map is showing your expected vibe"; `crowd_live` → "The crowd has taken over · {Crowd_Vibe name}". Keep the existing empty-slot one-tap create flow and JWT `businessId` authorization/denial.
  - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_

- [x] 7. Staff declaration surface (`apps/staff`)
- [x] 7.1 Add a venue-scoped declaration surface writing the same Music_Schedule API
  - Scope to the staff member's assigned venue; persist through the existing Music_Schedule API (single source of truth); denial state when session is not scoped; no phone/SMS.
  - _Requirements: 5.4, 5.5, 5.6_

- [x] 8. Consumer vibe panel (`CrowdVibeSection`)
- [x] 8.1 Label the live glyph as promise vs now
  - In `apps/web` node sheet, label by branch: `declared_promise` → "Expected tonight" with soft low-presence copy; `crowd_live` → "In the room now". No confirm/deny control; no identity, named counts, or location.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 11.1_

- [x] 9. Feature flag plumbing
- [x] 9.1 Register `live_vibe_declaration` for web + backend
  - Default `false` in every environment; unreachable flag store ⇒ `false`; flip-on applies the new precedence for visible venues within one socket reconnect cycle (≤ 10 000 ms).
  - _Requirements: 10.1, 10.2, 10.4_

- [x] 10. End-to-end verification
- [x] 10.1 Cold-start → fill → empty path test
  - Empty room shows `declared_promise`; crossing 3 present flips to `crowd_live`; dropping to 1 reverts; assert only glyph identity changed and the `node:archetype_change` payload carries no consumer identity.
  - _Requirements: 1.1, 2.1, 2.4, 3.1, 4.3, 11.2, 11.3, 11.4_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "5.1", "6.1", "7.1", "8.1", "9.1"] },
    { "id": 2, "tasks": ["1.3", "3.1", "3.2"] },
    { "id": 3, "tasks": ["2.1", "2.2", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["10.1"] }
  ]
}
```

- Wave 0: shared branch labels (`1.1`) unblock everything.
- Wave 1: resolver input shape, the Node `lastBranch` field, all three UI surfaces, and the flag — independent once `1.1` lands.
- Wave 2: the pure precedence logic (`1.3`) and the evaluator's reads (`3.1`, `3.2`).
- Wave 3: resolver property tests and evaluator wiring (`4.1` needs `1.3`, `3.1`, `3.2`, `5.1`, `9.1`).
- Wave 4: evaluator unit tests.
- Wave 5: end-to-end cold-start → fill → empty verification.

## Notes

- Pure-first: the entire decision lives in `resolveLiveArchetype` and is property-tested (Task 2) before any I/O is wired, so the load-bearing logic is verified in isolation.
- Reuse-only: no new tables, no new socket events, no new currency. The single new persisted field is `lastBranch` on the existing Node row.
- Honesty guarantee: the floor is gated on the presence-integrity **present** count (check-in − check-out − expiry), not a raw 90-minute tally, which keeps a future rewards feature un-farmable. This spec must not weaken presence verification (R7).
- Safety: the flag-off regression lock (P6) proves today's behaviour is unchanged while `live_vibe_declaration` is `false`, so this can ship dark and be enabled per environment.
- Out of scope: rewarding presence (separate spec on the existing rewards/guest-claim rails).
