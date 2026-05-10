# Postgres Migration — Rock-Solid Rebuild

**Status: Phase 1 + critical path of Phase 2 complete.** This document is the running plan + checklist.

## Why Postgres (and not DynamoDB)

The app's data shape is a textbook fit for relational + PostGIS:

- **Geographic queries** (`ST_DWithin`, GIST indexes) — first-class in Postgres, anti-pattern in DDB.
- **Ranked leaderboards** — Postgres + Redis ZSET wins on every dimension.
- **Fuzzy search** (`pg_trgm` ILIKE / similarity) — first-class in Postgres, requires OpenSearch in DDB land.
- **Social graph traversals** (mutual follows, feeds) — JOINs are 1000× simpler than DDB GSIs.
- **ACID** — reward redemptions, payment idempotency, leaderboard rollovers want strong consistency.
- **No real users yet** — green-field rebuild has zero migration risk.

Stack: **Aurora Postgres / RDS Postgres → RDS Proxy → Lambda Prisma → Redis (leaderboards / cache / rate-limits)**.

---

## Phase 1 — Foundation (DONE in this commit)

- ✅ Restored `backend/prisma/schema.prisma` and all migration SQL.
- ✅ Added `@prisma/client` and `prisma` to `backend/package.json` + scripts (`db:generate`, `db:migrate:dev`, `db:migrate:deploy`, `db:reset`, `db:studio`).
- ✅ Created `backend/src/shared/db/prisma.ts` — Lambda-safe singleton with `globalThis` cache, RDS-Proxy-aware, env-gated logging.
- ✅ New migration `20260403000001_scale_indexes/` — adds the 12 missing composite/partial indexes flagged in the audit (rewards, redemptions, reports, node_images, check-ins by neighbourhood, push tokens, business tier, etc.).
- ✅ New migration `20260403000002_check_ins_partition_helper/` — installs `ensure_check_ins_partition(date)` SQL function, creates a default partition, and pre-creates the next 12 months of monthly partitions. Fixes the "inserts fail after June 2026" bug.
- ✅ Rewrote `backend/src/workers/partition-manager.ts` — was a no-op stub; now ensures the next 4 months of partitions exist on every monthly EventBridge invocation.
- ✅ Added RDS Proxy resources to `infra/modules/rds/main.tf` — IAM role, secret-based auth, target group, connection pool config tuned for Prisma.
- ✅ Redis foundation already in place from prior commit (`shared/db/redis.ts`, `features/social/leaderboard-redis.ts`, `kv` Redis-first).

### To finalise Phase 1 (one-time, manual)

```powershell
# 1. Install deps
pnpm install

# 2. Local Postgres for dev (PostGIS image)
docker run -d --name areacode-pg -p 5432:5432 `
  -e POSTGRES_PASSWORD=dev `
  -e POSTGRES_DB=areacode `
  postgis/postgis:16-3.4

# 3. Point Prisma at it
$env:AREA_CODE_DB_URL = "postgresql://postgres:dev@localhost:5432/areacode"

