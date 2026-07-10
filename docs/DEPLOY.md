# Deployment Checklist

## Release Ritual

This is the single source of truth for a full prod release. It is the exact,
ordered sequence that takes a green working tree to a verified prod. Run the
steps in this order. Every other deploy doc links here rather than restating the
sequence. The supporting sections below cover script flags and one-off paths,
not ordering, so read this list first.

Order matters at each step: a frontend push auto-deploys via Amplify, but the
backend deploys only when `deploy-serverless.ps1` runs, so the backend must
follow the push, and the go-live check must follow the backend.

1. Pre-flight gates, all green before proceeding. For infra changes also run
   `terraform fmt -check -recursive infra/` and `terraform validate` in the
   changed environment.

   ```powershell
   pnpm typecheck
   pnpm test
   pnpm lint
   pnpm guard:serverless
   ```

2. Commit the working tree in reviewable commits. If any in-flight fix is
   incomplete at ship time, list it by name in the commit body as known-pending
   rather than leaving it silent.

   ```powershell
   git add -A
   git commit
   ```

3. Push `master`, then wait for all four Amplify apps (web, business, staff,
   admin) to report SUCCEED on the pushed sha before continuing. A partial set
   of green builds is not done.

   ```powershell
   git push origin master
   ```

4. Set or refresh Amplify env vars only if any `VITE_*` key changed. The script
   merges managed keys over the current app env, so it is safe to run when
   nothing changed. It now manages the Cognito Hosted UI domain and client-id
   keys, `VITE_CDN_URL`, and `VITE_VAPID_PUBLIC_KEY` in addition to the API,
   WebSocket, Mapbox, and RUM keys. Rebuild the apps that gained a key so the
   new value is baked into the bundle.

   ```powershell
   ./scripts/update-all-amplify-apps.ps1
   ```

5. Deploy the backend (build, terraform apply, Lambda code push). Review the
   `terraform plan` the script prints before you confirm the apply. Any
   unexpected destroy is a stop.

   ```powershell
   ./scripts/deploy-serverless.ps1 -Environment prod
   ```

6. Run the go-live check with a fresh authenticated WebSocket token. All gates
   must pass, including Sha_Parity (the API `/health` `commit` matches the
   latest successful Amplify build sha on master), the authenticated WebSocket
   probe, and the table-closure and Amplify-env-closure checks. Without
   `-WsToken` the authenticated socket probe reports SKIPPED, never PASS.

   ```powershell
   ./scripts/go-live-check.ps1 -Environment prod -WsToken <fresh token>
   ```

## Pre-deploy build check (optional, reference)

The Release Ritual gates in step 1 are the required checks. As an extra local
guard before pushing, you can build every frontend the way Amplify will, so a
build break surfaces on your machine instead of in the Amplify job:

```powershell
pnpm install
pnpm --filter backend build:lambda  # must produce backend/dist/{lambda,websocket,workers}
pnpm --filter web build
pnpm --filter business build
pnpm --filter staff build
pnpm --filter admin build
```

If any frontend build fails, the Amplify build will also fail, so fix it before pushing.

## Deploy Backend (script flags, reference)

Step 5 of the Release Ritual runs the full deploy (build + terraform apply +
Lambda code push). These flags narrow what it does:

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

## Consent Version Bump (founder-timed)

Bumping `AREA_CODE_CONSENT_VERSION` re-prompts every existing consumer to accept the current legal terms once on next open. It is a deliberate, founder-timed ops step. Run it in its own deploy window. Do not bundle it with unrelated infra or code changes.

### Prerequisites (verify before the prod bump)

1. The consumer re-consent gate (`ReconsentGate` in `apps/web/src/components/ReconsentGate.tsx`, wired in `apps/web/src/App.tsx`) is deployed to prod. Without it the env bump changes only what the backend records for new consents and what the admin re-consent list reports; it does not surface a prompt to existing users.
2. The dev rehearsal (task 7.1) is verified: dev runs `AREA_CODE_CONSENT_VERSION=v1.1`, one re-consent prompt fires in the dev consumer app, the new version is recorded, and the admin Consent Audit re-consent list behaves as expected.

### The change

One line in `infra/environments/prod/main.tf`, in the prod API Lambda environment block:

```hcl
AREA_CODE_CONSENT_VERSION = "v1.0"   # change to "v1.1"
```

Apply it as its own infra-only deploy, not bundled with other changes:

```powershell
./scripts/deploy-serverless.ps1 -Environment prod -TerraformOnly
```

The gated `terraform.yml` workflow is the alternative when the change lands via a `master` push to `infra/**`. Either way the plan should show a single env var change on `area-code-prod-api`. Confirm the value after apply:

```powershell
aws lambda get-function-configuration `
  --function-name area-code-prod-api `
  --query 'Environment.Variables.AREA_CODE_CONSENT_VERSION' `
  --output text --region us-east-1 --no-cli-pager
```

### Release note

Post this in the deploy record for the window:

> Consent version bumped from v1.0 to v1.1 in prod. Every existing consumer sees a one-time re-consent prompt on next app open, asking them to accept the updated Terms (tier-permanence clause). Accepting records v1.1 and preserves the session; the prompt does not appear again. The admin Consent Audit re-consent list will populate with all pre-bump users (latest recorded consent still v1.0) until each re-consents. No other behaviour changes.

### Rollback

Revert `AREA_CODE_CONSENT_VERSION` from `v1.1` back to `v1.0` and re-apply infra only. This stops new re-consent prompts immediately. Consents already recorded at `v1.1` are harmless: they are simply a newer accepted version and require no cleanup.

## Deploy Frontend (reference)

Amplify is wired to the `master` branch of each app. Pushing to `master` (step 3
of the Release Ritual) triggers a build. Env-var provisioning and rebuilds are
step 4 of the ritual, via `./scripts/update-all-amplify-apps.ps1`. This section
is background, not a separate sequence.

## Post-deploy Verification

The Release Ritual ends with the go-live check (step 6), which is the gate. These
manual spot checks are a quick supplement, not a replacement for it:

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

## Load Smoke (dev, manual only)

`scripts/load-smoke.js` is a k6 script that loads the dev API on the consumer hot path: the city nodes read and a check-in burst. It is manual only, never wired to push or PR, to respect the dev budget.

It runs two scenarios:

- `nodes_read`: `GET /v1/nodes/{city}` at 50 requests/sec for 2 minutes.
- `checkin_burst`: `POST /v1/check-in` at 10 requests/sec for 30 seconds with a dev consumer token.

Pass thresholds (the run fails if any is breached):

- `http_req_duration` p95 < 800ms on each scenario.
- `http_req_failed` rate < 1% on the public nodes read (it must return 200).
- `server_errors` rate < 1% overall, counting only 5xx and network/timeout errors. The check-in route is rate limited to 10 requests per 60s per user, so a single-token burst is mostly 429 by design. Rate limit 429s and auth 401s are the server responding correctly under load, not faults, so they are not counted as errors.

### Run locally

Install k6 (`https://grafana.com/docs/k6/latest/set-up/install-k6/`), then point it at the dev API. Never point it at prod: the check-in burst writes real check-ins and consumes the prod budget.

```bash
k6 run \
  -e BASE_URL=https://<dev-api-host> \
  -e K6_DEV_TOKEN=<consumer bearer JWT for the dev pool> \
  -e CHECKIN_NODE_ID=<a dev node id> \
  scripts/load-smoke.js
```

Environment variables:

| Var                | Required | Purpose                                                              |
| ------------------ | -------- | -------------------------------------------------------------------- |
| `BASE_URL`         | yes      | Dev API base, no trailing slash. No default, so dev is never guessed |
| `K6_DEV_TOKEN`     | yes      | Consumer bearer token for the dev pool. Never hardcoded              |
| `CHECKIN_NODE_ID`  | yes      | Dev node id for the check-in burst                                   |
| `CHECKIN_CITY`     | no       | City slug for the nodes read (default `johannesburg`)                |
| `CHECKIN_QR_TOKEN` | no       | QR token for the node; not needed on dev (check-in short-circuits)   |

Without `K6_DEV_TOKEN` the check-in requests return 401 and the scenario honestly reports an unauthenticated result rather than faking success.

### Run via GitHub Actions

`.github/workflows/load-smoke.yml` runs the same script on `workflow_dispatch` only. Trigger it from the Actions tab. It reads `BASE_URL` from the `base_url` input or the `LOAD_SMOKE_BASE_URL` repository variable, the node id from the `checkin_node_id` input or the `LOAD_SMOKE_NODE_ID` variable, and `K6_DEV_TOKEN` from the repository secret of the same name. It is not on any push or schedule trigger, so it never runs automatically.

Record the first run's results in `docs/GO_LIVE_CHECK_RESULT.md`.

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
