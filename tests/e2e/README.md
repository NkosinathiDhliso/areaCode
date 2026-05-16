# Area Code — End-to-End Tests

Playwright suite that automates the browser-driven portions of [`docs/UAT_CHECKLIST.md`](../../docs/UAT_CHECKLIST.md).

## Coverage matrix

| Section                               | Coverage                     | Spec(s)                                                                |
| ------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Cross-cutting smoke                   | ✅                           | `tests/smoke.spec.ts`                                                  |
| §1.1 Sign up & first launch           | 🟡 (Google + SMS OTP manual) | `consumer/signup-and-checkin.spec.ts`, `consumer/manual-flows.spec.ts` |
| §1.2 Map & discovery                  | ✅                           | `consumer/signup-and-checkin.spec.ts`                                  |
| §1.3 Check-in (GPS, cooldown, errors) | ✅ (QR via phone manual)     | `consumer/signup-and-checkin.spec.ts`                                  |
| §1.4 Profile & history                | ✅                           | `consumer/profile-and-history.spec.ts`                                 |
| §1.5 Rewards                          | ✅ (push prompt manual)      | `consumer/rewards.spec.ts`                                             |
| §1.6 Social                           | ✅                           | `consumer/social.spec.ts`                                              |
| §1.7 Privacy & safety                 | ✅                           | `consumer/privacy-and-safety.spec.ts`                                  |
| §1.8 Account management               | ✅ (delete flow manual)      | `consumer/account-management.spec.ts`                                  |
| §1.9 Error handling                   | ✅                           | `consumer/error-handling.spec.ts`                                      |
| §2.1 Onboarding                       | 🟡 (Google manual)           | `business/onboarding-and-live.spec.ts`                                 |
| §2.2 Live panel                       | ✅                           | `business/onboarding-and-live.spec.ts`                                 |
| §2.3 Venue editor                     | ✅                           | `business/venue-editor.spec.ts`                                        |
| §2.4 Check-in detail panel            | ✅                           | `business/checkin-detail.spec.ts`                                      |
| §2.5 Rewards                          | ✅                           | `business/rewards.spec.ts`                                             |
| §2.6 Staff management                 | ✅                           | `business/staff-management.spec.ts`                                    |
| §2.7 Staff redemption attribution     | ✅                           | `business/staff-management.spec.ts`                                    |
| §2.8 Subscription & billing           | 🟡 (Yoco card flow manual)   | `business/billing-and-qr.spec.ts`                                      |
| §2.9 QR code                          | ✅                           | `business/billing-and-qr.spec.ts`                                      |
| §2.10 Reports                         | ✅                           | `business/reports-and-audience.spec.ts`                                |
| §2.11 Audience & boost                | ✅                           | `business/reports-and-audience.spec.ts`                                |
| §3.1 Staff auth                       | ✅                           | `staff/auth-and-redemption.spec.ts`                                    |
| §3.2 QR scanner (camera)              | ❌ manual                    | `staff/auth-and-redemption.spec.ts` (fixme)                            |
| §3.3 Manual code entry                | ✅                           | `staff/auth-and-redemption.spec.ts`                                    |
| §3.4 Redemption preview               | ✅                           | `staff/auth-and-redemption.spec.ts`                                    |
| §3.5 Confirmation & result            | ✅                           | `staff/auth-and-redemption.spec.ts`                                    |
| §3.6 Recent redemptions               | ✅                           | `staff/auth-and-redemption.spec.ts`                                    |
| §4.1 Admin auth                       | ✅                           | `admin/dashboard.spec.ts`                                              |
| §4.2 Dashboard overview               | ✅                           | `admin/dashboard.spec.ts`                                              |
| §4.3 Consumer management              | ✅                           | `admin/management.spec.ts`                                             |
| §4.4 Business management              | ✅                           | `admin/management.spec.ts`                                             |
| §4.5 Node management                  | ✅                           | `admin/management.spec.ts`                                             |
| §4.6 Abuse flag dashboard             | ✅                           | `admin/moderation-and-iam.spec.ts`                                     |
| §4.7 Audit trail                      | ✅                           | `admin/moderation-and-iam.spec.ts`                                     |
| §4.8 Report queue                     | ✅                           | `admin/moderation-and-iam.spec.ts`                                     |
| §4.9 Consent audit                    | ✅                           | `admin/moderation-and-iam.spec.ts`                                     |
| §4.10 IAM                             | ✅                           | `admin/moderation-and-iam.spec.ts`                                     |
| §4.11 Archetype management            | ✅                           | `admin/moderation-and-iam.spec.ts`                                     |
| §5 Cross-portal real-time             | ✅                           | `cross-portal/realtime.spec.ts`                                        |
| §6 Performance & reliability          | 🟡 (memory leaks manual)     | `performance.spec.ts`                                                  |
| §7 Security spot checks               | ✅                           | `security.spec.ts`                                                     |
| §8 Mobile responsiveness              | ✅                           | `mobile-sweep.spec.ts`                                                 |
| §9 Accessibility                      | 🟡 (screen-reader manual)    | `accessibility.spec.ts`                                                |

