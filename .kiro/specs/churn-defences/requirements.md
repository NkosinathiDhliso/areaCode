# Requirements Document — Churn Defences

## Introduction

Churn Defences is a focused workstream that closes the six gaps identified by mapping documented Starbucks failures (2023 redemption-price hike, 2026 elite-tier rollout, 6-month star expiration, mobile-order overload, app crashes, member-vs-casual divide) onto Area Code's product surface. See `docs/CHURN_DEFENSES.md` for the source-cited rationale per gap.

This spec covers six concrete product changes:

1. **Reward-threshold grandfathering** — protect in-flight progress when a venue raises a reward threshold.
2. **Reward expiry transparency** — make the "tier never expires" promise visible at the consumer surface.
3. **Tier-permanence T&C commitment** — written guarantee that tier earned is tier kept.
4. **GPS-proximity check-in nudge** — pre-warm the check-in prompt when a consumer enters venue radius.
5. **Sentry release-health auto-rollback** — gate deploys on crash-free-user rate.
6. **Casual-customer first-Get path** — let a first-time walk-in claim one introductory reward without full signup.

The serverless-only architecture rule is binding for all work in this spec. No new always-on resources.

## Glossary

- **Reward**: a single redeemable item (Get) configured by a venue, with a `threshold` (visit count required) and optional `expiresAt`.
- **Reward_Progress**: a per-(user, reward) row tracking how many qualifying check-ins the user has accumulated.
- **Threshold_Lock**: a snapshot of the threshold a user was working toward at the moment they made their first qualifying check-in for that reward.
- **Tier**: visit-count-based membership level (`explorer → regular → local → insider`). Tier never resets in our model.
- **Proximity_Nudge**: a low-priority browser/web-push notification fired when a consumer's device enters the geofence of a venue they have previously visited.
- **Geofence**: a venue's published lat/lng plus a configured radius (default 80m), used only for client-side detection. We do not persist coordinates server-side.
- **Release_Health**: Sentry's measurement of crash-free user rate per release version.
- **Auto_Rollback**: a CI/CD step that automatically promotes the previous Lambda version to the live alias when release health degrades.
- **Guest_Claim**: a one-time reward claim attached to a phone number with no verified Cognito account yet.
- **Conversion_Window**: the 30-day period after a Guest_Claim during which the same phone number can be linked to a new full account, inheriting the original claim's history.
- **POPIA**: South African Protection of Personal Information Act; binding for all PII handling.

## Requirements

### Requirement 1: Reward-Threshold Grandfathering

**User Story:** As a consumer, I want progress I've already made toward a reward to be protected if the venue changes the threshold, so that I don't feel cheated when the goalposts move.

#### Acceptance Criteria

1. WHEN a consumer makes their first qualifying check-in toward a reward, THE system SHALL persist a Threshold_Lock containing the reward's current threshold, the timestamp, and the user ID.
2. WHEN a venue updates a reward's threshold, THE system SHALL leave existing Threshold_Lock rows unchanged.
3. WHEN computing whether a consumer has earned a reward, THE system SHALL use the threshold stored in their Threshold_Lock if one exists, otherwise the reward's current threshold.
4. WHEN a venue lowers a threshold, THE system SHALL replace the user's Threshold_Lock with the new lower threshold so the user gets the better deal.
5. WHEN a reward is deleted, THE system SHALL invalidate associated Threshold_Lock rows within 24 hours via the existing cleanup worker.
6. THE system SHALL expose the locked threshold in the consumer rewards UI as "X of Y visits" using the locked Y, never the current.
7. THE system SHALL surface a one-line explanation in the business portal reward editor: "Existing customers stay on their original visit count. Only new customers see the new threshold."

### Requirement 2: Reward Expiry Transparency

**User Story:** As a consumer, I want to know exactly what does and doesn't expire in this rewards program, so that I trust the program enough to keep using it.

#### Acceptance Criteria

1. THE consumer rewards screen SHALL display a fixed-position helper line: "Your tier never expires. Specific Gets may have end dates set by the venue."
2. WHEN a reward has an `expiresAt` within the next 7 days, THE system SHALL display a yellow countdown badge ("Expires in 3 days") on the reward card.
3. WHEN a reward has an `expiresAt` within the next 24 hours, THE system SHALL display a red countdown badge ("Expires in 4 hours") on the reward card.
4. WHEN a reward has expired, THE system SHALL move it to a separate "Expired" section rather than removing it from the user's list, so the user has a record of what they could have claimed.
5. THE system SHALL never display a countdown for tier or accumulated visit count.

### Requirement 3: Tier-Permanence Commitment

**User Story:** As a consumer, I want a written, public guarantee that my tier never gets reset, so that I trust the program over multi-year horizons.

#### Acceptance Criteria

1. THE Terms of Service SHALL include a clause: "Your tier and accumulated visit count are permanent. Area Code commits never to reset, downgrade, or annualise tier or visit count."
2. THE consumer profile screen SHALL display the same commitment as a single line beneath the tier badge.
3. WHEN the consent version increments, THE updated T&Cs SHALL preserve the tier-permanence clause unchanged or strengthened, never weakened.
4. THE admin portal SHALL block, with a clear error, any direct API or UI action that would decrement a user's tier below the level implied by their visit count.

### Requirement 4: GPS-Proximity Check-In Nudge

**User Story:** As a consumer, I want a gentle reminder to check in when I arrive at a venue I've been to before, so that I don't miss earning a visit because the queue forms before staff can ask me.

