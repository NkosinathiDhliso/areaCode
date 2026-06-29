import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import { api } from '@area-code/shared/lib/api'
import { useUserStore } from '@area-code/shared/stores/userStore'
import type { MusicGenre, StreamingProvider, User } from '@area-code/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { resolveArchetypeDisplayName } from '../lib/archetypeDisplay'
import { ArchetypeReveal } from './ArchetypeReveal'
import { ManualGenreSelector } from './ManualGenreSelector'

const UNCHARTED_ARCHETYPE_ID = 'archetype-uncharted'

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

interface ConnectResponse {
  success: boolean
  provider: string
  redirectUrl?: string
  genres: MusicGenre[]
}

export function StreamingSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useUserStore((s) => s.user)
  const setUser = useUserStore((s) => s.setUser)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConsent, setShowConsent] = useState<StreamingProvider | null>(null)
  const [spotifySuccess, setSpotifySuccess] = useState(false)
  const [syncingSpotify, setSyncingSpotify] = useState(false)
  // Manual genres are the fallback when Spotify isn't connected. Hidden behind
  // a toggle so the section leads with one choice at a time (Spotify first).
  const [showManual, setShowManual] = useState(false)

  const connected = user?.streamingProvider ?? null
  // Look up the catalog entry by id so the rename module (R9.6) is the only
  // source of consumer-facing display names. The legacy `archetype.name`
  // field is preserved on the catalog for admin tools (R9.7) and is no
  // longer rendered on consumer surfaces.
  const archetypeId = user?.archetypeId ?? UNCHARTED_ARCHETYPE_ID
  const archetype = ARCHETYPE_CATALOG.find((a) => a.id === archetypeId)
  const archetypeDisplayName = resolveArchetypeDisplayName(archetypeId)
  const genres = user?.musicGenres ?? []

  // Handle Spotify OAuth callback, read query params after redirect back.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const streaming = params.get('streaming')
    const provider = params.get('provider')
    const genresParam = params.get('genres')
    const reason = params.get('reason')

    if (!streaming) return

    // Clean the URL so the params don't persist on refresh
    const cleanUrl = window.location.pathname
    window.history.replaceState({}, '', cleanUrl)

    if (streaming === 'success' && provider === 'spotify') {
      setSpotifySuccess(true)
      setError(null)
      setLoading(false)
      setSyncingSpotify(true)

      const callbackGenres = genresParam ? (genresParam.split(',').filter(Boolean) as MusicGenre[]) : []

      if (user) {
        setUser({
          ...user,
          streamingProvider: 'spotify',
          musicGenres: callbackGenres.length > 0 ? callbackGenres : user.musicGenres,
        })
      }

      void api
        .get<User>('/v1/users/me')
        .then((freshUser) => {
          setUser(freshUser)
          return queryClient.invalidateQueries({ queryKey: ['user', 'me'] })
        })
        .catch(() => {
          // The callback already marked Spotify connected. Keep that optimistic state.
        })
        .finally(() => setSyncingSpotify(false))

      // Clear success banner after 5s
      setTimeout(() => setSpotifySuccess(false), 5000)
    } else if (streaming === 'error') {
      const messages: Record<string, string> = {
        invalid_state: 'Spotify authorization expired. Please try again.',
        expired: 'Spotify authorization timed out. Please try again.',
        fetch_failed: 'Could not fetch your Spotify data. Please try again.',
      }
      setError(messages[reason ?? ''] ?? 'Spotify connection failed. Please try again.')
    }
  }, [queryClient, setUser, user])

  async function handleConnect(provider: StreamingProvider) {
    setShowConsent(null)
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<ConnectResponse>('/v1/users/me/streaming/connect', {
        provider,
        frontendOrigin: window.location.origin,
      })

      // If the backend returns a redirectUrl, open it (OAuth flow)
      if (res.redirectUrl) {
        // Redirect the user to Spotify's authorization page
        window.location.href = res.redirectUrl
        return // Do not setLoading(false), we are navigating away.
      }

      // No redirect URL means direct connect (e.g. Apple Music with token, or fallback)
      if (user) {
        setUser({
          ...user,
          streamingProvider: provider,
          musicGenres: res.genres?.length ? res.genres : user.musicGenres,
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
      if (user) setUser({ ...user, streamingProvider: null, musicGenres: [], archetypeId: undefined })
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

      {/* Success banner after Spotify OAuth callback */}
      {spotifySuccess && (
        <div className="bg-[var(--success)]/10 border border-[var(--success)]/30 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--success)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-[var(--success)] text-xs font-medium">
            Spotify connected, your music personality has been updated
          </span>
        </div>
      )}

      {syncingSpotify && (
        <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[var(--text-secondary)] text-xs">Syncing your Spotify genres and archetype</span>
        </div>
      )}

      {/*
        Archetype reveal card. Renders the rename-module display name,
        the catalog description, and (for non-English names like Kasi)
        an italicised etymology line beneath the display name. The same
        component is also the "re-read" surface reachable from the
        consumer profile screen per R9.11. For `archetype-uncharted` it
        also surfaces the helper copy from `profile.archetype.uncharted`
        as a call to action (R9.8).
      */}
      <ArchetypeReveal archetypeId={archetypeId} />

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
        <div className="bg-[var(--bg-raised)] border border-[var(--accent)] rounded-xl p-3">
          <div className="flex flex-row items-center justify-between gap-3">
            <div className="flex-1">
              <div className="flex flex-row items-center gap-2">
                {connected === 'spotify' && (
                  <svg className="text-[var(--accent)]" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                )}
                <span className="text-[var(--text-primary)] text-sm font-medium">
                  {t('profile.streaming.connected', {
                    provider: connected === 'spotify' ? 'Spotify' : 'Apple Music',
                  })}
                </span>
              </div>
              <p className="text-[var(--text-muted)] text-xs mt-1">
                {genres.length > 0
                  ? `${genres.length} genres synced${archetype ? `, ${archetypeDisplayName}` : ''}`
                  : 'Connected. Add listening history or pick genres manually to shape your archetype.'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              {connected === 'spotify' && (
                <button
                  onClick={() => handleConnect('spotify')}
                  disabled={loading}
                  className="text-[var(--accent)] text-sm disabled:opacity-50"
                >
                  {t('profile.streaming.refresh', 'Refresh')}
                </button>
              )}
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="text-[var(--danger)] text-sm disabled:opacity-50"
              >
                {t('profile.streaming.disconnect')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl p-3 mb-3">
            <div className="flex flex-row items-start justify-between gap-3 mb-3">
              <div className="flex flex-row items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                </span>
                <div>
                  <p className="text-[var(--text-primary)] text-sm font-medium">Spotify music sync</p>
                  <p className="text-[var(--text-muted)] text-xs">Ready to discover your music personality</p>
                </div>
              </div>
              <span className="rounded-xl border border-[var(--accent)] px-2 py-1 text-[var(--accent)] text-[10px] font-medium uppercase tracking-wider">
                Live
              </span>
            </div>

            <p className="text-[var(--text-secondary)] text-xs mb-3">
              Connect Spotify to read your top artists, map them into Area Code genres, and set your music personality.
              Reconnect anytime to refresh it.
            </p>

            <div className="flex flex-row flex-wrap gap-2 mb-3">
              <span className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-2 py-1 text-[var(--text-secondary)] text-[11px]">
                OAuth connected
              </span>
              <span className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-2 py-1 text-[var(--text-secondary)] text-[11px]">
                Top artists
              </span>
              <span className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-2 py-1 text-[var(--text-secondary)] text-[11px]">
                Instant archetype read
              </span>
            </div>

            <button
              onClick={() => setShowConsent('spotify')}
              disabled={loading}
              className="w-full bg-[var(--accent)] text-white rounded-xl py-3 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                t('profile.streaming.connectSpotify')
              )}
            </button>
          </div>

          {showManual ? (
            <>
              <div className="flex flex-row items-center justify-between gap-3 mb-2">
                <p className="text-[var(--text-muted)] text-xs">
                  Fallback: pick up to 5 genres. Connecting Spotify later replaces these.
                </p>
                <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">
                  {t('profile.streaming.connectApple')} soon
                </span>
              </div>
              <ManualGenreSelector />
            </>
          ) : (
            <button
              onClick={() => setShowManual(true)}
              className="w-full text-center text-[var(--text-secondary)] text-xs font-medium py-2 transition-all active:scale-95"
            >
              {genres.length > 0
                ? t('profile.streaming.editGenres', 'Edit your genres instead')
                : t('profile.streaming.pickManually', 'Prefer not to connect? Pick your genres')}
            </button>
          )}
        </>
      )}

      {error && <p className="text-[var(--danger)] text-xs mt-2">{error}</p>}

      {showConsent && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 50 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConsent(null)
          }}
        >
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 mx-4"
            style={{ maxWidth: 360 }}
          >
            <p className="text-[var(--text-primary)] text-sm font-medium mb-2">{t('profile.streaming.consentTitle')}</p>
            <p className="text-[var(--text-secondary)] text-xs mb-4">
              We'll read your top artists from Spotify to discover your music personality. We only access your listening
              history. You can disconnect anytime.
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
                className="flex-1 bg-[#1DB954] text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50"
              >
                Connect Spotify
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