Legend: ✅ automated · 🟡 partially automated, see notes · ❌ stays manual

## What's still manual (and why)

These cannot be automated reliably and stay in `UAT_CHECKLIST.md`:

- **Real Google OAuth** — Google blocks headless browsers
- **Real Yoco checkout** — use Yoco test mode + webhook stubs in CI
- **Real SMS OTP delivery** — needs a real phone or sandbox SMS quota
- **Real device QR scanning** — fake-camera frames are black, not scannable
- **Browser permission UI** (push, camera denial fallback) — not exposed
- **Screen-reader accessibility validation** (NVDA / JAWS / VoiceOver)
- **Long-running memory leak observation**
- **Account deletion** — destructive, kept manual until soft-delete dry-run exists

These are encoded as `test.fixme()` cases so they appear in the report as
"Known manual" rather than silently absent.

## First-time setup

```bash
pnpm install
cp tests/e2e/.env.example tests/e2e/.env
# Fill in the staging URLs, pool IDs, AWS creds, and a long random password.

pnpm --filter @area-code/e2e install:browsers
```

## Running

```bash
# Full run against the env in tests/e2e/.env
pnpm --filter @area-code/e2e test

# Smoke only (no auth, no AWS)
pnpm --filter @area-code/e2e test:smoke

# UI mode for debugging
pnpm --filter @area-code/e2e test:ui

# Just one project
pnpm --filter @area-code/e2e test --project=admin
pnpm --filter @area-code/e2e test --project=cross-portal
```

After a run, open the HTML report:

```bash
pnpm --filter @area-code/e2e report
```

## Test accounts

`support/global-setup.ts` provisions five Cognito users (one per role)
and re-uses them across runs. Emails follow `e2e-<role>@areacode.test`.

To keep the seeded users between runs (faster local iteration):

```bash
E2E_KEEP_USERS=1 pnpm --filter @area-code/e2e test
```

## Targeting environments

The four portal URLs and the API URL are read from env vars. Switch
environments by maintaining separate `.env.staging` and `.env.local` files.

> ⚠️ Do not run this against production. The seeded users would land in
> your real Cognito pools. Always target a dedicated staging environment.

## CI

- `quality-gate.yml` runs `@smoke` on every PR — public URLs only, no AWS.
- `e2e.yml` runs the full suite nightly + on `workflow_dispatch` against
  staging. It needs Cognito pool IDs and AWS creds in repo secrets.

## Stability tips

- Selectors are layered: `data-testid` first, then role + accessible
  name, then text patterns. See [`TESTID_AUDIT.md`](./TESTID_AUDIT.md)
  for which testids the apps should expose for maximum stability.
- Tests skip with a clear reason rather than failing when fixture data
  isn't available (`No nodes seeded`, `No nearby rewards`, etc). To get
  full green, your staging environment needs:
  - At least one public node in Johannesburg (lat ≈ -26.2041, lng ≈ 28.0473)
  - A reward published on a venue the test consumer can claim
  - The seeded business owner owning at least one node
- API contracts evolve — if a spec sees a 404 it doesn't recognise, it
  skips with the status rather than failing. Update the path in the
  spec when the API moves.
