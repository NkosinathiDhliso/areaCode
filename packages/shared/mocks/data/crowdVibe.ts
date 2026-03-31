import type {
  MusicGenre, DimensionScoreVector, CrowdVibeSnapshot,
  BusinessMusicAudience, NodeCategory,
} from '../../types'
import { ARCHETYPE_CATALOG } from '../../constants/archetype-catalog'
import { MOCK_USERS } from './users'
import { MOCK_NODES } from './nodes'

/**
 * Pre-computed music data per mock user.
 * Reads genres, dimension scores, and archetype IDs directly from MOCK_USERS
 * (which are computed deterministically in users.ts via buildMusicFields).
 */
export interface UserMusicEntry {
  genres: MusicGenre[]
  dimensionScores: DimensionScoreVector | null
  archetypeId: string
}

export const MOCK_USER_MUSIC_DATA = new Map<string, UserMusicEntry>()

for (const user of MOCK_USERS) {
  MOCK_USER_MUSIC_DATA.set(user.id, {
    genres: user.musicGenres ?? [],
    dimensionScores: user.dimensionScores ?? null,
    archetypeId: user.archetypeId ?? 'archetype-uncharted',
  })
}

/** Convenience accessor for a single user's music data */
export function getUserMusicData(userId: string): UserMusicEntry | undefined {
  return MOCK_USER_MUSIC_DATA.get(userId)
}

// Category-biased genre pools for selecting which users are "checked in"
const CATEGORY_PREFERRED_GENRES: Record<NodeCategory, MusicGenre[]> = {
  nightlife: ['amapiano', 'deep_house', 'gqom'],
  coffee: ['jazz', 'rnb'],
  arts: ['jazz', 'gospel'],
  food: ['amapiano', 'pop', 'afrobeats'],
  retail: ['pop', 'hip_hop', 'amapiano'],
  fitness: ['amapiano', 'gqom', 'hip_hop'],
}

/** Deterministic count 3-8 derived from nodeId string */
function checkinCountForNode(nodeId: string): number {
  const seed = nodeId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return 3 + (seed % 6)
}

/** Pick mock users for a node, biased by category genre overlap */
function pickCheckedInUsers(nodeId: string, category: NodeCategory) {
  const preferred = CATEGORY_PREFERRED_GENRES[category]
  const count = checkinCountForNode(nodeId)

  const scored = MOCK_USERS.map((u) => {
    const entry = MOCK_USER_MUSIC_DATA.get(u.id)
    const overlap = entry
      ? entry.genres.filter((g) => preferred.includes(g)).length
      : 0
    return { user: u, overlap }
  })

  // Sort by overlap descending, then by user index for stability
  scored.sort((a, b) => b.overlap - a.overlap)
  return scored.slice(0, count).map((s) => s.user)
}

/** Build a CrowdVibeSnapshot for a given node */
export function buildCrowdVibeSnapshot(nodeId: string): CrowdVibeSnapshot {
  const node = MOCK_NODES.find((n) => n.id === nodeId)
  if (!node) {
    return { genreCounts: {}, archetypePercentages: {}, aggregateDimensionScores: null, totalCheckedIn: 0 }
  }

  const users = pickCheckedInUsers(nodeId, node.category)
  if (users.length === 0) {
    return { genreCounts: {}, archetypePercentages: {}, aggregateDimensionScores: null, totalCheckedIn: 0 }
  }

  const genreCounts: Partial<Record<MusicGenre, number>> = {}
  const archetypeCounts: Record<string, number> = {}
  const dimSums: Record<string, number> = {
    energy: 0, cultural_rootedness: 0, sophistication: 0, edge: 0, spirituality: 0,
  }
  let dimCount = 0

  for (const u of users) {
    const entry = MOCK_USER_MUSIC_DATA.get(u.id)
    if (!entry) continue

    for (const g of entry.genres) {
      genreCounts[g] = (genreCounts[g] ?? 0) + 1
    }

    const archetype = ARCHETYPE_CATALOG.find((a) => a.id === entry.archetypeId)
    const name = archetype?.name ?? 'The Eclectic'
    archetypeCounts[name] = (archetypeCounts[name] ?? 0) + 1

    if (entry.dimensionScores) {
      for (const [dim, val] of Object.entries(entry.dimensionScores)) {
        dimSums[dim] = (dimSums[dim] ?? 0) + val
      }
      dimCount++
    }
  }

  // Convert archetype counts to percentages (rounded, summing to 100)
  const total = users.length
  const archetypePercentages: Record<string, number> = {}
  const sorted = Object.entries(archetypeCounts).sort((a, b) => b[1] - a[1])
  let pctSum = 0

  for (const [name, count] of sorted) {
    const pct = Math.round((count / total) * 100)
    archetypePercentages[name] = pct
    pctSum += pct
  }

  // Adjust largest segment so percentages sum to exactly 100
  const largest = sorted[0]
  if (largest && pctSum !== 100) {
    const key = largest[0]
    archetypePercentages[key] = (archetypePercentages[key] ?? 0) + (100 - pctSum)
  }

  const aggregateDimensionScores: DimensionScoreVector | null = dimCount > 0
    ? {
        energy: Math.round((dimSums['energy']! / dimCount) * 1000) / 1000,
        cultural_rootedness: Math.round((dimSums['cultural_rootedness']! / dimCount) * 1000) / 1000,
        sophistication: Math.round((dimSums['sophistication']! / dimCount) * 1000) / 1000,
        edge: Math.round((dimSums['edge']! / dimCount) * 1000) / 1000,
        spirituality: Math.round((dimSums['spirituality']! / dimCount) * 1000) / 1000,
      } as DimensionScoreVector
    : null

  return { genreCounts, archetypePercentages, aggregateDimensionScores, totalCheckedIn: total }
}

/** Build mock BusinessMusicAudience data with realistic distributions */
export function buildBusinessMusicAudience(): BusinessMusicAudience {
  const genreDistribution: Partial<Record<MusicGenre, number>> = {
    amapiano: 35, deep_house: 22, hip_hop: 18, jazz: 12, afrobeats: 8, rnb: 5,
  }

  const archetypeBreakdown: Record<string, number> = {
    'The Groove Seeker': 28,
    'The Vibe Architect': 22,
    'The Heritage Groover': 18,
    'The Midnight Philosopher': 15,
    'The Firecracker': 10,
    'The Eclectic': 7,
  }

  const peakArchetypeByTime = [
    { timeSegment: 'Morning', archetypeName: 'The Midnight Philosopher', archetypeIconId: 'midnight-philosopher' },
    { timeSegment: 'Afternoon', archetypeName: 'The Vibe Architect', archetypeIconId: 'vibe-architect' },
    { timeSegment: 'Evening', archetypeName: 'The Groove Seeker', archetypeIconId: 'groove-seeker' },
    { timeSegment: 'Late Night', archetypeName: 'The Firecracker', archetypeIconId: 'firecracker' },
  ]

  return {
    genreDistribution,
    archetypeBreakdown,
    peakArchetypeByTime,
    totalWithMusicPrefs: 187,
  }
}
