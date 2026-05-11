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
   - `area-code-prod-sqs-push-sender-dlq`
   - `area-code-prod-api-health` (Route53 health check)

## Key CloudWatch Log Groups

| Log group                                      | What's in it                  |
| ---------------------------------------------- | ----------------------------- |
| `/aws/lambda/area-code-prod-api`               | Fastify app (all HTTP)        |
| `/aws/lambda/area-code-prod-websocket`         | WebSocket connect/disconnect  |
| `/aws/lambda/area-code-prod-reward-evaluator`  | Reward SQS worker             |
| `/aws/lambda/area-code-prod-report-dispatcher` | Weekly/monthly report kickoff |
| `/aws/lambda/area-code-prod-report-generator`  | Per-business report worker    |
| `/aws/lambda/area-code-prod-pulse-decay`       | Pulse decay cron              |
| `/aws/lambda/area-code-prod-leaderboard-reset` | Weekly leaderboard reset      |
| `/aws/lambda/area-code-prod-partition-manager` | Daily partition housekeeping  |
| `/aws/lambda/area-code-prod-cleanup`           | Daily cleanup cron            |
| `/aws/lambda/area-code-prod-yoco-webhook`      | Yoco payment webhooks         |
| `/aws/apigateway/area-code-prod`               | API Gateway access logs       |

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

Known flags: `AREA_CODE_FORCE_LIVE`, `AREA_CODE_ENV`, `SENTRY_DSN` (blanking disables Sentry), `AREA_CODE_QR_HMAC_SECRET`.

## Common Failure Modes

**DynamoDB `ProvisionedThroughputExceededException` / ThrottledRequests alarm.**
Tables are `PAY_PER_REQUEST`, so throttling implies a hot partition. Check `NodeIndex` / `UserIndex` for skew. Short-term: add a client-side retry with jitter. Longer: revisit the partition key or add a random suffix.

**API Lambda p99 > 10s.**
Cold start on a function with many dependencies, or a DynamoDB slow path. Confirm with X-Ray (tracing is Active on the API Lambda). If cold-start driven, consider provisioned concurrency on the `live` alias.

**SQS DLQ has messages.**
The consumer has failed `maxReceiveCount` times. Read the first message, reproduce locally, fix the code, redeploy, then re-drive:

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

## Escalation

- Primary on-call: see `alerts@areacode.co.za` distribution list.
- AWS Support: Basic plan, case link via console. Upgrade to Developer if the business-impacting issue is AWS-side.
- Amplify deploys: check the Amplify console for the affected app.

## What Not To Do

- **Never** apply `terraform destroy` without an explicit plan review.
- **Never** edit `infra/environments/prod/terraform.tfvars` in a PR diff — it holds secrets that must not land in git.
- **Never** re-enable ECS, RDS, ElastiCache, ALB, or NAT Gateway. The serverless guard will block the merge; the warning is there for a reason.
