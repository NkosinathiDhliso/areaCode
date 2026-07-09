# Requirements Document

## Introduction

Companion to `billing-revenue-integrity`. That spec builds the subscription
lifecycle (Paid_Until, Grace_Window, unified Tier_Resolver, boost windows) and
fixes the business portal. This spec, **Cross-Portal Lifecycle Alignment**,
makes the other three portals (admin, staff, consumer web) agree with that
lifecycle and closes the remaining verified logical-operation gaps found in
the 9 July 2026 portal sweep.

Verified gaps this spec fixes:

1. **Admin comps will fight the unified resolver.** `setBusinessTier`
   (`backend/src/features/admin/service.ts`) writes a raw tier and optional
   `trialEndsAt`. Under the unified Tier_Resolver, a comped paid tier with no
   active window resolves to starter, silently re-introducing for admin comps
   the exact paying-business downgrade bug the billing spec fixes for
   payments.
2. **Admin cannot see billing state.** `BusinessManagement.tsx` shows tier
   controls but no Paid_Until, no window source, no grace state. Admin cannot
   answer "why did this venue leave the map" or support a billing dispute, and
   there is no operational list of businesses currently in grace.
3. **Staff portal has no honest lapsed-business state.** When a business is
   demoted (`deactivateForNonPayment`), staff can still sign in and scan.
   Nothing tells them the account lapsed. The policy for redeeming
   already-earned codes at a lapsed venue is undecided: today redemption
   succeeds by accident (`redeem` checks `reward.isActive` and staff state,
   not node or business state), not by decision.
4. **Consumer wallet is silent about lapsed venues.** Earned-but-unredeemed
   codes (`useUnclaimedRewards` in ProfileScreen) keep rendering after the
   venue drops off the map, with no honest copy about what the holder can
   expect.
5. **No offline check-in durability (platform audit C4).** A failed check-in
   (network, 5xx) is lost. The user must retry manually and may have left the
   venue. This is the largest remaining consumer logical gap and directly
   erodes the honest-presence signal in a load-shedding, flaky-GPS market.
