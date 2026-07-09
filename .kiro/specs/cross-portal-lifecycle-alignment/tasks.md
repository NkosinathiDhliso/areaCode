# Implementation Plan: Cross-Portal Lifecycle Alignment

## Overview

Bottom-up per portal, with one hard sequencing rule: task 1 (admin comps)
depends on billing-revenue-integrity task 5 (extended Tier_Resolver) being
merged, because comps are expressed as Paid_Until windows. Tasks 2 through 7
are independent of the billing implementation order and of each other, except
task 5 (consumer wallet honesty) which reads the flag added in task 4.3.

No new tables, queues, or workers. The outbox is client-side. No SMS, no
phone identifiers.

## Tasks

- [x] 1. Admin comps join the window algebra (R1) - AFTER billing task 5
  - [x] 1.1 Extend `setBusinessTier` to write the Comp_Window
    - Paid tiers require `paidUntil` (ISO, future); starter forbids it and
      clears `paidUntil` / `paidInterval`; both clear `trialEndsAt` and
      `paymentGraceUntil`; audit log records the window
    - Zod body validation in `features/admin/types.ts`
    - Unit tests: validation matrix, clears, audit content
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_
  - [x] 1.2 BusinessManagement set-tier dialog collects the end date
    - Default +1 calendar month; copy states normal grace flow applies on
      lapse
    - _Requirements: 1.4_
  - [x] 1.3 Write property test for comp equivalence
    - Property 1: comp and paid activation are indistinguishable to the
      resolver
    - _Requirements: 1.1_

- [x] 2. Admin lifecycle visibility (R2)
  - [x] 2.1 `listBusinessesInGraceProjection` repository query + admin
        endpoint `GET /v1/admin/businesses/grace`
    - Projection only (id, name, tier, grace expiry), `requireAuth('admin')`,
      pagination per existing admin list endpoints
    - _Requirements: 2.2_
  - [x] 2.2 Business_State_Badge in BusinessManagement
    - Stored tier, effective tier, window source, Paid_Until, grace; extract
      `BusinessStateBadge` component if the screen crosses limits
    - _Requirements: 2.1_
  - [x] 2.3 GraceList admin screen wired into nav
    - Soonest expiry first, links into BusinessManagement detail
    - _Requirements: 2.2_
  - [x] 2.4 System-actor audit entry on Lapse_Sweep demotion
    - `deactivateForNonPayment` writes actor `system:lapse-sweep`, action
      `deactivate_for_non_payment`; renders in the existing AuditTrailViewer
      unchanged; unit test asserts the entry
    - _Requirements: 2.3_

- [x] 3. Staff honest lapsed state (R3)
  - [x] 3.1 Staff bootstrap read includes `businessState`
    - Derived server-side; no polling, no socket
    - _Requirements: 3.1_
  - [x] 3.2 `LapsedBusinessBanner` on StaffHome
    - Names the state and what still works; no billing amounts; jsdom test
      for render conditions
    - _Requirements: 3.1_
  - [x] 3.3 Pin the Earned_Code_Policy with regression tests
    - Test: code earned at an active node redeems after the node and business
      go inactive, within validity; test: no new earning at inactive nodes;
      fix code only if an assertion fails
    - _Requirements: 3.2, 3.3_
  - [x] 3.4 Write property test for earned-code policy
    - Property 4
    - _Requirements: 3.2_
  - [x] 3.5 Reconcile churn-defences stale task text
    - Mark 18.4 obsolete pointing at `FirstGetIssuer` and the staff-surface
      regression test; correct 19.4 phone-primary wording
    - _Requirements: 3.4_

- [x] 4. Backend replay support for the outbox (R5)
  - [x] 4.1 Optional `capturedAt` on the check-in body with Replay_Window
    - Reject older than 15 minutes with typed `checkin_replay_expired`;
      proximity validated on submitted coordinates; presence starts at
      delivery time
    - _Requirements: 5.3, 5.4_
  - [x] 4.2 Idempotency on (userId, nodeId, capturedAt)
    - Conditional write; double delivery returns the original success; unit
      tests for the race
    - _Requirements: 5.7_
  - [x] 4.3 Extend the unclaimed-rewards payload with `venueActive`
    - Shared type updated; no per-card venue fetch
    - _Requirements: 4.2_
  - [x] 4.4 Write property test for replay honesty
    - Property 3
    - _Requirements: 5.3, 5.4_

- [x] 5. Consumer wallet honesty (R4)
  - [x] 5.1 RedemptionCodeCard lapsed-venue line
    - Copy per R4.1/R4.3; driven by `venueActive`; jsdom test
    - _Requirements: 4.1, 4.3_

- [x] 6. Consumer check-in outbox (R5)
  - [x] 6.1 `apps/web/src/lib/checkinOutbox.ts` pure logic core
    - Enqueue decision (network/5xx only), retry schedule 30s/2m/8m, park
      after 3, Replay_Window discard before any network call, injected
      storage adapter
    - _Requirements: 5.1, 5.2, 5.4_
  - [x] 6.2 Write property test for the outbox state machine
    - Property 2: single-state invariant, retry cap, no stale network calls,
      success/4xx always remove
    - _Requirements: 5.1, 5.2, 5.4, 5.5_
  - [x] 6.3 `useCheckinOutbox` pump hook wired into the check-in flow
    - Interval + `online` event, cleanup on unmount, disabled buttons during
      in-flight retries where surfaced
    - _Requirements: 5.1, 5.2_
  - [x] 6.4 ProfileScreen parked-failures section
    - Retry (re-enqueue, Replay_Window permitting) and discard actions; jsdom
      test
    - _Requirements: 5.6_

- [x] 7. Record deferred-surface decisions (R6)
  - [x] 7.1 Annotate `docs/PLATFORM_AUDIT_FINDINGS.md`
    - C4 closed by this spec; mobile deferral and its outbox follow-up
      recorded with the no-phone-auth binding
    - _Requirements: 6.1, 6.2_

- [x] 8. End-to-end sweep
  - [x] 8.1 Playwright: staff home renders the lapsed banner for a demoted
        fixture business
  - [x] 8.2 Playwright: consumer profile shows a parked check-in and retry
        path (mocked network failure)
