import { useState } from 'react'
import { api } from '../lib/api'
import type { MusicGenre } from '../types'

const GENRES: { id: MusicGenre; label: string }[] = [
  { id: 'amapiano', label: 'Amapiano' },
  { id: 'deep_house', label: 'Deep House' },
  { id: 'afrobeats', label: 'Afrobeats' },
  { id: 'hip_hop', label: 'Hip Hop' },
  { id: 'rnb', label: 'R&B' },
  { id: 'kwaito', label: 'Kwaito' },
  { id: 'gqom', label: 'Gqom' },
  { id: 'jazz', label: 'Jazz' },
  { id: 'rock', label: 'Rock' },
  { id: 'pop', label: 'Pop' },
  { id: 'gospel', label: 'Gospel' },
  { id: 'maskandi', label: 'Maskandi' },
]

interface OnboardingFlowProps {
  onComplete: () => void
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [selected, setSelected] = useState<MusicGenre[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(genre: MusicGenre) {
    setSelected((prev) =>
      prev.includes(genre)
        ? prev.filter((g) => g !== genre)
        : prev.length < 5 ? [...prev, genre] : prev,
    )
  }

  async function handleContinue() {
    if (selected.length < 1) {
      setError('Pick at least 1 genre')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.patch('/v1/users/me/genres', { musicGenres: selected })
      await api.post('/v1/users/me/onboarding/complete')
      onComplete()
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-base, #0f0f17)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          margin: '0 16px',
          padding: '32px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <h1
          style={{
            color: 'var(--text-primary, #f0f0f5)',
            fontSize: 24,
            fontWeight: 800,
            textAlign: 'center',
            margin: '0 0 8px 0',
            fontFamily: 'Syne, system-ui, sans-serif',
          }}
        >
          What do you listen to?
        </h1>
        <p
          style={{
            color: 'var(--text-secondary, #a0a0b8)',
            fontSize: 13,
            textAlign: 'center',
            margin: '0 0 24px 0',
            lineHeight: '1.5',
          }}
        >
          Pick up to 5 genres. This powers the crowd vibe at venues you visit.
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          {GENRES.map((g) => {
            const active = selected.includes(g.id)
            return (
              <button
                key={g.id}
                onClick={() => toggle(g.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 500,
                  border: active ? 'none' : '1px solid var(--border, rgba(255,255,255,0.08))',
                  backgroundColor: active
                    ? 'var(--accent, #6c63ff)'
                    : 'var(--bg-raised, #1e1e2e)',
                  color: active ? '#fff' : 'var(--text-secondary, #a0a0b8)',
                  cursor: 'pointer',
                  transition: 'all 150ms',
                }}
              >
                {g.label}
              </button>
            )
          })}
        </div>

        <p
          style={{
            color: 'var(--text-muted, #606078)',
            fontSize: 11,
            textAlign: 'center',
            margin: '0 0 16px 0',
          }}
        >
          {selected.length}/5 selected
        </p>

        {error && (
          <p
            style={{
              color: 'var(--danger, #ff4757)',
              fontSize: 12,
              textAlign: 'center',
              margin: '0 0 12px 0',
            }}
          >
            {error}
          </p>
        )}

        <button
          onClick={handleContinue}
          disabled={saving || selected.length < 1}
          style={{
            width: '100%',
            backgroundColor: selected.length >= 1
              ? 'var(--accent, #6c63ff)'
              : 'var(--bg-raised, #1e1e2e)',
            color: selected.length >= 1 ? '#fff' : 'var(--text-muted, #606078)',
            fontWeight: 600,
            borderRadius: 12,
            padding: '14px 0',
            fontSize: 15,
            border: 'none',
            cursor: selected.length >= 1 ? 'pointer' : 'default',
            opacity: saving ? 0.5 : 1,
            transition: 'all 200ms',
          }}
        >
          {saving ? '...' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
