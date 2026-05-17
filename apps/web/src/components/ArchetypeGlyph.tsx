import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type SVGProps,
} from 'react'
import { ARCHETYPE_CATALOG, dynamicContrastForCategory, getArchetypeGlyph } from '@area-code/shared/constants'
import type { NodeCategory, NodeState } from '@area-code/shared/types'

/**
 * Archetype glyph rendered on a live-map Node (R8.1-R8.9).
 *
 * The component is intended to be mounted as a child of the Node's
 * existing pulse `<g>` / animated container, so the per-state breathe
 * and pulse keyframes already running on the parent drive the glyph's
 * scale curve in lockstep (R8.5). The component itself only owns
 * opacity — pulse_state opacity (R8.3 / R8.4) and the crossfade on
 * archetype change (R8.6).
 *
 * Foreground colour is set via the inherited `currentColor` so the
 * registered SVGs (every glyph in `ARCHETYPE_GLYPHS` paints with
 * `fill="currentColor"`) pick up the contrast-safe colour returned by
 * `dynamicContrastForCategory(category)` and stay above the 3:1 floor
 * against the node-core fill at every Pulse_State (R8.9).
 *
 * The size is clamped to a floor of 8px (R8.9). The default of 16px
 * matches the smallest typical node-core diameter (`CORE_SIZE.dormant`
 * in `useMapMarkers.ts`) so the glyph doesn't bleed past the core. The
 * caller can pass a larger size to fill larger cores.
 */

export interface ArchetypeGlyphProps {
  archetypeId: string
  pulseState: NodeState
  category: NodeCategory
  /**
   * Pixel diameter of the rendered glyph. Clamped to a floor of 8px so
   * the glyph stays legible (R8.9). Defaults to 16px which fits inside
   * the smallest node-core (`dormant`, 12px diameter doubled by the
   * marker container).
   */
  size?: number
}

const MIN_GLYPH_SIZE_PX = 8
const DEFAULT_GLYPH_SIZE_PX = 16
const DORMANT_OPACITY = 0.4
const ACTIVE_OPACITY = 1.0
/**
 * Total crossfade window per R8.6 (400ms ± 20ms with linear easing).
 * The exiting glyph fades 1.0 → 0 over this window; the entering glyph
 * runs the same window 0.99 → 1.0 so neither layer is ever painted at
 * 0% opacity (R8.6's "no intermediate frame at 0%" trap).
 */
const CROSSFADE_DURATION_MS = 400
/**
 * Floor opacity for the entering glyph during the crossfade. Picked
 * just under 1.0 so the CSS opacity transition has a non-zero starting
 * point — the human eye can't distinguish 0.99 from 1.0, but the
 * "never at 0%" invariant from R8.6 holds at every frame.
 */
const PHASE_ONE_START_OPACITY = 0.99
/**
 * When `archetypeId` is unknown (not present in `ARCHETYPE_CATALOG`),
 * the resolver falls back to `archetype-eclectic` per the design. If
 * eclectic is somehow also missing from the catalog, the component
 * falls through to the generic-dot SVG defined below.
 */
const FALLBACK_ARCHETYPE_ID = 'archetype-eclectic'

/**
 * Per-session set of `iconId`s that have already been warned about.
 * R8.8 limits the dev warning to one per session per missing id; the
 * Set is module-scoped so it survives re-mounts across the session.
 */
const warnedIconIds = new Set<string>()

function resolveIconId(archetypeId: string): string | null {
  const found = ARCHETYPE_CATALOG.find((a) => a.id === archetypeId)
  return found?.iconId ?? null
}

/**
 * Generic dot fallback (R8.7). Drawn with the same `fill="currentColor"`
 * convention as the registered glyphs so it picks up the contrast-safe
 * foreground colour without further wiring.
 */
function GenericDotGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width="100%"
      height="100%"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <circle cx="12" cy="12" r="4" />
    </svg>
  )
}

/**
 * Take a registered glyph node from the shared registry and ensure it
 * fills its container. Every entry in `ARCHETYPE_GLYPHS` is a single
 * `<svg>` element with a `viewBox` but no explicit `width` / `height`,
 * so a raw inline SVG would default to 300×150 in CSS. Cloning lets us
 * inject `width="100%" height="100%"` without forking the registry.
 */
function fillSizedGlyph(glyph: ReactNode): ReactNode {
  if (!isValidElement(glyph)) return glyph
  const element = glyph as ReactElement<SVGProps<SVGSVGElement>>
  const existingStyle = element.props.style ?? {}
  return cloneElement(element, {
    width: '100%',
    height: '100%',
    style: { display: 'block', ...existingStyle },
  })
}

