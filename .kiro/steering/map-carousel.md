<!-- GENERATED FILE. DO NOT EDIT.
     Single source of truth: rules/*.md
     Regenerate with: pnpm sync:rules -->

# Map Carousel (consumer web): camera and scope rules

Hard rules for the Peek_Carousel and its camera. Breaking these reintroduces
bugs already fixed. Ranking DNA lives in
`discovery-dna-vibe-over-convenience.md`; country-zoom beam behaviour lives in
`constellation-mode.md`. This file is the carousel camera/scope contract.

- **Two scopes, one order.** `vibeRank` (`apps/web/src/lib/carouselRanking.ts`)
  decides order (taste, aliveness, tier, live gets, distance, id). Scope decides
  membership only, never re-sorts by nearness. Default scope is `recommended`
  (citywide top venues, viewport independent). Switch to `area`
  (viewport-scoped) only on a meaningful user pan or zoom (>= 400 m or >= 0.35
  zoom levels), not micro-drags or control jitter.
- **Recompute order from user moves only.** Wire `notifyViewportChanged` to map
  `moveend` only (not `zoom`), and only when `e.originalEvent` is present. Never
  recompute on programmatic camera moves (the selection fly-to), or the order
  collapses to the active venue and the browse arrows gray out.
- **Idle bearing-drift pauses during camera moves.** `map.setBearing` is an
  instant jump that aborts an in-flight `flyTo`. The drift loop must check
  `map.isMoving()` and skip while a move animates, or the selection fly-to never
  arrives (the no-snap bug).
- **Snap-zoom only when below `MIN_MARKER_ZOOM`.** On selection, force
  `MAP_ARRIVAL_ZOOM` only if the current zoom is below the marker threshold.
  Otherwise preserve the user's zoom (omit `zoom` from `flyTo`).
- **Cards are selection-only.** A card tap sets the Active_Venue and flies the
  camera, nothing else. Commit_Mode (details) opens only from the "View details"
  control. No card tap and no gesture (including swipe-up) opens details.
  Swipe-down dismisses; horizontal swipe steps the carousel.
- **Map tab re-tap toggles the carousel** via `selectionStore.toggleOpen`, wired
  through `BottomNav` `onReselect`.
- **Constellation scope lock.** While `zoom < MIN_MARKER_ZOOM`, browse scope
  stays `recommended`; never flip to `area`. See `constellation-mode.md`.
- **Single selection source of truth.** All inputs (card tap, search, focus,
  beam tap) write the one `selectionStore` Active_Venue.

Zoom thresholds and `RECOMMENDED_LIMIT` live in
`apps/web/src/lib/carouselConstants.ts`.
