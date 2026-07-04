# Implementation Plan: Leaderboard Consolidation

## Overview

Consolidate the consumer Ranks leaderboard onto one canonical, week-agnostic key
(`LEADERBOARD#{cityId}` / `USER#{userId}`, `checkInCount` attribute): increment on check-in,
read the same key on the Ranks tab, clear it in the weekly reset, and delete the dead
week-keyed writer. Order: add the incrementer on the live check-in path, rewrite the read to
serve the same key, fix the reset to paginate, remove the dead code, then verify.

## Tasks

- [x] 1. Leaderboard_Incrementer on the check-in path
  - [x] 1.1 Add `incrementLeaderboard(cityId, userId)` (atomic `ADD checkInCount`) in the leaderboard repository
    - `UpdateCommand` on `pk=LEADERBOARD#{cityId}`, `sk=USER#{userId}`, set `userId`/`updatedAt`.
    - _Requirements: 1.1, 2.1, 2.2, 2.4_
  - [x] 1.2 Call it from the check-in service as a best-effort fan-out
    - Await on the live path; log-and-continue on failure like other fan-outs; never block the check-in response.
    - _Requirements: 2.1, 2.3, 2.4_
  - [ ]\* 1.3 Unit test the atomic update shape and best-effort behavior
    - _Requirements: 2.1, 2.4_

- [x] 2. Consumer read serves the canonical key (H6)
  - [x] 2.1 Rewrite `getLeaderboardTop50` to Query `LEADERBOARD#{cityId}`, sort desc in memory, top 50
    - Deterministic tiebreak by userId; assign ranks; keep archetype-filter behavior.
    - _Requirements: 3.1_
  - [x] 2.2 Rewrite `getUserLeaderboardRank` to return exact rank (incl. outside top 50) or null when absent
    - _Requirements: 3.2_
  - [x] 2.3 Preserve friend-visibility/privacy filtering in `getCityLeaderboard`
    - `applyFriendVisibility` / `filterByPrivacy` unchanged.
    - _Requirements: 5.1, 5.2_
  - [ ]\* 2.4 Integration test: populated Ranks after simulated check-ins; DEV_MODE fixture intact
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Weekly reset covers all entries (paginate)
  - [x] 3.1 Replace `Limit: 50` with `LastEvaluatedKey` pagination in `leaderboard-reset` handler
    - Archive all entries to `LB_HISTORY#{cityId}`, then delete all.
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 3.2 Apply the same paginated read + canonical key to `preResetHandler`
    - _Requirements: 4.4_
  - [ ]\* 3.3 Unit test: reset deletes > 50 entries; pre-reset uses the canonical key
    - _Requirements: 4.1, 4.2_

- [x] 4. Delete the dead writer
  - Remove `updateLeaderboardEntry` and `getLeaderboard` (week-keyed) from `check-in/dynamodb-repository.ts` after re-confirming zero call sites.
  - _Requirements: 1.2_

- [ ]\* 5. Key-drift regression guard
  - Test asserting the incrementer key and the read key are the same string built from `cityId`.
  - _Requirements: 1.1, 1.3_

- [x] 6. Final checkpoint — verify
  - `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm guard:serverless`.
  - _Requirements: 5.3_

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "2.1", "2.2", "3.1"],
      "description": "Incrementer write + read rewrite + reset pagination (share the canonical key)"
    },
    {
      "id": 1,
      "tasks": ["1.2", "2.3", "3.2"],
      "description": "Wire incrementer into check-in; preserve privacy filtering; align pre-reset"
    },
    { "id": 2, "tasks": ["4"], "description": "Delete dead week-keyed writer once nothing references it" },
    { "id": 3, "tasks": ["1.3", "2.4", "3.3", "5"], "description": "Tests and key-drift regression guard" },
    { "id": 4, "tasks": ["6"], "description": "Full verification sweep" }
  ]
}
```

## Notes

- `*` tasks are optional tests but the key-drift guard (task 5) is cheap insurance against the exact bug this spec fixes.
- Week-agnostic canonical key cleared weekly is the chosen model (design doc); the score-in-sort-key alternative is documented there if a city partition ever outgrows an in-memory sort read.
- DEV_MODE leaderboard fixtures stay for local dev but are never the production source.
- No new tables/GSIs; reuses `app-data` and the existing `LB_HISTORY#` archive rows per `serverless-only.md`.
