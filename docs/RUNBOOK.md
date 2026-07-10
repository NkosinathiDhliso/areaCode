# Incident Runbook

This doc is for the on-call engineer dealing with a live production incident. Everything referenced here exists in `us-east-1`.

## First 60 Seconds

1. **Is the API alive?**

   ```bash
   curl -fsS https://api.areacode.co.za/health
   # Expected: {"status":"ok","env":"prod","version":"0.0.1","timestamp":"..."}
   ```

2. **What does the user see?** Open <https://areacode.co.za> and reproduce. 500s usually mean Lambda errors; 403 from CORS means the origin is not in the allow list.

3. **Which alarm fired?** Check CloudWatch alarms in `us-east-1`. The ones that page:
   - `area-code-prod-api-errors`
   - `area-code-prod-api-duration-p99`
   - `area-code-prod-api-throttles`
   - `area-code-prod-dynamo-<table>-throttles`
   - `area-code-prod-dynamo-<table>-system-errors`
   - `area-code-prod-sqs-reward-eval-dlq`
   - `area-code-prod-api-health` (Route53 health check)

## Frontend Crashes and Errors

Frontend crash and JS error triage lives in the **CloudWatch RUM console** (`us-east-1` → CloudWatch → RUM). There are four app monitors, one per SPA:

- `area-code-prod-web` (consumer)
- `area-code-prod-business`
- `area-code-prod-staff`
- `area-code-prod-admin`

Each monitor's Errors tab shows `JsErrorCount` and session counts. The auto-rollback gate (`release-health-gate.yml`) reads these same monitors; see `ROLLBACK.md`. RUM writes to CloudWatch Logs only (no analytics cookies, POPIA-friendly). Sentry is no longer used for any frontend or backend monitoring.

## Funnel Readout

Usage events are emitted from the API Lambda as CloudWatch Embedded Metric Format (EMF) log lines (`backend/src/features/events/service.ts`). CloudWatch Logs parses them into metrics with no `PutMetricData` call and no extra infrastructure:

- Namespace: `AreaCode/Usage`
- Metric: `Count` (Unit `Count`)
- Dimension: `event` (the only dimension; the event name is the value)

The ten event names: `auth_gate_shown`, `signup_started`, `signup_completed`, `venue_selected`, `checkin_cta_shown`, `checkin_completed`, `beam_tap`, `zoom_commit`, `firstget_token_entered`, `firstget_token_redeemed`.

### Funnels

| Funnel               | Steps                                                        | Answers                                       |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Constellation (gate) | `beam_tap` → `zoom_commit` → `checkin_completed`             | Does Phase A lift the country-zoom ship gate? |
| Signup               | `auth_gate_shown` → `signup_started` → `signup_completed`    | Where do new accounts drop off?               |
| Check-in             | `venue_selected` → `checkin_cta_shown` → `checkin_completed` | Where do check-ins drop off?                  |
| First-Get            | `firstget_token_entered` → `firstget_token_redeemed`         | Do casual-customer tokens convert?            |

The Constellation funnel is the ship gate from `constellation-mode.md`: measure `beam_tap → zoom_commit → checkin_completed`, not time spent sweeping. If Phase A does not lift this funnel, do not stack more spectacle.

### Option A: CloudWatch metric math (dashboard or Metrics console)

In CloudWatch → Metrics → source view, paste these. Each `SEARCH` sums one event's `Count` per period; the `mN/m1*100` lines give step-to-step conversion percentages. Set the period to `1 day` and the statistic to `Sum`.

Constellation funnel:

```
m1 = SEARCH('{AreaCode/Usage,event} MetricName="Count" event="beam_tap"', 'Sum', 86400)
m2 = SEARCH('{AreaCode/Usage,event} MetricName="Count" event="zoom_commit"', 'Sum', 86400)
m3 = SEARCH('{AreaCode/Usage,event} MetricName="Count" event="checkin_completed"', 'Sum', 86400)
zoom_rate  = m2 / m1 * 100
checkin_rate = m3 / m2 * 100
gate_rate  = m3 / m1 * 100
```

