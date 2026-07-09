import {
  ARCHETYPE_CATALOG,
  dynamicContrastForCategory,
  getArchetypeIcon,
  FALLBACK_ARCHETYPE_ICON,
  type ArchetypeIconSpec,
} from '@area-code/shared/constants'
import type { NodeCategory, NodeState } from '@area-code/shared/types'
import type { Icon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'

import { resolveArchetypeIconComponent } from '../lib/archetypeIconComponents'
import { getCategoryColour } from '../lib/mapHelpers'

/**
 * Archetype icon rendered as the live-map Node (R8 redesign).
 *
 * The glyph is the marker: a Phosphor icon painted in the venue's category
 * colour with a thin contrast-safe outline behind it for edge separation
 * against any basemap tile. Mounted inside the marker's pulse wrapper so the
 * breathe / pulse keyframes drive its scale curve (R8.5); this component owns
 * opacity (R8.3 / R8.4) and the 400ms crossfade on archetype change (R8.6).
 *
 * Icons come from the shared `ARCHETYPE_ICONS` data registry (Phosphor names),
 * so web and mobile render the exact same icon per archetype.
 */

export interface ArchetypeGlyphProps {
  archetypeId: string
  pulseState: NodeState
  category: NodeCategory
  /** Pixel diameter; clamped to an 8px floor for legibility (R8.9). */
  size?: number
  /**
   * Optional override for the glyph's fill (silhouette) colour. Defaults to the
   * venue's category colour (`getCategoryColour`). The Venue_Card passes the
   * venue's Pulse_State colour here so the browse-strip glyph reads in the live
   * state colour (R1.2) while the map marker keeps the category colour.
   */
  silhouetteColour?: string
}

const MIN_GLYPH_SIZE_PX = 8
const DEFAULT_GLYPH_SIZE_PX = 32
const DORMANT_OPACITY = 0.55
const ACTIVE_OPACITY = 1.0
const CROSSFADE_DURATION_MS = 400
const PHASE_ONE_START_OPACITY = 0.99
const FALLBACK_ARCHETYPE_ID = 'archetype-eclectic'

/** Per-session set of icon names already warned about (one warning each). */
const warnedIconNames = new Set<string>()

function resolveIconId(archetypeId: string): string | null {
  return ARCHETYPE_CATALOG.find((a) => a.id === archetypeId)?.iconId ?? null
}

/** Resolve a Phosphor component by name, or null if the curated registry omits it. */
function resolvePhosphorComponent(name: string): Icon | null {
  return resolveArchetypeIconComponent(name)
}

/**
 * Resolve the icon spec + component for an archetypeId, applying the
 * eclectic → generic fallback ladder.
 */
function resolveIcon(archetypeId: string): { Component: Icon; spec: ArchetypeIconSpec } | null {
  let iconId = resolveIconId(archetypeId)
  if (iconId === null) iconId = resolveIconId(FALLBACK_ARCHETYPE_ID)

  const spec = (iconId !== null ? getArchetypeIcon(iconId) : undefined) ?? FALLBACK_ARCHETYPE_ICON
  const Component = resolvePhosphorComponent(spec.name)
  if (!Component) {
    if (import.meta.env?.DEV && !warnedIconNames.has(spec.name)) {
      warnedIconNames.add(spec.name)

      console.warn(
        `[ArchetypeGlyph] Phosphor icon "${spec.name}" not found (archetypeId="${archetypeId}"). ` +
          'Falling back to a circle.',
      )
    }
    return null
  }
  return { Component, spec }
}

export function ArchetypeGlyph({
  archetypeId,
  pulseState,
  category,
  size,
  silhouetteColour,
}: ArchetypeGlyphProps): ReactElement {
  const renderSize = Math.max(MIN_GLYPH_SIZE_PX, size ?? DEFAULT_GLYPH_SIZE_PX)

  const silhouette = silhouetteColour ?? getCategoryColour(category)
  const outline = dynamicContrastForCategory(category)
  const stateOpacity = pulseState === 'dormant' ? DORMANT_OPACITY : ACTIVE_OPACITY

  // Crossfade: render the current archetype, and during a change keep one
  // exiting layer fading to 0 over CROSSFADE_DURATION_MS.
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
    const exitClear = window.setTimeout(() => setExitingArchetypeId(null), CROSSFADE_DURATION_MS)

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

  // Outline stroke scales with size so it stays proportional from 8px up.
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
      <div
        key={archetypeId}
        style={{ ...layerStyle, opacity: enterOpacity, transition: `opacity ${CROSSFADE_DURATION_MS}ms linear` }}
      >
        <GlyphPair
          archetypeId={archetypeId}
          renderSize={renderSize}
          silhouette={silhouette}
          outline={outline}
          outlineStrokeWidth={outlineStrokeWidth}
        />
      </div>

      {exitingArchetypeId !== null && (
        <div
          key={`exit-${exitingArchetypeId}`}
          style={{ ...layerStyle, opacity: exitingOpacity, transition: `opacity ${CROSSFADE_DURATION_MS}ms linear` }}
        >
          <GlyphPair
            archetypeId={exitingArchetypeId}
            renderSize={renderSize}
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
 * Stacks the icon twice: a stroked outline pass (contrast colour) under a
 * filled pass (category colour). Phosphor icons accept `color` and pass `style`
 * through to the underlying `<svg>`, so the outline pass adds a stroke via
 * inline style; the fill pass paints the silhouette.
 */
function GlyphPair({
  archetypeId,
  renderSize,
  silhouette,
  outline,
  outlineStrokeWidth,
}: {
  archetypeId: string
  renderSize: number
  silhouette: string
  outline: string
  outlineStrokeWidth: number
}): ReactElement {
  const resolved = resolveIcon(archetypeId)

  if (!resolved) {
    // Generic dot fallback when the Phosphor component can't be resolved.
    return (
      <svg viewBox="0 0 24 24" width={renderSize} height={renderSize} style={{ display: 'block' }} aria-hidden="true">
        <circle cx="12" cy="12" r="6" fill={silhouette} stroke={outline} strokeWidth={outlineStrokeWidth} />
      </svg>
    )
  }

  const { Component, spec } = resolved

  return (
    <>
      {/* Outline pass - stroked clone underneath. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Component
          size={renderSize}
          weight={spec.weight}
          color={outline}
          style={{
            stroke: outline,
            strokeWidth: outlineStrokeWidth,
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
            paintOrder: 'stroke',
          }}
        />
      </div>
      {/* Fill pass - silhouette in the category colour. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Component size={renderSize} weight={spec.weight} color={silhouette} />
      </div>
    </>
  )
}
