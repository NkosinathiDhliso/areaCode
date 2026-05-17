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
import { getCategoryColour } from '../lib/mapHelpers'

/**
 * Archetype glyph rendered as the live-map Node (R8 redesign).
 *
 * The previous design overlaid the glyph on a category-coloured core
 * circle. The current design retires the core circle entirely: the
 * glyph itself is the marker, with the category colour painted into the
 * glyph silhouette and a thin contrast-safe outline around it for edge
 * separation against any basemap tile (Mapbox light / dark / satellite).
 *
 * The component is mounted as a child of the marker's pulse wrapper, so
 * the per-state breathe / pulse keyframes already running on the
 * wrapper drive the glyph's scale curve in lockstep (R8.5). The
 * component itself only owns opacity (R8.3 / R8.4) and the crossfade on
 * archetype change (R8.6).
 *
 * Foreground colour is set via the inherited `currentColor` so the
 * registered SVGs (every glyph in `ARCHETYPE_GLYPHS` paints with
 * `fill="currentColor"`) pick up the category colour returned by
 * `getCategoryColour(category)`. The contrasting outline lives on a
 * stroked clone underneath the fill, sized just enough to read on busy
 * tiles without bloating the silhouette.
 */

export interface ArchetypeGlyphProps {
  archetypeId: string
  pulseState: NodeState
  category: NodeCategory
  /**
   * Pixel diameter of the rendered glyph. Clamped to a floor of 8px so
   * the inner SVG strokes stay legible (R8.9). Defaults to 32px which
   * is roughly the mid-Pulse_State glyph size in `useMapMarkers.ts`.
   * Marker sizing is managed by the marker layer, not by this prop.
   */
  size?: number
}

const MIN_GLYPH_SIZE_PX = 8
const DEFAULT_GLYPH_SIZE_PX = 32
const DORMANT_OPACITY = 0.55
const ACTIVE_OPACITY = 1.0
/**
 * Total crossfade window per R8.6 (400ms ± 20ms with linear easing).
 */
const CROSSFADE_DURATION_MS = 400
const PHASE_ONE_START_OPACITY = 0.99
/**
 * Fallback when an `archetypeId` is unknown to the catalog. The
 * resolver chain falls through to `archetype-eclectic`, then to a
 * generic dot if eclectic is also missing (defence in depth).
 */
const FALLBACK_ARCHETYPE_ID = 'archetype-eclectic'

/**
 * Per-session set of `iconId`s that have already been warned about.
 * R8.8 limits the dev warning to one per session per missing id.
 */
const warnedIconIds = new Set<string>()

function resolveIconId(archetypeId: string): string | null {
  const found = ARCHETYPE_CATALOG.find((a) => a.id === archetypeId)
  return found?.iconId ?? null
}

/**
 * Generic dot fallback (R8.7). Drawn with `fill="currentColor"` so it
 * picks up the category colour like every registered glyph.
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
      <circle cx="12" cy="12" r="6" />
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
 * R8.8 fallback ladder.
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

  // Two colours drive the look:
  //   - silhouette: the venue's category colour (food red, nightlife blue, …)
  //   - outline: the contrast-safe colour from the WCAG helper, drawn as a
  //     thin stroked layer behind the fill so the silhouette reads on any
  //     basemap (light, dark, satellite).
  const silhouette = getCategoryColour(category)
  const outline = dynamicContrastForCategory(category)
  const stateOpacity = pulseState === 'dormant' ? DORMANT_OPACITY : ACTIVE_OPACITY

  // Crossfade tracking. The "current" layer always renders the latest
  // archetypeId from props. When archetypeId changes, the previous
  // archetypeId is captured into `exitingArchetypeId` and rendered as a
  // second layer that fades 1.0 → 0 over CROSSFADE_DURATION_MS, then
  // unmounts. Holding at most one exiting layer keeps the DOM bounded.
  const previousArchetypeIdRef = useRef<string>(archetypeId)
  const [exitingArchetypeId, setExitingArchetypeId] = useState<string | null>(null)
  const [exitingOpacity, setExitingOpacity] = useState(1)
  const [enterOpacity, setEnterOpacity] = useState(1)

  useEffect(() => {
    if (previousArchetypeIdRef.current === archetypeId) return
    const oldId = previousArchetypeIdRef.current
    previousArchetypeIdRef.current = archetypeId

    setExitingArchetypeId(oldId)
    setExitingOpacity(1)
    setEnterOpacity(PHASE_ONE_START_OPACITY)

    const enterFrame = window.requestAnimationFrame(() => {
      setEnterOpacity(1)
      setExitingOpacity(0)
    })
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
    pointerEvents: 'none',
  }

  // The glyph layer renders TWO copies of the SVG stacked: a wider
  // stroked outline behind, and the category-coloured fill in front.
  // Stacking them this way lets the registered SVGs stay simple — they
  // only paint with `fill="currentColor"` — while the outline still
  // wraps the silhouette. The outline width scales with renderSize so
  // it stays proportional from 8px through 80px+.
  const outlineStrokeWidth = Math.max(1, Math.round(renderSize * 0.12))

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
        <GlyphPair
          node={resolveGlyphNode(archetypeId)}
          silhouette={silhouette}
          outline={outline}
          outlineStrokeWidth={outlineStrokeWidth}
        />
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
          <GlyphPair
            node={resolveGlyphNode(exitingArchetypeId)}
            silhouette={silhouette}
            outline={outline}
            outlineStrokeWidth={outlineStrokeWidth}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Stacks the same glyph twice: once stroked-only as a contrasting
 * outline, once filled with the category colour. The outline lives in
 * a wrapper with `paint-order: stroke fill` (via inline SVG technique)
 * so the stroke draws first and reads on busy tiles.
 *
 * This is the only place that knows the registered SVGs paint with
 * `fill="currentColor"`. The outline copy sets `color: outline` and
 * adds a stroke; the fill copy just sets `color: silhouette`.
 */
function GlyphPair({
  node,
  silhouette,
  outline,
  outlineStrokeWidth,
}: {
  node: ReactNode
  silhouette: string
  outline: string
  outlineStrokeWidth: number
}): ReactElement {
  return (
    <>
      {/* Outline pass — stroked clone underneath. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          color: outline,
          // Stroke every path inside the SVG without modifying the
          // registry — see the global CSS rule paired with this class
          // in the marker stylesheet. Inline style fallback keeps it
          // working without that rule too.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ['--glyph-outline-width' as any]: `${outlineStrokeWidth}px`,
        }}
        className="archetype-glyph-outline"
      >
        {node}
      </div>
      {/* Fill pass — silhouette in the category colour. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          color: silhouette,
        }}
      >
        {node}
      </div>
    </>
  )
}