Swap the `event="..."` values for the other funnels. Signup: `auth_gate_shown`, `signup_started`, `signup_completed` with `signup_completed / auth_gate_shown * 100` as the overall conversion. Check-in: `venue_selected`, `checkin_cta_shown`, `checkin_completed`. First-Get: `firstget_token_entered`, `firstget_token_redeemed` with `firstget_token_redeemed / firstget_token_entered * 100`.

### Option B: CloudWatch Logs Insights (copy-pasteable)

Run against the API Lambda log group `/aws/lambda/area-code-prod-api`. This parses the EMF lines directly and returns one row per event with its total count for the selected time range:

```
fields event, Count
| filter ispresent(event) and ispresent(Count)
| stats sum(Count) as total by event
| sort event asc
```

To read a single funnel, filter to its events (Constellation shown):

```
fields event, Count
| filter event in ["beam_tap", "zoom_commit", "checkin_completed"]
| stats sum(Count) as total by event
```

Conversion is one step's total divided by the previous step's total (e.g. `signup_completed / auth_gate_shown` for signup, `checkin_completed / beam_tap` for the Constellation gate). Read the totals from the query above and divide.

## Key CloudWatch Log Groups

| Log group                                             | What's in it                                |
| ----------------------------------------------------- | ------------------------------------------- |
| `/aws/lambda/area-code-prod-api`                      | Fastify app (all HTTP)                      |
| `/aws/lambda/area-code-prod-websocket`                | WebSocket connect/disconnect                |
| `/aws/lambda/area-code-prod-reward-evaluator`         | Reward SQS worker                           |
| `/aws/lambda/area-code-prod-report-dispatcher`        | Weekly/monthly report kickoff               |
| `/aws/lambda/area-code-prod-report-generator`         | Per-business report worker                  |
| `/aws/lambda/area-code-prod-pulse-decay`              | Pulse decay cron                            |
| `/aws/lambda/area-code-prod-leaderboard-reset`        | Weekly leaderboard reset                    |
| `/aws/lambda/area-code-prod-partition-manager`        | Daily partition housekeeping                |
| `/aws/lambda/area-code-prod-cleanup`                  | Daily cleanup cron                          |
| `/aws/lambda/area-code-prod-schedule-transition-tick` | Live-vibe music schedule tick (minute cron) |
| `/aws/apigateway/area-code-prod`                      | API Gateway access logs                     |

Yoco payment webhooks log inside the API Lambda group: `POST /v1/webhooks/yoco`
is served by the monolith (the dedicated yoco-webhook Lambda was deleted
2026-07-10; it only ever ran the infra placeholder).

## Key DynamoDB Tables

| Table                                  | What's in it                               |
| -------------------------------------- | ------------------------------------------ |
| `area-code-prod-users`                 | Consumer and portal user records           |
| `area-code-prod-nodes`                 | Venues / nodes                             |
| `area-code-prod-checkins`              | Check-in events                            |
| `area-code-prod-rewards`               | Rewards and redemption codes               |
| `area-code-prod-businesses`            | Business accounts and subscriptions        |
| `area-code-prod-presence`              | Live presence (honest count)               |
| `area-code-prod-music-schedules`       | Live-vibe music schedules (MusicSchedules) |
| `area-code-prod-app-data`              | Generic KV store, cities, rate limits      |
| `area-code-prod-websocket-connections` | WebSocket connection tracking              |

Tail a log group:

```bash
aws logs tail /aws/lambda/area-code-prod-api --follow --since 10m
```

## Rollback a Bad Deploy

The quick-deploy script publishes a new Lambda version every time. To roll back to a known good version:

```bash
# 1. Find the previous version you trust
aws lambda list-versions-by-function --function-name area-code-prod-api \
  --query 'Versions[-5:].[Version,LastModified,Description]' --output table

# 2. Point the `live` alias at it
aws lambda update-alias --function-name area-code-prod-api \
  --name live --function-version <VERSION>
```

If the alias is not wired, re-upload the last good zip:

```powershell
aws lambda update-function-code `
  --function-name area-code-prod-api `
  --zip-file fileb://rollback-v39.zip `
  --publish
```

Frontend rollback: Amplify console → app → `master` branch → redeploy a prior build.

## Disable a Misbehaving Feature

Most feature gates live in Lambda env vars. Toggle without a redeploy:

```bash
aws lambda get-function-configuration --function-name area-code-prod-api \
  --query 'Environment.Variables' --output json > /tmp/env.json

