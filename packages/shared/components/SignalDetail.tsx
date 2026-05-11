/**
 * SignalDetail — Node detail sheet section showing active live signals.
 *
 * Displays genre consensus, queue length, confidence indicators, time since report,
 * owner badge, and report count. Falls back to predicted taste profile when no live
 * signals exist.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
import { CheckCircle, Music, Users } from 'lucide-react'

import type { MusicGenre } from '../types'
import { Box, Text } from './primitives'

export interface SignalDetailProps {
  /** Consensus genre value, null if no active signal */
  consensusGenre: string | null
  /** Confidence score for genre consensus (0.0 - 1.0) */
  consensusGenreConfidence: number
  /** Consensus queue length, null if no active signal */
  consensusQueue: 'none' | 'short' | 'long' | null
  /** Confidence score for queue consensus (0.0 - 1.0) */
  consensusQueueConfidence: number
  /** Total number of reports contributing to consensus */
  signalReportCount: number
  /** ISO timestamp of the most recent signal report */
  lastSignalAt: string | null
  /** Whether the most recent signal is from the venue owner */
  isOwnerReport: boolean
  /** Fallback genre counts from CrowdVibeSnapshot (when no live signals) */
  genreCounts?: Partial<Record<MusicGenre, number>>
}

type ConfidenceLevel = 'high' | 'medium' | 'low'

const GENRE_LABELS: Record<string, string> = {
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

const QUEUE_LABELS: Record<string, string> = {
  none: 'No queue',
  short: 'Short queue',
  long: 'Long queue',
}

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { color: string; bg: string; label: string }> = {
  high: {
    color: 'text-[var(--success)]',
    bg: 'bg-[var(--success)]',
    label: 'High confidence',
  },
  medium: {
    color: 'text-[var(--warning)]',
    bg: 'bg-[var(--warning)]',
    label: 'Medium confidence',
  },
  low: {
    color: 'text-[var(--tier-regular)]',
    bg: 'bg-[var(--tier-regular)]',
    label: 'Low confidence',
  },
}

function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

function getTimeSinceReport(isoTimestamp: string): string {
  const now = Date.now()
  const then = new Date(isoTimestamp).getTime()
  const diffMs = now - then

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Returns the top N genres from genreCounts, sorted by count descending
 * with alphabetical tiebreak for deterministic ordering.
 */
export function getTopGenres(
  genreCounts: Partial<Record<string, number>>,
  count: number,
): Array<{ genre: string; genreCount: number }> {
  return Object.entries(genreCounts)
    .filter(([, v]) => v != null && v > 0)
    .sort((a, b) => {
      const countDiff = (b[1] ?? 0) - (a[1] ?? 0)
      if (countDiff !== 0) return countDiff
      return a[0].localeCompare(b[0])
    })
    .slice(0, count)
    .map(([genre, genreCount]) => ({ genre, genreCount: genreCount ?? 0 }))
}

function ConfidenceIndicator({ score }: { score: number }) {
  const level = getConfidenceLevel(score)
  const style = CONFIDENCE_STYLES[level]

  return (
    <Box className="flex items-center gap-1.5">
      <Box className={`w-2 h-2 rounded-full ${style.bg}`} aria-hidden="true" />
      <Text className={`text-xs ${style.color}`} aria-label={style.label}>
        {style.label}
      </Text>
    </Box>
  )
}

function OwnerBadge() {
  return (
    <Box className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--info-soft)] text-[var(--info)]">
      <CheckCircle size={12} aria-hidden="true" />
      <Text className="text-xs font-medium">Owner</Text>
    </Box>
  )
}

function QueueChip({ queue }: { queue: 'none' | 'short' | 'long' }) {
  const chipStyles: Record<string, string> = {
    none: 'bg-[var(--success-soft)] text-[var(--success)]',
    short: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    long: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  }

  return (
    <Text className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${chipStyles[queue]}`}>
      {QUEUE_LABELS[queue]}
    </Text>
  )
}

function hasLiveSignals(
  consensusGenre: string | null,
  consensusQueue: 'none' | 'short' | 'long' | null,
): boolean {
  return consensusGenre != null || consensusQueue != null
}

export function SignalDetail({
  consensusGenre,
  consensusGenreConfidence,
  consensusQueue,
  consensusQueueConfidence,
  signalReportCount,
  lastSignalAt,
  isOwnerReport,
  genreCounts,
}: SignalDetailProps) {
  const hasLive = hasLiveSignals(consensusGenre, consensusQueue)

  // Fallback: predicted taste profile when no live signals
  if (!hasLive) {
    if (!genreCounts || Object.keys(genreCounts).length === 0) {
      return null
    }

    const topGenres = getTopGenres(genreCounts, 3)
    if (topGenres.length === 0) return null

    return (
      <Box className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <Box className="flex items-center gap-2 mb-3">
          <Music size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
          <Text className="text-xs text-[var(--text-muted)] font-medium">
            Based on visitor music preferences
          </Text>
        </Box>
        <Box className="flex flex-wrap gap-2">
          {topGenres.map(({ genre }) => (
            <Text
              key={genre}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--bg-raised)] text-[var(--text-secondary)] opacity-70"
            >
              {GENRE_LABELS[genre] ?? genre}
            </Text>
          ))}
        </Box>
      </Box>
    )
  }

  // Live signals display
  return (
    <Box className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      {/* Genre signal */}
      {consensusGenre != null && (
        <Box className="mb-3">
          <Box className="flex items-center justify-between mb-1">
            <Box className="flex items-center gap-2">
              <Music size={16} className="text-[var(--text-primary)]" aria-hidden="true" />
              <Text className="text-sm font-semibold text-[var(--text-primary)]">
                {GENRE_LABELS[consensusGenre] ?? consensusGenre}
              </Text>
            </Box>
            {isOwnerReport && <OwnerBadge />}
          </Box>
          <Box className="flex items-center gap-3">
            <ConfidenceIndicator score={consensusGenreConfidence} />
            {lastSignalAt && (
              <Text className="text-xs text-[var(--text-muted)]">
                {getTimeSinceReport(lastSignalAt)}
              </Text>
            )}
          </Box>
        </Box>
      )}

      {/* Queue signal */}
      {consensusQueue != null && (
        <Box className={consensusGenre != null ? 'pt-3 border-t border-[var(--border)]' : ''}>
          <Box className="flex items-center justify-between mb-1">
            <QueueChip queue={consensusQueue} />
            {!consensusGenre && isOwnerReport && <OwnerBadge />}
          </Box>
          <Box className="flex items-center gap-3">
            <ConfidenceIndicator score={consensusQueueConfidence} />
            {lastSignalAt && (
              <Text className="text-xs text-[var(--text-muted)]">
                {getTimeSinceReport(lastSignalAt)}
              </Text>
            )}
          </Box>
        </Box>
      )}

      {/* Report count */}
      {signalReportCount > 0 && (
        <Box className="flex items-center gap-1.5 mt-3 pt-3 border-t border-[var(--border)]">
          <Users size={12} className="text-[var(--text-muted)]" aria-hidden="true" />
          <Text className="text-xs text-[var(--text-muted)]">
            {signalReportCount} {signalReportCount === 1 ? 'report' : 'reports'}
          </Text>
        </Box>
      )}
    </Box>
  )
}
