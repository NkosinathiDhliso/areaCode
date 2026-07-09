# Design Document

## Overview

### Goals

- Make admin comps first-class citizens of the billing window algebra with
  zero new resolver branches.
- Give admin read access to the lifecycle it now governs (state badge, grace
  list, demotion audit entries).
- Turn two accidental behaviours into decided, tested policy: earned codes at
  lapsed venues (staff and consumer sides) and lapsed-business staff UX.
- Close platform audit C4 with a durable consumer check-in outbox that stays
  inside the honest-presence rules.
- Retire the stale phone-flavoured churn-defences task text.

### Non-Goals (out of scope)

- Any change to payment, webhook, or renewal code (that is
  `billing-revenue-integrity`).
- Mobile app work (recorded deferral only).
- Offline read caching, service workers, or PWA scope changes.
- New notification channels.

### Architectural Constraints (binding)

- Serverless only; no new tables, queues, or workers. The outbox is
  client-side localStorage; the grace list is a repository query on existing
  attributes.
- Handler to service to repository layering; admin reads stay in the admin
  feature, business attributes stay behind the business repository.
- One home per concept: the Comp_Window IS Paid_Until. No `compUntil`
  attribute, no parallel entitlement field.
- Honest presence: replayed check-ins never backdate presence; the presence
  window starts at delivery.
- No SMS, no phone identifiers anywhere, including in outbox rows.

### Dependency

Requirement 1 assumes the extended Tier_Resolver and Paid_Until attributes
from billing-revenue-integrity tasks 2 and 5. Do not start R1 before billing
task 5 is merged; everything else can proceed in parallel.

## Architecture

### Component map

```
admin portal
  ├─ BusinessManagement: Business_State_Badge + comp end-date field
  └─ GraceList screen: GET /v1/admin/businesses/grace

admin feature (backend)
  ├─ setBusinessTier: writes tier + Paid_Until (comp), clears trial/grace
  └─ listBusinessesInGrace: projection query

business feature (backend)
  └─ Lapse_Sweep demotion writes a system-actor audit entry (reuses
     admin repo createAuditLog with actor 'system:lapse-sweep')

staff portal
  └─ StaffHome: Lapsed_Business_Banner from business state on the existing
     staff bootstrap read

rewards feature (backend)
  └─ Earned_Code_Policy pin tests (no behaviour change expected)

consumer web
  ├─ lib/checkinOutbox.ts: pure logic core (enqueue/retry/park/discard)
  ├─ useCheckinOutbox hook: online listener + interval pump
  ├─ ProfileScreen: parked-failure section
  └─ RedemptionCodeCard: lapsed-venue honest line

check-in feature (backend)
  └─ accepts capturedAt within Replay_Window; idempotency on
     (userId, nodeId, capturedAt)
```

### Flows

**Flow 1: admin comp.** Admin picks tier + end date + reason. Backend writes
`tier`, `paidUntil = endDate`, `paidInterval = null`, `trialEndsAt = null`,
`paymentGraceUntil = null`, audit-logs `{ tier, reason, paidUntil }`. From
that point the business is indistinguishable from a paid one: the
Lapse_Sweep, grace email, and demotion all apply, which is the desired
behaviour for comps.

**Flow 2: lapse audit.** `deactivateForNonPayment` gains one call: write an
audit entry with actor `system:lapse-sweep`, action `deactivate_for_non_payment`,
after-state `{ tier: 'free', nodesDeactivated }`. Admin's existing
AuditTrailViewer renders it with no changes.

**Flow 3: staff lapsed banner.** The staff bootstrap read (existing staff
home data fetch) is extended with `businessState: 'active' | 'lapsed'`
derived server-side (business inactive or stored tier free after having had
staff). StaffHome renders the banner when lapsed. No polling, no socket.

**Flow 4: outbox.** Check-in submit catches network/5xx, calls
`outbox.enqueue(attempt)`. A single pump (interval + `online` event) takes
the oldest entry, submits with original `capturedAt` and coords. Success or
4xx removes the entry (4xx also toasts). Retry schedule 30s, 2m, 8m; after
the third failure the entry is parked. Parked entries render in ProfileScreen
with retry (re-enqueue with retryCount reset, subject to Replay_Window) and
discard. Entries past the Replay_Window are discarded with a toast at pump
time, before any network call.