# Edit /tmp/env.json, then:
aws lambda update-function-configuration --function-name area-code-prod-api \
  --environment "Variables=$(cat /tmp/env.json | jq -c .)"
```

Known flags: `AREA_CODE_FORCE_LIVE`, `AREA_CODE_ENV`, `AREA_CODE_QR_HMAC_SECRET`.

## Common Failure Modes

**DynamoDB `ProvisionedThroughputExceededException` / ThrottledRequests alarm.**
Tables are `PAY_PER_REQUEST`, so throttling implies a hot partition. Check `NodeIndex` / `UserIndex` for skew. Short-term: add a client-side retry with jitter. Longer: revisit the partition key or add a random suffix.

**API Lambda p99 > 10s.**
Cold start on a function with many dependencies, or a DynamoDB slow path. Confirm with X-Ray (tracing is Active on the API Lambda). If cold-start driven, consider provisioned concurrency on the `live` alias.

**SQS DLQ has messages.**
The consumer has failed `maxReceiveCount` times. Read the first message, reproduce locally, fix the code, redeploy via the Release Ritual in `docs/DEPLOY.md` (the single ordered command list for any prod deploy), then re-drive:

```bash
# Peek at a DLQ message
aws sqs receive-message --queue-url <DLQ_URL> --max-number-of-messages 1

# After a fix, re-drive (copy DLQ back to main queue)
aws sqs start-message-move-task \
  --source-arn <DLQ_ARN> \
  --destination-arn <MAIN_QUEUE_ARN>
```

**Route53 health check red but `/health` returns ok from your laptop.**
Check if the health check is hitting the custom domain or the raw API Gateway URL. Route53 hits `api.areacode.co.za` directly. If the cert or the custom domain mapping is broken, traffic works but the health check fails.

**Cognito `NotAuthorizedException` on new logins.**
Usually the CUSTOM_AUTH Lambda trigger is erroring. Tail `/aws/lambda/area-code-prod-cognito-<pool>-define-auth` and the create/verify siblings.

**Image upload returns 403.**
Presigned URL was generated with the wrong bucket or `ContentType` does not match. Check `AREA_CODE_S3_MEDIA_BUCKET` on the API Lambda env vars; the code now reads `AREA_CODE_S3_MEDIA_BUCKET` first and falls back to `MEDIA_BUCKET`.

## PITR Restore Rehearsal

Point-in-time recovery is enabled in Terraform on every DynamoDB table in both dev and prod (`point_in_time_recovery { enabled = true }` in `infra/environments/{dev,prod}/main.tf`). This rehearsal proves a restore works end to end against a dev table before we ever need it in prod. Run it in the dev account, `us-east-1`.

The rehearsal restores `area-code-dev-users` to a point 15 minutes ago into a new table, verifies one row survived, then deletes the restored table. It never touches the source table and never restores over it.

### 1. Precondition: confirm PITR is enabled on the source table

```bash
aws dynamodb describe-continuous-backups \
  --table-name area-code-dev-users \
  --region us-east-1 \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus'
# Expected: "ENABLED"
```

If this returns `DISABLED`, stop. A restore is impossible without PITR. It is defined in `infra/environments/dev/main.tf` on the `users` table, so re-run `terraform plan` / `terraform apply` for the dev environment to reconcile before rehearsing.

### 2. Note a known row to verify later

Grab one existing `userId` from the source table so step 4 can confirm it came back. The users table key is `userId` (string), no sort key.

```bash
aws dynamodb scan \
  --table-name area-code-dev-users \
  --region us-east-1 \
  --max-items 1 \
  --projection-expression userId \
  --query 'Items[0].userId.S' --output text
# Copy the printed userId for step 4.
```

### 3. Restore to a point in time (T-15min) into a new table

Never reuse the source name. The target is a throwaway `-pitr-rehearsal` table.

bash (GNU date):

```bash
RESTORE_TIME=$(date -u -d '-15 minutes' +%Y-%m-%dT%H:%M:%SZ)

