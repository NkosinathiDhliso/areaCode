# Requirements Document

## Introduction

The `presence-integrity` spec delivered the honest live-signal **data foundation** and is
fully implemented on the backend: an authenticated `POST /v1/check-out` action, bounded
serverless presence expiry, a `GET /v1/nodes/:nodeId/presence` honest read API, and a
`node:presence_update` realtime event consumed by `packages/shared/hooks/useNodePulse.ts`.
That spec was deliberately scoped as "the honest data foundation only" and deferred the
consumer-facing UI.

This spec, **Honest Presence UI**, is that deferred consumer layer. It does **not**
re-specify or duplicate any backend behaviour owned by `presence-integrity`; it consumes the
already-built endpoints and events. Its job is twofold:

1. Give the consumer a way to **check out** ("I'm leaving") from the web app, so the live
   count can fall through user action and the binding `honest-presence.md` rule "momentum
   requires departures" is actually satisfiable on web today. The `POST /v1/check-out`
   endpoint exists but has no caller in `apps/web` (the venue-detail CTA only checks in).
2. **Prime each venue's honest Live_Presence_Count over REST** when the map's nodes load, so
   venues do not read 0/quiet on first paint while waiting for the first
   `node:presence_update` socket event. The read API exists
   (`GET /v1/nodes/:nodeId/presence`) but has no web caller.

Out of scope: the discovery "pull" magnet copy (belonging / "your crowd is here" /
anticipation / momentum framing), which is its own later spec; the native/mobile check-out
surface (`apps/mobile`); and distance-based automatic check-out (deferred in
`presence-integrity` Requirement 11). This spec is web-only and reuses the existing shared
API client, `mapStore`, `useCheckIn` patterns, and selection/venue-detail surfaces rather
than introducing new transports or stores.

### Existing implementation this builds on (context, not requirements)

- `POST /v1/check-out` — `backend/src/features/check-out/handler.ts:11`. Body
  `{ nodeId }` (length 1–128). `requireAuth('consumer')` → rate-limit 10/60s → validate.
  Returns a success shape on both an actual check-out and a no-op when no active presence
  exists (`presence-integrity` R1.4, R3.1).
- `GET /v1/nodes/:nodeId/presence` — `backend/src/features/nodes/handler.ts:199`. Public
  read returning `{ nodeId, livePresenceCount }` computed from current `present` records
  (`presence-integrity` R7.1, R7.7).
- `node:presence_update` — consumed in `packages/shared/hooks/useNodePulse.ts`, writing
  `payload.livePresenceCount` into `mapStore` via `setLivePresenceCount`. The hook comment
  states the first-paint priming "lives with the nodes payload load" and is not done by the
  hook itself.
- Check-in CTA and venue detail: `apps/web/src/components/NodeDetailContent.tsx` (check-in
  via `apps/web/src/hooks/useCheckIn.ts` / shared `useCheckIn`). The map nodes load is in
  `apps/web/src/screens/MapScreen.tsx` (`GET /v1/nodes/:citySlug`).
- Live count surface today reads `mapStore.checkInCounts` / the live-presence value set by
  the socket hook.

## Glossary

- **Check_Out_CTA**: the consumer-facing web control that ends the consumer's active
  presence at a venue by calling `POST /v1/check-out`.
- **Active_Presence (client view)**: the client's best knowledge that the current consumer
  is checked in and not yet checked out / expired at a specific venue, used to decide
  whether to show the Check_Out_CTA. Derived from the consumer's own successful check-in in
  this session and/or a presence read; it is a UI affordance hint, never the authority — the
  backend remains the source of truth and treats a stray check-out as a safe no-op.
- **Presence_Seeding**: the one-shot REST priming of each in-view venue's
  Live_Presence_Count from `GET /v1/nodes/:nodeId/presence` at nodes-load time, after which
  `node:presence_update` keeps the value live.
- **Live_Presence_Count**: as defined in `presence-integrity` — the honest count of current
  `present` records for a venue. This spec only displays and primes it; it does not compute
  it.

## Requirements

### Requirement 1: Consumer check-out control on the web venue surface

**User Story:** As a consumer who has left a venue, I want a clear "I'm leaving" control in
the venue detail, so that I can stop being counted as present and keep the live map honest.

#### Acceptance Criteria

1. THE web app SHALL present a Check_Out_CTA on the venue-detail surface
   (`NodeDetailContent`) for a venue WHERE the client holds Active_Presence for that venue.
2. WHERE the client does not hold Active_Presence for a venue, THE web app SHALL NOT show the
   Check_Out_CTA for that venue, and the existing check-in CTA SHALL remain the primary
   action.
3. WHEN the consumer activates the Check_Out_CTA, THE web app SHALL call
   `POST /v1/check-out` with `{ nodeId }` for that venue using the shared API client, and
   SHALL NOT introduce a bespoke `fetch` or a second HTTP path.
4. THE Check_Out_CTA SHALL be a real touch target of at least 44px and SHALL use only CSS
   design tokens (no Tailwind colour classes), consistent with `code-style.md`.
5. THE Check_Out_CTA label and any confirmation copy SHALL contain no emoji and no em dash,
   consistent with `code-style.md`.

### Requirement 2: Check-out interaction states and honesty of feedback

**User Story:** As a consumer on a flaky connection, I want the check-out control to behave
predictably and tell me the truth about what happened, so that I trust the result.

#### Acceptance Criteria

1. WHILE a check-out request is in flight, THE web app SHALL disable the Check_Out_CTA and
   show a loading state, consistent with the app-wide "disable buttons during API calls"
   rule.
2. WHEN `POST /v1/check-out` returns a successful active check-out, THE web app SHALL reflect
   that the consumer is no longer present (clear Active_Presence for that venue) and surface
   a brief success confirmation.