**Flow 5: replay acceptance.** The check-in handler accepts an optional
`capturedAt`. If present and older than 15 minutes, reject with
`checkin_replay_expired`. Otherwise validate proximity with the submitted
coordinates exactly as a live check-in, then create the check-in with
presence starting now. Idempotency: a conditional write keyed on
`(userId, nodeId, capturedAt)` makes double delivery a no-op returning the
original success.

## Components and Interfaces

### Backend

- `features/admin/service.ts`: `setBusinessTier` signature gains
  `paidUntil: string` (required for paid tiers, forbidden for starter);
  validation in `features/admin/types.ts` Zod body. New
  `listBusinessesInGrace` + handler route
  `GET /v1/admin/businesses/grace`.
- `features/business/service.ts`: `deactivateForNonPayment` writes the
  system audit entry (import kept behind the shared interface used by admin
  audit logging today).
- `features/business/repository.ts`: `listBusinessesInGraceProjection`
  (paginated scan, same shape as `listBusinessesWithLapsedGrace`, projecting
  id, name, tier, `paymentGraceUntil`).
- `features/staff` bootstrap read: include `businessState`.
- `features/check-in`: optional `capturedAt` in the body schema, Replay_Window
  check, conditional-write idempotency, new typed error
  `checkin_replay_expired`.
- `features/rewards`: no behaviour change; two pin tests (earned code redeems
  at inactive node; no new earning at inactive node).

### Frontend

- `apps/admin/BusinessManagement.tsx`: badge column and comp end-date field;
  extract `BusinessStateBadge` component if the screen crosses component
  limits. New `GraceList.tsx` screen wired into admin nav.
- `apps/staff` StaffHome: `LapsedBusinessBanner` component, copy per R3.1.
- `apps/web/src/lib/checkinOutbox.ts`: pure module, no React, no I/O;
  storage adapter injected so tests drive it synchronously.
- `apps/web/src/hooks/useCheckinOutbox.ts`: pump wiring, cleanup on unmount.
- `apps/web` ProfileScreen: parked-failures section; RedemptionCodeCard
  lapsed-venue line driven by the extended unclaimed-rewards payload.
- `packages/shared/types`: unclaimed-reward item gains `venueActive`.

## Data Models

No new tables or rows. Attribute usage:

- Business_Row: comp writes reuse `paidUntil`; `paidInterval` null marks
  "window not bought" (comp or legacy), never branches logic.
- Check-in idempotency: existing check-ins table, conditional put on a
  deterministic sort key that already includes the user, node, and timestamp;
  if the current key uses server time, add `capturedAt` to the condition
  attributes rather than the key (no migration).
- Checkin_Outbox entry (localStorage, consumer namespace):
  `{ id, nodeId, capturedAt, lat, lng, retryCount, parkedAt? }`. No names, no
  phone, nothing beyond what a live check-in already sends.

## Correctness Properties

### Property 1: Comp equivalence

For any business state, applying an admin comp `(tier, endDate)` then
resolving the tier yields the same result as a paid activation producing the
same `paidUntil`. Comp and payment are indistinguishable to the resolver.

### Property 2: Outbox state machine

For any sequence of failures, successes, 4xx responses, and clock advances:
an entry is in exactly one of {queued, parked, gone}; retryCount never
exceeds 3; entries older than the Replay_Window never generate a network
call; success and 4xx always remove the entry. Min 100 runs.

### Property 3: Replay honesty

For any `capturedAt`, acceptance implies `now - capturedAt <= 15 minutes`,
and the created presence window starts at `now`, never at `capturedAt`.

### Property 4: Earned-code policy

For any reward code earned while its node was active, redemption outcome is
independent of the node's and business's current active flags, within the
code's validity window.

## Testing Strategy

- Property tests for the four properties above (fast-check, tagged
  `Feature: cross-portal-lifecycle-alignment, Property N`, block-statement
  predicates).
- Unit tests: setBusinessTier validation matrix (paid requires end date,
  starter forbids it), grace-list projection, staff bootstrap
  `businessState`, replay endpoint acceptance/rejection/idempotency.
- Component tests (jsdom): LapsedBusinessBanner render conditions,
  RedemptionCodeCard lapsed line, ProfileScreen parked section actions.
- The two rewards pin tests land even though no behaviour changes; they turn
  accident into contract.
