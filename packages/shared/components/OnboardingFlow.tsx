import { useState } from 'react'
import { api } from '../lib/api'
import { Spinner } from './Spinner'
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
      prev.includes(genre) ? prev.filter((g) => g !== genre) : prev.length < 5 ? [...prev, genre] : prev,
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
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto"
      style={{ backgroundColor: 'var(--bg-base)' }}
    >
      <div
        className="w-full max-w-[380px] mx-4 py-8 px-5 flex flex-col items-center min-h-full justify-center"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}
      >
        <h1 className="text-[var(--text-primary)] text-2xl font-extrabold text-center mb-2 font-[Syne]">
          What do you listen to?
        </h1>
        <p className="text-[var(--text-secondary)] text-[13px] text-center mb-6 leading-relaxed">
          Pick up to 5 genres. This powers the crowd vibe at venues you visit.
        </p>

        <div className="flex flex-wrap gap-2 justify-center mb-6">
          {GENRES.map((g) => {
            const active = selected.includes(g.id)
            return (
              <button
                key={g.id}
                onClick={() => toggle(g.id)}
                className={`px-4 py-2 rounded-xl text-[13px] font-medium transition-all duration-150 ${
                  active
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-raised)] text-[var(--text-secondary)] border border-[var(--border)]'
                }`}
              >
                {g.label}
              </button>
            )
          })}
        </div>

        <p className="text-[var(--text-muted)] text-[11px] text-center mb-4">{selected.length}/5 selected</p>

        {error && <p className="text-[var(--danger)] text-xs text-center mb-3">{error}</p>}

        <button
          onClick={handleContinue}
          disabled={saving || selected.length < 1}
          className={`w-full rounded-xl py-3.5 text-[15px] font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
            selected.length >= 1
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-raised)] text-[var(--text-muted)] cursor-default'
          } ${saving ? 'opacity-50' : ''}`}
        >
          {saving ? <Spinner size="sm" className="border-white border-t-transparent" /> : 'Continue'}
        </button>
      </div>
    </div>
  )
}
