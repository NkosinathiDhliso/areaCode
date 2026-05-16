# Design Document — Churn Defences

## Architecture Overview

Six independent product changes, four touching backend + UI, two UI-or-pipeline only. Each is small enough to ship as its own PR. They share the same constraint: serverless-only, reuse existing tables, respect POPIA.

```
┌──────────────────────────────────────────────────────────────────┐
│                    Existing DynamoDB tables                      │
│  users · nodes · checkins · rewards · app-data                   │
└──────────────────────────────────────────────────────────────────┘
            ▲                           ▲                ▲
            │                           │                │
   ┌────────┴────────┐         ┌────────┴────────┐  ┌───┴────────┐
   │ Threshold_Lock  │         │ Guest_Claim     │  │ Proximity   │
   │ LOCK#user#rwd   │         │ GUESTCLAIM#ph   │  │ Nudge       │
   │ (req 1)         │         │ (req 6)         │  │ (req 4)     │
   └─────────────────┘         └─────────────────┘  └────────────┘
                                                     client-only

   ┌─────────────────────────────────────────┐
   │ Sentry Release Health → GH Actions      │  (req 5)
   │ → re-alias Lambda → Slack alert         │
   └─────────────────────────────────────────┘

   ┌─────────────────────────────────────────┐
   │ Copy-only: T&C clause, profile line,    │  (reqs 2, 3)
   │ rewards screen helper text              │
   └─────────────────────────────────────────┘
```

## Component Design

### 1. Reward-Threshold Grandfathering

**New module:** `backend/src/features/rewards/threshold-lock.ts`

#### Storage

DynamoDB `app-data` table:

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| `pk`              | `LOCK#<userId>#<rewardId>`                                      |
| `sk`              | `LOCK` (single row per pair)                                    |
| `userId`          | UUID                                                            |
| `rewardId`        | UUID                                                            |
| `lockedThreshold` | int — the threshold at the moment of first qualifying check-in  |
| `firstCheckInAt`  | ISO timestamp                                                   |
| `currentVisits`   | int — denormalised counter, incremented per qualifying check-in |
| `ttl`             | epoch — 90 days after reward expiry, for cleanup                |

Single-row writes; no GSI needed.

#### Read path

`getEffectiveThreshold(userId, rewardId)`:

1. Look up `LOCK#<userId>#<rewardId>`. If found, return `min(lockedThreshold, currentReward.threshold)` — the user gets the better of the two.
2. If not found, return `currentReward.threshold`.

#### Write path

In `processCheckIn` (existing code in `backend/src/features/check-in/service.ts`):

- After insertion of the check-in, for each active reward at the venue, check whether the user has a lock row.
- If not, write one with `lockedThreshold = currentReward.threshold`, `currentVisits = 1`.
- If yes, increment `currentVisits`. If `currentReward.threshold < lockedThreshold`, also lower the lock to the new threshold (req 1.4).

#### UI surface

Consumer rewards screen: change "X of Y" calculation to use the locked threshold. Existing component, single-line change.

Business portal reward editor: add a one-line note: _Existing customers stay on their original visit count. Only new customers see the new threshold._

#### Cleanup

The existing cleanup worker (`backend/src/workers/cleanup.ts`) gets a new pass that scans for `LOCK#` rows whose reward no longer exists, or whose `ttl` has passed. Bounded scan, daily.

### 2. Reward Expiry Transparency

UI-only. Two changes to `apps/web/src/screens/RewardsScreen.tsx`:

- Add a fixed helper line under the screen title.
- Add a `<CountdownBadge>` component that renders yellow/red based on `expiresAt - now`.

A reward whose `expiresAt < now` is rendered in a separate "Expired" section using the same component but with a "Missed" tone.

### 3. Tier-Permanence Commitment

Three changes:

1. `packages/shared/constants/legal.ts` (new file) exports the canonical clause string. Imported by both the T&Cs screen and the profile screen so they can never drift.
2. The admin service's tier-update endpoints get a guard:

```ts
if (newTier rank < computedTierFromVisits rank) {
  throw AppError.badRequest('tier_downgrade_not_allowed')
}
```

3. The legal clause appears as a subtitle under the tier badge on the consumer profile.

No infrastructure changes.

### 4. GPS-Proximity Check-In Nudge

**Pure client-side** (key POPIA requirement — no coordinates ever leave the device for this feature).

#### State

