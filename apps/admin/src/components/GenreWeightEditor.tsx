import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import type { GenreWeightEntry, MusicGenre, PersonalityDimension } from '@area-code/shared/types'
import { PERSONALITY_DIMENSIONS, MUSIC_GENRES } from '@area-code/shared/constants/genre-weights'

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano', deep_house: 'Deep House', afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop', rnb: 'R&B', kwaito: 'Kwaito', gqom: 'Gqom',
  jazz: 'Jazz', rock: 'Rock', pop: 'Pop', gospel: 'Gospel', maskandi: 'Maskandi',
}

const DIM_SHORT: Record<PersonalityDimension, string> = {
  energy: 'ENR', cultural_rootedness: 'CUL', sophistication: 'SOP', edge: 'EDG', spirituality: 'SPI',
}

export function GenreWeightEditor() {
  const { t } = useTranslation()
  const [matrix, setMatrix] = useState<GenreWeightEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<GenreWeightEntry[]>('/v1/admin/genre-weights')
      .then(setMatrix)
      .catch(() => {})
  }, [])

  function updateWeight(genre: MusicGenre, dim: PersonalityDimension, val: string) {
    const num = parseFloat(val)
    if (isNaN(num)) return
    setMatrix((prev) => prev.map((entry) =>
      entry.genre === genre
        ? { ...entry, weights: { ...entry.weights, [dim]: num } }
        : entry,
    ))
  }

  function validate(): boolean {
    for (const entry of matrix) {
      for (const d of PERSONALITY_DIMENSIONS) {
        const v = entry.weights[d]
        if (v < 0 || v > 1) return false
      }
    }
    return true
  }

  async function handleSave() {
    if (!validate()) {
      setError(t('admin.genreWeights.invalid'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.patch('/v1/admin/genre-weights', { matrix })
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('admin.genreWeights.title')}</h2>

      <div className="overflow-x-auto">
        {/* Header row */}
        <div className="flex flex-row gap-1 mb-2">
          <div className="w-24 shrink-0" />
          {PERSONALITY_DIMENSIONS.map((d) => (
            <div key={d} className="w-16 text-center text-[var(--text-muted)] text-xs font-medium">{DIM_SHORT[d]}</div>
          ))}
        </div>

        {/* Genre rows */}
        {matrix.map((entry) => (
          <div key={entry.genre} className="flex flex-row gap-1 mb-1 items-center">
            <div className="w-24 shrink-0 text-[var(--text-primary)] text-xs">{GENRE_LABELS[entry.genre]}</div>
            {PERSONALITY_DIMENSIONS.map((d) => (
              <input
                key={d}
                type="number" step="0.1" min="0" max="1"
                value={entry.weights[d]}
                onChange={(e) => updateWeight(entry.genre, d, e.target.value)}
                className="w-16 bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg px-1 py-1 text-center text-xs text-[var(--text-primary)]"
              />
            ))}
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-[var(--accent)] text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50"
      >
        {t('admin.genreWeights.save')}
      </button>
      {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
    </div>
  )
}
