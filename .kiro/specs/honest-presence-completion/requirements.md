# Requirements Document

## Introduction

This feature closes two consumer-web gaps where the live presence signal undershoots
the binding honest-presence product rules (`.kiro/steering/honest-presence.md` and
`.kiro/steering/constellation-mode.md` §3, UI gap #3). Both backend capabilities
already exist and are wired; the gap is purely that the consumer frontend never uses
them.

- **Gap A — Manual check-out is unreachable from consumer web.** `POST /v1/check-out`
  is fully implemented (`backend/src/features/check-out/handler.ts`,
  `service.ts`) and emits a `friend:checkout` socket event and a
  `node:presence_update` event with `cause: 'check_out'`. The web already listens for
  both events (`apps/web/src/hooks/useFriendsPresence.ts`,
  `packages/shared/hooks/useNodePulse.ts`), but no consumer surface ever calls
  `/v1/check-out`. Presence can therefore only end via backend expiry, so the
  "filling up / winding down" momentum signal cannot be user-driven. This violates the
  honest-presence rule "momentum requires departures."

- **Gap B — Per-venue presence count is never seeded over REST.**
  `GET /v1/nodes/:nodeId/presence` exists (`backend/src/features/nodes/handler.ts`)
  and returns the honest Live_Presence_Count. In production
  `getNodesByCitySlug` deliberately seeds only `pulseScore` and never
  `liveCheckInCount` (it avoids a per-node fan-out on the hot map read path), and
  `packages/shared/hooks/useNodePulse.ts` documents that the count should be primed
  from the read endpoint but no caller exists. Counts therefore depend entirely on the
  live `node:presence_update` socket event, so a venue reads `0` / "quiet" on first
  paint until an event arrives. This is exactly the "backend follow-up" gap called out
  in `constellation-mode.md` UI gap #3.

The primary surfaces are the consumer web app (`apps/web`): the venue detail body
(`apps/web/src/components/NodeDetailContent.tsx`) and the map load
(`apps/web/src/screens/MapScreen.tsx`). Logic that belongs in shared hooks/stores
(`packages/shared`) is called out so the half-built mobile app inherits it.

### Constraints and scope notes

- **No new backend endpoints are required for the primary path.** Both
  `POST /v1/check-out` and `GET /v1/nodes/:nodeId/presence` already exist and are
  registered. Requirement 3 flags the one place where full server-confirmed honesty
  would imply a backend change (the presence read carries no "is the current user
  present" flag, and `CheckInResponse` carries no `expiresAt`); that change is
  explicitly out of scope for this spec and the requirements are written to stay
  honest without it.
- **Email/password and Google OAuth only.** No phone or SMS surface is added, revived,
  or referenced (`.kiro/steering/no-sms-no-phone-auth.md`). Check-out is authenticated
  by the existing consumer JWT.
- **One source of truth, no duplicates.** Check-out, presence seeding, and the local
  presence signal are implemented by extending the existing shared hooks/stores
  (`useCheckIn`, `useNodePulse`, `mapStore`), never by forking parallel copies
  (`.kiro/steering/dry-reuse-no-duplication.md`).

## Glossary

- **Consumer_Web**: The consumer web app (`apps/web`), mobile-first React + Vite.
- **Venue_Detail**: The venue detail body rendered by
  `apps/web/src/components/NodeDetailContent.tsx` (Commit_Mode of the Peek_Carousel
  bottom sheet). The surface that owns the check-in CTA and will own the check-out CTA.
- **Map_Screen**: `apps/web/src/screens/MapScreen.tsx`, which loads city nodes via
  `GET /v1/nodes/:citySlug`.
- **Check_Out_Endpoint**: The existing `POST /v1/check-out`, body `{ nodeId }`,
  consumer-JWT authenticated, returning
  `{ nodeId, presenceState: 'checked_out' | 'no_active_presence', dwellSeconds }`.
- **Presence_Read**: The existing `GET /v1/nodes/:nodeId/presence`, returning
  `{ nodeId, livePresenceCount }` computed honestly from current presence records.
- **Live_Presence_Count**: The honest count of people present at a venue right now
  (check-in minus check-out minus expiry), held client-side in
  `mapStore.checkInCounts` and updated by the `node:presence_update` socket event.
- **Local_Presence**: The Consumer_Web's own client-side knowledge that the signed-in
  user currently has an active (un-expired) presence at a specific venue, used only to
  decide whether to offer the check-out control. Distinct from Live_Presence_Count.
- **Check_Out_Control**: The consumer-facing control on Venue_Detail that calls
  Check_Out_Endpoint.
- **Presence_Update_Event**: The `node:presence_update` socket event already handled
  by `useNodePulse`, payload `{ nodeId, livePresenceCount, cause }`.
- **Friend_Checkout_Event**: The `friend:checkout` socket event already handled by
  `useFriendsPresence`, payload `{ userId, nodeId }`.
- **Quiet_State**: The honest empty/low-confidence presentation ("Quiet right now")
  shown when presence data is unavailable or zero, instead of a fabricated count.
- **Reduced_Motion**: The `prefers-reduced-motion` user preference.

## Requirements

### Requirement 1: Manual check-out from the venue detail surface

**User Story:** As a signed-in consumer who has checked in at a venue, I want to
manually check out from the venue detail surface, so that the live count reflects my
departure and the "winding down" signal stays honest.

#### Acceptance Criteria

1. WHERE the signed-in consumer has Local_Presence at the displayed venue, THE
   Venue_Detail SHALL render the Check_Out_Control.
2. WHEN the consumer activates the Check_Out_Control, THE Consumer_Web SHALL send one
   `POST /v1/check-out` request with body `{ nodeId }` for the displayed venue,
   authenticated by the existing consumer JWT.
3. WHILE a check-out request is in flight, THE Consumer_Web SHALL disable the
   Check_Out_Control and display a loading state on it.
4. WHILE a check-out request is in flight, THE Consumer_Web SHALL ignore further
   activations of the Check_Out_Control until the request resolves, so a single
   departure produces at most one `POST /v1/check-out` request.
5. WHEN the Check_Out_Endpoint responds with `presenceState` equal to `checked_out`,
   THE Consumer_Web SHALL clear Local_Presence for that venue and hide the
   Check_Out_Control.
6. WHEN the Check_Out_Endpoint responds with `presenceState` equal to
   `no_active_presence`, THE Consumer_Web SHALL clear Local_Presence for that venue and
   hide the Check_Out_Control without surfacing an error.
7. IF the Check_Out_Endpoint returns a status code of 401, THEN THE Consumer_Web SHALL
   prompt the consumer to sign in and SHALL NOT change Local_Presence.
8. IF the Check_Out_Endpoint returns a status code of 429, THEN THE Consumer_Web SHALL
   display a message that the consumer is acting too quickly and SHALL re-enable the
   Check_Out_Control for retry.
9. IF the Check_Out_Endpoint returns a network error or a status code of 500, THEN THE
   Consumer_Web SHALL display a check-out failure message, SHALL retain Local_Presence,
   and SHALL re-enable the Check_Out_Control for retry.

### Requirement 2: Honest check-out control visibility

**User Story:** As a consumer, I want the check-out control to appear only when I am
actually present at a venue, so that the interface never implies a presence state that
is not real.

#### Acceptance Criteria

1. WHERE the signed-in consumer does not have Local_Presence at the displayed venue,
   THE Venue_Detail SHALL hide the Check_Out_Control.
2. WHILE the consumer is not authenticated, THE Venue_Detail SHALL hide the
   Check_Out_Control.
3. WHERE the signed-in consumer has Local_Presence at the displayed venue, THE
   Venue_Detail SHALL present the check-in CTA and the Check_Out_Control as distinct
   controls, so the two presence actions are never represented by a single ambiguous
   control.
4. WHEN the displayed venue changes within the venue detail sheet, THE Venue_Detail
   SHALL evaluate Check_Out_Control visibility against the newly displayed venue.

### Requirement 3: Local presence signal that drives control visibility

**User Story:** As a consumer, I want the app to know when I am present at a venue, so
that check-out is offered honestly without over-claiming my own state.

#### Acceptance Criteria

1. WHEN the `POST /v1/check-in` request for a venue succeeds, THE Consumer_Web SHALL
   record Local_Presence for that venue, including the check-in time.
2. WHEN the consumer checks in at a different venue, THE Consumer_Web SHALL record
   Local_Presence only for the most recently checked-in venue, so Local_Presence
   reflects a single current venue.
3. WHEN the consumer signs out, THE Consumer_Web SHALL clear all Local_Presence.
4. WHILE the elapsed time since the recorded check-in exceeds the maximum presence
   Expiry_Window, THE Consumer_Web SHALL treat Local_Presence as absent and hide the
   Check_Out_Control, so a stale local signal cannot offer check-out after the server
   would have expired the presence.
5. WHEN a Presence_Update_Event with `cause` equal to `expiry` is received for the
   venue where the consumer holds Local_Presence, THE Consumer_Web SHALL treat that as
   a signal that the consumer's own presence may have ended and SHALL re-evaluate
   Check_Out_Control visibility.
6. THE Consumer_Web SHALL derive Local_Presence only from the consumer's own check-in
   and check-out actions and their elapsed time, and SHALL NOT infer that the consumer
   is present from the aggregate Live_Presence_Count.
7. WHERE precise server-confirmed knowledge of the consumer's own presence state is
   required (the Presence_Read returns only an aggregate count and `CheckInResponse`
   returns no `expiresAt`), THE requirements SHALL treat that as a backend change that
   is out of scope for this spec, and THE Consumer_Web SHALL favor hiding the
   Check_Out_Control when Local_Presence confidence is uncertain rather than showing it
   (under-claim, never over-claim).

### Requirement 4: Count reconciliation after check-out

**User Story:** As a consumer, I want the live count to update when I check out, so
that what I see immediately matches the honest server-confirmed count.

#### Acceptance Criteria

1. WHEN the Check_Out_Endpoint responds with `presenceState` equal to `checked_out`,
   THE Consumer_Web SHALL reflect the consumer's departure in the displayed
   Live_Presence_Count for that venue.
2. WHEN a Presence_Update_Event is received for a venue, THE Consumer_Web SHALL set the
   displayed Live_Presence_Count for that venue to the event's `livePresenceCount`
   value, so the server-confirmed count is the source of truth.
3. WHERE the Consumer_Web applies an optimistic count decrement on check-out before the
   Presence_Update_Event arrives, THE Consumer_Web SHALL reconcile to the event's
   `livePresenceCount` when the event is received, even when the reconciled value
   differs from the optimistic value.
4. THE Consumer_Web SHALL NOT display a negative Live_Presence_Count.
5. WHEN a Friend_Checkout_Event is received, THE Consumer_Web SHALL continue to remove
   that friend from the venue's friends-at-venue presence via the existing handler,
   without altering the aggregate Live_Presence_Count reconciliation in this
   requirement.

### Requirement 5: Seed per-venue presence count from REST on load

**User Story:** As a consumer, I want a venue to show its honest live count on first
paint, so that an alive venue does not read as quiet before a socket event arrives.

#### Acceptance Criteria

1. WHEN a venue is brought into focus on Map_Screen or its Venue_Detail opens, THE
   Consumer_Web SHALL request `GET /v1/nodes/:nodeId/presence` for that venue.
2. WHEN the Presence_Read responds, THE Consumer_Web SHALL set the venue's
   Live_Presence_Count to the response's `livePresenceCount` value.
3. WHEN a Presence_Update_Event for a venue is received after the Presence_Read seed,
   THE Consumer_Web SHALL update the venue's Live_Presence_Count from the event, so the
   REST seed primes first paint and live socket updates keep it in sync.
4. THE Consumer_Web SHALL seed the Live_Presence_Count per venue on demand and SHALL
   NOT issue a citywide per-node presence fan-out on the Map_Screen city-load path,
   consistent with the backend hot-path design that omits `liveCheckInCount` from the
   `GET /v1/nodes/:citySlug` payload.
5. IF the Presence_Read returns a non-success status code or a network error, THEN THE
   Consumer_Web SHALL leave any existing Live_Presence_Count unchanged and SHALL
   present the Quiet_State rather than a fabricated count.

### Requirement 6: Honest-presence guardrails

**User Story:** As a consumer, I want the app to under-claim rather than over-claim
activity, so that I can trust the live signal.

#### Acceptance Criteria

1. IF presence data for a venue is unavailable, THEN THE Consumer_Web SHALL present the
   Quiet_State and SHALL NOT display a fabricated or substituted count.
2. WHERE a venue's Live_Presence_Count is zero, THE Consumer_Web SHALL present the
   Quiet_State rather than implying a crowd.
3. THE Consumer_Web SHALL present presence as an aggregate count only and SHALL NOT
   expose the identity of any individual present at a venue from the aggregate
   presence surfaces.
4. WHILE Reduced_Motion is enabled, THE Consumer_Web SHALL apply check-out and
   count-change presentation without motion-based animation.
5. THE Consumer_Web SHALL keep the Check_Out_Control authenticated by the existing
   consumer JWT and SHALL NOT introduce any phone, SMS, or one-time-passcode input on
   any check-out or presence surface.

### Requirement 7: Shared logic and cross-platform inheritance

**User Story:** As a maintainer, I want presence completion logic to live in shared
hooks and stores, so that the mobile app inherits the same honest behavior without
duplicated code.

#### Acceptance Criteria

1. THE Consumer_Web SHALL invoke the Check_Out_Endpoint through a single shared
   check-out mechanism in `packages/shared` that mirrors the existing `useCheckIn`
   hook, rather than a `apps/web`-local fetch implementation.
2. THE Consumer_Web SHALL hold Local_Presence and Live_Presence_Count in the existing
   shared store (`mapStore`) so that presence state has one home reused across apps.
3. THE Presence_Read seeding SHALL be implemented so that a future mobile caller can
   reuse the same shared mechanism without re-implementing the seed.
4. THE shared presence changes SHALL NOT modify the `node:presence_update` or
   `friend:checkout` event contracts, since both events are already emitted by the
   backend and consumed by the existing web hooks.
