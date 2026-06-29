# Design Document

## Overview

This feature makes the live-map glyph honest by one rule: **below a small headcount the glyph shows the venue's declared promise (taste-on-intent); at or above it the glyph shows the crowd's actual vibe (taste-on-presence).** It is implemented as a small, contained change to the **existing** `resolveLiveArchetype` resolver and the **existing** `live-archetype-evaluator` Lambda, plus honest labelling in three UI surfaces that already exist. No new always-on infrastructure, no new currency, no trust score, no voting.

The design reuses, in place:

- `resolveLiveArchetype` (`packages/shared/lib/liveArchetype.ts`) — extended with two inputs and a precedence flip, staying observably pure.
- `live-archetype-evaluator` (`backend/src/workers/live-archetype-evaluator.ts`) — reads one more value (the honest present count) and passes it to the resolver.
- The `node:archetype_change` socket event and its coalescing — unchanged wire shape except the new branch labels.
- `mapStore`, `MusicSchedulePanel` (business), the staff app, and `CrowdVibeSection` (consumer) — for the surfaces.
- The presence-integrity read model for the honest `Live_Presence_Count`.

### Non-goals

- Rewards for showing up (separate spec on the existing rewards/guest-claim rails). This spec only guarantees it does not weaken presence verification.
- Any change to beam brightness / height / animation (constellation-mode: those stay pulse-only; this changes glyph identity only).
- Any new anti-fraud machinery (presence-integrity already verifies presence by proximity + expiry).

## Architecture

```
                         EventBridge 60s tick ┐
   check-in / check-out / expiry (presence) ──┤
                  live-channel subscription ──┘
                              │  Evaluation_Tick (one venue)
                              ▼
                 ┌──────────────────────────────────────┐
                 │  live-archetype-evaluator (Lambda)    │
                 │  1. read Music_Schedule (GetItem)     │
                 │  2. read recent check-ins (Query)     │  ← archetype mode (Crowd_Vibe)
                 │  3. read honest present count (GetItem)│ ← Live_Presence_Count (floor gate)
                 │  4. resolveLiveArchetype(... + count)  │  ← PURE precedence decision
                 │  5. if changed: emit node:archetype_   │
                 │     change {nodeId, liveArchetypeId,   │
                 │     branch}; write lastArchetypeId     │
                 └──────────────────────────────────────┘
                              │ socket delta (coalesced ≤ 1 / 10s)
                              ▼
        mapStore.archetypeIds  ──►  glyph identity (web map + node sheet)
```

The decision itself lives entirely in the pure resolver. The Lambda is only the I/O boundary; everything testable is pure.

## The precedence flip (core logic)

### Current precedence (live-vibe-on-map, unchanged when flag off)

```
1. schedule slot (lineup/blanket) → declared vibe   ← always wins during an Active_Slot
2. check-in mode                  → crowd vibe
3. node default
4. eclectic fallback
```

### New precedence when `live_vibe_declaration` is on

```
qualifyingCount = honest present check-ins in Lookback_Window carrying a catalog archetypeId

if qualifyingCount >= effectiveFloor:           → CROWD_VIBE        branch: crowd_live
elif Active_Slot exists:                        → DECLARED_VIBE     branch: declared_promise
else:                                           → node default → eclectic   (unchanged)

where effectiveFloor = Presence_Floor normally, but
      Presence_Floor − Presence_Grace while the previous branch was crowd_live
      (downward-only grace, see below)
```

The flip is deliberate and total: **once the room is real, the crowd beats the declaration, full stop.** Below the floor the declaration is shown but is only ever labelled as a promise, so it cannot misrepresent the present.

### Presence-grace (anti-flicker)

The resolver is pure, so it cannot remember the last branch. The previous branch is passed in as an input (`previousBranch`), sourced from the Node row's existing `lastArchetypeId` companion (a new sibling field `lastBranch`, written alongside it). The grace is downward-only:

- Enter `crowd_live` when `qualifyingCount >= Presence_Floor`.
- Stay in `crowd_live` until `qualifyingCount < Presence_Floor − Presence_Grace`.

With `Presence_Floor = 3`, `Presence_Grace = 1`: switches to crowd at 3 present, reverts to promise only when it drops to 1.

## Components and Interfaces

### 1. Resolver extension (`packages/shared/lib/liveArchetype.ts`)

Extend `LiveArchetypeInputs` and the branch union. The function stays observably pure.

