import { useState, useCallback, useEffect, useRef } from 'react'

import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { useConsumerAuthStore } from '../stores/consumerAuthStore'
import { useGeolocation } from '../hooks/useGeolocation'
import { api } from '../lib/api'
import type { ApiError } from '../lib/api'

// ============================================================================
// Constants
// ============================================================================

const MUSIC_GENRES = [
  'amapiano',
  'deep_house',
  'afrobeats',
  'hip_hop',
  'rnb',
  'kwaito',
  'gqom',
  'jazz',
  'rock',
  'pop',
  'gospel',
  'maskandi',
] as const

const QUEUE_VALUES = ['none', 'short', 'long'] as const

type MusicGenre = (typeof MUSIC_GENRES)[number]
type QueueValue = (typeof QUEUE_VALUES)[number]

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

const QUEUE_LABELS: Record<QueueValue, string> = {
  none: 'No Queue',
  short: 'Short',
  long: 'Long',
}

/** Rate limit cooldown: 5 minutes total */
const COOLDOWN_MS = 5 * 60 * 1000
/** Correction window: 2 minutes */
const CORRECTION_WINDOW_MS = 2 * 60 * 1000

// ============================================================================
// Types
// ============================================================================

interface SignalReportSheetProps {
  nodeId: string
  isOpen: boolean
  onClose: () => void
}

interface SubmitResponse {
  signalId: string
  reputationEarned: number
  isProximityReport: boolean
}

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error' | 'correcting'

interface CooldownState {
  genre: { until: number; correctionUntil: number } | null
  queue: { until: number; correctionUntil: number } | null
}

// ============================================================================
// Component
// ============================================================================

