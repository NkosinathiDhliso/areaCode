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

## First-time Setup

Before the first deploy in a fresh AWS account:

1. Provision GitHub OIDC for deploy role: `scripts/setup-github-oidc.ps1`.
2. Populate Secrets Manager: `scripts/deploy-secrets.sh --env prod`.
3. Exit SNS/SMS sandbox if OTP delivery is in scope (see Pinpoint console).
4. `terraform apply` once from `infra/environments/prod/` to create the stack.
5. Run `./scripts/deploy-serverless.ps1 -Environment prod` to push Lambda code.
