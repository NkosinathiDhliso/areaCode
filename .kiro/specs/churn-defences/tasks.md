# Tasks — Churn Defences

Implementation status: **Phases 1–5 shipped.** Phase 6 (acceptance & rollout) remains.

Each phase ships independently. None introduce always-on infra. None violate the serverless rule.

---

## Phase 1 — Copy & contract changes · SHIPPED

### Task 1: Reward expiry transparency · Req 2

- [x] 1.1 Add a fixed helper line on the consumer rewards screen: "Your tier never expires. Specific Gets may have end dates set by the venue."
- [x] 1.2 Add a `<CountdownBadge>` shared component.
- [x] 1.3 Render the badge on each reward card.
- [x] 1.4 Move expired rewards to a separate "Expired" section inside the same screen.
- [ ] 1.5 Extend the e2e rewards spec with helper-line + countdown assertions.

### Task 2: Tier-permanence T&C commitment · Req 3

- [x] 2.1 Create `packages/shared/constants/legal.ts` exporting the canonical clause.
- [x] 2.2 Surface the tier-permanence clause on the T&Cs screen (web `TermsScreen` + shared `legal-content.ts`). Note: `AREA_CODE_CONSENT_VERSION` bump deferred — a major bump forces re-consent on next open, so it is a deliberate ops step.
- [x] 2.3 Add the same line to the consumer profile screen.
- [x] 2.4 Add a backend guard rejecting tier downgrades below the visit-count-implied tier.
- [x] 2.5 Property test the guard.

### Task 3: Documentation

- [ ] 3.1 Add the tier-permanence clause to `docs/PRIVACY.md`.
- [x] 3.2 `docs/CHURN_DEFENSES.md` references the canonical clause file.

---

## Phase 2 — Reward-Threshold Grandfathering · Req 1 · SHIPPED

### Task 4: Threshold-lock storage layer

- [x] 4.1 Create `backend/src/features/rewards/threshold-lock.ts` with `getOrCreateLock`, `incrementProgress`, `getEffectiveThreshold`, `deleteLock`, `cleanupOrphanedLocks`.
- [x] 4.2 DynamoDB key shape `LOCK#<userId>#<rewardId>`.
- [x] 4.3 Property tests for `computeEffectiveThreshold`.

### Task 5: Wire into check-in pipeline

- [x] 5.1 Call `processCheckInRewardLocks` after `processCheckIn` insert.
- [x] 5.2 Apply the lock when computing reward eligibility (`getRewardEligibility`).

### Task 6: Surface in UIs

- [x] 6.1 Reward eligibility now uses `getEffectiveThreshold`.
- [x] 6.2 Reward editor in business portal shows the explanation line.
- [x] 6.3 Reward editor confirm dialog: "X customers will keep their existing progress." Backend `GET /v1/business/rewards/:id/lock-count` (`countLocksForReward`, ownership-gated), threshold now editable on the reward edit form, and a confirm dialog fires when the threshold changes and locks exist.

### Task 7: Cleanup

- [x] 7.1 Cleanup worker drops orphaned locks daily.
- [ ] 7.2 Test for cleanup happy path + idempotence.

---

## Phase 3 — GPS-Proximity Check-In Nudge · Req 4 · SHIPPED

### Task 8: Visited-nodes endpoint

- [x] 8.1 `GET /v1/users/me/visited` returning `{ items: Array<{ nodeId, lat, lng, radiusM }> }`.
- [x] 8.2 No new PII surfaces.
- [x] 8.3 Banner caches client-side for 1 hour.

### Task 9: Client-side proximity hook

- [x] 9.1 `packages/shared/hooks/useProximityNudge.ts` created.
- [x] 9.2 Haversine + 60s loop + 6h/24h cooldowns + daily cap of 5.
- [x] 9.3 Persist cooldown state in `localStorage`.
- [x] 9.4 Skip when privacy is `private` or proximity toggled off.
- [x] 9.5 Property test the cooldown logic.

### Task 10: Banner UI + push integration

- [x] 10.1 `ProximityNudgeBanner` component on the consumer map screen.
- [x] 10.2 Dismiss persists for 24h per venue.
- [ ] 10.3 Optional: also send a `web-push` Notification (deferred).

### Task 11: Privacy toggle

- [x] 11.1 `proximityNudgesEnabled` field added to the `User` type. Defaults to true (false for `private`).
- [ ] 11.2 Settings UI to flip the toggle (deferred — backend already respects the field).

