import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import type { MusicGenre, ArchetypeTestResult } from '@area-code/shared/types'
import { MUSIC_GENRES, PERSONALITY_DIMENSIONS } from '@area-code/shared/constants/genre-weights'

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano', deep_house: 'Deep House', afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop', rnb: 'R&B', kwaito: 'Kwaito', gqom: 'Gqom',
  jazz: 'Jazz', rock: 'Rock', pop: 'Pop', gospel: 'Gospel', maskandi: 'Maskandi',
}

export function ArchetypeTestTool() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<MusicGenre[]>([])
  const [result, setResult] = useState<ArchetypeTestResult | null>(null)
  const [loading, setLoading] = useState(false)

  function toggle(genre: MusicGenre) {
    setSelected((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    )
  }

  async function handleTest() {
    setLoading(true)
    try {
      const res = await api.post<ArchetypeTestResult>('/v1/admin/archetypes/test', { genres: selected })
      setResult(res)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
      <h3 className="text-[var(--text-primary)] text-sm font-medium">{t('admin.archetypes.test')}</h3>

      <div className="flex flex-row flex-wrap gap-2">
        {MUSIC_GENRES.map((g) => (
          <button key={g} onClick={() => toggle(g)}
            className={`rounded-xl px-3 py-1 text-xs transition-all ${
              selected.includes(g)
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-secondary)]'
            }`}>
            {GENRE_LABELS[g]}
          </button>
        ))}
      </div>

      <button onClick={handleTest} disabled={loading}
        className="bg-[var(--accent)] text-white rounded-xl py-2 text-sm disabled:opacity-50">
        {t('admin.archetypes.test')}
      </button>

      {result && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[var(--text-secondary)] text-xs mb-1">{t('admin.archetypes.testResult')}</p>
            <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-row items-center gap-3">
              <span className="text-[var(--text-muted)] text-xs">{result.resolvedArchetype.iconId}</span>
              <div className="flex-1">
                <p className="text-[var(--text-primary)] text-sm font-medium">{result.resolvedArchetype.name}</p>
                <p className="text-[var(--text-secondary)] text-xs">{result.resolvedArchetype.description}</p>
              </div>
            </div>
          </div>

          {result.dimensionScores && (
            <div className="flex flex-row flex-wrap gap-2">
              {PERSONALITY_DIMENSIONS.map((d) => (
                <div key={d} className="bg-[var(--bg-raised)] rounded-xl px-3 py-1 text-xs text-[var(--text-secondary)]">
                  {d}: {result.dimensionScores![d].toFixed(2)}
                </div>
              ))}
            </div>
          )}

          {result.allMatches.length > 0 && (
            <div>
              <p className="text-[var(--text-secondary)] text-xs mb-1">{t('admin.archetypes.allMatches')}</p>
              <div className="flex flex-col gap-1">
                {result.allMatches.map((a, i) => (
                  <div key={a.id} className={`flex flex-row items-center gap-2 px-3 py-1 rounded-xl text-xs ${
                    i === 0 ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)]'
                  }`}>
                    <span>{a.priority}</span>
                    <span className="flex-1">{a.name}</span>
                    {i === 0 && <span className="font-medium">{t('admin.archetypes.winner')}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
