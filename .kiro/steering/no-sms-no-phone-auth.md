<!-- GENERATED FILE. DO NOT EDIT.
     Single source of truth: rules/*.md
     Regenerate with: pnpm sync:rules -->

---
inclusion: always
---

# Hard rule: SMS and phone-OTP authentication are permanently removed

This is a binding architectural decision, not a default. Read this whole file before touching anything that smells like authentication, OTP, signup, login, or SMS.

## What's banned

You MUST NOT, under any circumstances:

1. Re-enable the phone-OTP authentication flow in any user-facing surface (web, business, staff, admin, mobile). The endpoints `/v1/auth/{consumer,business,staff}/{login,signup,verify-otp}` exist as dead code and return `410 Gone` in prod. Do not remove the gate. Do not lift the guard. Do not reroute around it.
2. Add a phone-number input to any signup or login screen, in any portal, on any platform.
3. Add an SMS-sending integration. AWS End User Messaging, Pinpoint SMS Voice v2, Twilio, MessageBird, Vonage, Africa's Talking — none of them. The existing `backend/src/shared/sms/feedback.ts` is dead code.
4. "Modernise", "fix", "complete", "extend", or "add tests for" the dead phone-OTP paths. They are dead deliberately.
5. Wire phone signup into the half-built `apps/mobile` React Native app. The mobile app, when resumed, will use the same email + Google OAuth surface as the web apps.
6. Use phone numbers as identifiers anywhere new. Email and Cognito sub are the only consumer identity primitives.

## What's allowed

- Email/password signup and login (in prod use today).
- Google OAuth via Cognito Hosted UI (in prod use today).
- The token-based casual-customer "First-Get" flow (`backend/src/features/rewards/guest-claim.ts`). This is the replacement for the original phone-based guest-claim model. Tokens are 8-character Crockford base32 (no I, L, O, U). Read the file before extending it.
- Internal admin-driven SMS for ops alerts (PagerDuty, Slack, etc.) — these don't touch the user authentication path.

## Why

Pilot testing in May 2026 showed unreliable SMS delivery to South African networks (MTN and Vodacom OTP latency frequently exceeded 30 seconds, with intermittent failures and throttling). The customer-experience cost on signup day was the single highest cause of drop-off in early testing.

The decision is recorded with full context in:

- `docs/CHURN_DEFENSES.md` §1.6 (the rationale for the casual-customer path replacement)
- The git commit `481e4cf` (squashed history with the full reasoning)
- This file

## What to do if a task seems to require phone auth

Stop and confirm with the user. Do not implement it speculatively. Acceptable phrasings:

- "This task as written would require re-enabling phone OTP, which is permanently disabled per `.kiro/steering/no-sms-no-phone-auth.md`. Should I propose an email-based alternative?"
- "I notice phone-OTP code in the repo. Per the steering rule, this is dead code. Do you want me to leave it untouched?"

## What to do when you see suspicious code that seems to contradict this

The following code is **intentionally** present and **must not be removed or revived**:

- `backend/src/features/auth/handler.ts` — phone-OTP routes guarded by `PHONE_OTP_DISABLED`, returning `410 Gone`
- `backend/src/features/auth/service.ts` — `consumerVerifyOtp`, `businessVerifyOtp`, `staffVerifyOtp`, `consumerLogin` (phone), etc. — exist for dev-mode tests only
- `backend/src/shared/cognito/client.ts` — `signUpUser`, `respondToAuthChallenge` etc. — Cognito CUSTOM_AUTH wiring kept for dev fixtures
- `backend/src/shared/sms/feedback.ts` — Pinpoint v2 feedback reporting, dead in prod
- `backend/src/__tests__/e2e.test.ts` — exercises the routes in DEV_MODE only; prod returns 410
- `backend/src/__tests__/data-integrity.test.ts` — schema validation tests for `verifyOtpBodySchema` (the schema is still imported elsewhere)

If you are about to "clean up" any of these, the right answer is **don't**. Leave them. Removing them creates the risk that someone re-adds them from scratch and forgets the gate.

## Authoritative reference

For the full architecture and rationale, read in this order:

1. `docs/CHURN_DEFENSES.md` (sections 1.4 and 1.6 in particular)
2. `.kiro/specs/churn-defences/requirements.md` Requirement 6
3. `docs/PILOT_LAUNCH_CHECKLIST.md` §1 blocker 2
