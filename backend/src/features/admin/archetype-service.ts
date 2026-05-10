// Admin Archetype Service — archetypes, genre weights, dashboard metrics
import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import { checkPermission } from './permissions.js'
import type { AdminRole } from './types.js'

// Default archetype catalog — seeded to DynamoDB on first read
const DEFAULT_ARCHETYPES: Array<{
  id: string
  name: string
  iconId: string
  description: string
  dimensionThresholds: Record<string, number>
  priority: number
  isActive: boolean
}> = [
  {
    id: 'archetype-festival-spirit',
    name: 'The Festival Spirit',
    iconId: 'festival-spirit',
    description: 'Lives for the energy of a packed crowd.',
    dimensionThresholds: { energy: 0.7, cultural_rootedness: 0.6, edge: 0.4 },
    priority: 15,
    isActive: true,
  },
  {
    id: 'archetype-conscious-creative',
    name: 'The Conscious Creative',
    iconId: 'conscious-creative',
    description: 'A soulful innovator.',
    dimensionThresholds: { spirituality: 0.4, edge: 0.4, sophistication: 0.4 },
    priority: 14,
    isActive: true,
  },
  {
    id: 'archetype-township-royal',
    name: 'The Township Royal',
    iconId: 'township-royal',
    description: 'Deeply rooted in culture.',
    dimensionThresholds: { cultural_rootedness: 0.7, energy: 0.6, edge: 0.4 },
    priority: 13,
    isActive: true,
  },
  {
    id: 'archetype-sacred-rebel',
    name: 'The Sacred Rebel',
    iconId: 'sacred-rebel',
    description: 'Spiritual conviction with raw edge.',
    dimensionThresholds: { spirituality: 0.6, edge: 0.6 },
    priority: 12,
    isActive: true,
  },
  {
    id: 'archetype-firecracker',
    name: 'The Firecracker',
    iconId: 'firecracker',
    description: 'Pure high-octane energy.',
    dimensionThresholds: { energy: 0.7, edge: 0.6 },
    priority: 11,
    isActive: true,
  },
  {
    id: 'archetype-heritage-groover',
    name: 'The Heritage Groover',
    iconId: 'heritage-groover',
    description: 'High-energy beats rooted in tradition.',
    dimensionThresholds: { energy: 0.7, cultural_rootedness: 0.6 },
    priority: 10,
    isActive: true,
  },
  {
    id: 'archetype-midnight-philosopher',
    name: 'The Midnight Philosopher',
    iconId: 'midnight-philosopher',
    description: 'Refined thinker.',
    dimensionThresholds: { sophistication: 0.7, spirituality: 0.4 },
    priority: 9,
    isActive: true,
  },
  {
    id: 'archetype-street-poet',
    name: 'The Street Poet',
    iconId: 'street-poet',
    description: 'Raw edge through cultural awareness.',
    dimensionThresholds: { edge: 0.6, cultural_rootedness: 0.4 },
    priority: 8,
    isActive: true,
  },
  {
    id: 'archetype-soul-wanderer',
    name: 'The Soul Wanderer',
    iconId: 'soul-wanderer',
    description: 'Spiritual depth and sophistication.',
    dimensionThresholds: { spirituality: 0.6, sophistication: 0.6 },
    priority: 7,
    isActive: true,
  },
  {
    id: 'archetype-vibe-architect',
    name: 'The Vibe Architect',
    iconId: 'vibe-architect',
    description: 'Crafts the perfect atmosphere.',
    dimensionThresholds: { sophistication: 0.6, energy: 0.4 },
    priority: 6,
    isActive: true,
  },
  {
    id: 'archetype-smooth-operator',
    name: 'The Smooth Operator',
    iconId: 'smooth-operator',
    description: 'Effortlessly sophisticated.',
    dimensionThresholds: { sophistication: 0.7 },
    priority: 5,
    isActive: true,
  },
  {
    id: 'archetype-groove-seeker',
    name: 'The Groove Seeker',
    iconId: 'groove-seeker',
    description: 'Chases the beat.',
    dimensionThresholds: { energy: 0.7 },
    priority: 4,
    isActive: true,
  },
  {
    id: 'archetype-culture-curator',
    name: 'The Culture Curator',
    iconId: 'culture-curator',
    description: 'Guardian of cultural heritage.',
    dimensionThresholds: { cultural_rootedness: 0.7 },
    priority: 3,
    isActive: true,
  },
  {
    id: 'archetype-eclectic',
    name: 'The Eclectic',
    iconId: 'eclectic',
    description: 'Open to everything.',
    dimensionThresholds: {},
    priority: 2,
    isActive: true,
  },
  {
    id: 'archetype-uncharted',
    name: 'The Uncharted',
    iconId: 'uncharted',
    description: 'Waiting to be discovered.',
    dimensionThresholds: {},
    priority: 1,
    isActive: true,
  },
]

