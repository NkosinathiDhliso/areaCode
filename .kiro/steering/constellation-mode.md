---
inclusion: always
---

# Constellation mode: country-zoom discovery

Read this before touching marker presentation, cold open, country zoom, beam
visuals, map play interactions, or browse scope while `zoom < MIN_MARKER_ZOOM`.

Supersedes the old **Globe_Zoom = hidden** rule in
`.kiro/specs/map-discovery-experience/requirements.md` Req 12.3. Country zoom
is not empty space. It is a designed discovery mode.

## The principle

**At country zoom the consumer is feeling the city, not picking a venue yet.**
The map shows pulse-driven sky beams so the "city is alive" promise is visible
on first paint. Play is allowed, but every interaction must pull toward commit
(beam tap → zoom in → check in), not become a screensaver.

Calm by default, magic on intent. Works for a 16-year-old and a 50-year-old on
a mid-range Android without overwhelming spectacle or battery drain.

## Zoom bands (four tiers)

| Zoom   | Mode              | Visual                  | Consumer job                       |
| ------ | ----------------- | ----------------------- | ---------------------------------- |
| 4–8    | **Constellation** | Sky beams + ground glow | Play, skim aliveness, pick a light |
| 8–12.5 | **Embers** (dot)  | Category dots + halos   | Regional density overview          |
| 12.5+  | **Glyphs**        | Archetype markers       | Compare, commit, check in          |

Crossfade between tiers on zoom. Never pop or detach from coordinates.

Constants live in `apps/web/src/lib/carouselConstants.ts` (`MIN_MARKER_ZOOM`,
`GLYPH_ZOOM_THRESHOLD`, `MAP_ARRIVAL_ZOOM`).

## Beam visuals (honest aliveness only)

- Beams are vertical light pillars anchored at the venue, fading upward into
  the existing sky atmosphere layer.
- **Brightness, height, and animation speed = Pulse_State / pulse score only.**
  Business tier may affect **which beams survive the visibility cap** (tiebreak
  among equally-alive venues) but must **never** make a quiet paid venue burn
  brighter than an alive free one. See `.kiro/steering/discovery-dna-vibe-over-convenience.md`.
- **First-in** venues (zero live presence): faint, clearly inviting beam. Never
  imply a crowd that is not there. See `.kiro/steering/honest-presence.md`.
- **Active venue**: brightest beam; others dim (~40%) so selection reads clearly.
- **Cap at country zoom**: render at most the top `RECOMMENDED_LIMIT` (20) beams
  by `vibeRank`. Omit dormant venues beyond the cap at `zoom < 6`. Fade in more
  as zoom approaches `MIN_MARKER_ZOOM`.

## Calm by default, magic on intent

Default (no touch): slow pulse-driven beams only. No trails, no ambient sound.

On active touch only (then settle):

- Proximity brighten when finger sweeps near a beam
- Optional short haptic tick per beam brushed (`navigator.vibrate(8)`), gated on
  `prefers-reduced-motion` and user agent support
- One-line magnet whisper on brush (e.g. "Buzzing · your crowd"), not glow alone

**No ambient sound bed.** Never on by default.

`prefers-reduced-motion`: static beams, no trail/sweep animation. Still tappable.

## Interactions (three layers)

All inputs still write the single `selectionStore` Active_Venue. See
`CLAUDE.md` Map Carousel rules for carousel/camera invariants.

### 1. Sweep (play, no selection)

- Finger drags across the map; beams near the path brighten briefly.
- Does **not** set Active_Venue, open carousel, or flip browse scope.
- Shows a magnet whisper when a beam is brushed (belonging/momentum/aliveness).

### 2. Touch (select, stay at country zoom)

- Tap a beam: lock bright, set Active_Venue, gentle **pan-only** ease toward
  venue (no forced fly to `MAP_ARRIVAL_ZOOM`).
- Open **Constellation peek**: minimal sheet (one card + "N more nearby"), primary
  CTA **"Zoom in"** (one tap into normal discovery funnel).
- Check-in is **not** offered at Constellation zoom (proximity required).

### 3. Commit zoom (enter Embers/Glyphs)

- User taps "Zoom in", double-taps beam, or pinch-zooms past `MIN_MARKER_ZOOM`.
- Crossfade beams → dots → glyphs; camera may fly to `MAP_ARRIVAL_ZOOM` (13).
- Full Peek_Carousel Browse_Mode from here. Existing selection/camera rules apply.

## Cold open (recommended-first)

