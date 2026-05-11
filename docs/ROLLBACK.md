# Rollback Procedures

For the live-incident playbook, see `RUNBOOK.md`. This doc covers the rollback mechanics in more detail.

## Lambda Functions

Every deploy via `scripts/deploy-serverless.{ps1,sh}` calls `aws lambda update-function-code ... --publish`, which mints an immutable version. To roll back:

```bash
# List the last 5 versions
aws lambda list-versions-by-function \
  --function-name area-code-prod-api \
  --query 'Versions[-5:].[Version,LastModified,Description]' \
  --output table

# Option A — point the `live` alias at the prior version
aws lambda update-alias \
  --function-name area-code-prod-api \
  --name live \
  --function-version <VERSION>

# Option B — re-upload the previous zip (when you still have it on disk)
aws lambda update-function-code \
  --function-name area-code-prod-api \
  --zip-file fileb://path/to/previous.zip \
  --publish
```

`rollback-v39.zip` at the repo root is a known-good pre-serverless-cleanup bundle kept for emergency re-upload.

## DynamoDB

All tables have `point_in_time_recovery { enabled = true }`, which lets you restore to any second in the last 35 days. This creates a new table — you have to swap the env var on the Lambda to the restored table, or copy data back.

```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name area-code-prod-checkins \
  --target-table-name area-code-prod-checkins-restored-$(date +%Y%m%d) \
  --restore-date-time $(date -u -d '1 hour ago' +%FT%TZ)
```

For full-table blast-radius events, restore to a new table, validate the data, then either:

1. Re-point the Lambda env var (fast, but table name drifts from the canonical one), or
2. Use DynamoDB Streams + a one-off migration Lambda to replay the restored table back into the original.

## Frontend (Amplify)

Amplify keeps build history per app. Rollback in the console:

1. Amplify console → pick the app (web / business / staff / admin).
2. Click `master` branch.
3. Pick the last green deployment and hit **Redeploy this version**.

No CLI equivalent worth scripting — the console path is fast.

## Infrastructure (Terraform)

Revert the offending commit, then apply:

```bash
git revert <commit-sha>
./scripts/deploy-serverless.ps1 -Environment prod -TerraformOnly
```

For changes that touch Route53, ACM, or custom domains, expect DNS propagation delays on the order of minutes.

## What Is Not Rollable

- **Secrets rotation**: rotating a secret in Secrets Manager is one-way; the old value is gone once you overwrite it. Keep a copy in your local password manager for the window when you need to deploy both old and new side by side.
- **Deleted DynamoDB items**: once a `DeleteItem` runs, the only recovery is PITR restore to a new table (see above). There is no item-level undo.
- **Sent SMS / push notifications**: once dispatched, cannot be clawed back.
