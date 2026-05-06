# DynamoDB GSI Additions for 1M-User Scale

These GSIs are required by the new repository code in `backend/src/`.
Code falls back to Scan with a `console.warn` when a GSI is missing, so deployment
order is safe — apply Terraform first, then deploy backend.

Apply to **both** `infra/environments/dev/main.tf` and `infra/environments/prod/main.tf`.

---

## 1. `users` table — add `UsernameLowerIndex` and `PhoneIndex`

Used by:
- `searchUsers()` in `backend/src/features/social/repository.ts`
- `getUserByPhone()` in `backend/src/features/auth/dynamodb-repository.ts`

### Required write-side change

When creating/updating a user, also write `usernameLower = username.toLowerCase()`.
Add this in `backend/src/features/auth/dynamodb-repository.ts` `createUser()` /
`updateUser()` (single-line: `usernameLower: data.username?.toLowerCase()`).

### Terraform diff

```hcl
resource "aws_dynamodb_table" "users" {
  name         = "area-code-${local.env}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute { name = "userId"        type = "S" }
  attribute { name = "email"         type = "S" }
  attribute { name = "cognitoSub"    type = "S" }

  # ── ADD ──────────────────────────────────────────────────────────────────
  attribute { name = "usernameLower" type = "S" }
  attribute { name = "phone"         type = "S" }
  # ─────────────────────────────────────────────────────────────────────────

  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "CognitoIndex"
    hash_key        = "cognitoSub"
    projection_type = "ALL"
  }

  # ── ADD ──────────────────────────────────────────────────────────────────
  global_secondary_index {
    name            = "UsernameLowerIndex"
    hash_key        = "usernameLower"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "PhoneIndex"
    hash_key        = "phone"
    projection_type = "KEYS_ONLY"   # only need userId; full projection wastes WCU
  }
  # ─────────────────────────────────────────────────────────────────────────

  point_in_time_recovery { enabled = true }
  tags = { Environment = local.env }
}
```

---

## 2. `nodes` table — add `Geohash5Index` and `SlugIndex`

Used by:
- `findNearbyNodes()` in `backend/src/features/nodes/dynamodb-repository.ts`
- `getNodeBySlug()` (pending refactor — currently still scans)

### Write-side: already done

`createNode()` now writes `geohash5` and `geohash7` automatically (see commit).
For the existing rows, run a one-time backfill (script below).

### Terraform diff

```hcl
resource "aws_dynamodb_table" "nodes" {
  name         = "area-code-${local.env}-nodes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "nodeId"

  attribute { name = "nodeId"     type = "S" }
  attribute { name = "businessId" type = "S" }
  attribute { name = "location"   type = "S" }

  # ── ADD ──────────────────────────────────────────────────────────────────
  attribute { name = "geohash5"   type = "S" }
  attribute { name = "geohash7"   type = "S" }
  attribute { name = "slug"       type = "S" }
  # ─────────────────────────────────────────────────────────────────────────

  global_secondary_index {
    name            = "BusinessIndex"
    hash_key        = "businessId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "LocationIndex"
    hash_key        = "location"
    projection_type = "ALL"
  }

  # ── ADD ──────────────────────────────────────────────────────────────────
  global_secondary_index {
    name            = "Geohash5Index"
    hash_key        = "geohash5"
    range_key       = "geohash7"     # enables begins_with(geohash7, prefix)
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "SlugIndex"
    hash_key        = "slug"
    projection_type = "ALL"
  }
  # ─────────────────────────────────────────────────────────────────────────

  point_in_time_recovery { enabled = true }
  tags = { Environment = local.env }
}
```

---

## 3. `businesses` table — add `CognitoIndex` and `EmailIndex`

Used by `getBusinessByCognitoSub()` and `getBusinessByEmail()` which currently Scan.

