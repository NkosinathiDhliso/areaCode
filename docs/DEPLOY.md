# Deployment Checklist

## Pre-deploy

Run these locally before pushing to `master`:

```powershell
pnpm install
pnpm guard:serverless               # must exit 0
pnpm typecheck                      # must exit 0
pnpm lint                           # must exit 0
pnpm test                           # must pass
pnpm --filter backend build:lambda  # must produce backend/dist/{lambda,websocket,workers}
pnpm --filter web build
pnpm --filter business build
pnpm --filter staff build
pnpm --filter admin build
```

If any of the frontend builds fails, the Amplify build will also fail — fix before pushing.

## Deploy Backend

Full deploy (build + terraform apply + Lambda code push):

```powershell
./scripts/deploy-serverless.ps1 -Environment prod
```

Options:

| Flag                | Effect                                     |
| ------------------- | ------------------------------------------ |
| `-SkipBuild`        | Reuse the existing `backend/dist/` bundle  |
| `-SkipTerraform`    | Deploy Lambda code only (no infra changes) |
| `-TerraformOnly`    | Apply infra only; do not touch Lambda code |
| `-Region us-east-1` | Override region (default `us-east-1`)      |

Quick path for an API-only change:

```powershell
./deploy-api.ps1 -Env prod
```

## Infrastructure Applies via GitHub Actions

`.github/workflows/terraform.yml` runs whenever a push to `master` touches `infra/**`. It applies infrastructure in two legs:

- **Dev** applies automatically. The `apply-dev` job runs `terraform apply -auto-approve` with no gate.
- **Prod** waits for a human. The `apply-prod` job declares the `prod-infra` GitHub environment, which is configured with a required reviewer. It runs only after `apply-dev` succeeds.

### Prod approval flow

1. A push to `master` that changes `infra/**` triggers the workflow.
2. `apply-dev` applies dev automatically.
3. `apply-prod` runs `terraform init` and then `terraform plan`, so the plan is visible in the job output before anything is applied.
4. The job then pauses on the `prod-infra` environment and waits for a required reviewer.
5. A reviewer opens the run in the GitHub Actions UI, reads the surfaced plan, and approves or rejects.
6. On approval the `terraform apply` step runs against prod. On rejection nothing is applied.

Pull requests that touch `infra/**` still run `terraform plan` for both dev and prod and post the result as a PR comment. Only `master` pushes apply.

### Break-glass path

When the workflow is unavailable or an urgent change cannot wait for the approval queue, the canonical scripted path stays available:

```powershell
./scripts/deploy-serverless.ps1 -Environment prod
```

This is the repo's standard prod deploy path (build + terraform apply + Lambda code push). Run `terraform plan` intent applies here too: the script wraps `terraform apply`, so review the plan output it prints before confirming. Use this path deliberately, not as the default, since it bypasses the required-reviewer gate.

## Deploy Frontend

Amplify is wired to the `master` branch of each app. Pushing to `master` triggers a build.

To trigger manual rebuilds (e.g. to pick up new env vars):

```powershell
./scripts/update-all-amplify-apps.ps1
```

If you changed the API URL or any `VITE_*` env var that Amplify reads, run `update-amplify-api-url.ps1` first, then trigger the rebuild.

## Post-deploy Verification

```bash
# 1. Health endpoint
curl -fsS https://api.areacode.co.za/health
# Expected: {"status":"ok","env":"prod",...}

# 2. A read path that touches DynamoDB
curl -fsS https://api.areacode.co.za/v1/nodes/johannesburg | jq '.nodes | length'
# Expected: a non-zero number

# 3. Watch the Lambda for errors for 5 minutes
aws logs tail /aws/lambda/area-code-prod-api --since 5m --follow
```

Portal smoke checks:

- <https://areacode.co.za> — map renders with nodes
- <https://business.areacode.co.za> — login lands on the venue editor
- <https://staff.areacode.co.za> — scan/entry screen loads
- <https://admin.areacode.co.za> — dashboard loads

## Rollback

See `docs/RUNBOOK.md` for the full rollback matrix. Summary:

- **Backend**: re-upload the previous Lambda zip or point the `live` alias at the prior version.
- **Frontend**: Amplify console → redeploy a prior build.
- **Infra**: `git revert` the offending Terraform commit, then `./scripts/deploy-serverless.ps1 -TerraformOnly`.

## Secrets and Variables

Secrets live in AWS Secrets Manager (`area-code/<env>/*`) and in Amplify app environment variables. Never commit:

- `infra/environments/prod/terraform.tfvars`
- `.env`
- `push-env.ps1`

All three are in `.gitignore`. If you need to rotate a secret, use `scripts/deploy-secrets.sh --env prod`.

### Yoco payment secrets

The Yoco keys live in `infra/environments/prod/terraform.tfvars` and are read by `terraform apply` (via `deploy-serverless.ps1`), which sets them as Lambda environment variables. Never commit real values.

| tfvars variable       | Lambda env var         | Source                                                                               |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `yoco_secret_key`     | `YOCO_PROD_SECRET_KEY` | Yoco dashboard > Developers > API keys > Live secret key                             |
| `yoco_webhook_secret` | `YOCO_WEBHOOK_SECRET`  | Yoco dashboard > Developers > Webhooks > the areacode.co.za webhook > Signing secret |

`yoco_webhook_secret` verifies the HMAC signature on every incoming payment webhook. If it is unset or wrong, the API rejects every webhook (fail-closed) and no payment ever activates a tier, so it must be present and correct in prod.

To rotate the webhook secret:

1. In the Yoco dashboard, open the areacode.co.za webhook and regenerate the signing secret.
2. Copy the new value into `yoco_webhook_secret` in `infra/environments/prod/terraform.tfvars`.
3. Apply infra only: `./scripts/deploy-serverless.ps1 -Environment prod -TerraformOnly`.
4. Send a test webhook from the Yoco dashboard and confirm it is accepted (no 401 in `aws logs tail /aws/lambda/area-code-prod-api`).

## First-time Setup

Before the first deploy in a fresh AWS account:

1. Provision GitHub OIDC for deploy role: `scripts/setup-github-oidc.ps1`.
2. Populate Secrets Manager: `scripts/deploy-secrets.sh --env prod`.
3. Exit SNS/SMS sandbox if OTP delivery is in scope (see Pinpoint console).
4. `terraform apply` once from `infra/environments/prod/` to create the stack.
5. Run `./scripts/deploy-serverless.ps1 -Environment prod` to push Lambda code.
