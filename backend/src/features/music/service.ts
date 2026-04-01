import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'
import type { MusicGenre, DimensionScoreVector, CrowdVibeSnapshot, BusinessMusicAudience } from './shared-types.js'

const DEV_MODE = !isDbAvailable && process.env['AREA_CODE_ENV'] !== 'prod'

// Re-export the archetype resolver logic inline to avoid cross-package import issues at runtime
const DIMENSIONS = ['energy', 'cultural_rootedness', 'sophistication', 'edge', 'spirituality'] as const

const GENRE_WEIGHTS: Record<string, Record<string, number>> = {
  amapiano:   { energy: 0.9, cultural_rootedness: 0.6, sophistication: 0.3, edge: 0.2, spirituality: 0.1 },
  deep_house: { energy: 0.5, cultural_rootedness: 0.2, sophistication: 0.8, edge: 0.1, spirituality: 0.3 },
  afrobeats:  { energy: 0.8, cultural_rootedness: 0.7, sophistication: 0.3, edge: 0.3, spirituality: 0.2 },
  hip_hop:    { energy: 0.6, cultural_rootedness: 0.4, sophistication: 0.4, edge: 0.8, spirituality: 0.2 },
  rnb:        { energy: 0.4, cultural_rootedness: 0.3, sophistication: 0.8, edge: 0.2, spirituality: 0.4 },
  kwaito:     { energy: 0.7, cultural_rootedness: 0.9, sophistication: 0.2, edge: 0.5, spirituality: 0.3 },
  gqom:       { energy: 0.9, cultural_rootedness: 0.5, sophistication: 0.1, edge: 0.8, spirituality: 0.1 },
  jazz:       { energy: 0.3, cultural_rootedness: 0.3, sophistication: 0.9, edge: 0.2, spirituality: 0.7 },
  rock:       { energy: 0.8, cultural_rootedness: 0.1, sophistication: 0.2, edge: 0.9, spirituality: 0.1 },
  pop:        { energy: 0.6, cultural_rootedness: 0.2, sophistication: 0.4, edge: 0.3, spirituality: 0.2 },
  gospel:     { energy: 0.4, cultural_rootedness: 0.7, sophistication: 0.4, edge: 0.1, spirituality: 0.9 },
  maskandi:   { energy: 0.5, cultural_rootedness: 0.9, sophistication: 0.3, edge: 0.3, spirituality: 0.6 },
}

interface ArchetypeDef {
  id: string; name: string; thresholds: Partial<Record<string, number>>; priority: number
}

const ARCHETYPES: ArchetypeDef[] = [
  { id: 'archetype-festival-spirit', name: 'The Festival Spirit', thresholds: { energy: 0.7, cultural_rootedness: 0.6, edge: 0.4 }, priority: 15 },
  { id: 'archetype-conscious-creative', name: 'The Conscious Creative', thresholds: { spirituality: 0.4, edge: 0.4, sophistication: 0.4 }, priority: 14 },
  { id: 'archetype-township-royal', name: 'The Township Royal', thresholds: { cultural_rootedness: 0.7, energy: 0.6, edge: 0.4 }, priority: 13 },
  { id: 'archetype-sacred-rebel', name: 'The Sacred Rebel', thresholds: { spirituality: 0.6, edge: 0.6 }, priority: 12 },
  { id: 'archetype-firecracker', name: 'The Firecracker', thresholds: { energy: 0.7, edge: 0.6 }, priority: 11 },
  { id: 'archetype-heritage-groover', name: 'The Heritage Groover', thresholds: { energy: 0.7, cultural_rootedness: 0.6 }, priority: 10 },
  { id: 'archetype-midnight-philosopher', name: 'The Midnight Philosopher', thresholds: { sophistication: 0.7, spirituality: 0.4 }, priority: 9 },
  { id: 'archetype-street-poet', name: 'The Street Poet', thresholds: { edge: 0.6, cultural_rootedness: 0.4 }, priority: 8 },
  { id: 'archetype-soul-wanderer', name: 'The Soul Wanderer', thresholds: { spirituality: 0.6, sophistication: 0.6 }, priority: 7 },
  { id: 'archetype-vibe-architect', name: 'The Vibe Architect', thresholds: { sophistication: 0.6, energy: 0.4 }, priority: 6 },
  { id: 'archetype-smooth-operator', name: 'The Smooth Operator', thresholds: { sophistication: 0.7 }, priority: 5 },
  { id: 'archetype-groove-seeker', name: 'The Groove Seeker', thresholds: { energy: 0.7 }, priority: 4 },
  { id: 'archetype-culture-curator', name: 'The Culture Curator', thresholds: { cultural_rootedness: 0.7 }, priority: 3 },
  { id: 'archetype-eclectic', name: 'The Eclectic', thresholds: {}, priority: 2 },
  { id: 'archetype-uncharted', name: 'The Uncharted', thresholds: {}, priority: 1 },
]