On open, **dive straight into the recommended Browse_Mode carousel** at
`MAP_ARRIVAL_ZOOM` so the consumer immediately sees the top recommended venues,
not the single-venue Constellation peek. This is a deliberate product decision:
the first thing a consumer should see is the alive, taste-matched venues they
can act on, not a one-card peek behind a "Zoom in" gate.

| Session                       | Map on open                             | Carousel                                       |
| ----------------------------- | --------------------------------------- | ---------------------------------------------- |
| First-ever / no `lastVenueId` | Fly to `MAP_ARRIVAL_ZOOM` on top venue  | Open in Browse_Mode, led by `carouselOrder[0]` |
| Returning (`lastVenueId` set) | Fly to `MAP_ARRIVAL_ZOOM` on last venue | Open in Browse_Mode, resumed on the last venue |
| Focus_Signal pending          | Fly to target per existing focus rules  | Opens on focus target                          |

Implemented by reusing the Focus_Signal dive: `MapScreen.tsx`'s first-paint
effect calls `setFocusNodeId(target)` (target = `lastVenueId ?? carouselOrder[0]`),
whose consumer in `useCarouselSelection.ts` flies to `MAP_ARRIVAL_ZOOM`, opens
Browse_Mode, and recomputes the recommended order — structurally never the
country-zoom peek. Ranking still leads with aliveness and taste, never proximity
(see `discovery-dna-vibe-over-convenience.md`).

The Constellation beam tier, sweep/peek interactions, and `enterConstellation()`
remain for users who zoom back out to country level — country zoom is still a
designed discovery mode. What changed is only that we no longer _land_ a cold
open there.

Power users: optional fast path (e.g. double-tap globe / Recenter) to dive into
their city without forced play.

## Browse scope at Constellation zoom

While `zoom < MIN_MARKER_ZOOM`:

- Browse scope stays **`recommended`** (citywide). Never flip to `area` scope.
- Viewport scoping applies only at Embers zoom and above.
- `notifyViewportChanged` must not narrow the carousel while Constellation is active.

## UI gaps locked (decisions)

1. **Map feedback**: carousel step / search / focus must update active beam
   brightness even when zoomed out.
2. **Hit targets**: beam column ~48px wide at Constellation; halos stay decorative
   (`pointer-events: none`).
3. **Pulse on first paint**: `GET /v1/nodes/:city` should seed pulse scores so
   beams are not all dormant until the first socket event (backend follow-up).
4. **Sweep vs pan**: distinguish play sweep on beam from globe pan (reuse axis
   threshold from `gestureClassifier.ts`). Map drag on empty globe = pan.
5. **Carousel vs play**: at Constellation, carousel minimal/closed; map gets full
   touch surface until beam tap opens peek.
6. **3D toggle**: beams read taller in 3D pitch, shorter radial glow in 2D flat.
7. **Empty/error city**: honest copy ("Quiet right now"), no broken auto-open.
8. **Performance**: top-20 cap + animation budget; reduced-motion parity.

## Success metric (ship gate)

Measure **beam tap → zoom in → check in**, not time spent sweeping.

If Phase A (beams + segmented cold open) does not lift that funnel, do not stack
more spectacle (trails, auroras, comets) until the core pull works.

## Phased build

| Phase | Ship                                                                            | Unlocks               |
| ----- | ------------------------------------------------------------------------------- | --------------------- |
| A     | Beam tier, pulse-driven CSS, top-20 cap, segmented cold open, scope lock at z<8 | See the living city   |
| B     | Beam tap → peek card, active beam, carousel step syncs beams                    | Pick a light          |
| C     | Sweep proximity + whisper, optional haptic, sweep/pan discrimination            | Play with lights      |
| D     | Crossfade beam→dot→glyph; 3D pitch adjusts beam height                          | Seamless zoom journey |
| E     | REST pulse seed; taste aurora fringe; live-get comet (optional)                 | First-frame magnets   |

## Code that this rule governs

- `apps/web/src/hooks/useMapMarkers.ts` — presentation tiers, beam DOM, hit targets
- `apps/web/src/hooks/useMapInit.ts` — country zoom, globe, sky layer
- `apps/web/src/hooks/useCarouselSelection.ts` — scope lock, cold-open camera rules
- `apps/web/src/screens/MapScreen.tsx` — recommended-first cold open, Constellation peek
- `apps/web/src/lib/carouselConstants.ts` — zoom thresholds, `RECOMMENDED_LIMIT`