aws dynamodb restore-table-to-point-in-time \
  --source-table-name area-code-dev-users \
  --target-table-name area-code-dev-users-pitr-rehearsal \
  --restore-date-time "$RESTORE_TIME" \
  --region us-east-1
```

PowerShell:

```powershell
$RestoreTime = (Get-Date).ToUniversalTime().AddMinutes(-15).ToString("yyyy-MM-ddTHH:mm:ssZ")

aws dynamodb restore-table-to-point-in-time `
  --source-table-name area-code-dev-users `
  --target-table-name area-code-dev-users-pitr-rehearsal `
  --restore-date-time $RestoreTime `
  --region us-east-1
```

### 4. Wait for ACTIVE, then verify row-level recovery

The restored table starts in `CREATING`. Wait for it, then read the row from step 2.

```bash
aws dynamodb wait table-exists \
  --table-name area-code-dev-users-pitr-rehearsal \
  --region us-east-1

aws dynamodb get-item \
  --table-name area-code-dev-users-pitr-rehearsal \
  --region us-east-1 \
  --key '{"userId":{"S":"<userId-from-step-2>"}}'
# Expected: the same item that exists in the source table. Recovery verified.
```

PowerShell mangles inline JSON for the AWS CLI (see Common gotchas in `tech.md`), so pass the key from a file instead of inline:

```powershell
'{"userId":{"S":"<userId-from-step-2>"}}' | Out-File -Encoding ascii key.json

aws dynamodb wait table-exists `
  --table-name area-code-dev-users-pitr-rehearsal `
  --region us-east-1

aws dynamodb get-item `
  --table-name area-code-dev-users-pitr-rehearsal `
  --region us-east-1 `
  --key file://key.json
```

### 5. Tear down the restored table

Delete the rehearsal table so it does not linger or cost anything (serverless-only budget). Delete the rehearsal table only, never the source.

```bash
aws dynamodb delete-table \
  --table-name area-code-dev-users-pitr-rehearsal \
  --region us-east-1
```

Confirm it is gone (and that the source is untouched):

```bash
aws dynamodb list-tables --region us-east-1 \
  --query "TableNames[?contains(@, 'area-code-dev-users')]"
# Expected: ["area-code-dev-users"] only. No -pitr-rehearsal entry.
```

### Rehearsal record

Founder fills this in after a live run. Status: pending.

| Field                  | Value                              |
| ---------------------- | ---------------------------------- |
| Date rehearsed         | pending                            |
| Restore point (UTC)    | pending                            |
| Source table           | area-code-dev-users                |
| Restored table         | area-code-dev-users-pitr-rehearsal |
| Row verified (userId)  | pending                            |
| Restored table deleted | pending                            |

## Ops_Log

Record of every one-time script and backfill: what it does, which environment,
when it ran, who ran it, and the outcome (or PENDING). A one-time script is any
migration, backfill, seed, or config bump that runs by hand rather than on a
schedule or in a deploy.

Rule (definition of done): any new one-time script or backfill MUST add a row to
this table as part of its own change. A script that has run but is not recorded
here is treated as not run, because "did we ever run it?" then has no answer.

