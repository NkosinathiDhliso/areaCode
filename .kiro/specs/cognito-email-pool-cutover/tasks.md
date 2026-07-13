# Implementation Plan

The Terraform change already exists on branch `claude/eager-ramanujan-1db8a9`
(commit `b81f5b8`). Tasks 1 and 2 consume that branch; do not re-author the
pools from scratch.

- [x] 1. Review and land the authored fix
  - Review `claude/eager-ramanujan-1db8a9` against Requirement 1 (email username attributes, no SMS config, module default removed, dev pools flipped)
  - `terraform fmt -check` and `terraform validate` for both environments
  - Merge to master; full local suite green before push (typecheck, test, lint, guard:serverless)
  - _Requirements: 1.1, 1.2, 1.3, 8.1_

- [x] 2. Plan and apply prod infrastructure
  - `terraform plan` for prod; confirm the plan creates V2 pools and does NOT destroy the old business/staff pools
  - Apply via `./scripts/deploy-serverless.ps1 -Environment prod`
  - Record the new pool IDs, client IDs, and Hosted UI domains from the Terraform outputs
  - _Requirements: 1.1, 1.4, 1.5_

- [x] 3. Google OAuth client first
  - Add the two new Hosted UI redirect URIs to the shared Google OAuth client (Google console, manual)
  - Verify the old-pool Hosted UI still works afterwards (additive change, nothing switched yet)
  - _Requirements: 2.1_

- [x] 4. Single-release cutover
  - Lambda env: point `AREA_CODE_COGNITO_BUSINESS_*` and `AREA_CODE_COGNITO_STAFF_*` (API and WebSocket Lambdas) at the V2 values via Terraform, applied through the deploy script
  - Amplify: run `update-all-amplify-apps.ps1` with the new `VITE_COGNITO_CLIENT_ID_BUSINESS/STAFF` and `VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS/STAFF`; wait for all four builds to SUCCEED
  - _Requirements: 2.2, 2.3_

- [x] 5. Live verification in prod
  - Business email signup returns 201 and the account logs in (fresh test email)
  - Staff invite from that test business accepted end to end; staff portal login works
  - One real Google business login self-heals via `businessOAuthSync`
  - Re-invite the one Google-linked staff account (identified in the migration session notes)
  - Disable or delete the verification test accounts; record in Ops_Log
  - _Requirements: 2.4, 3.1, 3.2, 3.4, 4.1, 4.2, 4.3_

- [x] 6. Pool_Parity gate in go-live check
  - `go-live-check.ps1`: read pool IDs from the deployed prod API Lambda env, `describe-user-pool` each, FAIL unless `UsernameAttributes = ["email"]` on all four
  - Configuration only, never user data
  - _Requirements: 6.1, 6.2_

- [x] 7. Documentation
  - `tests/e2e/README.md`: no staging frontend exists; never seed prod pools; the read-only sweep is the sanctioned prod layer; authenticated-suite enablement is an open decision
  - RUNBOOK Ops_Log entry: cutover date, old and new pool IDs, verification outcome
  - `docs/GO_LIVE_CHECK_RESULT.md` coverage change note
  - `pnpm sync:rules` if any `rules/*.md` changed
  - _Requirements: 4.4, 7.1, 7.2, 7.3_

- [ ] 8. Delete the old pools (separate, gated)
  - Only after task 5 is fully verified
  - Separate `terraform plan` reviewed for exactly the two pool deletions, applied via the deploy script
  - Ops_Log updated
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 9. Final gates
  - `go-live-check.ps1 -Environment prod` passes with the Pool_Parity gate
  - Read-only e2e sweep green: `cd tests/e2e; pnpm exec playwright test --project=smoke --project=cross-cutting --project=mobile-sweep`
  - _Requirements: 8.2, 8.3_
