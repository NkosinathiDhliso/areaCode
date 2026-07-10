# Decision: prod-default env vars (FROM_EMAIL, business URL, unsubscribe API base URL)

Date: 2026-07-10

Spec: audit-gap-closure Requirement 1.6. Related: `.kiro/steering/no-fallbacks-no-legacy.md`.

## Context

Requirement 1 converts the security-critical secrets (`AREA_CODE_QR_HMAC_SECRET`,
the campaign unsubscribe secret, and `AREA_CODE_CONSENT_VERSION`) to the fail-fast
`requireEnv` pattern so a misdeploy crashes at startup instead of signing over an
empty value.

Three remaining env vars still carried a prod-correct `?? 'https://...'` style
default and were left for a recorded decision:

1. `AREA_CODE_FROM_EMAIL` in `backend/src/shared/email/ses.ts`. Default
   `noreply@areacode.co.za`. The SES sender identity for every transactional
   email (password reset, email verification, trial and renewal reminders,
   report-ready, digest, campaign send). Consumed by four Lambdas: `api`,
   `report-generator`, `campaign-sender`, and the trial/renewal reminder path.
2. `AREA_CODE_BUSINESS_URL` in `backend/src/shared/email/ses.ts`. Default
   `https://business.areacode.co.za`. Used once, to build the `/reports` link in
   the report-ready email. Consumed by `report-generator`.
3. `AREA_CODE_API_BASE_URL` in `backend/src/features/campaigns/unsubscribe.ts`.
   Default `https://api.areacode.co.za`. Used to build the one-click unsubscribe
   URL embedded in every campaign email. Consumed by `campaign-sender`, which
   already sets this var in prod Terraform.

These three differ from the secrets: none is a secret (the in-repo value has no
security consequence), and each default is the literally correct production
value, not a placeholder.

`no-fallbacks-no-legacy.md` bans config defaults that mask misconfiguration and
names URLs explicitly. The requirement allows keeping a prod-correct default only
with a recorded rationale; otherwise the var follows the same fail-fast rule.

## Options

For each var:

- Option A: convert to fail-fast via `requireEnv` with a dev-only default. A
  missing var in prod throws. Requires the var to be provisioned in Terraform for
  every consuming Lambda, or the previously-working path crashes on first send.
- Option B: keep the prod-correct default, documented here.

## Decision

- `AREA_CODE_API_BASE_URL`: Option A, convert to fail-fast. It is already
  provisioned in prod Terraform on `campaign-sender`, so conversion adds no
  deployment risk. A wrong or missing base URL silently produces broken one-click
  unsubscribe links, which POPIA and anti-spam expectations require to work. This
  one must fail loud. `buildUnsubscribeUrl` now calls
  `requireEnv(API_BASE_URL_ENV, 'https://api.areacode.co.za')`; the dev default
  preserves local behaviour.

- `AREA_CODE_FROM_EMAIL`: Option B, keep with rationale. It is not a secret. The
  default is the correct prod sender. A misconfiguration is not silent: SES
  rejects an unverified or wrong sender identity at send time and the failure is
  logged, so the value is self-checking in prod. It is consumed by four separate
  Lambdas, none of which currently provision it, so fail-fast conversion would
  add four Terraform wiring points and four new startup crash surfaces to protect
  a value that is already correct and self-verifying.

- `AREA_CODE_BUSINESS_URL`: Option B, keep with rationale. It is not a secret.
  The default is the correct prod value. It is used only to build a link in the
  report-ready email, so a wrong value yields a visibly broken link discovered on
  first click, not a data-integrity or security failure. It is consumed by
  `report-generator`, which does not provision it today.

If Area Code ever runs a second environment that needs a different sender domain
or business host (for example a staging domain), revisit both kept vars and move
them to Option A at that point, wiring the value through Terraform for every
consuming Lambda.

## Consequences

- `AREA_CODE_API_BASE_URL` missing in prod now throws at the first
  `buildUnsubscribeUrl` call rather than emitting a broken link. Dev and test are
  unchanged via the dev default. No Terraform change is needed because
  `campaign-sender` already sets it.
- `AREA_CODE_FROM_EMAIL` and `AREA_CODE_BUSINESS_URL` keep their current
  behaviour. Their single-source defaults remain in `ses.ts`. The risk accepted
  is that a future second environment could send from or link to the wrong host
  until the var is set; this is bounded by the revisit trigger above.
- No behaviour change for existing prod email paths.
