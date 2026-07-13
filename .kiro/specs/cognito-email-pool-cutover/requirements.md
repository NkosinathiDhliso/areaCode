# Requirements Document

## Introduction

The 2026-07-12 go-live e2e run found a latent launch blocker: the prod business
(`us-east-1_ToRjJQAGY`) and staff (`us-east-1_IgGAzUdON`) Cognito pools still
have `UsernameAttributes = phone_number`, relics of the removed SMS-OTP era.
The live email signup path (`businessEmailSignup`, staff invite acceptance)
calls `createEmailPasswordUser`, which passes the email as the Cognito
username; those pools reject it with "Username should be a phone number".
Consumer was migrated to an email pool (`consumer-v2`) after the SMS removal;
business and staff never were. Root cause: `infra/modules/cognito/main.tf`
defaults `username_attributes` to `["phone_number"]` and only the admin pool
(and the standalone prod `consumer_v2` resource) override it. All dev pools
except dev-admin carry the same defect.

Nobody has hit this yet: a 14-day scan of the prod API logs shows zero
occurrences of the rejection. It fires on the first real business email signup
or staff invite acceptance, both required by `docs/PILOT_LAUNCH_CHECKLIST.md`
paragraph 4, so the cutover must land before any venue owner is onboarded.

A Terraform fix is already authored on branch `claude/eager-ramanujan-1db8a9`
(commit `b81f5b8`): Terraform-owned `business-v2` and `staff-v2` email pools in
prod, dev pools flipped to email, and the module's phone default removed. It is
NOT applied or deployed. This spec is the recorded decision and the binding
contract for reviewing, applying, and cutting over to that fix, and for the
gate that stops this class of drift (pool configuration contradicting the auth
architecture) from recurring silently.

Secondary finding closed by this spec's documentation requirement: the
authenticated e2e suite has never been runnable in any environment, because
seeding creates email-username users and no environment offered email-username
business/staff pools, and because no staging frontend exists (all four Amplify
apps point at the prod API).

Binding rules: `no-sms-no-phone-auth.md` (email and Google OAuth are the only
identity paths; nothing here revives phone auth), `no-fallbacks-no-legacy.md`
(the old pools are deleted after verified cutover, not kept beside the new
ones), `serverless-only.md` (Cognito is pay-per-use; nothing always-on),
`dry-reuse-no-duplication.md` (one cognito module, parameterised, not forked).

## Glossary

- **Old_Pools**: prod `area-code-prod-business` (`us-east-1_ToRjJQAGY`) and `area-code-prod-staff` (`us-east-1_IgGAzUdON`), both phone-username.
- **V2_Pools**: the new email-username `business-v2` and `staff-v2` pools (and clients, and Hosted UI domains) defined on the fix branch. Replacement is required because `username_attributes` is immutable on an existing pool.
- **Cutover**: the ordered switch of the deployed world from Old*Pools to V2_Pools: Google OAuth client redirect URIs, Lambda env (API and WebSocket), Amplify `VITE_COGNITO*\*` vars.
- **Pool_Parity**: for each of the four auth contexts, the pool the deployed Lambdas point at has `UsernameAttributes = ["email"]`.
- **Read_Only_Sweep**: the prod-safe e2e layer: `cd tests/e2e; pnpm exec playwright test --project=smoke --project=cross-cutting --project=mobile-sweep`.

## Requirements

### Requirement 1: Email pools exist through Terraform

**User Story:** As the founder, I want business and staff to have email-username
Cognito pools defined in Terraform, so that the live signup and invite paths
can create the accounts the product promises.

#### Acceptance Criteria

1. THE V2_Pools SHALL be defined in `infra/environments/prod/main.tf` with `username_attributes = ["email"]`, TOTP-only MFA posture consistent with the existing module, and no SMS configuration of any kind.
2. THE cognito module SHALL no longer default `username_attributes` to `["phone_number"]`; every instantiation SHALL state its username attributes explicitly, so a missing value fails at plan time rather than silently provisioning a phone pool.
3. Dev pools SHALL be email-username after this spec (replacement in dev is acceptable; dev has no users worth preserving).
4. `terraform plan` SHALL be reviewed before apply; the plan for this phase SHALL NOT destroy the Old_Pools (deletion is Requirement 5, gated on verification).
5. THE apply SHALL run only via `./scripts/deploy-serverless.ps1` per repo rules.

### Requirement 2: Cutover order preserves Google OAuth continuity

**User Story:** As a business owner who signs in with Google, I want login to
keep working through the migration, so that the pool swap is invisible to me.

#### Acceptance Criteria