| Script                                                                                  | Purpose                                                                                                                                                 | Environment | Date run                          | Run by                        | Outcome                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/seed-demo-venues.ps1`                                                          | Seed Area Code demo venues so Johannesburg clears the 5-node launch floor with margin                                                                   | prod        | 2026-07-05                        | founder                       | Done. Braamfontein Beans and Maboneng Social created; Johannesburg at 7 active paid-tier nodes. See GO_LIVE_CHECK_RESULT.                                                                                                                                                                                                                                                 |
| `scripts/claim-demo-venues.ps1`                                                         | Rename the three placeholder demo venues and publish one live get each so every venue reads honestly                                                    | prod        | 2026-07-05                        | founder                       | Done. Plato coffe to Plato Coffee Co., Hi to Hive Kitchen, RuleRev to Revolver Eatery; one `nth_checkin` get on each of the five demo venues. See GO_LIVE_CHECK_RESULT.                                                                                                                                                                                                   |
| Consent version bump (`AREA_CODE_CONSENT_VERSION` in `infra/environments/dev/main.tf`)  | Raise the consent version so new consents record it and the admin re-consent list captures pre-bump users                                               | dev         | staged 2026-07-05, deploy pending | pending                       | v1.0 to v1.1 staged in dev `main.tf`; the dev deploy that applies it is founder-run and not yet executed. See the "Task 7.1 verification" note in GO_LIVE_CHECK_RESULT.                                                                                                                                                                                                   |
| Consent version bump (`AREA_CODE_CONSENT_VERSION` in `infra/environments/prod/main.tf`) | Same, for prod                                                                                                                                          | prod        | PENDING                           | pending                       | Not run. Tracked as `release-quality-and-ops-hygiene` task 7.2, in its own window.                                                                                                                                                                                                                                                                                        |
| `backend/src/scripts/backfill-user-locks.ts`                                            | Write `EMAIL#`/`SUB#` uniqueness locks for users created before transactional locks existed, so duplicate emails/subs are impossible table-wide         | prod        | 2026-07-10                        | agent (deployment-parity 6.5) | Done. Dry run then apply: 26 real users, 26 email/sub lock sets now complete (first apply wrote 14 email + 12 sub locks; the rest pre-existed from transactional signups). Zero real duplicate emails or subs. The first apply misreported same-user locks as duplicates because `existingLockOwner` used a Scan with Limit 1; fixed to a keyed GetCommand, re-run clean. |
| `backend/src/scripts/backfill-user-search.ts`                                           | Write people-search index attributes (`usernameLower` etc.) for users created before the search GSIs existed, so they appear in `/v1/users/search`      | prod        | 2026-07-10                        | agent (deployment-parity 6.5) | Done. Dry run then apply: 70 rows scanned, 26 real users, 24 indexed, 0 cleared, 2 skipped (nothing to index).                                                                                                                                                                                                                                                            |
| DLQ redrive `area-code-prod-reward-eval-dlq`                                            | Redrive 3 poisoned check-in evaluations from 2026-07-09 (old evaluator artifact crashed on missing `CONNECTIONS_TABLE`; fixed by the 2026-07-10 deploy) | prod        | PENDING                           | pending                       | Founder-run: `aws sqs start-message-move-task --source-arn arn:aws:sqs:us-east-1:562691664641:area-code-prod-reward-eval-dlq`. See the 2026-07-10 record in GO_LIVE_CHECK_RESULT.                                                                                                                                                                                         |

### Prod backfills (run 2026-07-10, re-runnable)

Both backfills ran clean in prod on 2026-07-10 (outcomes in the table above).
The commands stay recorded because both scripts are idempotent and
non-destructive (locks are written with `attribute_not_exists`; the search
backfill only sets or clears derived attributes), so a dry run then an apply is
safe to repeat, e.g. after a table restore. They need the same AWS credentials
and `USERS_TABLE` the prod API Lambda uses. Run from the repo root, then record
the outcome in the table above.

```powershell
$env:AWS_PROFILE = "areacode-prod"        # prod credentials, account 562691664641
$env:AWS_REGION  = "us-east-1"
$env:USERS_TABLE = "area-code-prod-users"

# 1) user locks: dry run first (no writes), then apply
pnpm --filter backend backfill:user-locks --dry-run
pnpm --filter backend backfill:user-locks

# 2) search index: dry run first (no writes), then apply
pnpm --filter backend backfill:user-search --dry-run
pnpm --filter backend backfill:user-search
```

The lock backfill logs any duplicate email/sub it finds (the second writer is
refused) so an operator can merge those accounts by hand; capture that output in
the Outcome cell. Both scripts print a summary (rows scanned, locks or index
attributes written) that is the outcome to record.

## Escalation

- Primary on-call: see `alerts@areacode.co.za` distribution list.
- AWS Support: Basic plan, case link via console. Upgrade to Developer if the business-impacting issue is AWS-side.
- Amplify deploys: check the Amplify console for the affected app.

## What Not To Do

- **Never** apply `terraform destroy` without an explicit plan review.
- **Never** edit `infra/environments/prod/terraform.tfvars` in a PR diff — it holds secrets that must not land in git.
- **Never** re-enable ECS, RDS, ElastiCache, ALB, or NAT Gateway. The serverless guard will block the merge; the warning is there for a reason.