```ts
export type LiveArchetypeBranch =
  | 'schedule_lineup'
  | 'schedule_blanket'
  | 'checkin_mode'
  | 'default'
  | 'eclectic_fallback'
  | 'declared_promise' // NEW: below floor, showing intent
  | 'crowd_live' // NEW: at/above floor, showing real crowd

export interface LiveArchetypeInputs {
  node: Pick<Node, 'id' | 'defaultArchetypeId'> | { id: string; defaultArchetypeId?: string | null }
  schedule?: MusicSchedule
  recentCheckIns: LiveArchetypeCheckIn[]
  timestampIso: string
  // NEW (all optional → backwards compatible / flag-off path unchanged):
  presenceFloor?: number // undefined ⇒ legacy precedence (flag off)
  presenceGrace?: number // default 0
  qualifyingPresenceCount?: number // honest present count gating the floor
  previousBranch?: LiveArchetypeBranch | null // for downward grace only
}
```

Decision rule (added before the existing schedule branch, only when `presenceFloor` is defined):

```ts
if (inputs.presenceFloor !== undefined) {
  const floor =
    inputs.previousBranch === 'crowd_live' ? inputs.presenceFloor - (inputs.presenceGrace ?? 0) : inputs.presenceFloor
  const count = inputs.qualifyingPresenceCount ?? 0

  if (count >= floor) {
    const crowd = pickCheckInMode(recentCheckIns ?? [])
    if (crowd) return { archetype: crowd, branch: 'crowd_live' }
    // count says the room is real but no catalog archetype mode exists →
    // fall through to declared/default rather than invent a vibe
  }
  if (hasActiveSlot(schedule, timestampIso)) {
    const declared = resolveScheduleArchetype(schedule!, timestampIso) // existing helper
    if (declared) return { archetype: declared, branch: 'declared_promise' }
  }
  // else fall through to existing default → eclectic
}
// when presenceFloor is undefined, the existing live-vibe-on-map body runs verbatim
```

`pickCheckInMode`, `resolveActiveSlot`, the catalog lookups, and the default/eclectic tail are all reused unchanged.

### 2. Evaluator change (`backend/src/workers/live-archetype-evaluator.ts`)

One added read and the new inputs:

- `readHonestPresenceCount(nodeId)` — a single `GetItem` against the presence-integrity present-count aggregate (the same value behind `node:presence_update` / `mapStore.checkInCounts`). The `qualifyingPresenceCount` passed to the resolver is the honest **present** count, so a person who checked in and left (check-out or expiry) does not keep the floor met — this is what keeps it honest, not the raw 90-min check-in tally.
- Read `presenceFloor` / `presenceGrace` from config (flag-gated; `undefined` when `live_vibe_declaration` is off, which selects the legacy path).
- Pass `previousBranch` from the Node row (read alongside `lastArchetypeId`; persist `lastBranch` next to `lastArchetypeId` on change).
- Emit `node:archetype_change { nodeId, liveArchetypeId, branch }` only when the archetype id changes, reusing the existing coalescing (≤ 1 / 10 000 ms).

Read budget per tick: schedule GetItem + check-ins Query + node-fields GetItem + presence-count GetItem = within the bounded budget (R9.3). All on existing `PAY_PER_REQUEST` tables; Lambda stays `arm64`.

### 3. Feature flag

`live_vibe_declaration`, read by web and backend, default `false` everywhere, falling back to `false` if the flag store is unreachable. When off: `presenceFloor` is passed as `undefined`, so the resolver runs its existing body and declaration always wins during an Active_Slot — behaviour identical to today. The declaration surfaces still render and still write schedules.

### 4. UI surfaces (reuse, add honest labels)

- **Business — `MusicSchedulePanel`**: add a status line driven by the venue's current `branch` (read from the live map payload / socket): `declared_promise` → "Map is showing your expected vibe"; `crowd_live` → "The crowd has taken over · {Crowd_Vibe display name}". Empty-slot state keeps the existing one-tap slot-create flow. Authorization unchanged (JWT `businessId`).
- **Staff — `apps/staff`**: a surface scoped to the assigned venue that writes the promise through the **same** Music_Schedule API (single source of truth). Session-scope check; denial state otherwise. No phone/SMS anywhere.
- **Consumer — `CrowdVibeSection`** in the node sheet: label keyed on branch — `declared_promise` → "Expected tonight" with soft low-presence copy; `crowd_live` → "In the room now". No confirm/deny control. No individual identity, counts of named people, or location.

The label everywhere is derived from the single resolved `branch` so no surface can disagree with the rendered glyph.

## Data Models

No new tables. Existing tables touched:

- **Nodes**: add a `lastBranch?: LiveArchetypeBranch | null` field beside the existing `lastArchetypeId` (used only to feed `previousBranch` for downward grace). Optional; absent ⇒ treated as `null`.
- **Music_Schedules, CheckIns, presence aggregate**: read-only here; no schema change.

Wire/types:

