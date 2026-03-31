import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import type { CrowdVibeSnapshot, MusicGenre } from '@area-code/shared/types'
import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'

interface CrowdVibeSectionProps {
  nodeId: string
}

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano', deep_house: 'Deep House', afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop', rnb: 'R&B', kwaito: 'Kwaito', gqom: 'Gqom',
  jazz: 'Jazz', rock: 'Rock', pop: 'Pop', gospel: 'Gospel', maskandi: 'Maskandi',
}

export function CrowdVibeSection({ nodeId }: CrowdVibeSectionProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<CrowdVibeSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<CrowdVibeSnapshot>(`/v1/nodes/${nodeId}/crowd-vibe`)
      .then((res) => { if (!cancelled) setData(res) })
      .catch(() => { /* hide silently */ })
    return () => { cancelled = true }
  }, [nodeId])

  if (!data || data.totalCheckedIn === 0) return null

  const archetypeEntries = Object.entries(data.archetypePercentages)
    .filter(([, pct]) => pct > 0)
    .sort((a, b) => b[1] - a[1])

  const genreEntries = Object.entries(data.genreCounts)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [MusicGenre, number][]

  if (archetypeEntries.length === 0 && genreEntries.length === 0) return null

  return (
    <div className="mb-4">
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-2">
        {t('crowdVibe.title')}
      </h3>

      {archetypeEntries.length > 0 && (
        <div className="flex flex-row flex-wrap gap-2 mb-3">
          {archetypeEntries.map(([name, pct]) => {
            const arch = ARCHETYPE_CATALOG.find((a) => a.name === name)
            return (
              <div
                key={name}
                className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-3 py-2 flex flex-row items-center gap-2"
              >
                <span className="text-[var(--text-muted)] text-xs">{arch?.iconId ?? '?'}</span>
                <span className="text-[var(--text-primary)] text-sm font-medium">{pct}%</span>
                <span className="text-[var(--text-secondary)] text-xs">{name}</span>
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
