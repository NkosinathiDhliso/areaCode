# Design: Map Camera and Gesture Feel

## Root-cause map

| Symptom                             | Cause                                                                                                                         | Fix                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Two-finger tilt snaps back on swipe | Pitch ramp re-applies `pitchForZoom(zoom)` on every `zoom` event; manual pitch honoured only mid-gesture                      | Sticky manual-pitch offset folded into the ramp target         |
| Zoom stutters (wheel and pinch)     | Per-frame `setPitch` = `jumpTo` = stops in-flight camera animation, aborting wheel easing and fly-tos                         | Ramp applies on `zoomend` via `easeTo(450ms)`                  |
| Zoom stutters (marker layer)        | Raw zoom pushed into React state per frame re-runs the full marker-reconcile effect; per-frame restyle fan-out on all markers | Quantised zoom state (0.25) + per-marker presentation key gate |
| Rotate gesture janks                | `setBearing(raw)` re-renders MapScreen per frame                                                                              | Bearing quantised to whole degrees                             |

## Camera: sticky-offset pitch ramp (implemented)

`useMapInit` keeps two refs:

- `manualPitchRef`: true only between a `pitchstart` carrying `originalEvent`
  and its `pitchend`. The ramp never applies while true.
- `manualPitchOffsetRef`: degrees between the user's chosen pitch and
  `pitchForZoom(zoom)`, captured at the end of a manual gesture.

Ramp target: `clamp(pitchForZoom(zoom) + offset, PITCH_FLAT, MAX_PITCH)`,
applied on `zoomend` with `easeTo({ pitch, duration: 450 })`, skipped when the
delta is within 1 degree. `setPitch3D` resets the offset (mode toggle is a
deliberate re-baseline) and remains the only other pitch writer.

Why `zoomend`, not per-frame: `setPitch` calls `jumpTo`, which stops the
current camera animation. Per-frame application cancelled scroll-zoom easing
(each wheel tick restarted its ease and was immediately killed) and could
abort the selection fly-to mid-flight, the same class of bug map-carousel.md
documents for `setBearing` in the old idle-drift loop. Applying once on settle
with an ease gives a calm dolly-in feel and can never fight a live gesture.

Trade-off: pitch no longer tracks continuously during a long pinch; it eases
to target on release. This is deliberate (predictable, cheaper, un-fightable).

## Marker layer: quantised zoom, keyed restyle (implemented)

`syncFromZoom` (attached to `zoom`) now has a two-lane split:

- Per-frame lane: `applyZoomScale` only (one transform write per marker), so
  marker size still tracks the zoom smoothly.
- Keyed lane: tier flips, dim state, beam crossfade, animation sync, and beam
  geometry re-apply only when `` `${tier}|${dimInactive}|${blend}` `` changes,
  with blend quantised to 0.05. The key is stored on
  `el.dataset.presentationKey`.

The React `mapZoom` state (a dependency of the marker-reconcile effect, whose
body runs vibeRank, rebuilds marker DOM, and renders glyph roots) updates only
when the zoom moved at least 0.25 from the last stored value. Beam-cap
membership (`constellationVisibleIds`) and tier flips tolerate 0.25
granularity because the fade ramps span multiple zoom levels and the per-frame
lane keeps visuals continuous between recomputes.

Interaction with the reconcile effect: the effect writes fresh presentation
state directly (pulse changes, active flips re-run it via deps), and the
keyed lane only gates syncFromZoom's own re-application, so the two writers
cannot fight.

## Bearing (implemented)

`rotate` handler rounds to whole degrees and functional-updates state only on
change. The compass icon has a 200ms transform transition, so degree steps
render smoothly.

## Reduced-motion parity (planned)

Single `reducedMotion()` helper in `apps/web/src/lib` (cached matchMedia with
change listener), consumed by useMapInit's four eases and markerBeam. Camera
eases pass `duration: 0` when set. markerBeam already renders `animation:
none`; it just re-queries per call today.

## Constants consolidation (planned)

`USER_VIEW_ZOOM` stays in `cameraControl.ts` (already exported, already
mirrored by tests); `useMapInit.ts` and `MapScreen.tsx` import it.
`MapControls.tsx` imports `POSITION_FRESHNESS_WINDOW` from
`carouselConstants.ts` instead of re-declaring 60s.

## Device tiering (planned)

One synchronous heuristic at map init (WEBGL_debug_renderer_info string,
`hardwareConcurrency`, `devicePixelRatio`); result held for the map lifetime.
Low tier: `antialias: false`, no `cast-shadows`, terrain exaggeration 1.0.
Everything interactive is identical across tiers (honest-presence and
discovery surfaces never differ).

## Sweep whisper (planned)

`useConstellationSweep` already resolves `brushedNodeId`. Add a small
screen-anchored whisper chip (reuses toast styling tokens) fed by the brushed
venue's strongest magnet line, ranked per discovery-DNA: belonging, momentum,
aliveness ("Buzzing - your crowd" style copy, no fabricated claims per
honest-presence). Dismiss on `pointerup`.

## Zoom buttons (planned)

Two 44px buttons in the existing `MapControls` glass cluster calling
`map.zoomIn()` / `map.zoomOut()` (eased, gesture-safe). Hidden below the `md`
breakpoint where pinch is the norm.
