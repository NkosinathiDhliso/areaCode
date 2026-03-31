import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { MUSIC_GENRES } from '@area-code/shared/constants/genre-weights'
import type { MusicGenre } from '@area-code/shared/types'

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano', deep_house: 'Deep House', afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop', rnb: 'R&B', kwaito: 'Kwaito', gqom: 'Gqom',
  jazz: 'Jazz', rock: 'Rock', pop: 'Pop', gospel: 'Gospel', maskandi: 'Maskandi',
}

export function ManualGenreSelector() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const setUser = useUserStore((s) => s.setUser)
  const [selected, setSelected] = useState<MusicGenre[]>(user?.musicGenres ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(genre: MusicGenre) {
    setSelected((prev) =>
      prev.includes(genre)
        ? prev.filter((g) => g !== genre)
        : prev.length < 5 ? [...prev, genre] : prev,
    )
  }

  async function handleSave() {
    if (selected.length < 1) {
      setError(t('profile.genres.min'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.patch('/v1/users/me/genres', { musicGenres: selected })
      if (user) setUser({ ...user, musicGenres: selected })
    } catch {
      setError(t('profile.streaming.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h4 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-2">
        {t('profile.genres.title')}
      </h4>
      <div className="flex flex-row flex-wrap gap-2 mb-2">
        {MUSIC_GENRES.map((genre) => (
          <button
            key={genre}
            onClick={() => toggle(genre)}
            className={`rounded-xl px-3 py-1 text-xs transition-all duration-150 ${
              selected.includes(genre)
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-secondary)]'
            }`}
          >
            {GENRE_LABELS[genre]}
          </button>
        ))}
      </div>
      <p className="text-[var(--text-muted)] text-xs mb-2">{t('profile.genres.max')}</p>
      <button
        onClick={handleSave}
        disabled={saving || selected.length < 1}
        className="w-full bg-[var(--accent)] text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50"
      >
        {t('profile.genres.save')}
      </button>
      {error && <p className="text-[var(--danger)] text-xs mt-1">{error}</p>}
    </div>
  )
}
