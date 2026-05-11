/**
 * PredictedGenre — Displays a predicted genre indicator when no live signal exists.
 *
 * Shows the top genre from CrowdVibeSnapshot genreCounts with muted styling
 * and a "Predicted from visitor tastes" label. Renders nothing when:
 * - A live signal is active (consensusGenre with confidence > 0.0)
 * - No CrowdVibeSnapshot data is available
 *
 * Requirements: 3.4, 11.1, 11.2, 11.3, 11.4
 */
import { useMemo } from 'react'

import { selectFallbackGenre } from '../lib/selectFallbackGenre'
import type { CrowdVibeSnapshot, MusicGenre } from '../types'

export interface PredictedGenreProps {
  /** The live consensus genre from signal data (null if no live signal) */
  consensusGenre: string | null | undefined
  /** The live consensus genre confidence (0.0 if no live signal) */
  consensusGenreConfidence: number | undefined
  /** The CrowdVibeSnapshot for this node (null if unavailable) */
  crowdVibeSnapshot: CrowdVibeSnapshot | null | undefined
  /** Optional className for additional styling */
  className?: string
}

/** Human-readable genre labels */
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

/**
 * Determines whether a live signal is active.
 * A live signal exists when consensusGenre is set and confidence > 0.0.
 */
function hasLiveSignal(
  consensusGenre: string | null | undefined,
  consensusGenreConfidence: number | undefined,
): boolean {
  if (!consensusGenre) return false
  if (consensusGenreConfidence === undefined || consensusGenreConfidence === null) return false
  return consensusGenreConfidence > 0.0
}

export function PredictedGenre({
  consensusGenre,
  consensusGenreConfidence,
  crowdVibeSnapshot,
  className = '',
}: PredictedGenreProps) {
  const predictedGenre = useMemo(() => {
    // If a live signal is active, don't show predicted data
    if (hasLiveSignal(consensusGenre, consensusGenreConfidence)) {
      return null
    }

    // If no CrowdVibeSnapshot data, show nothing
    if (!crowdVibeSnapshot?.genreCounts) {
      return null
    }

    return selectFallbackGenre(crowdVibeSnapshot.genreCounts)
  }, [consensusGenre, consensusGenreConfidence, crowdVibeSnapshot])

  // Render nothing if no predicted genre available
  if (!predictedGenre) {
    return null
  }

  return (
    <div
      className={`predicted-genre ${className}`}
      style={{ opacity: 0.6 }}
      aria-label={`Predicted genre: ${GENRE_LABELS[predictedGenre]}. Predicted from visitor tastes.`}
    >
      <span className="predicted-genre__label">
        {GENRE_LABELS[predictedGenre]}
      </span>
      <span className="predicted-genre__indicator" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
        Predicted from visitor tastes
      </span>
    </div>
  )
}