6. **Stale spec text invites a banned build.** `churn-defences` Task 18
   describes a phone-accepting first-get preview endpoint; the token-based
   flow shipped instead and
   `backend/src/features/staff/__tests__/staff-surface.test.ts` pins the
   phone-preview route ABSENT. Task 18.4 ("UI pending") and Task 19.4 ("phone
   signup is the primary path") are stale and contradict
   `no-sms-no-phone-auth.md`.

Sequencing: Requirement 1 must land with or immediately after
billing-revenue-integrity task 5 (the resolver extension). Everything else is
independent of the billing implementation order.

Out of scope: the mobile app (deferred, not in CI; recorded in R6), tokenised
recurring billing, offline caching of map/venue data (only the check-in write
path is covered), and any new discovery surface.

## Glossary

- **Tier_Resolver**, **Paid_Until**, **Grace_Window**, **Lapse_Sweep**: as
  defined in `.kiro/specs/billing-revenue-integrity/requirements.md`.
- **Comp_Window**: an admin-granted entitlement window. Implemented as the
  admin writing Paid_Until directly (with a mandatory reason, audit-logged),
  so a comp is just a paid window whose payment is Area Code goodwill. No new
  attribute, no second resolver branch.
- **Business_State_Badge**: the read-only billing summary rendered in admin
  BusinessManagement: stored tier, effective tier, window source (trial, paid,
  grace, none), Paid_Until, `paymentGraceUntil`.
- **Grace_List**: admin view of businesses currently inside Grace_Window,
  ordered by grace expiry.
- **Lapsed_Business_Banner**: staff-portal banner shown when the staff
  member's business is inactive or effective-starter after demotion.
- **Earned_Code_Policy**: the decided rule for redemption codes earned before
  a venue lapsed: they remain redeemable through their existing validity
  window. Earned value is never revoked by the venue's billing state, in the
  spirit of the tier-permanence commitment.
- **Checkin_Outbox**: a consumer-side durable queue (localStorage) of failed
  check-in attempts, each `{ nodeId, capturedAt, lat, lng, retryCount }`.
- **Replay_Window**: the maximum age of a queued check-in the backend will
  accept, 15 minutes from `capturedAt`.

## Requirements

### Requirement 1: Admin comps use the same window algebra

**User Story:** As an admin, I want a comped tier to behave exactly like a
paid tier, so that goodwill upgrades do not silently degrade 14 days later.

#### Acceptance Criteria

1. WHEN an admin sets a paid tier via `setBusinessTier`, THE admin service
   SHALL require an explicit entitlement end date and SHALL write it to
   Paid_Until (Comp_Window), clearing `trialEndsAt` and `paymentGraceUntil`,
   so the Tier_Resolver honours the comp without any resolver change.
2. WHEN an admin sets tier `starter`, THE admin service SHALL clear
   Paid_Until and `paidInterval` so the business does not read as paid.
3. THE existing audit log entry SHALL record the granted window
   (`paidUntil`) alongside tier and reason.
4. THE BusinessManagement set-tier dialog SHALL collect the end date
   (default: +1 calendar month) and SHALL state that map removal on lapse
   follows the normal grace flow.
5. `extendTrial` SHALL remain trial-only and unchanged.
6. Admin comp writes SHALL NOT create Subscription_Payment_Rows (no money
   moved, nothing to audit as revenue).

### Requirement 2: Admin can see and operate the billing lifecycle

**User Story:** As an admin, I want to see each business's billing state and
who is about to lapse, so that support and retention are operable from the
portal instead of the DynamoDB console.

#### Acceptance Criteria

1. THE BusinessManagement list SHALL render the Business_State_Badge per
   business from existing reads extended with `paidUntil`, `paidInterval`,
   and `paymentGraceUntil`.
2. THE admin portal SHALL provide the Grace_List (businesses with an active
   Grace_Window, soonest expiry first), via a `requireAuth('admin')` endpoint
   that projects business id, name, tier, and grace expiry only.
3. WHEN a business was demoted by the Lapse_Sweep, THE admin audit trail
   SHALL contain a system-actor entry recording the demotion, so "why did
   this venue disappear" has a queryable answer.

### Requirement 3: Staff portal is honest about a lapsed business

**User Story:** As a staff member at a venue whose owner stopped paying, I
want the app to tell me what still works, so that I am not debugging a
mystery at the till.

#### Acceptance Criteria

1. WHEN the staff member's business is inactive or resolves to starter after
   demotion, THE staff home SHALL render the Lapsed_Business_Banner naming
   the state and what still works (validating earned codes), without exposing
   billing amounts.
2. THE Earned_Code_Policy SHALL be implemented deliberately: redemption of a
   code earned before demotion SHALL succeed through its existing validity
   window even when the node or business is inactive, and a regression test
   SHALL pin this so it cannot regress into an accidental behaviour.
3. WHEN a business is demoted, new reward earning at its venues SHALL remain
   impossible via the existing surfaces (venues hidden from the map, rewards
   skipped on inactive nodes), asserted by test, with no new enforcement code
   unless the assertion fails.
4. THE churn-defences Task 18 stale items SHALL be reconciled: 18.4 marked
   obsolete with a pointer to the shipped token-based `FirstGetIssuer` and
   the staff-surface regression test; 19.4's phone-primary wording corrected
   to the email/Google + token reality.

### Requirement 4: Consumer wallet is honest about lapsed venues

**User Story:** As a consumer holding an earned reward code, I want the
wallet to tell me the truth about the venue, so that I never trek to a venue
that no longer participates.

#### Acceptance Criteria

1. WHEN a wallet code's venue is no longer active on Area Code, THE
   RedemptionCodeCard SHALL render an honest secondary line ("This venue has
   left Area Code. Your code stays valid until <expiry> and staff can still
   scan it.") consistent with the Earned_Code_Policy.
2. THE unclaimed-rewards read SHALL carry enough venue state (active flag)
   for the card to render this without a per-card venue fetch.
3. THE copy SHALL avoid blame and avoid the word "expired" while the code is
   still valid.

### Requirement 5: Check-ins survive network failure (closes platform audit C4)

**User Story:** As a consumer on flaky mobile data, I want a failed check-in
to complete on its own, so that my visit counts without me babysitting the
app.

#### Acceptance Criteria

1. WHEN a check-in submission fails with a network error or 5xx, THE consumer
   web app SHALL enqueue it in the Checkin_Outbox with the original
   `capturedAt` and coordinates. 4xx rejections (proximity, rate limit,
   validation) SHALL NOT be queued; they surface immediately as today.
2. WHILE the outbox is non-empty and the app is online, THE consumer web app
   SHALL retry oldest-first with exponential backoff, at most 3 retries per
   entry, then park the entry as failed.
3. THE check-in endpoint SHALL accept a queued submission whose `capturedAt`
   is within the Replay_Window (15 minutes), validating proximity against the
   submitted original coordinates, and SHALL record presence starting at
   delivery time, never backdated, per `honest-presence.md`.
4. WHEN `capturedAt` is older than the Replay_Window, THE endpoint SHALL
   reject with a specific error and THE app SHALL discard the entry with an
   honest toast, not retry forever.
5. THE outbox logic (enqueue decision, retry schedule, parking, discard)
   SHALL be a pure logic core with fast-check property tests (min 100 runs),
   per the testing standard for logic cores.
6. THE profile screen SHALL surface parked failures with retry and discard
   actions.
7. Duplicate delivery (retry races a success) SHALL be idempotent
   server-side: the same consumer, node, and `capturedAt` SHALL NOT produce
   two check-ins.

### Requirement 6: Deferred-surface decisions are recorded

**User Story:** As the founder, I want the deferred portals and flows written
down as decisions, so that audits stop rediscovering them.

#### Acceptance Criteria

1. `docs/PLATFORM_AUDIT_FINDINGS.md` SHALL be annotated: C4 closed by this
   spec; the mobile app remains deferred, excluded from CI, and bound to
   email + Google OAuth on resume per `no-sms-no-phone-auth.md`.
2. THE mobile app SHALL receive no changes under this spec; its outbox
   equivalent is recorded as a follow-up in the same annotation.
