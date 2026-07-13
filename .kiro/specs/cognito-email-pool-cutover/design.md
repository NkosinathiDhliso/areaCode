# Design Document

## Context

`username_attributes` is immutable on a Cognito user pool, so the fix is
replacement, not mutation. The consumer migration already set the precedent:
`area-code-prod-consumer-v2` is a standalone email pool and the old consumer
pool is history. Business and staff follow the same v2 pattern. The Terraform
change is authored on branch `claude/eager-ramanujan-1db8a9` (commit
`b81f5b8`); this design records the decisions that change embodies plus the
cutover mechanics around it.

## Decisions

### 1. Replacement pools in prod, in-place replacement in dev

Prod gets new `business-v2` and `staff-v2` pools beside the old ones so the
cutover is a pointer swap with a rollback path. Dev pools flip to email
directly (Terraform will destroy and recreate them); dev has no accounts worth
preserving and no uptime promise.

### 2. Module default removed, not changed

Changing the module default from `["phone_number"]` to `["email"]` would fix
today's callers but keep the failure mode: a silent default masking intent.
Removing the default forces every instantiation to declare its username
attributes, which is the `no-fallbacks-no-legacy.md` posture: required
configuration is explicit or the plan fails.

### 3. Cutover order

The Hosted UI redirect URIs on the shared Google OAuth client are additive and
harmless to the old pools, so they go first. Everything that binds tokens to a
pool (Lambda env, Amplify `VITE_COGNITO_*`) switches in one release, because a
split state produces tokens the backend rejects: the frontend would mint
against one pool while `verifyBearerToken` checks the other. Amplify vars are
set only through `update-all-amplify-apps.ps1`, never the console, per the
deployment-parity spec.

### 4. Account migration is analysis, not tooling

The old business pool holds a small number of accounts: Google-linked users
whose email is carried by the identity token, and phone-era accounts that are
already unloginable (`410 Gone` on the dead phone paths). `businessOAuthSync`
already resolves a business record by email when the `cognitoSub` is unknown,
so Google users self-heal on first login against the new pool. The single
Google-linked staff account is re-invited through the normal invite flow. No
migration script is written; writing one for a handful of accounts would be
speculative tooling.

### 5. Old pools deleted after a verification window

Keeping the old pools indefinitely would be a second source of truth. They
survive only as the rollback pointer until Requirement 4's live verification
passes, then a separate reviewed plan deletes them. Their IDs live on in the
Ops_Log.

### 6. Pool_Parity gate

The go-live check gains a structural check: pool IDs are read from the
deployed API Lambda env (the same authority this audit used), and each pool's
`UsernameAttributes` must be `["email"]`. This detects the drift class (a
deployed pool contradicting the auth architecture) rather than the single
instance, and reads only configuration, never user data.

## What this spec deliberately does not do

- No staging environment. The authenticated e2e suite stays blocked on a
  separate decision (staging frontends, or an explicitly authorized seeded
  prod run). Requirement 7 records the constraint where the next runner will
  look.
- No changes to consumer or admin pools; both are already email pools.
- No touch of the dead phone-OTP code paths, per `no-sms-no-phone-auth.md`.
