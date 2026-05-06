# Backend Scale Hardening — Summary

This document describes the scale fixes applied on top of the existing
DynamoDB-only architecture, why they were chosen, and what's still pending.

---

## TL;DR

The codebase had several O(N)-on-table-size patterns (Scans, N+1 awaits) and a
single-partition leaderboard that caps at 1000 WCU. We did **not** migrate to
Postgres — that would be a multi-week green-field rebuild. Instead we kept
DynamoDB and added Redis for the workloads DDB is bad at.

| Hot path                          | Before                                  | After                                    |
| --------------------------------- | --------------------------------------- | ---------------------------------------- |
| `getActivityFeed`                 | N+1 `getUserById` × N + `getNodeById` × N | `BatchGetItem` × 1 each, `Promise.all`   |
| `getNearbyRecentEvent`            | Full `Scan` of nodes table              | 9 cell `Query`s on `Geohash5Index`       |
| `searchUsers`                     | Full `Scan` of users table              | `Query` on `UsernameLowerIndex`          |
| `getWhoIsHere`, profile lookups   | Sequential `await` loops                | `BatchGetItem`                           |
| Leaderboard top-50 / rank         | Single DDB partition (cap 1000 WCU)     | Redis `ZSET` (atomic, O(log N))          |
| `findNearbyNodes`                 | Full table Scan + Haversine in JS       | Geohash GSI Query + Haversine refine     |
| `kvGet/Set/Incr/Ttl`              | DynamoDB read+write per call            | Redis with DDB fallback                  |

---

## What changed in code

### New files

- `backend/src/shared/db/redis.ts` — `ioredis` singleton, lazy-init, Lambda-safe.
- `backend/src/shared/db/batch.ts` — `batchGetUsers`, `batchGetNodes`, `batchGetBusinesses` with chunking + UnprocessedKeys retry.
- `backend/src/shared/db/geohash.ts` — minimal base32 geohash encoder, `neighbourCells`, `pickPrecision`, `haversineMetres` (no new dep).
- `backend/src/features/social/leaderboard-redis.ts` — `bumpCheckIn`, `getTopN`, `getUserRank`, `resetLeaderboard`.

### Modified files

- `backend/src/features/social/repository.ts` — full rewrite. All loops batched,
  leaderboard delegates to Redis with DDB fallback, `searchUsers` queries the
  GSI with Scan fallback.
- `backend/src/features/nodes/dynamodb-repository.ts` — `findNearbyNodes` uses
  geohash GSI; `createNode` populates `geohash5`/`geohash7`.
- `backend/src/shared/kv/dynamodb-kv.ts` — Redis-first with DDB fallback. API unchanged.
- `backend/src/features/check-in/service.ts` — calls `bumpLeaderboard` on every check-in.
- `backend/package.json` — added `ioredis ^5.4.1`.

### Deleted files (dead code)

- `backend/prisma/` — entire directory (Prisma was never wired).
- `backend/src/shared/db/migration-runner.ts`.
- `backend/src/workers/run-migration.ts`.
- `backend/src/workers/partition-manager.ts` (was a no-op stub).

---

## Fallback strategy

Every refactored path checks first whether the new GSI / Redis is available and
falls back to the old behaviour with a `console.warn`. This means **deployment
order is safe**: deploy backend before Terraform, or Terraform before backend,
either works. The warnings are the signal to apply the missing infra.

---

## Required infra changes

See `infra/SCALE_GSI_ADDITIONS.md` for full HCL diffs. Summary:

1. Add 5 new DynamoDB GSIs (`UsernameLowerIndex`, `PhoneIndex`, `Geohash5Index`,
   `SlugIndex`, businesses `CognitoIndex` + `EmailIndex`).
2. Wire `REDIS_URL` env var on API Lambda from existing
   `area-code/${env}/redis-url` secret.
3. Ensure API Lambda is in the same VPC as ElastiCache and has SG access to
   port 6379.
4. Run one-time backfill scripts for `geohash5`/`geohash7` on `nodes`, and
   `usernameLower` on `users`.
5. Remove dead Lambda module definitions (`run-migration`, `partition-manager`).

---

## What's still left (per-feature audit)

