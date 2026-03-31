// Shared type aliases used by the music service — avoids cross-package imports at runtime

export type MusicGenre =
  | 'amapiano' | 'deep_house' | 'afrobeats' | 'hip_hop' | 'rnb'
  | 'kwaito' | 'gqom' | 'jazz' | 'rock' | 'pop' | 'gospel' | 'maskandi'

export type PersonalityDimension =
  | 'energy' | 'cultural_rootedness' | 'sophistication' | 'edge' | 'spirituality'

export type DimensionScoreVector = Record<PersonalityDimension, number>

export interface CrowdVibeSnapshot {
  genreCounts: Partial<Record<string, number>>
  archetypePercentages: Record<string, number>
  aggregateDimensionScores: DimensionScoreVector | null
  totalCheckedIn: number
}

export interface BusinessMusicAudience {
  genreDistribution: Partial<Record<string, number>>
  archetypeBreakdown: Record<string, number>
  peakArchetypeByTime: Array<{
    timeSegment: string
    archetypeName: string
    archetypeIconId: string
  }>
  totalWithMusicPrefs: number
}
