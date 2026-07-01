# Design Document: Honest Presence UI

## Overview

This is the consumer web UI layer on top of the completed `presence-integrity` backend. It
adds two things and nothing more:

1. A **check-out control** in the venue detail that calls the existing `POST /v1/check-out`.
2. **First-paint presence seeding** that primes each in-view venue's honest
   `livePresenceCount` from the existing `GET /v1/nodes/:nodeId/presence` at nodes-load, after
   which the existing `node:presence_update` socket path keeps it live.

No backend contract changes are planned (see Open Questions for the one place that could
force one). No new transport, no new live-count store, no phone path, web-only.

The central design constraint, confirmed from the code: the presence read API returns only
`{ nodeId, livePresenceCount }` — there is **no endpoint that tells a client "are _you_
present at node X".** Therefore client knowledge of the user's own presence ("Active
Presence") can only be derived from the user's own successful check-in in the current
session. This is a feature, not a limitation: it means the UI never asserts a presence the
backend may no longer hold from stale persisted state, and a stray check-out is already a
safe backend no-op (`check-out/service.ts` returns `no_active_presence`).

## Architecture

```
Check-out path
  NodeDetailContent (CTA, shown when hasActivePresence(nodeId))
    -> onCheckOut(nodeId) prop  [parent: PeekCarousel/MapScreen]
        -> useCheckOut()  [new shared hook, mirrors useCheckIn]
            -> api.post('/v1/check-out', { nodeId })
            -> on success/no-op: presenceStore.clearPresent(nodeId)
        live count updates arrive via existing useNodePulse -> node:presence_update

Check-in path (existing, augmented)
  successful checkIn() -> presenceStore.setPresent(nodeId)   [new write only]

Seeding path
  MapScreen nodes load (GET /v1/nodes/:citySlug)
    -> usePresenceSeeding(nodes)  [new hook]
        -> bounded fan-out GET /v1/nodes/:id/presence (top-N by vibeRank, cap 20)
        -> mapStore.setLivePresenceCount(id, livePresenceCount)  [existing setter]
```

### New / changed files

