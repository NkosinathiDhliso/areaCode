# Privacy posture and data retention

Operational reference for how Area Code handles consumer personal information
under South Africa's Protection of Personal Information Act (POPIA, Act No. 4 of
2013). The user-facing privacy policy is served publicly at
`https://areacode.co.za/legal/privacy` and implemented in
`apps/web/src/screens/PrivacyPolicyScreen.tsx`. This document is the internal
companion: it records the retention windows, the POPIA close-out evidence, and
the tier-permanence commitment so the legal surface and the code stay aligned.

Privacy contact and information officer: privacy@areacode.co.za.

## What we collect and why

The authoritative list lives in the public policy sections 2 and 3. In summary,
we collect account data (email, display name, avatar, Cognito identifier),
check-in metadata (venue and timestamp; the GPS reading is verified in memory
and discarded, never stored), optional music taste data, reward and tier data,
device and connection data, and support communications. We never collect phone
numbers, identity numbers, consumer payment card details, persistent location
history, or biometric data.

## Retention windows

- Account data: kept while the account is active; soft-deleted immediately on
  deletion request and hard-deleted within 30 days per POPIA Article 14.
- Check-in records: kept while the account is active to compute streaks, tiers,
  and leaderboard standing; deleted with the account.
- Casual-customer First-Get tokens: kept up to 60 days (a 30-day conversion
  window plus a 30-day audit grace), then permanently deleted by DynamoDB TTL.
  These tokens contain no personal information.
- Server logs: retained up to 90 days for security and debugging.

## Tier permanence

A consumer's loyalty tier is derived only from their retained check-in history.
Tier is a count-based threshold over total check-ins, not a category we assign
by judgement, spend, or annual review:

- Local: 0 to 9 check-ins
- Insider: 10 to 49 check-ins
- Patron: 50 to 149 check-ins
- Icon: 150 to 499 check-ins
- Legend: 500 or more check-ins

Because tier is a pure function of accumulated visit count, it reflects genuine
engagement and moves in one direction only as a consumer checks in more. We do
not reset it annually, we do not downgrade it, and we do not re-tier a consumer
based on recent inactivity. The tier ladder has a single level for every
consumer at all times; there is no point currency and no expiry on tier or on
accumulated visit count.

The following commitment is the canonical clause. It appears verbatim in the
Terms of Service and in the consumer profile screen, sourced from
`packages/shared/constants/legal.ts` (`TIER_PERMANENCE_CLAUSE`) so the wording
can never drift between surfaces:

> Your tier and accumulated visit count are permanent. Area Code commits never
> to reset, downgrade, or annualise tier or visit count.

This clause may only be strengthened, never weakened, in later revisions. When
the consent version increments, the updated Terms of Service preserve this
clause unchanged or stronger. The admin portal blocks any direct API or UI
action that would decrement a consumer's tier below the level implied by their
visit count.

Permanence is bounded only by the consumer's own data rights. Tier persists for
as long as the underlying check-in history is retained. When a consumer
exercises their POPIA right to erasure, their account and check-in records are
deleted within 30 days, and their tier and accumulated visit count are removed
with that data rather than retained. Erasure removes the tier; it is never a
downgrade.

## POPIA close-out record

The three POPIA close-out checks (churn-defences tasks 23.1 to 23.3) were
executed on 2026-07-09 and verified against the shipped code. The full evidence
is recorded in `docs/CHURN_DEFENSES.md` Part 6:

- Threshold_Lock rows store only `userId` as a personal identifier.
- Guest_Claim tokens store no personal data and expire within 60 days by TTL.
- The proximity nudge runs entirely client-side and persists no coordinates
  server-side.

## Related references

- Public policy: `apps/web/src/screens/PrivacyPolicyScreen.tsx`
- Canonical legal clauses: `packages/shared/constants/legal.ts`
- Churn rationale and POPIA evidence: `docs/CHURN_DEFENSES.md`
- Tier thresholds and labels: `packages/shared/constants/tier-levels.ts`

This document should be reviewed by a South African attorney before it is relied
on for production legal coverage.
