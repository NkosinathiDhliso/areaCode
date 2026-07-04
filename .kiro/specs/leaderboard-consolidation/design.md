# Design Document

## Overview

The consumer Ranks leaderboard is non-functional in production because the read key
(`LEADERBOARD#{cityId}`) is never written; the only writer is dead, week-keyed code
(`LEADERBOARD#{cityId}#{weekEnding}`). This design consolidates the leaderboard onto one
canonical, week-agnostic key that the check-in path writes, the Ranks read serves, and the
weekly reset clears — and deletes the dead duplicate. It resolves Requirement 1.3 in favor
of a **week-agnostic canonical key cleared weekly**, because it matches the existing read
and reset code, keeps the hot check-in write to a single atomic operation, and needs no
week-derivation to stay in sync across three call sites.

Binding rules: `no-fallbacks-no-legacy.md` (one path, delete the dead writer),
`dry-reuse-no-duplication.md` (one home per concept), `honest-presence.md` (counts reflect
reality), `serverless-only.md` (pay-per-request, cheap hot path).

## Key-model decision (Requirement 1.3)

Canonical key: `pk = LEADERBOARD#{cityId}`, `sk = USER#{userId}`, attribute `checkInCount`.

- **Week-agnostic, reset-cleared.** "Current week" is simply whatever rows exist now; the
  reset worker archives and deletes the partition every Monday 00:00 SAST, so no week is
  encoded in the key. This is the existing read/reset key, so those call sites need minimal
  change and can never drift from a week-derivation the writer computes differently.
- **Write path (hot):** a single atomic `UpdateItem ... ADD checkInCount :one` per check-in.
  No read-modify-write, no delete+put. Cheap and idempotent-friendly.
- **Read path (cold, cacheable):** `Query pk = LEADERBOARD#{cityId}`, sort by `checkInCount`
  desc in memory, take top 50, and compute the viewer's exact rank from the same result.

Rejected alternative — score-in-sort-key (`sk = SCORE#{paddedCount}#{userId}` with
`ScanIndexForward:false, Limit:50`): gives O(1) top-N reads but forces a read-modify-write
(find old sk, delete, put) on every check-in, which is the wrong tradeoff on the hottest
path at our scale. Documented here so a future maintainer can switch if a single city's
partition grows large enough that the in-memory sort read becomes the bottleneck.

## Architecture

```
Check-in path (check-in service)
  └─▶ Leaderboard_Incrementer: UpdateItem ADD checkInCount on LEADERBOARD#{cityId} / USER#{userId}

GET /v1/leaderboard/:citySlug (social/handler → service.getCityLeaderboard)
  └─▶ getLeaderboardTop50(cityId): Query LEADERBOARD#{cityId}, in-memory sort desc, top 50
  └─▶ getUserLeaderboardRank(cityId, userId): exact rank from the same partition read
        └─▶ applyFriendVisibility / filterByPrivacy (unchanged)

leaderboard-reset worker (Mon 00:00 SAST)
  └─▶ paginate LEADERBOARD#{cityId} → archive to LB_HISTORY#{cityId} → delete all

pre-reset notifier (Sun 20:00 SAST)
  └─▶ same paginated read, notify ranked users
```

## Components and Interfaces

### 1. Leaderboard_Incrementer (new, on check-in path)

- Location: check-in service, alongside the existing check-in fan-out (SQS/socket emit).
- `incrementLeaderboard(cityId, userId)`: `UpdateCommand` with
  `UpdateExpression: 'ADD checkInCount :one SET userId = :u, updatedAt = :t'`,
  `Key: { pk: LEADERBOARD#{cityId}, sk: USER#{userId} }`.
- Best-effort per Requirement 2.4: wrap in the same try/log pattern as other check-in
  fan-outs so a leaderboard write failure logs but does not fail the check-in response. It
  must be a real, awaited call on the live path — not dead or manual.

### 2. getLeaderboardTop50 (rewrite, `social/repository.ts`)

- `Query pk = LEADERBOARD#{cityId}` (paginate if a partition exceeds one page), map to
  `{ userId, checkInCount }`, sort desc by `checkInCount` (tiebreak by userId for
  determinism), assign `rank = index + 1`, return top 50.