function computeScores(genres: string[]): Record<string, number> | null {
  if (genres.length === 0) return null
  const sums: Record<string, number> = {}
  for (const d of DIMENSIONS) sums[d] = 0
  for (const g of genres) {
    const w = GENRE_WEIGHTS[g]
    if (!w) continue
    for (const d of DIMENSIONS) sums[d]! += w[d]!
  }
  const result: Record<string, number> = {}
  for (const d of DIMENSIONS) result[d] = Math.round((sums[d]! / genres.length) * 1000) / 1000
  return result
}

function resolveArchetypeId(scores: Record<string, number> | null): string {
  if (!scores) return 'archetype-uncharted'
  const sorted = ARCHETYPES
    .filter((a) => a.name !== 'The Eclectic' && a.name !== 'The Uncharted')
    .sort((a, b) => b.priority - a.priority)
  for (const arch of sorted) {
    if (Object.keys(arch.thresholds).length === 0) continue
    let matches = true
    for (const [dim, threshold] of Object.entries(arch.thresholds)) {
      if ((scores[dim] ?? 0) < threshold!) { matches = false; break }
    }
    if (matches && arch.id === 'archetype-smooth-operator' && (scores['energy'] ?? 0) >= 0.5) matches = false
    if (matches) return arch.id
  }
  return 'archetype-eclectic'
}

// ─── Update Genres ──────────────────────────────────────────────────────────

export async function updateGenres(userId: string, musicGenres: string[]) {
  const scores = computeScores(musicGenres)
  const archetypeId = resolveArchetypeId(scores)

  if (DEV_MODE) {
    return { id: userId, musicGenres, dimensionScores: scores, archetypeId }
  }

  return repo.updateUserGenres(userId, musicGenres, scores, archetypeId)
}

// ─── Streaming Connect/Disconnect ───────────────────────────────────────────

export async function connectStreaming(userId: string, provider: string, musicUserToken?: string) {
  if (DEV_MODE) {
    return { success: true, provider, genres: ['amapiano', 'deep_house'] }
  }

  // Lazy import to avoid loading OAuth module when not needed
  const oauth = await import('./streaming-oauth.js')

  if (provider === 'spotify') {
    if (!oauth.isSpotifyConfigured()) {
      // Spotify credentials not set — fall back to manual genre selection
      await repo.updateStreamingProvider(userId, provider)
      return { success: true, provider, genres: [] as string[] }
    }

    // Generate a state token that encodes the userId for the callback
    const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64url')
    const redirectUrl = oauth.getSpotifyAuthorizeUrl(state)
    return { success: true, provider, redirectUrl, genres: [] as string[] }
  }

  if (provider === 'apple_music') {
    if (!oauth.isAppleMusicConfigured() || !musicUserToken) {
      // Apple Music credentials not set or no user token — fall back to manual
      await repo.updateStreamingProvider(userId, provider)
      return { success: true, provider, genres: [] as string[] }
    }

    try {
      const developerToken = await oauth.generateAppleDeveloperToken()
      const genres = await oauth.fetchAppleMusicTopGenres(developerToken, musicUserToken)

      await repo.updateStreamingProvider(userId, provider)

      if (genres.length > 0) {
        const scores = computeScores(genres)
        const archetypeId = resolveArchetypeId(scores)
        await repo.updateUserGenres(userId, genres, scores, archetypeId)
      }

      return { success: true, provider, genres }
    } catch (err) {
      console.error('[music] Apple Music fetch failed:', err instanceof Error ? err.message : err)
      await repo.updateStreamingProvider(userId, provider)
      return { success: true, provider, genres: [] as string[] }
    }
  }

  await repo.updateStreamingProvider(userId, provider)
  return { success: true, provider, genres: [] as string[] }
}

/**
 * Handles the Spotify OAuth callback.
 * Exchanges the auth code for an access token, fetches top genres,
 * updates the user's music profile, and redirects to the frontend.
 */
export async function handleSpotifyCallback(code: string, state: string): Promise<string> {
  const frontendBase = process.env['AREA_CODE_ENV'] === 'prod'
    ? 'https://areacode.co.za'
    : 'http://localhost:3000'

  try {
    // Decode the state to get the userId
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as { userId: string; ts: number }
    const userId = decoded.userId

    // Reject if state is older than 10 minutes
    if (Date.now() - decoded.ts > 10 * 60 * 1000) {
      return `${frontendBase}/profile?streaming=error&reason=expired`
    }

    const oauth = await import('./streaming-oauth.js')
    const tokens = await oauth.exchangeSpotifyCode(code)
    const genres = await oauth.fetchSpotifyTopGenres(tokens.access_token)

    await repo.updateStreamingProvider(userId, 'spotify')

    if (genres.length > 0) {
      const scores = computeScores(genres)
      const archetypeId = resolveArchetypeId(scores)
      await repo.updateUserGenres(userId, genres, scores, archetypeId)
    }

    const genreParam = genres.length > 0 ? `&genres=${genres.join(',')}` : ''
    return `${frontendBase}/profile?streaming=success&provider=spotify${genreParam}`
  } catch (err) {
    console.error('[music] Spotify callback failed:', err instanceof Error ? err.message : err)
    return `${frontendBase}/profile?streaming=error&reason=fetch_failed`
  }
}

