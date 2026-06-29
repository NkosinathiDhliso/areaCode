import { getArchetypeIcon, FALLBACK_ARCHETYPE_ICON } from '@area-code/shared/constants'
import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import { api } from '@area-code/shared/lib/api'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { CrowdVibeSnapshot, MusicGenre } from '@area-code/shared/types'
import * as PhosphorIcons from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { resolveArchetypeDisplayName } from '../lib/archetypeDisplay'

interface CrowdVibeSectionProps {
  nodeId: string
}

/** Small Phosphor icon for an archetype iconId. */
function ArchetypeChipIcon({ iconId }: { iconId: string | undefined }) {
  const spec = (iconId ? getArchetypeIcon(iconId) : undefined) ?? FALLBACK_ARCHETYPE_ICON
  const registry = PhosphorIcons as unknown as Record<string, Icon | undefined>
  const Component = registry[spec.name]
  if (!Component) return null
  return <Component size={16} weight={spec.weight} className="text-[var(--text-secondary)]" />
}

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano',
  deep_house: 'Deep House',
  afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop',
  rnb: 'R&B',
  kwaito: 'Kwaito',
  gqom: 'Gqom',
  jazz: 'Jazz',
  rock: 'Rock',
  pop: 'Pop',
  gospel: 'Gospel',
  maskandi: 'Maskandi',
}

export function CrowdVibeSection({ nodeId }: CrowdVibeSectionProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<CrowdVibeSnapshot | null>(null)

  // Source the Resolution_Branch from the SAME live map data the glyph rides
  // (`mapStore`, written by the `node:archetype_change` socket event). Because
  // the branch and the rendered archetype id are stored together, this label
  // can never disagree with the glyph (live-vibe-declaration R6.1-R6.3). We do
  // not recompute the branch here.
  const branch = useMapStore((s) => s.archetypeBranches[nodeId])

  useEffect(() => {
    let cancelled = false
    api
      .get<CrowdVibeSnapshot>(`/v1/nodes/${nodeId}/crowd-vibe`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        /* hide silently */
      })
    return () => {
      cancelled = true
    }
  }, [nodeId])

  if (!data || data.totalCheckedIn === 0) return null

  const archetypeEntries = Object.entries(data.archetypePercentages)
    .filter(([, pct]) => pct > 0)
    .sort((a, b) => b[1] - a[1])

  const genreEntries = Object.entries(data.genreCounts)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [MusicGenre, number][]

  if (archetypeEntries.length === 0 && genreEntries.length === 0) return null

  // Honest promise-vs-now framing keyed on the resolved branch (R6.2, R6.3).
  // `declared_promise` (below the Presence_Floor) is the venue's expectation,
  // never a claim about the crowd in the room; `crowd_live` (at/above the
  // floor) is the real crowd now. Any other branch or missing data falls back
  // to the neutral "Crowd Vibe" heading and asserts no reading.
  const heading =
    branch === 'declared_promise'
      ? t('crowdVibe.expectedTonight')
      : branch === 'crowd_live'
        ? t('crowdVibe.inTheRoomNow')
        : t('crowdVibe.title')

  return (
    <div className="mb-4">
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-2">{heading}</h3>

      {archetypeEntries.length > 0 && (
        <div className="flex flex-row flex-wrap gap-2 mb-3">
          {archetypeEntries.map(([name, pct]) => {
            // The crowd-vibe API keys the percentages by the legacy long-form
            // archetype name (e.g. "The Festival Spirit"), which is preserved
            // on the catalog for admin tools (R9.7) and is no longer rendered
            // on consumer surfaces. Map the legacy name back to the catalog
            // id, then resolve through `resolveArchetypeDisplayName` so the
            // surface renders the short display name (R9.6) and emits a
            // non-blocking warning if the id is unknown (R9.10).
            const arch = ARCHETYPE_CATALOG.find((a) => a.name === name)
            const displayName = arch ? resolveArchetypeDisplayName(arch.id) : name
            return (
              <div
                key={name}
                className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-3 py-2 flex flex-row items-center gap-2"
              >
                <ArchetypeChipIcon iconId={arch?.iconId} />
                <span className="text-[var(--text-primary)] text-sm font-medium">{pct}%</span>
                <span className="text-[var(--text-secondary)] text-xs">{displayName}</span>
              </div>
            )
          })}
        </div>
      )}

      {genreEntries.length > 0 && (
        <div className="flex flex-row flex-wrap gap-2">
          {genreEntries.map(([genre, count]) => (
            <span
              key={genre}
              className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-1 text-[var(--text-secondary)] text-xs"
            >
              {count} {GENRE_LABELS[genre] ?? genre}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