---

## Phase 4 — Sentry Release-Health Auto-Rollback · Req 5 · SHIPPED

### Task 12: Release marker on deploy

- [x] 12.1 `deploy-lambda.yml` records a Sentry release per prod deploy.
- [x] 12.2 Captures previous live version SHA.

### Task 13: Health-gate workflow

- [x] 13.1 New `release-health-gate.yml` triggered after prod deploy.
- [x] 13.2 30-minute wait, Sentry query, decision logic.
- [x] 13.3 AWS CLI `update-alias` rollback step.
- [x] 13.4 Slack alert.
- [x] 13.5 Auto-rollback tags the rolled-back commit.

### Task 14: Dry-run mode

- [x] 14.1 `dryRun` workflow input runs the decision but skips alias swap.

### Task 15: Documentation

- [x] 15.1 `docs/ROLLBACK.md` documents the auto-rollback path and override.
- [ ] 15.2 RUNBOOK call-out (deferred — covered indirectly).

---

## Phase 5 — Casual-Customer First-Get Path · Req 6 · SHIPPED

### Task 16: Reward schema

- [x] 16.1 `isFirstGet: boolean` added to `Reward` type.
- [x] 16.2 Service-layer uniqueness enforcement (one First-Get per node).
- [x] 16.3 Reward editor checkbox in business portal.

### Task 17: Guest-claim storage layer

- [x] 17.1 `backend/src/features/rewards/guest-claim.ts` with `createGuestClaim`, `findGuestClaimsByPhone`, `getOpenClaimsForConversion`, `deleteAllClaimsForPhone`.
- [x] 17.2 DynamoDB key shape `GUESTCLAIM#<phoneE164>`.
- [x] 17.3 Anti-abuse: per-venue uniqueness + 3-claim-per-30d cap.
- [x] 17.4 Property tests for the anti-abuse rules.

### Task 18: Staff redemption flow

- [x] 18.1 `GET /v1/staff/first-get/:rewardId/preview` accepts a phone, returns anti-abuse decision.
- [x] 18.2 `POST /v1/staff/first-get/:rewardId/confirm` creates the GUESTCLAIM row.
- [x] 18.3 Staff–business ownership check.
- [ ] 18.4 Staff scanner UI surfacing the new flow (deferred — backend ready, UI pending).

### Task 19: Conversion on signup

- [x] 19.1 `convertGuestClaims` helper invoked on consumer phone signup.
- [x] 19.2 Looks up open claims within Conversion_Window.
- [x] 19.3 Credits one historical visit per claim and deletes claim rows.
- [ ] 19.4 Email-signup branch wiring (deferred — phone signup is the primary path).

### Task 20: Leaderboard integration

- [x] 20.1 Guest claims contribute to `redemptions` and `uniqueConsumersServed`.
- [x] 20.2 Excluded from `attributedReturnVisits` (no userId to track).
- [ ] 20.3 Business leaderboard UI footnote: "incl. guest claims" (deferred).

### Task 21: Cleanup

- [x] 21.1 GUESTCLAIM TTL handles automatic deletion (60 days). No worker change required.

---

## Phase 6 — Acceptance & rollout · PENDING

### Task 22: E2E coverage

- [ ] 22.1 `tests/e2e/tests/consumer/threshold-grandfather.spec.ts`.
- [ ] 22.2 `tests/e2e/tests/staff/guest-claim.spec.ts`.
- [ ] 22.3 Update `tests/e2e/README.md` coverage matrix.

### Task 23: Privacy review

- [ ] 23.1 Confirm the Threshold_Lock stores only userId.
- [ ] 23.2 Confirm Guest_Claim phone deletion within 60 days.
- [ ] 23.3 Confirm Proximity_Nudge never persists coordinates server-side.

### Task 24: Comms and rollout

- [ ] 24.1 Draft in-app announcement of the tier-permanence commitment.
- [ ] 24.2 Brief sales / business-development on the First-Get path.
- [x] 24.3 Update `SALES_PITCH.md` (repo root; there is no `docs/SALES_PITCH.md`) to include the casual-customer story. Added the "Turning Walk-Ins Into Members: The First-Get" section.

---

## Out-of-scope for this spec

- Per-tier reward customisation. Tracked separately.
- Daily worker pre-computing retention beyond 26 weeks. Tracked in platform-completeness.
- Push-notification re-engagement campaigns. Separate growth experiment.