export async function disconnectStreaming(userId: string) {
  if (DEV_MODE) return
  await repo.clearUserMusicData(userId)
}

// ─── Crowd Vibe ─────────────────────────────────────────────────────────────

export async function getCrowdVibe(nodeId: string): Promise<CrowdVibeSnapshot> {
  const empty: CrowdVibeSnapshot = {
    genreCounts: {}, archetypePercentages: {},
    aggregateDimensionScores: null, totalCheckedIn: 0,
  }

  if (DEV_MODE) return empty

  const users = await repo.getCrowdVibeData(nodeId)
  if (users.length === 0) return empty

  const genreCounts: Partial<Record<string, number>> = {}
  const archetypeCounts: Record<string, number> = {}
  const dimSums: Record<string, number> = {}
  for (const d of DIMENSIONS) dimSums[d] = 0
  let dimCount = 0

  for (const u of users) {
    for (const g of u.musicGenres) {
      genreCounts[g] = (genreCounts[g] ?? 0) + 1
    }

    const archId = u.archetypeId ?? 'archetype-eclectic'
    const archName = ARCHETYPES.find((a) => a.id === archId)?.name ?? 'The Eclectic'
    archetypeCounts[archName] = (archetypeCounts[archName] ?? 0) + 1

    if (u.dimensionScores && typeof u.dimensionScores === 'object') {
      const scores = u.dimensionScores as Record<string, number>
      for (const d of DIMENSIONS) dimSums[d]! += scores[d] ?? 0
      dimCount++
    }
  }

  const total = users.length
  const archetypePercentages: Record<string, number> = {}
  const sorted = Object.entries(archetypeCounts).sort((a, b) => b[1] - a[1])
  let pctSum = 0
  for (const [name, count] of sorted) {
    const pct = Math.round((count / total) * 100)
    archetypePercentages[name] = pct
    pctSum += pct
  }
  if (sorted[0] && pctSum !== 100) {
    archetypePercentages[sorted[0][0]] = (archetypePercentages[sorted[0][0]] ?? 0) + (100 - pctSum)
  }

  const aggregateDimensionScores = dimCount > 0
    ? Object.fromEntries(DIMENSIONS.map((d) => [d, Math.round((dimSums[d]! / dimCount) * 1000) / 1000])) as unknown as DimensionScoreVector
    : null

  return { genreCounts, archetypePercentages, aggregateDimensionScores, totalCheckedIn: total }
}

// ─── Business Audience Music ────────────────────────────────────────────────

export async function getBusinessAudienceMusic(businessId: string): Promise<BusinessMusicAudience> {
  const empty: BusinessMusicAudience = {
    genreDistribution: {}, archetypeBreakdown: {},
    peakArchetypeByTime: [], totalWithMusicPrefs: 0,
  }

  if (DEV_MODE) return empty

  const users = await repo.getBusinessAudienceMusicData(businessId)
  const withPrefs = users.filter((u) => u.musicGenres.length > 0)
  if (withPrefs.length === 0) return empty

  const genreCounts: Record<string, number> = {}
  const archetypeCounts: Record<string, number> = {}

  for (const u of withPrefs) {
    for (const g of u.musicGenres) {
      genreCounts[g] = (genreCounts[g] ?? 0) + 1
    }
    const archId = u.archetypeId ?? 'archetype-eclectic'
    const archName = ARCHETYPES.find((a) => a.id === archId)?.name ?? 'The Eclectic'
    archetypeCounts[archName] = (archetypeCounts[archName] ?? 0) + 1
  }

  const total = withPrefs.length
  const genreDistribution: Partial<Record<string, number>> = {}
  for (const [genre, count] of Object.entries(genreCounts)) {
    genreDistribution[genre] = Math.round((count / total) * 100)
  }

  const archetypeBreakdown: Record<string, number> = {}
  for (const [name, count] of Object.entries(archetypeCounts)) {
    archetypeBreakdown[name] = Math.round((count / total) * 100)
  }

  return {
    genreDistribution,
    archetypeBreakdown,
    peakArchetypeByTime: [], // Requires time-bucketed query — deferred
    totalWithMusicPrefs: total,
  }
}