- Keep the archetype filter parameter behavior consistent with today (filter after read if
  an `archetypeId` is supplied and stored on entries; otherwise city-wide).

### 3. getUserLeaderboardRank (rewrite, `social/repository.ts`)

- Reuse the same full-partition read; find the viewer's entry; return exact
  `{ rank, checkInCount }` even when outside the top 50; return a truthful "unranked" (null)
  only when the viewer has no entry.

### 4. leaderboard-reset + preResetHandler (`workers/leaderboard-reset.ts`)

- Replace `Limit: 50` with pagination over `LastEvaluatedKey` so **all** entries are
  archived and deleted (Requirement 4.1, 4.2). Archive rows to `LB_HISTORY#{cityId}` with
  `sk = {weekEnding}#{userId}` as today.
- Pre-reset notifier uses the same paginated read and canonical key.

### 5. Delete the dead writer

- Remove `updateLeaderboardEntry` and `getLeaderboard` (week-keyed) from
  `check-in/dynamodb-repository.ts`. Confirm zero call sites (already verified) before removal.

## Data Models

- **Leaderboard_Entry:** `pk = LEADERBOARD#{cityId}`, `sk = USER#{userId}`,
  `{ userId, checkInCount, archetypeId?, updatedAt }`. No TTL (reset worker clears it).
- **LB_HISTORY row (unchanged):** `pk = LB_HISTORY#{cityId}`, `sk = {weekEnding}#{userId}`,
  `{ cityId, weekEnding, userId, rank, checkInCount }`.

## Error Handling

- Incrementer: best-effort on the check-in path (log-and-continue), matching existing
  fan-out semantics — a leaderboard write must never block or fail a check-in.
- Read: a DynamoDB failure surfaces as an API error (no silent empty leaderboard that could
  be mistaken for "no data" — `no-fallbacks`). The genuine empty-partition case (new week,
  no check-ins yet) returns an honest empty list.
- Reset: per-city failures log and continue to the next city (existing worker pattern).

## Correctness Properties

### Property 1: Sort invariant

For any set of entries, `getLeaderboardTop50` returns them ordered by `checkInCount`
descending (deterministic userId tiebreak), length ≤ 50.
**Validates: Requirements 3.1**

### Property 2: Rank monotonicity

Ranks are `1..n` with no gaps or duplicates; a higher `checkInCount` never has a worse
(larger) rank than a lower one.
**Validates: Requirements 3.1**

### Property 3: Increment monotonicity

N check-ins for a user yield `checkInCount === N` for the current period (atomic ADD is
associative/commutative under concurrent updates).
**Validates: Requirements 2.1, 2.2**

### Property 4: Key identity

The partition key the incrementer writes equals the key the read and the reset use, for all
`cityId` (the anti-drift property this spec exists to guarantee).
**Validates: Requirements 1.1, 1.3**

### Property 5: Reset completeness

After a reset, a subsequent read returns an empty board (no entry survives, regardless of how
many entries existed — including > 50).
**Validates: Requirements 4.1, 4.2, 4.3**

### Property 6: Rank truthfulness

`getUserLeaderboardRank` returns the viewer's exact rank when an entry exists (including
outside top 50) and null when it does not — never a fabricated rank.
**Validates: Requirements 3.2**

## Testing Strategy

- **Unit (Vitest, node):** incrementer builds the correct atomic `UpdateCommand`;
  `getLeaderboardTop50` sorts desc and caps at 50; `getUserLeaderboardRank` returns exact
  rank outside top 50 and null when absent; reset pagination deletes beyond 50 entries.
- **Property:** the existing leaderboard sort/rank invariants in
  `social/__tests__/leaderboard.test.ts` continue to hold against the new read.
- **Integration:** `GET /v1/leaderboard/:citySlug` returns populated entries after simulated
  check-ins (non-DEV path), and DEV_MODE still returns its fixture.
- **Regression guard:** a test asserting the read key and the incrementer key are identical
  string-built from `cityId`, so they can never drift again.
- No network/WebGL; stub `documentClient` per the testing steering rules.
