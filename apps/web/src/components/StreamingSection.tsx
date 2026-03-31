import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import type { MusicGenre, StreamingProvider } from '@area-code/shared/types'
import { ManualGenreSelector } from './ManualGenreSelector'

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano', deep_house: 'Deep House', afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop', rnb: 'R&B', kwaito: 'Kwaito', gqom: 'Gqom',
  jazz: 'Jazz', rock: 'Rock', pop: 'Pop', gospel: 'Gospel', maskandi: 'Maskandi',
}

interface ConnectResponse {
  success: boolean
  provider: string
  genres: MusicGenre[]
}

export function StreamingSection() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const setUser = useUserStore((s) => s.setUser)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConsent, setShowConsent] = useState<StreamingProvider | null>(null)

  const connected = user?.streamingProvider ?? null
  const archetype = user?.archetypeId
    ? ARCHETYPE_CATALOG.find((a) => a.id === user.archetypeId)
    : ARCHETYPE_CATALOG.find((a) => a.name === 'The Uncharted')
  const genres = user?.musicGenres ?? []

  async function handleConnect(provider: StreamingProvider) {
    setShowConsent(null)
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<ConnectResponse>('/v1/users/me/streaming/connect', { provider })
      if (user) {
        setUser({
          ...user,
          streamingProvider: provider,
          musicGenres: res.genres ?? user.musicGenres,
        })
      }
    } catch {
      setError(t('profile.streaming.error'))
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    setLoading(true)
    setError(null)
    try {
      await api.delete('/v1/users/me/streaming/disconnect')
      if (user) setUser({ ...user, streamingProvider: null })
    } catch {
      setError(t('profile.streaming.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
        {t('profile.archetype.title')}
      </h3>

      {archetype && (
        <div className="flex flex-row items-center gap-3 mb-3">
          <span className="text-[var(--text-muted)] text-lg">{archetype.iconId}</span>
          <div className="flex-1">
            <p className="text-[var(--text-primary)] text-sm font-medium">{archetype.name}</p>
            <p className="text-[var(--text-secondary)] text-xs">{archetype.description}</p>
          </div>
        </div>
      )}

      {archetype?.name === 'The Uncharted' && (
        <p className="text-[var(--text-muted)] text-xs mb-3">
          {t('profile.archetype.uncharted')}
        </p>
      )}

      {genres.length > 0 && (
        <div className="flex flex-row flex-wrap gap-2 mb-3">
          {genres.map((g) => (
            <span
              key={g}
              className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-1 text-[var(--text-secondary)] text-xs"
            >
              {GENRE_LABELS[g] ?? g}
            </span>
          ))}
        </div>
      )}

      {connected ? (
        <div className="flex flex-row items-center justify-between">
          <span className="text-[var(--text-primary)] text-sm">
            {t('profile.streaming.connected', {
              provider: connected === 'spotify' ? 'Spotify' : 'Apple Music',
            })}
          </span>
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="text-[var(--danger)] text-sm disabled:opacity-50"
          >
            {t('profile.streaming.disconnect')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-row gap-2 mb-3">
            <button
              onClick={() => setShowConsent('spotify')}
              disabled={loading}
              className="flex-1 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl py-2 text-[var(--text-primary)] text-sm disabled:opacity-50"
            >
              {t('profile.streaming.connectSpotify')}
            </button>
            <button
              onClick={() => setShowConsent('apple_music')}
              disabled={loading}
              className="flex-1 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl py-2 text-[var(--text-primary)] text-sm disabled:opacity-50"
            >
              {t('profile.streaming.connectApple')}
            </button>
          </div>
          <ManualGenreSelector />
        </>
      )}

      {error && <p className="text-[var(--danger)] text-xs mt-2">{error}</p>}

      {showConsent && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 50 }}
        >
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 mx-4" style={{ maxWidth: 360 }}>
            <p className="text-[var(--text-primary)] text-sm font-medium mb-2">
              {t('profile.streaming.consentTitle')}
            </p>
            <p className="text-[var(--text-secondary)] text-xs mb-4">
              {t('profile.streaming.consentBody')}
            </p>
            <div className="flex flex-row gap-2">
              <button
                onClick={() => setShowConsent(null)}
                disabled={loading}
                className="flex-1 border border-[var(--border)] rounded-xl py-2 text-[var(--text-secondary)] text-sm disabled:opacity-50"
              >
                {t('profile.streaming.consentDecline')}
              </button>
              <button
                onClick={() => handleConnect(showConsent)}
                disabled={loading}
                className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2 text-sm disabled:opacity-50"
              >
                {t('profile.streaming.consentAgree')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