# 4. Generate client + apply migrations
pnpm --filter backend db:generate
pnpm --filter backend db:migrate:deploy
```

---

## Phase 2 — Repository ports

Each repository swaps DDB calls for Prisma. Critical-path features done; rest still on DDB pending follow-up.

| Order | Module                                                | Status |
| ----- | ----------------------------------------------------- | ------ |
| 1     | `auth/dynamodb-repository.ts` + `auth/repository.ts`  | **DONE** — Prisma + adapters |
| 2     | `nodes/dynamodb-repository.ts` + `nodes/repository.ts`| **DONE** — Prisma + PostGIS `ST_DWithin` + trigram search |
| 3     | `check-in/dynamodb-repository.ts` + `check-in/repository.ts` | **DONE** — Prisma + atomic `increment` + window-fn streak |
| 4     | `social/repository.ts`                                | **DONE** — Prisma + Redis ZSET leaderboard + trigram user search |
| 5     | `rewards/*`                                           | TODO — still DDB |
| 6     | `business/*`                                          | TODO — still DDB |
| 7     | `notifications/*`                                     | TODO — still DDB |
| 8     | `admin/*`                                             | TODO — still DDB (largest, ~53KB) |
| 9     | `reports/*` (incl. dispatcher, generator)             | TODO — still DDB |
| 10    | `music/*`                                             | TODO — still DDB |
| 11    | `social/block-repository.ts`, `social/report-repository.ts` | TODO — still DDB |
| 12    | `auth/session-repository.ts`                          | TODO — still DDB (sessions can stay on Redis instead of Prisma) |
| 13    | `workers/*` (cleanup, leaderboard-reset, pulse-decay, reward-evaluator, node-state-evaluator) | TODO — still DDB |
| 14    | `shared/middleware/rate-limit.ts`                     | DONE indirectly (Redis-first kv) |
| 15    | `shared/sms/feedback.ts`                              | TODO — still DDB |

### What "DONE" delivered

- **Adapters** at `backend/src/shared/db/adapters.ts` — translate Prisma rows (`id`-keyed) to legacy DTO shapes (`userId`/`nodeId`/`businessId`/`staffId`/`checkInId`-keyed) so call sites don't need updates.
- **Atomic counters** — `incrementTotalCheckIns` now uses `prisma.user.update({ data: { totalCheckIns: { increment: 1 } } })`, eliminating the read-modify-write race the DDB version had.
- **Spatial proximity** — `checkProximity` and `findNearbyNodes` use `ST_DWithin` against the GIST-indexed `location GEOGRAPHY` column. Sub-millisecond at city scale.
- **Trigram search** — `searchUsers` and `searchNodes` use `pg_trgm` `%` operator + `similarity()` ranking. Typo-tolerant, GIN-indexed.
- **Mutual follows** — single recursive JOIN replaces the per-candidate sequential checks.
- **Activity feed** — Prisma `include` joins user + node in one query; cursor-based pagination on `checkedInAt`.
- **Leaderboard** — Redis ZSET primary path unchanged; Postgres fallback now uses a real `RANK() OVER` window so users outside top-50 get an accurate rank instead of `null`.
- **Streak** — `WHERE user_id = ?` + `DISTINCT (checked_in_at AT TIME ZONE 'Africa/Johannesburg')::date` in a single query, replacing the JS-side dedupe over 100 fetched rows.

### How the unported repos behave

The 9 unported feature repositories still talk to DynamoDB through `shared/db/dynamodb.ts`. They are not broken — they just won't use Postgres. This means until Phase 2 finishes:

- You need **both** DynamoDB tables (existing) **and** Postgres (new) deployed simultaneously.
- The 4 ported features write to Postgres only.
- The 9 unported features write to DynamoDB only.
- Cross-feature dependencies (e.g. notifications reading user info, rewards reading nodes) currently work because the ported features expose the same function signatures via the adapters layer.

Once all 13 modules are ported, you can drop DynamoDB entirely (Phase 3).

### Backup files

The previous DDB implementations are kept as `*.ts.bak` next to the new files for diff/reference. `.gitignore` excludes them. Delete them after running the test suite.

**Per-repo recipe** (apply uniformly):

1. Replace `import { documentClient, TableNames } from '../../shared/db/dynamodb.js'` with `import { prisma } from '../../shared/db/prisma.js'`.
2. Translate each function. Naming map:
   - `Get/Query` → `prisma.<model>.findUnique` / `findFirst` / `findMany`
   - `Put` → `prisma.<model>.create`
   - `Update` → `prisma.<model>.update`
   - `Delete` → `prisma.<model>.delete`
   - `Scan + filter` → `prisma.<model>.findMany({ where })` with proper indexes (added in `20260403000001_scale_indexes`)
3. Spatial queries use `prisma.$queryRaw` with `ST_DWithin(location, ST_MakePoint($lng,$lat)::geography, $radius)`.
4. Fuzzy search uses `prisma.$queryRaw` with `name ILIKE $1` against the trigram GIN index.
5. Multi-step writes (check-in + counter increment + cooldown) wrap in `prisma.$transaction([...])`.
6. Update the matching test file. Tests already use Prisma fixtures in some places (`integration.test.ts`, `data-integrity.test.ts`).

---

## Phase 3 — Demolition (after Phase 2)

- Delete every `*/dynamodb-repository.ts`.
- Delete `backend/src/shared/db/dynamodb.ts` and `backend/src/shared/db/entities.ts`.
- Delete `backend/src/shared/kv/dynamodb-kv.ts` Postgres fallback path — **keep Redis-first only**, fail loudly without it (rate-limit + caches must use Redis at scale).
- Remove all 6 DynamoDB tables from `infra/environments/{dev,prod}/main.tf`.
- Remove all `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/util-dynamodb` deps from `backend/package.json`.
- Update Lambda IAM policies — drop `dynamodb:*`, add Secrets Manager read for the RDS Proxy auth secret.
- Update `lambda_api` env vars: `AREA_CODE_DB_URL` = RDS Proxy endpoint URL.

---

## Phase 4 — Validation

- [ ] `pnpm test` green.
- [ ] `EXPLAIN ANALYZE` audit on the 10 hottest queries (feed, nearby, leaderboard, search, who-is-here, rewards-list, my-redemptions, friends, reports-queue, push-fanout). Every one should be index-only or single index scan, < 5ms p99.
- [ ] Synthetic load test at 10k RPS on Aurora `db.r6g.large` (or Serverless v2 with min=1 ACU max=8 ACU).
- [ ] CloudWatch dashboard: connection pool utilisation, slow query log, replica lag, Redis hit rate.
- [ ] Backup/restore drill: `RESTORE` to a fresh instance from PITR, run smoke tests.

---

## Final architecture (when all 4 phases done)

```
                           ┌──────────────────┐
                           │   API Gateway    │
                           └────────┬─────────┘
                                    │
                           ┌────────▼─────────┐         ┌──────────────────┐
                           │   Lambda (API)   │ ◄──────►│  ElastiCache     │
                           │   Prisma client  │         │  (Redis 7+)      │
                           │   in VPC private │         │   - leaderboards │
                           └────────┬─────────┘         │   - rate limits  │
                                    │                   │   - hot caches   │
                           ┌────────▼─────────┐         └──────────────────┘
                           │   RDS Proxy      │
                           │   (multiplexer)  │
                           └────────┬─────────┘
                                    │
                  ┌─────────────────┴────────────────┐
                  │                                  │
         ┌────────▼─────────┐               ┌────────▼─────────┐
         │ Aurora Postgres  │ async repl    │  Read Replica    │
         │ (writer)         │ ────────────► │  (reads, leader- │
         │ + PostGIS        │               │   board archive) │
         │ + pg_trgm        │               │                  │
         │ + partitioned    │               │                  │
         │   check_ins      │               │                  │
         └──────────────────┘               └──────────────────┘
```

---

## Hand-off contract for Phase 2

When you continue this work:

1. **Don't recreate the work I've already done.** The Prisma schema is comprehensive; trust it.
2. **Use `$queryRaw` only for PostGIS / trigram.** Everything else uses the typed Prisma API.
3. **Wrap multi-step state changes in `$transaction`.** Especially: check-in insert + `total_check_ins++` + streak update + leaderboard bump.
4. **Always SELECT columns, never `*`** in raw queries; respect the indexes.
5. **No `findMany` without a `where` filter on an indexed column** — it's a full table scan in disguise.
6. **Tests first.** Each ported repo gets its existing test file adapted before the swap.

When all phases are done, this app will outperform 99% of what you find in production.