- `LiveArchetypeBranch` gains `declared_promise` and `crowd_live` (shared types + backend socket types kept in sync, as they already are).
- `node:archetype_change` payload shape is unchanged (`{ nodeId, liveArchetypeId, branch }`); only the set of possible `branch` values grows.

## Configuration values (founder-confirmed)

| Value            | Confirmed                                                 | Governs            |
| ---------------- | --------------------------------------------------------- | ------------------ |
| `Presence_Floor` | **3** qualifying present check-ins in the Lookback_Window | enter `crowd_live` |
| `Presence_Grace` | **1** (revert to promise only below floor − 1, i.e. < 2)  | exit `crowd_live`  |

Both live as flag-gated config read by the evaluator, so they can be tuned without a deploy.

## Error Handling

- Presence-count read fails/throttles → treat `qualifyingPresenceCount` as `0` (room not proven) → fall back to the declared promise / default. Never throws; mirrors the existing check-in-query "fall through on failure" contract.
- Recent check-ins query fails → empty array (existing behaviour) → no `crowd_live` mode available → declared promise / default.
- Flag store unreachable → `false` → legacy precedence.
- Schedule absent → no `declared_promise`; default → eclectic (existing tail).

## Testing Strategy

Pure resolver (property-based, reusing the existing `liveArchetype.test.ts` harness):

1. Returns exactly one active-catalog archetype for any `qualifyingPresenceCount` / `presenceFloor`.
2. Idempotent for identical inputs (same `id` + `branch`).
3. `qualifyingPresenceCount < effectiveFloor` ⇒ never `crowd_live`.
4. `qualifyingPresenceCount >= effectiveFloor` with a qualifying crowd mode ⇒ never `declared_promise`.
5. Presence-grace: held within `[floor − grace, floor)` after entering `crowd_live` ⇒ branch does not flip back (no oscillation).
6. `presenceFloor === undefined` ⇒ output identical to the pre-feature resolver (regression lock for the flag-off path).

Evaluator (unit, mocked I/O): present-count read maps to the resolver input; only-on-change emission; `lastBranch` persisted; bounded read count.

UI: each surface renders the correct label for `declared_promise` vs `crowd_live`; consumer surface exposes no identity and no confirm/deny.

## Correctness Properties

These invariants the property-based tests enforce on the pure resolver. They hold for the flag-on path; the flag-off path is locked to the pre-feature resolver by Property 6.

### Property 1: Returns one active-catalog archetype

For any valid inputs and any `qualifyingPresenceCount` / `presenceFloor`, the resolver returns exactly one archetype from the active catalog.

**Validates: Requirements 12.1**

### Property 2: Idempotence

For identical valid inputs with no intervening state change, two calls return the same archetype `id` and the same `branch`.

**Validates: Requirements 12.2, 4.1**

### Property 3: No crowd_live below the floor

Whenever `qualifyingPresenceCount < effectiveFloor`, the branch is never `crowd_live`.

**Validates: Requirements 1.1, 12.3**

### Property 4: No declared_promise above the floor

Whenever `qualifyingPresenceCount >= effectiveFloor` and a qualifying crowd mode exists, the branch is never `declared_promise`.

**Validates: Requirements 2.1, 12.4**

### Property 5: Presence-grace prevents oscillation

When the count is held within `[floor − grace, floor)` after entering `crowd_live`, the branch does not flip back.

**Validates: Requirements 3.1, 3.3, 12.5**

### Property 6: Flag-off regression lock

When `presenceFloor === undefined`, the output is identical to the pre-feature resolver.

**Validates: Requirements 10.3**

### Property 7: Glyph-identity only

For any resolution outcome, no beam brightness, height, or animation value is read or written.

**Validates: Requirements 4.3**

## Requirements Mapping

- R1 (promise, not present-tense) → resolver `declared_promise` branch + label rule; R1.4 single schedule store.
- R2 (presence is truth above floor) → `crowd_live` branch reusing `checkin_mode`; honest present count.
- R3 (grace) → downward-only `effectiveFloor` with `previousBranch`.
- R4 (pure + existing delivery) → resolver signature; `node:archetype_change` reuse; glyph-identity-only.
- R5/R6 (surfaces) → `MusicSchedulePanel`, `apps/staff`, `CrowdVibeSection` label rules + auth.
- R7 (rewards-safe presence) → honest present-count input; no verification weakened; rewards out of scope.
- R8 (founder values) → Presence_Floor 3, Presence_Grace 1 config table.
- R9 (serverless/reuse) → existing Lambda + tick; arm64; PAY_PER_REQUEST; no new infra.
- R10 (flag) → `live_vibe_declaration`, default false, legacy path when off.
- R11 (POPIA) → aggregate-only payload; no identity; no location trail; no phone/SMS.
- R12 (PBT) → testing strategy items 1–6.