// Default genre weight matrix
const DEFAULT_GENRE_WEIGHTS = [
  { genre: 'amapiano', weights: { energy: 0.9, cultural_rootedness: 0.6, sophistication: 0.3, edge: 0.2, spirituality: 0.1 } },
  { genre: 'deep_house', weights: { energy: 0.5, cultural_rootedness: 0.2, sophistication: 0.8, edge: 0.1, spirituality: 0.3 } },
  { genre: 'afrobeats', weights: { energy: 0.8, cultural_rootedness: 0.7, sophistication: 0.3, edge: 0.3, spirituality: 0.2 } },
  { genre: 'hip_hop', weights: { energy: 0.6, cultural_rootedness: 0.4, sophistication: 0.4, edge: 0.8, spirituality: 0.2 } },
  { genre: 'rnb', weights: { energy: 0.4, cultural_rootedness: 0.3, sophistication: 0.8, edge: 0.2, spirituality: 0.4 } },
  { genre: 'kwaito', weights: { energy: 0.7, cultural_rootedness: 0.9, sophistication: 0.2, edge: 0.5, spirituality: 0.3 } },
  { genre: 'gqom', weights: { energy: 0.9, cultural_rootedness: 0.5, sophistication: 0.1, edge: 0.8, spirituality: 0.1 } },
  { genre: 'jazz', weights: { energy: 0.3, cultural_rootedness: 0.3, sophistication: 0.9, edge: 0.2, spirituality: 0.7 } },
  { genre: 'rock', weights: { energy: 0.8, cultural_rootedness: 0.1, sophistication: 0.2, edge: 0.9, spirituality: 0.1 } },
  { genre: 'pop', weights: { energy: 0.6, cultural_rootedness: 0.2, sophistication: 0.4, edge: 0.3, spirituality: 0.2 } },
  { genre: 'gospel', weights: { energy: 0.4, cultural_rootedness: 0.7, sophistication: 0.4, edge: 0.1, spirituality: 0.9 } },
  { genre: 'maskandi', weights: { energy: 0.5, cultural_rootedness: 0.9, sophistication: 0.3, edge: 0.3, spirituality: 0.6 } },
]

async function seedArchetypesIfEmpty() {
  const existing = await repo.getArchetypes()
  if (existing.length > 0) return existing
  for (const a of DEFAULT_ARCHETYPES) {
    await repo.createArchetype(a)
  }
  return DEFAULT_ARCHETYPES
}

async function seedGenreWeightsIfEmpty() {
  const existing = await repo.getGenreWeights()
  if (existing) return existing
  await repo.updateGenreWeightsRecord(DEFAULT_GENRE_WEIGHTS)
  return DEFAULT_GENRE_WEIGHTS
}

export async function getArchetypes() {
  return seedArchetypesIfEmpty()
}

export async function createArchetype(adminId: string, adminRole: AdminRole, data: Record<string, unknown>) {
  checkPermission(adminRole, 'view_user')
  const id = `archetype-${Date.now()}`
  const entry = {
    id,
    name: (data['name'] as string) ?? '',
    iconId: (data['iconId'] as string) ?? '',
    description: (data['description'] as string) ?? '',
    dimensionThresholds: (data['dimensionThresholds'] as Record<string, number>) ?? {},
    priority: (data['priority'] as number) ?? 0,
    isActive: true,
  }
  await repo.createArchetype(entry)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'create_archetype',
    entityType: 'archetype',
    entityId: id,
    afterState: data,
  })
  return entry
}

export async function updateArchetype(
  adminId: string,
  adminRole: AdminRole,
  archetypeId: string,
  data: Record<string, unknown>,
) {
  checkPermission(adminRole, 'view_user')
  const allArchetypes = await repo.getArchetypes()
  const before = allArchetypes.find((a) => a.id === archetypeId)
  if (!before) throw AppError.notFound('Archetype not found')

  const updated = await repo.updateArchetypeRecord(archetypeId, data)
  if (!updated) throw AppError.notFound('Archetype not found')

  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'update_archetype',
    entityType: 'archetype',
    entityId: archetypeId,
    beforeState: before,
    afterState: data,
  })
  return updated
}

export async function getGenreWeights() {
  const matrix = await seedGenreWeightsIfEmpty()
  return { matrix }
}

export async function testArchetype(genres: string[]) {
  const archetypeCatalog = await seedArchetypesIfEmpty()
  return {
    dimensionScores: {},
    resolvedArchetype:
      archetypeCatalog.find((a) => a.isActive && a.name !== 'The Eclectic' && a.name !== 'The Uncharted') ??
      archetypeCatalog[archetypeCatalog.length - 1],
    allMatches: archetypeCatalog.filter((a) => a.isActive).slice(0, 3),
    inputGenres: genres,
  }
}

export async function updateGenreWeights(adminId: string, adminRole: AdminRole, data: Record<string, unknown>) {
  checkPermission(adminRole, 'view_user')
  const before = await seedGenreWeightsIfEmpty()
  if (Array.isArray(data['matrix'])) {
    await repo.updateGenreWeightsRecord(data['matrix'] as Array<{ genre: string; weights: Record<string, number> }>)
  }
  const updated = await seedGenreWeightsIfEmpty()
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'update_genre_weights',
    entityType: 'genre_weights',
    entityId: 'global',
    beforeState: { matrix: before },
    afterState: data,
  })
  return { matrix: updated }
}

export async function getDashboardMetrics(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_user')
  return repo.getDashboardMetrics()
}

export async function getAuditLogs(
  adminRole: AdminRole,
  filters: {
    cursor?: string
    adminId?: string
    action?: string
    startDate?: string
    endDate?: string
  },
) {
  checkPermission(adminRole, 'view_user')
  return repo.getAuditLogs(filters)
}