#### Acceptance Criteria

1. WHEN the consumer web app has location permission AND the user has previously checked in at any venue, THE app SHALL run a low-frequency client-side proximity check (every 60 seconds while the app is open).
2. WHEN the user's current location is within the Geofence of a venue they have previously visited, AND no Proximity_Nudge has fired for that venue in the last 6 hours, THE app SHALL display an in-app banner: "You're at {venueName}. Check in?"
3. WHEN the user dismisses a Proximity_Nudge, THE app SHALL not re-fire the same nudge for the same venue for 24 hours.
4. WHEN the user has granted web-push permission, THE app SHALL also fire a single low-priority push notification with the same copy.
5. THE proximity check SHALL never persist the user's coordinates server-side. POPIA compliance requires the comparison happen client-side only.
6. THE Proximity_Nudge SHALL be disabled by default for users with privacy level `private` and respect a per-user toggle in settings.
7. THE Proximity_Nudge SHALL not fire for venues the user has blocked or that have been disabled.

### Requirement 5: Sentry Release-Health Auto-Rollback

**User Story:** As an ops engineer, I want a bad release to roll itself back automatically before it churns users, so that a regression doesn't compound for hours while we sleep.

#### Acceptance Criteria

1. WHEN a new Lambda version is deployed and aliased to `live`, THE deploy pipeline SHALL record a release marker in Sentry with the new version number.
2. WHEN 30 minutes have elapsed since promotion, THE deploy pipeline SHALL query Sentry release-health for the new version's crash-free user rate.
3. IF the new version's crash-free user rate is more than 1 percentage point lower than the previous version's 7-day average, THEN THE pipeline SHALL re-alias `live` to the previous Lambda version and post an alert to the ops Slack channel.
4. IF the new version's error count exceeds the previous version's 7-day average by 5x or more, THEN THE pipeline SHALL trigger the same auto-rollback.
5. THE auto-rollback SHALL run inside the existing GitHub Actions workflow with no new always-on infrastructure.
6. THE auto-rollback SHALL complete within 5 minutes of detection.
7. WHEN rollback is triggered, THE pipeline SHALL block re-deployment of the same commit until a human acknowledges the alert.

### Requirement 6: Casual-Customer First-Get Path (token-based)

**User Story:** As a first-time walk-in to a venue, I want to claim a single introductory reward without giving any personal information at the till, so that I have a low-risk reason to try the app.

> **Auth model note (May 2026):** Phone OTP is permanently disabled on the platform (SMS reliability issues with SA carriers). This requirement uses a one-time **token** issued by staff at the till. The customer takes the token home (printed slip, screen photo, hand-written) and exchanges it for one historical visit credit when they sign up with email or Google.

#### Acceptance Criteria

1. THE business portal SHALL allow a venue owner to mark exactly one Reward as the venue's "First-Get".
2. WHEN a staff member confirms a First-Get redemption, THE system SHALL mint a one-time 8-character token (Crockford base32, no I/L/O/U) and return it to the staff app for display.
3. THE Guest_Claim record SHALL include only: token, reward ID, venue ID, staff ID, staff name, issuedAt, conversion-window expiry. **No PII whatsoever** (no phone, no email, no name).
4. WHEN a token is exchanged via `POST /v1/users/me/redeem-guest-token` within the Conversion_Window, THE system SHALL credit the redeeming user with one historical visit and mark the token redeemed.
5. WHEN a token is exchanged after the Conversion_Window expires, THE system SHALL return a `token_expired` error.
6. WHEN a token is already redeemed, a second redeem attempt SHALL fail with `token_already_used` (DynamoDB conditional-write enforces atomicity).
7. WHEN a token does not exist, exchange SHALL fail with `token_not_found`.
8. THE staff app SHALL display the token large enough to read at arm's length and SHALL allow printing or sharing.
9. THE business portal leaderboard SHALL count guest tokens toward the staff member's `redemptions` and (once redeemed) `uniqueConsumersServed`, but NOT `attributedReturnVisits`.
10. THE Guest_Claim record SHALL TTL out 60 days after issue (Conversion_Window + 30-day audit grace) per POPIA hygiene.

## Non-Functional Requirements

### Cost & Architecture

1. THE solution SHALL add no always-on AWS resources (no ECS, RDS, ElastiCache, ALB, NAT Gateway).
2. THE solution SHALL reuse existing DynamoDB tables (`area-code-prod-app-data`, `users`, `nodes`, `rewards`) where possible. New tables only with explicit justification.
3. THE Threshold_Lock storage SHALL use the existing `app-data` table with partition key `LOCK#<userId>#<rewardId>`.
4. THE Guest_Claim storage SHALL use the existing `app-data` table with partition key `GUESTCLAIM#<phoneE164>`.
5. THE Proximity_Nudge SHALL run entirely client-side. No server-side geolocation processing.

### Privacy (POPIA)

1. THE Threshold_Lock SHALL contain no PII beyond user ID.
2. THE Guest_Claim SHALL retain phone number only for the duration of the Conversion_Window.
3. THE Proximity_Nudge SHALL never persist coordinates beyond the device.
4. THE consumer SHALL be able to disable Proximity_Nudges in privacy settings.

### Observability

1. EACH new code path SHALL emit structured logs at INFO level on success and WARN/ERROR on failure.
2. THE auto-rollback decision SHALL be recorded as a Sentry release deployment event with rollback metadata.
3. THE Guest_Claim SHALL emit a metric `guest_claims_total` per business per day for the existing CloudWatch dashboard.
