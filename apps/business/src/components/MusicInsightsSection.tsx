import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import type { BusinessMusicAudience, MusicGenre } from '@area-code/shared/types'

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano', deep_house: 'Deep House', afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop', rnb: 'R&B', kwaito: 'Kwaito', gqom: 'Gqom',
  jazz: 'Jazz', rock: 'Rock', pop: 'Pop', gospel: 'Gospel', maskandi: 'Maskandi',
}

export function MusicInsightsSection() {
  const { t } = useTranslation()
  const [data, setData] = useState<BusinessMusicAudience | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<BusinessMusicAudience>('/v1/business/me/audience/music')
      .then((res) => { if (!cancelled) setData(res) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!data || data.totalWithMusicPrefs < 20) {
    if (data && data.totalWithMusicPrefs < 20) {
      return (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
          <p className="text-[var(--text-muted)] text-sm text-center">{t('biz.audience.minMusicData')}</p>
        </div>
      )
    }
    return null
  }

  const genreEntries = Object.entries(data.genreDistribution)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [MusicGenre, number][]
  const maxGenre = genreEntries[0]?.[1] ?? 1

  const archetypeEntries = Object.entries(data.archetypeBreakdown)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-4">
      {/* Music Taste card */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">
          {t('biz.audience.musicTaste')}
        </h3>
        <div className="flex flex-col gap-2">
          {genreEntries.map(([genre, count]) => (
            <div key={genre} className="flex flex-row items-center gap-3">
              <span className="text-[var(--text-primary)] text-xs w-20 shrink-0">
                {GENRE_LABELS[genre] ?? genre}
              </span>
              <div className="flex-1 bg-[var(--bg-raised)] rounded-xl h-5 overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-xl transition-all"
                  style={{ width: `${((count ?? 0) / maxGenre) * 100}%` }}
                />
              </div>
              <span className="text-[var(--text-muted)] text-xs w-8 text-right">{count}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Personality Types card */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">
          {t('biz.audience.personalityTypes')}
        </h3>
        <div className="flex flex-row flex-wrap gap-2">
          {archetypeEntries.map(([name, pct]) => (
            <div key={name} className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-3 py-2 flex flex-row items-center gap-2">
              <span className="text-[var(--text-primary)] text-sm font-medium">{pct}%</span>
              <span className="text-[var(--text-secondary)] text-xs">{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Peak Personality by Time card */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">
          {t('biz.audience.peakPersonality')}
        </h3>
        <div className="flex flex-col gap-2">
          {data.peakArchetypeByTime.map((seg) => (
            <div key={seg.timeSegment} className="flex flex-row items-center justify-between py-1">
              <span className="text-[var(--text-muted)] text-xs">{seg.timeSegment}</span>
              <span className="text-[var(--text-primary)] text-sm">{seg.archetypeName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
