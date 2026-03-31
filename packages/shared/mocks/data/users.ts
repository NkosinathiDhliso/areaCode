import type { User, MusicGenre, DimensionScoreVector, StreamingProvider } from '../../types'
import { GENRE_WEIGHT_MATRIX } from '../../constants/genre-weights'
import { ARCHETYPE_CATALOG } from '../../constants/archetype-catalog'
import { computeDimensionScores, resolveArchetype } from '../../lib/archetypeResolver'
import { hoursAgo } from '../helpers'

/**
 * 15 South African mock users distributed across all 5 tier levels.
 * Current user is mock-user-4 (Lerato Dlamini, regular, 23 check-ins).
 */

export const CURRENT_USER_ID = 'mock-user-4'

// Deterministic genre assignment per user
const GENRE_ASSIGNMENTS: MusicGenre[][] = [
  ['amapiano', 'kwaito', 'gqom'],           // user-1
  ['jazz', 'rnb', 'deep_house'],             // user-2
  ['hip_hop', 'gqom'],                       // user-3
  ['amapiano', 'deep_house', 'afrobeats'],   // user-4 (current)
  ['rock', 'hip_hop', 'pop'],                // user-5
  ['gospel', 'maskandi', 'jazz'],            // user-6
  ['amapiano', 'afrobeats', 'kwaito', 'gqom'], // user-7
  ['deep_house', 'jazz', 'rnb'],             // user-8
  ['hip_hop', 'amapiano'],                   // user-9
  ['pop', 'rnb', 'afrobeats'],              // user-10
  ['kwaito', 'amapiano', 'hip_hop'],         // user-11
  ['jazz', 'gospel'],                        // user-12
  ['gqom', 'amapiano', 'rock'],             // user-13
  ['deep_house', 'afrobeats', 'rnb', 'jazz'], // user-14
  ['maskandi', 'gospel', 'kwaito'],          // user-15
]

const PROVIDERS: (StreamingProvider | null)[] = [
  'spotify', 'apple_music', 'spotify', null, 'apple_music',
  null, 'spotify', 'apple_music', 'spotify', null,
  'spotify', null, 'apple_music', 'spotify', null,
]

function buildMusicFields(idx: number): Pick<User, 'musicGenres' | 'dimensionScores' | 'archetypeId' | 'streamingProvider'> {
  const genres = GENRE_ASSIGNMENTS[idx]!
  const scores = computeDimensionScores(genres, GENRE_WEIGHT_MATRIX)
  const archetype = resolveArchetype(scores, ARCHETYPE_CATALOG)
  return {
    musicGenres: genres,
    dimensionScores: scores,
    archetypeId: archetype.id,
    streamingProvider: PROVIDERS[idx] ?? null,
  }
}

export const MOCK_USERS: User[] = [
  { id: 'mock-user-1', phone: '+27060000001', username: 'sipho_m',
    displayName: 'Sipho Mthembu', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'legend', totalCheckIns: 520,
    cognitoSub: null, createdAt: hoursAgo(24 * 180), ...buildMusicFields(0) },
  { id: 'mock-user-2', phone: '+27060000002', username: 'thandi_n',
    displayName: 'Thandi Nkosi', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'institution', totalCheckIns: 210,
    cognitoSub: null, createdAt: hoursAgo(24 * 160), ...buildMusicFields(1) },
  { id: 'mock-user-3', phone: '+27060000003', username: 'bongani_k',
    displayName: 'Bongani Khumalo', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'fixture', totalCheckIns: 87,
    cognitoSub: null, createdAt: hoursAgo(24 * 140), ...buildMusicFields(2) },
  { id: 'mock-user-4', phone: '+27060000004', username: 'lerato_d',
    displayName: 'Lerato Dlamini', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'regular', totalCheckIns: 23,
    cognitoSub: null, createdAt: hoursAgo(24 * 120), ...buildMusicFields(3) },
  { id: 'mock-user-5', phone: '+27060000005', username: 'neo_p',
    displayName: 'Neo Pillay', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'regular', totalCheckIns: 35,
    cognitoSub: null, createdAt: hoursAgo(24 * 100), ...buildMusicFields(4) },
  { id: 'mock-user-6', phone: '+27060000006', username: 'zanele_z',
    displayName: 'Zanele Zulu', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'local', totalCheckIns: 6,
    cognitoSub: null, createdAt: hoursAgo(24 * 90), ...buildMusicFields(5) },
  { id: 'mock-user-7', phone: '+27060000007', username: 'kagiso_m',
    displayName: 'Kagiso Mokoena', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'fixture', totalCheckIns: 62,
    cognitoSub: null, createdAt: hoursAgo(24 * 80), ...buildMusicFields(6) },
  { id: 'mock-user-8', phone: '+27060000008', username: 'naledi_s',
    displayName: 'Naledi Sithole', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'institution', totalCheckIns: 180,
    cognitoSub: null, createdAt: hoursAgo(24 * 70), ...buildMusicFields(7) },
  { id: 'mock-user-9', phone: '+27060000009', username: 'tshepo_r',
    displayName: 'Tshepo Radebe', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'regular', totalCheckIns: 28,
    cognitoSub: null, createdAt: hoursAgo(24 * 60), ...buildMusicFields(8) },
  { id: 'mock-user-10', phone: '+27060000010', username: 'ayanda_n',
    displayName: 'Ayanda Ndlovu', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'local', totalCheckIns: 4,
    cognitoSub: null, createdAt: hoursAgo(24 * 50), ...buildMusicFields(9) },
  { id: 'mock-user-11', phone: '+27060000011', username: 'mpho_b',
    displayName: 'Mpho Botha', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'fixture', totalCheckIns: 95,
    cognitoSub: null, createdAt: hoursAgo(24 * 40), ...buildMusicFields(10) },
  { id: 'mock-user-12', phone: '+27060000012', username: 'lindiwe_m',
    displayName: 'Lindiwe Mahlangu', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'regular', totalCheckIns: 42,
    cognitoSub: null, createdAt: hoursAgo(24 * 35), ...buildMusicFields(11) },
  { id: 'mock-user-13', phone: '+27060000013', username: 'siyabonga_d',
    displayName: 'Siyabonga Dube', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'local', totalCheckIns: 2,
    cognitoSub: null, createdAt: hoursAgo(24 * 25), ...buildMusicFields(12) },
  { id: 'mock-user-14', phone: '+27060000014', username: 'nomsa_k',
    displayName: 'Nomsa Khumalo', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'legend', totalCheckIns: 550,
    cognitoSub: null, createdAt: hoursAgo(24 * 15), ...buildMusicFields(13) },
  { id: 'mock-user-15', phone: '+27060000015', username: 'themba_j',
    displayName: 'Themba Jansen', avatarUrl: null, cityId: 'jhb',
    neighbourhoodId: null, tier: 'local', totalCheckIns: 8,
    cognitoSub: null, createdAt: hoursAgo(24 * 5), ...buildMusicFields(14) },
]