| File                                                                                                                        | Change                                                                                                                                                                                     | Why                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/shared/stores/presenceStore.ts`                                                                                   | New. Session-scoped `Record<nodeId, { checkedInAt }>` of the current user's own active presence, with `setPresent`, `clearPresent`, `clear` (logout), and an `isPresent(nodeId)` selector. | One home for "am I here" client state; reused by web now and mobile later (R5.1, R5.3). |
| `packages/shared/hooks/useCheckOut.ts`                                                                                      | New. Mirrors `useCheckIn`: `isPending`, `error`, `checkOut(nodeId)` calling `POST /v1/check-out`, `statusCode`-keyed messages via `friendlyMessage`. Clears presence on success/no-op.     | Symmetry with check-in; shared client only (R1.3, R2).                                  |
| `packages/shared/hooks/usePresenceSeeding.ts`                                                                               | New. Given the loaded nodes, fires bounded `GET /v1/nodes/:id/presence` and writes `setLivePresenceCount`. One-shot per nodes payload.                                                     | R4.                                                                                     |
| `apps/web/src/components/NodeDetailContent.tsx`                                                                             | Add a Check_Out_CTA, rendered only when `presenceStore.isPresent(node.id)`; new `onCheckOut` + `isCheckingOut` props (symmetry with `onCheckIn`/`isCheckingIn`).                           | R1, R2.                                                                                 |
| Check-in success site (`apps/web/src/screens/MapScreen.tsx` / `PeekCarousel` wiring + `apps/web/src/screens/QrCheckIn.tsx`) | On a successful check-in, call `presenceStore.setPresent(nodeId)`; thread `onCheckOut`/`isCheckingOut` into `NodeDetailContent`.                                                           | R3.1.                                                                                   |
| `apps/web/src/screens/MapScreen.tsx`                                                                                        | Call `usePresenceSeeding(nodes)` after the city nodes load.                                                                                                                                | R4.                                                                                     |
| consumer logout (`consumerAuthStore` logout consumer or `App.tsx`)                                                          | Call `presenceStore.clear()` on logout.                                                                                                                                                    | R3, parity with `clearFriendsPresence`.                                                 |

Nothing in `presence-integrity`'s backend is modified. `mapStore.setLivePresenceCount`
already writes `checkInCounts`, which the marker/toast/detail count surfaces already read, so
the honest count display path is reused unchanged.

## Components and Interfaces

### 1. Active-presence state (`presenceStore`)

A minimal Zustand store, mirroring the `friendsAtVenue` lifecycle already in `mapStore`:

```ts
interface PresenceStore {
  // current user's own open presence, keyed by nodeId
  activePresence: Record<string, { checkedInAt: number }>
  setPresent: (nodeId: string) => void // on my successful check-in
  clearPresent: (nodeId: string) => void // on my successful check-out / no-op
  clear: () => void // on logout
}
```

Selector used by the component: `isPresent(nodeId) = nodeId in activePresence`.

Lifecycle and honesty (R3):

- Set on a successful presence **or** reward check-in (both open a Presence_Record per
  `presence-integrity` R4.3).
- Cleared on a successful check-out, on the `no_active_presence` no-op result, and on logout.
- **Not persisted.** On reload the map starts with no active presence, so the check-out CTA
  is hidden until the user checks in again. This deliberately avoids re-implementing the
  backend's Expiry_Window logic client-side (which would duplicate a `presence-integrity`
  constant and risk drift, R5.1). The cost — a user who checked in then hard-reloaded cannot
  check out from the UI until re-check-in — is acceptable because expiry reconciles them
  automatically and a manual re-tap is a safe no-op. Documented as a known limitation.
- We do **not** infer the user's own expiry from `node:presence_update` (that event carries
  no identity by design, R7.4), so a count dropping to 0 does not flip our local flag; the
  no-op safety net (R2.3) covers the resulting stray check-out.

### 2. Check-out hook (`useCheckOut`)

Mirror `useCheckIn` exactly so the two read the same:

```ts
export function useCheckOut() {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checkOut = useCallback(async (nodeId: string): Promise<CheckOutResponse | null> => {
    // in-flight guard (reuse the useCheckIn double-submit pattern)
    setIsPending(true)
    setError(null)
    try {
      const res = await api.post<CheckOutResponse>('/v1/check-out', { nodeId })
      usePresenceStore.getState().clearPresent(nodeId) // success AND no_active_presence
      return res
    } catch (err) {
      const msg = friendlyMessage(err as ApiError) // 429/401/403/5xx keyed (R2.4)
      setError(msg)
      useErrorStore.getState().showError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [])
  return { checkOut, isPending, error }
}
```

`CheckOutResponse` is imported from the shared types that already mirror
`backend/.../check-out/types.ts` (`presenceState: 'checked_out' | 'no_active_presence'`,
`dwellSeconds`). Both `checked_out` and `no_active_presence` are successes and clear the
local flag (R2.2, R2.3). A `friendlyMessage` variant reuses the check-in status-code mapping
(429 cooldown, 401 sign-in, 403 disabled, generic fallback) so we do not fork a second error
map — extract the shared shape if practical, otherwise a small check-out-specific map.

### 3. Check-out CTA in `NodeDetailContent`

The component already renders a single primary check-in `<button>` at the bottom and receives
`onCheckIn`, `onSignIn`, `isCheckingIn`. Add the symmetric pair `onCheckOut`,
`isCheckingOut`, and read `isPresent` from the store:

- WHERE `presenceStore.isPresent(node.id)` is true: render the **Check_Out_CTA** as the
  primary action ("I'm leaving" / `t('node.checkOut')`), using a secondary/neutral token
  style (e.g. `bg-[var(--bg-raised)]` with `var(--text-primary)`), `rounded-xl`, `py-4`,
  `active:scale-95`, disabled+loading while `isCheckingOut` (R1.4, R2.1, R6.2). The check-in
  button is replaced by the check-out button while present (a user who is here checks out;
  re-check-in to refresh is not the primary need).
- ELSE: render the existing check-in CTA unchanged (R1.2).
- Accessibility: `aria-label`, `aria-disabled`/`disabled` during flight, and success/error
  surfaced through the existing global toast (`useErrorStore`) which is already announced
  (R6.1). A brief inline success line ("You checked out") may also be shown.
- Copy contains no emoji, no em dash, no crowd-attribution claim (R1.5, R6.3, R6.4).

The actual `onCheckOut` handler lives in the same parent that owns `onCheckIn`
(`PeekCarousel`/`MapScreen` Commit_Mode wiring), implemented with `useCheckOut`, so the
component stays presentational and prop-symmetric.

### 4. Presence seeding (`usePresenceSeeding`)

```ts
export function usePresenceSeeding(nodes: Node[]) {
  const setLivePresenceCount = useMapStore((s) => s.setLivePresenceCount)
  useEffect(() => {
    if (nodes.length === 0) return
    let cancelled = false
    const targets = pickSeedTargets(nodes) // top-N by vibeRank, cap RECOMMENDED_LIMIT (20)
    void seedWithConcurrency(targets, 5, async (id) => {
      try {
        const res = await api.get<{ nodeId: string; livePresenceCount: number }>(`/v1/nodes/${id}/presence`)
        if (!cancelled) setLivePresenceCount(res.nodeId, res.livePresenceCount)
      } catch {
        // R4.4: leave unseeded; socket will populate. Never throw past the load.
      }
    })
    return () => {
      cancelled = true
    }
  }, [nodes, setLivePresenceCount])
}
```

Design points:

- **Bound (R4.5):** seed only the top `RECOMMENDED_LIMIT` (20, from
  `apps/web/src/lib/carouselConstants.ts`) venues by `vibeRank` — the set the consumer can
  actually act on at cold open — with a small concurrency cap (≈5 in flight). This avoids an
  unbounded burst on a large city and aligns with the constellation cold-open cap.
- **One-shot (R4.2):** keyed on the nodes payload; no polling. `node:presence_update` keeps
  values live afterward via the unchanged `useNodePulse` path.
- **Honest 0 (R4.3):** a read of 0 writes 0 through `setLivePresenceCount`; no decayed/pulse
  substitution. The presence value is the authority and overwrites any `liveCheckInCount`
  seeded by `setNodes`.
- **Failure isolation (R4.4):** per-node `catch`, `Promise.allSettled`-style; the map render
  never blocks or throws.

Called from `MapScreen` right after the `GET /v1/nodes/:citySlug` query resolves.

## Data Models

- Request: `POST /v1/check-out` body `{ nodeId }` (1–128 chars). Response
  `{ nodeId, presenceState, dwellSeconds }`. Unchanged.
- Request: `GET /v1/nodes/:nodeId/presence` → `{ nodeId, livePresenceCount }`. Unchanged.
- Event: `node:presence_update` `{ nodeId, livePresenceCount, cause }` consumed by the
  existing `useNodePulse`. Unchanged.
- Shared types: reuse/import `CheckOutResponse`; if it is not yet exported from
  `packages/shared/types`, add the type mirror there (no backend change).

## Error handling

| Case                            | Behaviour                                                 | Req  |
| ------------------------------- | --------------------------------------------------------- | ---- |
| Check-out in flight             | CTA disabled + loading label                              | R2.1 |
| `checked_out`                   | clear local presence, brief success                       | R2.2 |
| `no_active_presence`            | treat as success, clear stale local flag, no error        | R2.3 |
| 429 / 401 / 403 / 5xx / network | status-keyed toast, re-enable CTA, no false "checked out" | R2.4 |
| Presence seed read fails        | leave node unseeded, socket populates later, no throw     | R4.4 |

## Correctness Properties

These are the invariants the implementation must uphold; most are example-tested (Vitest),
and any that generalise cleanly can take a fast-check property tagged
`// Feature: honest-presence-ui, Property N: ...`.

### Property 1: CTA visibility tracks active presence

The Check_Out_CTA is shown for a node if and only if `presenceStore.isPresent(nodeId)` is
true; otherwise the check-in CTA shows.

**Validates: Requirements 1.1, 1.2**

### Property 2: Check-out is always reported honestly

A `checked_out` and a `no_active_presence` response both clear local presence and never raise
an error; only a thrown API failure surfaces an error, and it never reports a successful
check-out.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 3: No fabricated presence

Local active presence is only ever set by the current user's own successful check-in and
never reconstructed from persisted or third-party state; on a fresh load with no session
check-in, no node is `isPresent`.

**Validates: Requirements 3.1, 3.3**

### Property 4: Honest seeded count

For each seeded node, the value written to `mapStore` equals the `livePresenceCount` returned
by the read API, including 0, with no decayed/historical substitution.

**Validates: Requirements 4.1, 4.3**

### Property 5: Bounded, one-shot, failure-isolated seeding

Seeding issues at most one request per target per nodes payload, never exceeds the target
cap, and a per-node failure leaves that node unseeded without throwing or blocking the map.

**Validates: Requirements 4.2, 4.4, 4.5**

### Property 6: No new authority or transport

The live count continues to flow only through `mapStore.checkInCounts` via
`setLivePresenceCount`; no second store or HTTP path is introduced.

**Validates: Requirements 5.1, 5.4**

## Testing strategy

Vitest + jsdom for components/hooks (per `tech.md`: `// @vitest-environment jsdom` first
line; mock the shared API client; drive stores via `setState`, reset in `beforeEach`). No
network, no WebGL.

- `presenceStore`: set/clear/clear-all transitions; `isPresent` selector.
- `useCheckOut`: success clears presence; `no_active_presence` clears and shows no error;
  429/401/403/5xx map to specific messages; in-flight guard.
- `NodeDetailContent`: CTA shown only when present; check-in CTA shown otherwise; disabled
  while `isCheckingOut`; no emoji/em-dash in labels; accessible name present.
- `usePresenceSeeding`: seeds top-N only (bound), writes `setLivePresenceCount` with the read
  value including 0, swallows per-node failures, one-shot per payload.
- These are pure-UI/logic cores without fast-check property tests unless the seed-target
  selection (`pickSeedTargets`) warrants one; if so, tag
  `// Feature: honest-presence-ui, Property N: ...`.

## Open questions / decisions to confirm

1. **Seed target set (R4.5).** Proposed: top `RECOMMENDED_LIMIT` (20) by `vibeRank`,
   concurrency ≈5. Confirm the cap, or prefer strictly in-viewport nodes.
2. **CTA replacement vs coexistence (R1).** Proposed: while present, the check-out button
   replaces the check-in button as the primary action. Confirm, or show both (check-out
   primary, a smaller "check in again to refresh" secondary).
3. **Backend contract sufficiency (R5.2).** The check-out response gives enough to clear
   local state. No backend change is anticipated. The only scenario that would force one is
   if product later wants the CTA to survive reload — that needs a per-user "am I present"
   read, which would be a `presence-integrity` change, not a web shim. Flagged, not built.

```

```