1. THE two new Hosted UI redirect URIs SHALL be added to the shared Google OAuth client BEFORE any frontend or backend points at the V2_Pools.
2. THE prod API Lambda and WebSocket Lambda env vars (`AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID` / `..._CLIENT_ID`, `..._STAFF_...`) SHALL switch to the V2_Pools values in the same deploy as the Amplify switch, so no release window exists where frontend tokens and backend verification disagree.
3. `update-all-amplify-apps.ps1` SHALL provision the new `VITE_COGNITO_CLIENT_ID_BUSINESS`, `VITE_COGNITO_CLIENT_ID_STAFF`, `VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS`, and `VITE_COGNITO_HOSTED_UI_DOMAIN_STAFF` values (from the Terraform outputs), keeping the script the single source of truth for Amplify env.
4. WHEN the cutover deploy completes, business and staff Google OAuth logins SHALL succeed against the V2_Pools.

### Requirement 3: Existing accounts land safely

**User Story:** As an existing portal user, I want my access preserved or
restored deliberately, so that the migration never strands a real person.

#### Acceptance Criteria

1. Business accounts whose Google identity carries a verified email SHALL self-heal on next login via the existing `businessOAuthSync` email fallback; this path SHALL be verified with one real Google business login after cutover.
2. THE one Google-linked staff account in the old staff pool SHALL be re-invited through the normal staff invite flow after cutover (its owner is identified in the migration session notes; no user identifiers are recorded in this spec).
3. Phone-only accounts in the Old_Pools SHALL be treated as dead (their login path already returns `410 Gone`); no migration effort SHALL be spent on them.
4. THE DynamoDB business and staff records SHALL keep working: WHERE a stored `cognitoSub` no longer matches, the sync/re-invite path SHALL update it rather than creating a duplicate record.

### Requirement 4: The broken paths are proven fixed in prod

**User Story:** As the founder, I want live proof that a venue owner can sign up
and invite staff, so that pilot onboarding cannot fail on day one.

#### Acceptance Criteria

1. After Cutover, `POST /v1/auth/business/email-signup` SHALL return `201` for a fresh test business email in prod, and the created account SHALL be able to log in via `POST /v1/auth/business/email-login`.
2. After Cutover, a staff invite issued from that test business SHALL be acceptable end to end (invite email, token accept, staff login on the staff portal).
3. THE test business and staff accounts created for this verification SHALL be disabled or deleted afterwards and recorded in the RUNBOOK Ops_Log.
4. THE verification SHALL be recorded in `docs/GO_LIVE_CHECK_RESULT.md` as a coverage change note.

### Requirement 5: One path only, old pools removed

**User Story:** As the next engineer, I want exactly one business pool and one
staff pool in each environment, so that the source of truth is unambiguous.

#### Acceptance Criteria

1. WHEN Requirements 2, 3, and 4 are verified, THE Old_Pools SHALL be deleted through a separate reviewed `terraform plan` and apply.
2. THE Old_Pools' IDs SHALL be recorded in the Ops_Log entry before deletion (they are the rollback pointer while they exist, and the historical record after).
3. Rollback before deletion SHALL be re-pointing the Lambda env and Amplify vars back at the Old_Pools; after deletion, rollback is re-provisioning, which is acceptable because the V2_Pools will have carried all real logins for the verification window first.

### Requirement 6: Pool_Parity becomes a go-live gate

**User Story:** As an operator, I want the go-live check to fail when a
deployed pool contradicts the auth architecture, so that config relics of
removed eras cannot lie dormant again.

#### Acceptance Criteria

1. `go-live-check.ps1` SHALL read the pool IDs from the deployed prod API Lambda env, call `describe-user-pool` for each, and FAIL unless every pool has `UsernameAttributes = ["email"]`.
2. THE check SHALL report presence and configuration only, never user data.

### Requirement 7: Documentation matches reality

**User Story:** As the next engineer, I want the e2e and deployment docs to
describe the world as it is, so that the next go-live run does not rediscover
this by accident.

#### Acceptance Criteria

1. `tests/e2e/README.md` SHALL state that no staging frontend exists (Amplify apps point at prod), that Cognito seeding must never target prod pools, and that the Read_Only_Sweep is the sanctioned prod layer; enabling the authenticated suite (a staging environment, or an explicitly authorized seeded prod run) SHALL be recorded as an open decision, not implied to work.
2. THE RUNBOOK Ops_Log SHALL record the cutover: date, environments, Old_Pools IDs, V2_Pools IDs, and verification outcome.
3. IF any `rules/*.md` content changes, `pnpm sync:rules` SHALL be run so the mirror matches.

### Requirement 8: Verification

**User Story:** As the founder, I want the standard proof that the change is
green everywhere it touches.

#### Acceptance Criteria

1. `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm guard:serverless` SHALL pass; `terraform fmt -check` and `terraform validate` SHALL pass for the infra changes.
2. `go-live-check.ps1 -Environment prod` SHALL pass with the Pool_Parity gate enabled.
3. THE Read_Only_Sweep SHALL pass against prod after cutover.