Existing `apps/web/src/lib/locationStore.ts` already tracks the user's current GPS. We add:

- `lastNudgeAt[nodeId]: timestamp` — in `localStorage`, key `ac:proximity-nudges`.
- `dismissedAt[nodeId]: timestamp` — same.

#### Detection loop

A new hook `usePromixityNudge` in `packages/shared/hooks/`:

```ts
useEffect(() => {
  if (privacyLevel === 'private') return
  if (!proximityEnabled) return

  const interval = setInterval(() => {
    const visited = getVisitedNodes()           // from /v1/users/me/visited (cached)
    for (const node of visited) {
      const dist = haversine(currentLat, currentLng, node.lat, node.lng)
      if (dist <= node.radiusM ?? 80 && shouldFireNudge(node.id)) {
        showBanner(node)
        markFired(node.id)
      }
    }
  }, 60_000)
  return () => clearInterval(interval)
}, [...])
```

#### Cooldown

- 6 hours between nudges for the same venue.
- 24 hours after a dismiss for the same venue.
- Hard cap: 5 nudges per day across all venues.

#### Server contract

Existing `/v1/nodes/{slug}` already returns `lat` and `lng` for the public node listing. No new endpoint needed.

A new endpoint `/v1/users/me/visited` (lightweight wrapper over the existing check-in history) returns `{ items: Array<{ nodeId, lat, lng, radiusM }> }`. No PII change — the consumer already has this data via the history endpoint, this just returns the proximity-relevant subset.

#### Privacy switch

Add a single toggle in profile → privacy settings: "Notify me when I'm at a venue I've visited before". Default ON for `public` and `friends_only`, OFF for `private`.

### 5. Sentry Release-Health Auto-Rollback

**Pipeline-only.** No code changes outside `.github/workflows/`.

#### New workflow: `release-health-gate.yml`

Triggered after `deploy-lambda.yml` completes. Steps:

1. Wait 30 minutes (`sleep 1800` is fine in GitHub Actions; we're well within the 6-hour job limit).
2. Curl Sentry's release-health API:
   ```
   GET https://sentry.io/api/0/organizations/{org}/releases/{releaseVersion}/
   ```
3. Compute `crashFreeUsersDelta = newRelease.crashFreeRate - prevRelease7dAverage`.
4. If `crashFreeUsersDelta < -0.01` OR `errorCount > 5x prevRelease7dAverage`, run:
   ```
   aws lambda update-alias --function-name area-code-prod-api \
       --name live --function-version $PREV_VERSION
   ```
5. POST a Slack webhook with the rollback notice.
6. Tag the commit with `rollback-{ts}` so the same SHA can't be redeployed without explicit override.

#### Secrets needed

- `SENTRY_AUTH_TOKEN` (already exists)
- `SLACK_OPS_WEBHOOK` (new)

### 6. Casual-Customer First-Get Path

#### Storage

DynamoDB `app-data`:

| Field                 | Value                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| `pk`                  | `GUESTCLAIM#<phoneE164>`                                                   |
| `sk`                  | `<rewardId>#<timestamp>`                                                   |
| `phoneE164`           | string                                                                     |
| `rewardId`            | UUID                                                                       |
| `nodeId`              | UUID                                                                       |
| `staffId`             | UUID                                                                       |
| `redeemedAt`          | ISO timestamp                                                              |
| `conversionExpiresAt` | ISO timestamp = `redeemedAt + 30 days`                                     |
| `ttl`                 | epoch — `redeemedAt + 60 days` (gives 30-day grace after window for audit) |

#### Reward field

Existing `Reward` gains `isFirstGet: boolean`. Backed by a new column in the rewards table; default `false`. Business portal exposes a checkbox in the reward editor — only one reward per venue can have `isFirstGet = true`. The service layer enforces uniqueness.

#### Staff redemption flow

`POST /v1/staff/redeem/{code}/preview` already returns reward + consumer info. We add a branch:

- If `code` is for a `isFirstGet` reward AND `request.body.phoneE164` is present (new field) AND no Cognito user exists for that phone, return `{ guestClaim: true, phone, reward, anti_abuse_status }`.
- The staff confirm endpoint creates a `GUESTCLAIM#` row, marks the underlying redemption as redeemed by guest, and emits a metric.

The staff scanner UI gets a new "Phone number" input that becomes visible only when scanning a First-Get reward and the consumer doesn't have an account.

#### Anti-abuse

Two checks before allowing a Guest_Claim:

1. `GUESTCLAIM#<phoneE164>` with the same `nodeId` already exists → reject with `already_claimed_at_venue`.
2. Count of `GUESTCLAIM#<phoneE164>` rows in the last 30 days ≥ 3 → reject with `too_many_guest_claims`.

Both checks are O(1)-ish queries against the partition key.

#### Conversion

When a new user signs up, the Cognito post-confirmation Lambda already exists. We add a step:

```ts
const claims = await getGuestClaimsByPhone(phoneE164)
for (const claim of claims) {
  if (claim.conversionExpiresAt > now) {
    await linkGuestClaimToUser(claim, userId)
    await incrementUserCheckIns(userId, 1)
  }
}
await deleteGuestClaims(phoneE164)
```

#### Leaderboard impact

The existing `staff-leaderboard.ts` reads from `REDEMPTION#` rows. We add `GUESTCLAIM#` rows to the same query, but they only contribute to `redemptions` and `uniqueConsumersServed` — not `attributedReturnVisits`, since we have no userId to track returns.

#### Cleanup

`workers/cleanup.ts` already runs daily. Adds a pass: delete `GUESTCLAIM#` rows whose `ttl` has passed (POPIA: phone number must not be retained beyond Conversion_Window + audit grace).

## Data Flows

### Threshold-lock flow

```
User checks in at venue
        │
        ▼
processCheckIn() [existing]
        │
        ▼
For each active reward at venue:
        │
   ┌────┴────┐
   │ Lock?   │
   └────┬────┘
        │ no                 │ yes
        ▼                    ▼
   Create LOCK#         Increment currentVisits
   currentVisits=1      Lower lockedThreshold if reward.threshold dropped
        │                    │
        └─────────┬──────────┘
                  ▼
        UI reads getEffectiveThreshold()
        and displays "X of Y" using locked Y
```

### Guest-claim flow

```
Walk-in customer
        │ orders coffee, gets pitched the app
        ▼
Staff scans First-Get QR or types code
        │
        ▼
"Phone number?" prompt (because reward.isFirstGet === true)
        │
        ▼
Staff enters customer's phone
        │
        ▼
POST /v1/staff/redeem/{code}/preview { phoneE164 }
        │
        ▼
Service: anti-abuse checks, find or 404 user
        │
        ▼
If no user: respond with { guestClaim: true, ... }
        │
        ▼
Staff confirms
        │
        ▼
Service: insert GUESTCLAIM#phone#reward, mark code redeemed
        │
        ▼
Customer leaves with their freebie, no account yet
        │
        ▼ days later
        ▼
Customer signs up via app — phone matches
        │
        ▼
post-confirmation Lambda finds GUESTCLAIM#phone
        │
        ▼
Links claim to userId, +1 visit credit, deletes claim row
```

### Auto-rollback flow

```
deploy-lambda.yml succeeds
        │
        ▼
release-health-gate.yml triggers
        │
        ▼
sleep 30 min
        │
        ▼
Sentry API: crash-free rate for new vs prev
        │
        ▼
        ┌──── delta < -1% or errors > 5x ────┐
        │                                    │
        ▼ no                                 ▼ yes
   keep alias                          aws lambda update-alias
        │                                    │
        ▼                                    ▼
   write OK marker                    Slack alert + tag commit
                                             │
                                             ▼
                                       block re-deploy until ack
```

## Migration Notes

- **Threshold_Lock**: backfill existing in-flight reward progress lazily on next check-in. We do not need a one-shot migration — the lock is created at first qualifying check-in after deploy. Trade-off: users who had 4 of 5 visits today see their lock created at visit 5 (their next), starting at the new threshold. Accepted because backfill cost outweighs benefit at our current scale.
- **`isFirstGet` column**: defaults to false. No data migration needed.
- **`/v1/users/me/visited`**: read-only wrapper, no migration.

## Testing Strategy

- Property tests for `getEffectiveThreshold` (fast-check exists in repo).
- Unit tests for the rollback decision math.
- An e2e spec under `tests/e2e/tests/consumer/threshold-grandfather.spec.ts` driving the full flow end-to-end on staging.
- Auto-rollback dry-run mode: a workflow_dispatch input `dryRun=true` that runs the decision but skips the alias update, so we can verify the gate before trusting it on a real bad deploy.