```hcl
resource "aws_dynamodb_table" "businesses" {
  name         = "area-code-${local.env}-businesses"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "businessId"

  attribute { name = "businessId" type = "S" }
  attribute { name = "ownerId"    type = "S" }

  # ── ADD ──────────────────────────────────────────────────────────────────
  attribute { name = "cognitoSub" type = "S" }
  attribute { name = "email"      type = "S" }
  # ─────────────────────────────────────────────────────────────────────────

  global_secondary_index {
    name            = "OwnerIndex"
    hash_key        = "ownerId"
    projection_type = "ALL"
  }

  # ── ADD ──────────────────────────────────────────────────────────────────
  global_secondary_index {
    name            = "CognitoIndex"
    hash_key        = "cognitoSub"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    projection_type = "ALL"
  }
  # ─────────────────────────────────────────────────────────────────────────

  point_in_time_recovery { enabled = true }
  tags = { Environment = local.env }
}
```

---

## 4. Lambda env: wire `REDIS_URL` from existing secret

The `area-code/${env}/redis-url` secret already exists. Add to the API Lambda
environment in `module "lambda_api"` block:

```hcl
environment_variables = {
  AREA_CODE_ENV = local.env
  USERS_TABLE   = aws_dynamodb_table.users.name
  # ...existing entries...

  # ── ADD ──────────────────────────────────────────────────────────────────
  REDIS_URL = data.aws_secretsmanager_secret_version.redis_url.secret_string
  # ─────────────────────────────────────────────────────────────────────────
}
```

And add the secret data source if it's not already present:

```hcl
data "aws_secretsmanager_secret_version" "redis_url" {
  secret_id = data.aws_secretsmanager_secret.redis_url.id
}
```

For a long-running ECS task, mount it as a task secret instead.

The Lambda **must** be in the VPC that has access to the ElastiCache cluster
(see `infra/modules/elasticache/main.tf`). If the API Lambda is currently
public, attach it to the private subnets and add a SG rule allowing it to
reach the Redis SG on port 6379.

---

## 5. Remove dead Lambda definitions

Delete from both `dev/main.tf` and `prod/main.tf`:

- `module "lambda_run_migration"` (or whatever name) — backend file deleted.
- `module "lambda_partition_manager"` — was a no-op stub, file deleted.
- Their EventBridge rules.

---

## 6. One-time backfill: geohash on existing nodes

Run once after applying the Terraform GSI to populate `geohash5`/`geohash7` on
pre-existing rows. Example script (run with `tsx`):

```ts
// backend/scripts/backfill-geohash.ts
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../src/shared/db/dynamodb.js'
import { encodeGeohash } from '../src/shared/db/geohash.js'

let lastKey: Record<string, unknown> | undefined
let scanned = 0
let updated = 0

do {
  const r = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }),
  )
  for (const item of r.Items ?? []) {
    scanned++
    if (item['geohash5'] && item['geohash7']) continue
    const lat = item['lat'] as number
    const lng = item['lng'] as number
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.nodes,
        Key: { nodeId: item['nodeId'] },
        UpdateExpression: 'SET geohash5 = :g5, geohash7 = :g7',
        ExpressionAttributeValues: {
          ':g5': encodeGeohash(lat, lng, 5),
          ':g7': encodeGeohash(lat, lng, 7),
        },
      }),
    )
    updated++
  }
  lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined
  console.log(`scanned=${scanned} updated=${updated}`)
} while (lastKey)
```

Same pattern for `usernameLower` on the users table.

---

## 7. ElastiCache sizing

For ~1M MAU and the access patterns in this app:

- **ElastiCache Serverless (Redis 7+)** — recommended; scales 0.1→100 GB, pay-per-use.
  - Caches: profile, node, leaderboard ZSETs, rate-limits, sessions.
  - Estimated p50 GET ~1ms, p99 ~3ms.
- Alternatively `cache.r7g.large` ×2 (replication group) if you prefer fixed cost.

Confirm the existing module in `infra/modules/elasticache/main.tf` is provisioning
in the same VPC as the Lambda.

---

## 8. Apply order

1. Apply Terraform (Postgres-side changes none; only DynamoDB GSIs + ElastiCache + Lambda VPC + REDIS_URL).
2. Run backfill scripts.
3. Deploy backend (`pnpm install` to pull `ioredis`, then `pnpm --filter backend build:lambda`).
4. Verify in CloudWatch that the `[social.searchUsers] ... falling back to Scan`
   warning **does not appear** anymore.