3. WHEN `POST /v1/check-out` returns the successful no-op result (no active presence existed),
   THE web app SHALL treat it as success, clear any stale Active_Presence for that venue, and
   SHALL NOT show an error.
4. IF `POST /v1/check-out` fails (network, 429 rate limit, 401, 403, 5xx), THEN THE web app
   SHALL surface a specific message keyed on `statusCode` (per the app-wide error-handling
   rule), SHALL re-enable the Check_Out_CTA, and SHALL NOT falsely report that the consumer
   checked out.
5. WHEN a check-out succeeds, THE web app SHALL allow the venue's displayed Live_Presence_Count
   to update from the resulting `node:presence_update` event without a full reload, reusing
   the existing `useNodePulse` / `mapStore` path.

### Requirement 3: Determining Active_Presence without fabricating state

**User Story:** As the platform, I want the decision to show check-out to be based on real
signal, so that the UI never invents a presence the backend does not hold.

#### Acceptance Criteria

1. THE web app SHALL treat a successful presence or reward check-in performed in the current
   session (via the existing check-in flow) as establishing Active_Presence for that venue.
2. WHERE the client cannot determine Active_Presence from session state, THE web app MAY
   determine it from a presence read but SHALL NOT display a definitive "you are here"
   identity claim that `presence-integrity` does not back, consistent with `honest-presence.md`
   under-claim-never-over-claim.
3. WHEN presence for a venue is observed to drop to a state inconsistent with the consumer
   still being present (e.g. an expiry-caused `node:presence_update`, or app restart with no
   retained session presence), THE web app SHALL NOT keep asserting Active_Presence solely
   from stale local state in a way that would show a check-out control for a presence that no
   longer exists; a stray check-out remains a safe backend no-op per Requirement 2.3.
4. THE web app SHALL NOT persist any location coordinate or build any local movement trail to
   determine Active_Presence, consistent with the POPIA posture in `presence-integrity` R10.

### Requirement 4: First-paint presence seeding over REST

**User Story:** As a consumer opening the map, I want venues to show their true current
headcount immediately, so that the "city is alive" promise is honest on first paint instead
of reading empty until a socket event arrives.

#### Acceptance Criteria

1. WHEN the map's nodes load for a city (`GET /v1/nodes/:citySlug`), THE web app SHALL prime
   each in-view venue's Live_Presence_Count from `GET /v1/nodes/:nodeId/presence` and write
   it into `mapStore` via the existing `setLivePresenceCount` mechanism.
2. THE Presence_Seeding SHALL be a one-shot priming per nodes load; after seeding, the live
   value SHALL be kept current solely by `node:presence_update` (no polling loop is
   introduced).
3. WHERE a presence read returns 0 for a venue, THE web app SHALL display 0 honestly and
   SHALL NOT substitute a decayed pulse value or a cumulative historical tally to make the
   venue look occupied, consistent with `presence-integrity` R7.7 and `honest-presence.md`.
4. IF a presence read fails for a venue, THEN THE web app SHALL leave that venue's count
   unseeded (allowing the socket event to populate it) and SHALL NOT block the map render or
   surface a fabricated count; the failure SHALL not throw past the nodes-load flow.
5. THE Presence_Seeding SHALL be bounded so that it does not issue an unbounded burst of
   per-venue requests on a large city load; the design phase SHALL choose a concrete bound
   (for example limiting to the recommended/in-view set or batching) and document it.
6. THE Presence_Seeding SHALL reuse the shared API client and SHALL NOT introduce a new
   transport, store, or duplicate of the live-count write path.

### Requirement 5: Reuse, scope, and non-duplication

**User Story:** As a maintainer, I want this UI layer to consume the existing foundation
without forking it, so that there remains one home for presence logic.

#### Acceptance Criteria

1. THE feature SHALL consume the existing `POST /v1/check-out`,
   `GET /v1/nodes/:nodeId/presence`, and `node:presence_update` surfaces unchanged, and SHALL
   NOT add a second check-out endpoint, a second presence read, or a parallel live-count
   store.
2. IF a backend contract change is found to be required (for example the check-out response
   does not give the client enough to update Active_Presence), THEN THE design phase SHALL
   call it out explicitly as a change to the `presence-integrity`-owned surface rather than
   adding a compatibility shim in the web app.
3. THE feature SHALL be web-only (`apps/web` and shared packages it already uses); it SHALL
   NOT modify `apps/mobile` and SHALL NOT introduce any phone/SMS/OTP path.
4. THE feature SHALL keep the live count driven by Live_Presence_Count (presence), with the
   pulse score remaining a distinct signal, consistent with `presence-integrity` R8.

### Requirement 6: Accessibility, styling, and honest-presence compliance

**User Story:** As any user, including assistive-technology users, I want the new controls to
meet the project's UI and honesty standards, so that the feature is consistent and trustworthy.

#### Acceptance Criteria

1. THE Check_Out_CTA SHALL expose an accessible name and an in-flight/disabled state to
   assistive technology, and success/error feedback SHALL be perceivable to screen-reader
   users.
2. THE feature SHALL use design-token colours, `rounded-xl`/`rounded-2xl` surface
   conventions, and `active:scale-95` tactile feedback consistent with existing controls in
   `NodeDetailContent`.
3. THE feature SHALL NOT render any "people like you are here" or crowd-attribution claim;
   it limits itself to the honest count and the check-out action, leaving pull-magnet copy to
   its separate later spec.
4. WHERE presence confidence is low or unknown, THE feature SHALL soften wording toward
   "quiet right now" rather than implying activity, consistent with `honest-presence.md`
   under-claim-never-over-claim.

```

```