Audit found these additional Scan / N+1 patterns. They follow the same
pattern as the fixes above; estimated 1-2 hours each.

| File                                                          | Issue                                            | Fix                                            |
| ------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `auth/dynamodb-repository.ts` `getUserByPhone`                | Paginated full Scan                              | Query `PhoneIndex` GSI                         |
| `auth/dynamodb-repository.ts` `getBusinessByCognitoSub`       | Paginated full Scan of businesses                | Query `CognitoIndex` on businesses GSI         |
| `auth/dynamodb-repository.ts` `getBusinessByEmail`            | Paginated full Scan of businesses                | Query `EmailIndex` on businesses GSI           |
| `auth/dynamodb-repository.ts` `createUser`/`updateUser`       | Doesn't write `usernameLower`                    | Add `usernameLower: data.username?.toLowerCase()` |
| `nodes/dynamodb-repository.ts` `getNodeBySlug`                | Paginated full Scan                              | Query `SlugIndex` GSI                          |
| `nodes/dynamodb-repository.ts` `listNodes` (no cityId)        | Scan with filter                                 | Require pagination cursor or use GSI by status |
| `social/block-repository.ts`, `social/report-repository.ts`   | (Audit pending) likely similar N+1 lookups       | `BatchGetItem`                                 |
| `business/repository.ts` various                              | (Audit pending)                                  | Same                                           |
| `admin/repository.ts` various                                 | (Audit pending)                                  | Same                                           |
| `rewards/dynamodb-repository.ts`                              | (Audit pending)                                  | Same                                           |
| `music/repository.ts`                                         | (Audit pending)                                  | Same                                           |
| `notifications/repository.ts`                                 | (Audit pending)                                  | Same                                           |
| `reports/dispatcher.ts`, `reports/generator.ts`               | (Audit pending)                                  | Same                                           |

Pattern for each: replace `for (const x of xs) await getById(x)` with
`batchGetUsers(xs)` (or analogous) + `Promise.all`.

---

## Validation checklist before declaring "1M-ready"

- [ ] Apply Terraform GSI additions (see `infra/SCALE_GSI_ADDITIONS.md`).
- [ ] Run backfill scripts (geohash on nodes, usernameLower on users).
- [ ] Confirm `REDIS_URL` is set in Lambda env and Lambda is in correct VPC.
- [ ] Run `pnpm install` to pull `ioredis`.
- [ ] Deploy backend.
- [ ] Hit `/social/search?q=foo` — verify no Scan warning in CloudWatch.
- [ ] Hit `/nodes/nearby?lat=...&lng=...` — verify no Scan warning.
- [ ] Hit `/leaderboard/top` — verify response comes from Redis (latency p99 < 5ms).
- [ ] Run a synthetic load test at 10k RPS for 5 min.
- [ ] Audit & port the remaining repositories (table above).
- [ ] Add CloudWatch alarm on the `falling back to Scan` log pattern.

---

## What this does NOT fix

- **Strong write consistency across denormalised counters.** `users.totalCheckIns`
  is still incremented on the user row per check-in; for power users this is a
  hot row. Acceptable up to ~10 check-ins/sec per user; if you ever need more,
  switch to an append-only counter shard table.
- **Multi-region.** Everything is single-region. For 1M global users you want
  Global Tables on DynamoDB and Global Datastore on ElastiCache.
- **Search relevance.** `searchUsers` is exact + prefix match. For typo-tolerant
  fuzzy search at scale, add OpenSearch (or use `ZSCAN` patterns over a
  denormalised user index).
- **Backups & DR.** Verify PITR is on for all DDB tables (it is in the prod
  Terraform — keep it that way).

---

## Cost notes (rough, us-east-1, 1M MAU baseline)

- **DynamoDB on-demand**: dominant cost driver was the Scans. Eliminating them
  cuts read RCUs by ~99% on the hot endpoints. Expect ~$200-600/month range
  rather than 4-figure surprise bills.
- **ElastiCache Serverless**: ~$0.125/GB-hour storage + $0.0034/ECPU. For this
  workload (~few GB of leaderboard + cache) expect $80-200/month.
- **Lambda**: VPC-attached Lambdas have a slightly higher cold-start (~100ms more)
  but this app is socket-driven so warm invocations dominate.