export function SignalReportSheet({ nodeId, isOpen, onClose }: SignalReportSheetProps) {
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const { requestLocation } = useGeolocation()

  // Selection state
  const [selectedGenre, setSelectedGenre] = useState<MusicGenre | null>(null)
  const [selectedQueue, setSelectedQueue] = useState<QueueValue | null>(null)

  // Submission state
  const [submissionState, setSubmissionState] = useState<SubmissionState>('idle')
  const [reputationEarned, setReputationEarned] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  // Cooldown state per type
  const [cooldowns, setCooldowns] = useState<CooldownState>({ genre: null, queue: null })
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [, setTick] = useState(0) // force re-render for cooldown countdown

  // Cooldown timer to force re-renders for countdown display
  useEffect(() => {
    if (cooldowns.genre || cooldowns.queue) {
      cooldownTimerRef.current = setInterval(() => {
        setTick((t) => t + 1)

        // Clear expired cooldowns
        const now = Date.now()
        setCooldowns((prev) => ({
          genre: prev.genre && prev.genre.until > now ? prev.genre : null,
          queue: prev.queue && prev.queue.until > now ? prev.queue : null,
        }))
      }, 1000)
    }

    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    }
  }, [cooldowns.genre !== null, cooldowns.queue !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now()
  const genreCooldownActive = cooldowns.genre && cooldowns.genre.until > now
  const queueCooldownActive = cooldowns.queue && cooldowns.queue.until > now
  const genreInCorrectionWindow = cooldowns.genre && cooldowns.genre.correctionUntil > now
  const queueInCorrectionWindow = cooldowns.queue && cooldowns.queue.correctionUntil > now

  const canSubmit =
    (selectedGenre !== null || selectedQueue !== null) && submissionState !== 'submitting'

  const handleSubmit = useCallback(async () => {
    if (!selectedGenre && !selectedQueue) return

    setSubmissionState('submitting')
    setErrorMessage('')
    setReputationEarned(0)

    // Request GPS coordinates
    const position = await requestLocation()
    const lat = position?.lat
    const lng = position?.lng

    let totalReputation = 0
    let hasError = false

    try {
      // Submit genre signal if selected
      if (selectedGenre) {
        const genreResult = await api.post<SubmitResponse>('/v1/signals', {
          nodeId,
          type: 'genre_playing',
          value: selectedGenre,
          ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
        })
        totalReputation += genreResult.reputationEarned

        // Set cooldown for genre
        const submitTime = Date.now()
        setCooldowns((prev) => ({
          ...prev,
          genre: {
            until: submitTime + COOLDOWN_MS,
            correctionUntil: submitTime + CORRECTION_WINDOW_MS,
          },
        }))
      }

      // Submit queue signal if selected
      if (selectedQueue) {
        const queueResult = await api.post<SubmitResponse>('/v1/signals', {
          nodeId,
          type: 'queue_length',
          value: selectedQueue,
          ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
        })
        totalReputation += queueResult.reputationEarned

        // Set cooldown for queue
        const submitTime = Date.now()
        setCooldowns((prev) => ({
          ...prev,
          queue: {
            until: submitTime + COOLDOWN_MS,
            correctionUntil: submitTime + CORRECTION_WINDOW_MS,
          },
        }))
      }

      setReputationEarned(totalReputation)
      setSubmissionState('success')
    } catch (err) {
      hasError = true
      const apiErr = err as ApiError
      setErrorMessage(apiErr.message || 'Failed to submit signal. Please try again.')
      setSubmissionState('error')
    }

    // Reset selections after successful submission
    if (!hasError) {
      setSelectedGenre(null)
      setSelectedQueue(null)
    }
  }, [selectedGenre, selectedQueue, nodeId, requestLocation])

  const handleCorrect = useCallback(async (type: 'genre' | 'queue') => {
    setSubmissionState('correcting')
    setErrorMessage('')

    const position = await requestLocation()
    const lat = position?.lat
    const lng = position?.lng

    const value = type === 'genre' ? selectedGenre : selectedQueue
    if (!value) return

    try {
      const result = await api.post<SubmitResponse>('/v1/signals', {
        nodeId,
        type: type === 'genre' ? 'genre_playing' : 'queue_length',
        value,
        ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
      })

      // Correction doesn't award additional reputation
      setReputationEarned(0)
      setSubmissionState('success')

      // Reset the correction window (new 2-min window starts)
      const submitTime = Date.now()
      setCooldowns((prev) => ({
        ...prev,
        [type]: {
          until: submitTime + COOLDOWN_MS,
          correctionUntil: submitTime + CORRECTION_WINDOW_MS,
        },
      }))

      if (type === 'genre') setSelectedGenre(null)
      else setSelectedQueue(null)
    } catch (err) {
      const apiErr = err as ApiError
      setErrorMessage(apiErr.message || 'Failed to correct signal. Please try again.')
      setSubmissionState('error')
    }
  }, [selectedGenre, selectedQueue, nodeId, requestLocation])

  const handleClose = useCallback(() => {
    // Reset transient state on close, keep cooldowns
    setSubmissionState('idle')
    setErrorMessage('')
    setReputationEarned(0)
    setSelectedGenre(null)
    setSelectedQueue(null)
    onClose()
  }, [onClose])

  const handleDismissConfirmation = useCallback(() => {
    setSubmissionState('idle')
    setErrorMessage('')
    setReputationEarned(0)
  }, [])

  // Don't render for unauthenticated users
  if (!isAuthenticated) return null

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title="Report Signal">
      <div className="flex flex-col gap-5">
        {/* Success confirmation */}
        {submissionState === 'success' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-12 h-12 rounded-full bg-[var(--success)]/20 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="var(--success)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-[var(--text-primary)] font-semibold text-base">
              Signal reported!
            </p>
            {reputationEarned > 0 && (
              <p className="text-[var(--text-muted)] text-sm">
                +{reputationEarned} Reputation {reputationEarned === 1 ? 'point' : 'points'} earned
              </p>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDismissConfirmation}
              className="mt-2"
            >
              Done
            </Button>
          </div>
        )}

        {/* Error state */}
        {submissionState === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-12 h-12 rounded-full bg-[var(--danger)]/20 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 18L18 6M6 6l12 12"
                  stroke="var(--danger)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-[var(--danger)] text-sm text-center">{errorMessage}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDismissConfirmation}
              className="mt-2"
            >
              Try Again
            </Button>
          </div>
        )}

        {/* Main form - shown when idle, submitting, or correcting */}
        {(submissionState === 'idle' || submissionState === 'submitting' || submissionState === 'correcting') && (
          <>
            {/* Genre Section */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2">
                What&apos;s playing?
              </h3>
              <div className="flex flex-wrap gap-2">
                {MUSIC_GENRES.map((genre) => {
                  const isSelected = selectedGenre === genre
                  const isDisabled =
                    genreCooldownActive && !genreInCorrectionWindow
                  return (
                    <button
                      key={genre}
                      type="button"
                      disabled={!!isDisabled}
                      onClick={() => setSelectedGenre(isSelected ? null : genre)}
                      aria-pressed={isSelected}
                      className={`
                        px-3 py-1.5 rounded-full text-sm font-medium
                        transition-all duration-150
                        min-h-[44px] min-w-[44px]
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                        ${isSelected
                          ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-sm'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border)]'
                        }
                        ${isDisabled
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:border-[var(--border-strong)] active:scale-95'
                        }
                      `.trim()}
                    >
                      {GENRE_LABELS[genre]}
                    </button>
                  )
                })}
              </div>
              {/* Genre correction button */}
              {genreInCorrectionWindow && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleCorrect('genre')}
                  disabled={!selectedGenre || submissionState === 'correcting'}
                  className="mt-2"
                >
                  Correct genre
                </Button>
              )}
              {/* Genre cooldown indicator (after correction window) */}
              {genreCooldownActive && !genreInCorrectionWindow && (
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  Genre report cooldown: {formatCooldown(cooldowns.genre!.until - now)}
                </p>
              )}
            </div>

            {/* Queue Section */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2">
                Queue length
              </h3>
              <div className="flex gap-2">
                {QUEUE_VALUES.map((queue) => {
                  const isSelected = selectedQueue === queue
                  const isDisabled =
                    queueCooldownActive && !queueInCorrectionWindow
                  return (
                    <button
                      key={queue}
                      type="button"
                      disabled={!!isDisabled}
                      onClick={() => setSelectedQueue(isSelected ? null : queue)}
                      aria-pressed={isSelected}
                      className={`
                        flex-1 px-3 py-2 rounded-full text-sm font-medium
                        transition-all duration-150
                        min-h-[44px]
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                        ${isSelected
                          ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-sm'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border)]'
                        }
                        ${isDisabled
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:border-[var(--border-strong)] active:scale-95'
                        }
                      `.trim()}
                    >
                      {QUEUE_LABELS[queue]}
                    </button>
                  )
                })}
              </div>
              {/* Queue correction button */}
              {queueInCorrectionWindow && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleCorrect('queue')}
                  disabled={!selectedQueue || submissionState === 'correcting'}
                  className="mt-2"
                >
                  Correct queue
                </Button>
              )}
              {/* Queue cooldown indicator (after correction window) */}
              {queueCooldownActive && !queueInCorrectionWindow && (
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  Queue report cooldown: {formatCooldown(cooldowns.queue!.until - now)}
                </p>
              )}
            </div>

            {/* Submit button */}
            <Button
              variant="primary"
              size="lg"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              loading={submissionState === 'submitting' || submissionState === 'correcting'}
              className="w-full mt-2"
            >
              Report Signal
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function formatCooldown(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