/**
 * Resolve the React node for a given archetypeId, applying the R8.7 /
 * R8.8 fallback ladder:
 *   1. Look up `iconId` from the catalog.
 *   2. If the archetype is unknown, fall back to `archetype-eclectic`.
 *   3. If the registry has no glyph for the resolved iconId, render the
 *      generic dot and emit one dev-only `console.warn` per session per
 *      missing iconId.
 */
function resolveGlyphNode(archetypeId: string): ReactNode {
  let iconId = resolveIconId(archetypeId)
  if (iconId === null) {
    iconId = resolveIconId(FALLBACK_ARCHETYPE_ID)
  }
  if (iconId === null) {
    return <GenericDotGlyph />
  }
  const glyph = getArchetypeGlyph(iconId)
  if (glyph === undefined) {
    if (import.meta.env?.DEV && !warnedIconIds.has(iconId)) {
      warnedIconIds.add(iconId)
      // eslint-disable-next-line no-console
      console.warn(
        `[ArchetypeGlyph] No glyph registered for iconId="${iconId}" ` +
          `(archetypeId="${archetypeId}"). Falling back to generic dot.`,
      )
    }
    return <GenericDotGlyph />
  }
  return fillSizedGlyph(glyph)
}

export function ArchetypeGlyph({ archetypeId, pulseState, category, size }: ArchetypeGlyphProps): ReactElement {
  const renderSize = Math.max(MIN_GLYPH_SIZE_PX, size ?? DEFAULT_GLYPH_SIZE_PX)
  const colour = dynamicContrastForCategory(category)
  const stateOpacity = pulseState === 'dormant' ? DORMANT_OPACITY : ACTIVE_OPACITY

  // Crossfade tracking. The "current" layer always renders the latest
  // archetypeId from props. When archetypeId changes, the previous
  // archetypeId is captured into `exitingArchetypeId` and rendered as a
  // second layer that fades 1.0 → 0 over CROSSFADE_DURATION_MS, then
  // unmounts. Holding at most one exiting layer keeps the DOM bounded
  // even under rapid archetype churn (the fast-check property tests
  // exercise this).
  const previousArchetypeIdRef = useRef<string>(archetypeId)
  const [exitingArchetypeId, setExitingArchetypeId] = useState<string | null>(null)
  const [exitingOpacity, setExitingOpacity] = useState(1)
  const [enterOpacity, setEnterOpacity] = useState(1)

  useEffect(() => {
    if (previousArchetypeIdRef.current === archetypeId) return
    const oldId = previousArchetypeIdRef.current
    previousArchetypeIdRef.current = archetypeId

    // Phase 0: snap initial opacities for the new render. The entering
    // layer mounts at 0.99 (R8.6's "never at 0%") and the exiting layer
    // stays at 1.0 for one frame so the browser registers the starting
    // value before the transition kicks in.
    setExitingArchetypeId(oldId)
    setExitingOpacity(1)
    setEnterOpacity(PHASE_ONE_START_OPACITY)

    // Phase 1: on the next animation frame, flip opacities to their
    // final targets. The CSS `transition: opacity 400ms linear` on each
    // layer drives the actual animation. Using rAF (rather than a
    // synchronous flush) ensures the browser has painted the starting
    // state before the transition begins.
    const enterFrame = window.requestAnimationFrame(() => {
      setEnterOpacity(1)
      setExitingOpacity(0)
    })
    // Phase 2: at the end of the crossfade window, unmount the exiting
    // layer so the DOM doesn't grow under rapid changes.
    const exitClear = window.setTimeout(() => {
      setExitingArchetypeId(null)
    }, CROSSFADE_DURATION_MS)

    return () => {
      window.cancelAnimationFrame(enterFrame)
      window.clearTimeout(exitClear)
    }
  }, [archetypeId])

  const layerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colour,
    pointerEvents: 'none',
  }

  return (
    <div
      data-archetype-glyph={archetypeId}
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: `${renderSize}px`,
        height: `${renderSize}px`,
        transform: 'translate(-50%, -50%)',
        opacity: stateOpacity,
        pointerEvents: 'none',
      }}
    >
      {/* Entering / current glyph. `key` is intentionally the
          archetypeId so React unmounts and remounts when it changes,
          giving the entering layer a clean starting opacity. */}
      <div
        key={archetypeId}
        style={{
          ...layerStyle,
          opacity: enterOpacity,
          transition: `opacity ${CROSSFADE_DURATION_MS}ms linear`,
        }}
      >
        {resolveGlyphNode(archetypeId)}
      </div>

      {/* Exiting glyph (rendered during the 400ms crossfade only). */}
      {exitingArchetypeId !== null && (
        <div
          key={`exit-${exitingArchetypeId}`}
          style={{
            ...layerStyle,
            opacity: exitingOpacity,
            transition: `opacity ${CROSSFADE_DURATION_MS}ms linear`,
          }}
        >
          {resolveGlyphNode(exitingArchetypeId)}
        </div>
      )}
    </div>
  )
}
