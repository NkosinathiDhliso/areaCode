import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import type { AdminRole } from './types.js'

// Role permissions
const ROLE_PERMISSIONS: Record<AdminRole, Set<string>> = {
  super_admin: new Set([
    'view_user', 'disable_user', 'reset_flags', 'recalculate_tier',
    'override_streak', 'process_erasure', 'send_message', 'impersonate',
    'view_business', 'extend_trial', 'revoke_staff', 'deactivate_rewards',
    'override_cipc', 'view_reports', 'action_reports', 'view_consent',
  ]),
  support_agent: new Set([
    'view_user', 'send_message', 'view_business', 'extend_trial', 'view_consent',
  ]),
  content_moderator: new Set([
    'view_reports', 'action_reports', 'override_cipc',
  ]),
}

function checkPermission(role: AdminRole, action: string) {
  if (!ROLE_PERMISSIONS[role]?.has(action)) {
    throw AppError.forbidden(`Role ${role} cannot perform ${action}`)
  }
}

// ─── Consumer Management ────────────────────────────────────────────────────

export async function getUser(adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'view_user')
  const user = await repo.getUserById(userId)
  if (!user) throw AppError.notFound('User not found')
  return user
}

export async function getUserCheckInHistory(adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'view_user')
  return repo.getUserCheckInHistory(userId)
}

export async function resetAbuseFlags(
  adminId: string, adminRole: AdminRole, userId: string,
) {
  checkPermission(adminRole, 'reset_flags')
  await repo.resetAbuseFlags(userId)
  await repo.createAuditLog({
    adminId, adminRole, action: 'reset_abuse_flags',
    entityType: 'user', entityId: userId,
  })
}

export async function sendMessage(
  adminId: string, adminRole: AdminRole,
  targetUserId: string, message: string,
) {
  checkPermission(adminRole, 'send_message')
  const msg = await repo.sendAdminMessage(adminId, targetUserId, message)
  await repo.createAuditLog({
    adminId, adminRole, action: 'send_message',
    entityType: 'user', entityId: targetUserId,
    afterState: { message },
  })
  return msg
}

// ─── Business Management ────────────────────────────────────────────────────

export async function getBusiness(adminRole: AdminRole, businessId: string) {
  checkPermission(adminRole, 'view_business')
  const biz = await repo.getBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')
  return biz
}

export async function extendTrial(
  adminId: string, adminRole: AdminRole,
  businessId: string, days: number,
) {
  checkPermission(adminRole, 'extend_trial')
  const result = await repo.extendBusinessTrial(businessId, days)
  if (!result) throw AppError.notFound('Business not found')
  await repo.createAuditLog({
    adminId, adminRole, action: 'extend_trial',
    entityType: 'business', entityId: businessId,
    afterState: { days, newTrialEnd: result.trialEndsAt },
  })
  return result
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getReportQueue(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_reports')
  return repo.getReportQueue()
}

export async function actionReport(
  adminId: string, adminRole: AdminRole,
  reportId: string, action: string,
) {
  checkPermission(adminRole, 'action_reports')
  const report = await repo.updateReportStatus(reportId, action)
  await repo.createAuditLog({
    adminId, adminRole, action: `report_${action}`,
    entityType: 'report', entityId: reportId,
    afterState: { status: action },
  })
  return report
}

// ─── Impersonation ──────────────────────────────────────────────────────────

export async function startImpersonation(
  adminId: string, adminRole: AdminRole,
  targetUserId: string, targetAccountType: string, note: string,
) {
  checkPermission(adminRole, 'impersonate')
  if (!note) throw AppError.badRequest('Note is mandatory for impersonation')
  return repo.createImpersonationLog({
    adminId, targetUserId, targetAccountType, note,
  })
}

// ─── Consent Audit ──────────────────────────────────────────────────────────

export async function getConsentHistory(adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'view_consent')
  return repo.getUserConsentHistory(userId)
}

export async function getReconsentList(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_consent')
  const version = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
  return repo.getUsersNeedingReconsent(version)
}


// ─── Archetype Management ───────────────────────────────────────────────────

// In-memory archetype catalog — in production, this would be DB-backed
const archetypeCatalog = [
  { id: 'archetype-festival-spirit', name: 'The Festival Spirit', iconId: 'festival-spirit', description: 'Lives for the energy of a packed crowd.', dimensionThresholds: { energy: 0.7, cultural_rootedness: 0.6, edge: 0.4 }, priority: 15, isActive: true },
  { id: 'archetype-conscious-creative', name: 'The Conscious Creative', iconId: 'conscious-creative', description: 'A soulful innovator.', dimensionThresholds: { spirituality: 0.4, edge: 0.4, sophistication: 0.4 }, priority: 14, isActive: true },
  { id: 'archetype-township-royal', name: 'The Township Royal', iconId: 'township-royal', description: 'Deeply rooted in culture.', dimensionThresholds: { cultural_rootedness: 0.7, energy: 0.6, edge: 0.4 }, priority: 13, isActive: true },
  { id: 'archetype-sacred-rebel', name: 'The Sacred Rebel', iconId: 'sacred-rebel', description: 'Spiritual conviction with raw edge.', dimensionThresholds: { spirituality: 0.6, edge: 0.6 }, priority: 12, isActive: true },
  { id: 'archetype-firecracker', name: 'The Firecracker', iconId: 'firecracker', description: 'Pure high-octane energy.', dimensionThresholds: { energy: 0.7, edge: 0.6 }, priority: 11, isActive: true },
  { id: 'archetype-heritage-groover', name: 'The Heritage Groover', iconId: 'heritage-groover', description: 'High-energy beats rooted in tradition.', dimensionThresholds: { energy: 0.7, cultural_rootedness: 0.6 }, priority: 10, isActive: true },
  { id: 'archetype-midnight-philosopher', name: 'The Midnight Philosopher', iconId: 'midnight-philosopher', description: 'Refined thinker.', dimensionThresholds: { sophistication: 0.7, spirituality: 0.4 }, priority: 9, isActive: true },
  { id: 'archetype-street-poet', name: 'The Street Poet', iconId: 'street-poet', description: 'Raw edge through cultural awareness.', dimensionThresholds: { edge: 0.6, cultural_rootedness: 0.4 }, priority: 8, isActive: true },
  { id: 'archetype-soul-wanderer', name: 'The Soul Wanderer', iconId: 'soul-wanderer', description: 'Spiritual depth and sophistication.', dimensionThresholds: { spirituality: 0.6, sophistication: 0.6 }, priority: 7, isActive: true },
  { id: 'archetype-vibe-architect', name: 'The Vibe Architect', iconId: 'vibe-architect', description: 'Crafts the perfect atmosphere.', dimensionThresholds: { sophistication: 0.6, energy: 0.4 }, priority: 6, isActive: true },
  { id: 'archetype-smooth-operator', name: 'The Smooth Operator', iconId: 'smooth-operator', description: 'Effortlessly sophisticated.', dimensionThresholds: { sophistication: 0.7 }, priority: 5, isActive: true },
  { id: 'archetype-groove-seeker', name: 'The Groove Seeker', iconId: 'groove-seeker', description: 'Chases the beat.', dimensionThresholds: { energy: 0.7 }, priority: 4, isActive: true },
  { id: 'archetype-culture-curator', name: 'The Culture Curator', iconId: 'culture-curator', description: 'Guardian of cultural heritage.', dimensionThresholds: { cultural_rootedness: 0.7 }, priority: 3, isActive: true },
  { id: 'archetype-eclectic', name: 'The Eclectic', iconId: 'eclectic', description: 'Open to everything.', dimensionThresholds: {}, priority: 2, isActive: true },
  { id: 'archetype-uncharted', name: 'The Uncharted', iconId: 'uncharted', description: 'Waiting to be discovered.', dimensionThresholds: {}, priority: 1, isActive: true },
]

export async function getArchetypes() {
  return archetypeCatalog
}

export async function createArchetype(
  adminId: string, adminRole: AdminRole, data: Record<string, unknown>,
) {
  checkPermission(adminRole, 'view_user') // super_admin only in practice
  const id = `archetype-${Date.now()}`
  const entry = { id, ...data, isActive: true } as typeof archetypeCatalog[number]
  archetypeCatalog.push(entry)
  await repo.createAuditLog({
    adminId, adminRole, action: 'create_archetype',
    entityType: 'archetype', entityId: id,
    afterState: data,
  })
  return entry
}

export async function updateArchetype(
  adminId: string, adminRole: AdminRole, archetypeId: string, data: Record<string, unknown>,
) {
  checkPermission(adminRole, 'view_user')
  const idx = archetypeCatalog.findIndex((a) => a.id === archetypeId)
  if (idx === -1) throw AppError.notFound('Archetype not found')
  const before = { ...archetypeCatalog[idx] }
  Object.assign(archetypeCatalog[idx]!, data)
  await repo.createAuditLog({
    adminId, adminRole, action: 'update_archetype',
    entityType: 'archetype', entityId: archetypeId,
    beforeState: before, afterState: data,
  })
  return archetypeCatalog[idx]
}

// ─── Genre Weight Management ────────────────────────────────────────────────

// In-memory genre weight matrix — in production, this would be DB-backed
let genreWeightMatrix = [
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

export async function getGenreWeights() {
  return { matrix: genreWeightMatrix }
}

export async function updateGenreWeights(
  adminId: string, adminRole: AdminRole, data: Record<string, unknown>,
) {
  checkPermission(adminRole, 'view_user')
  const before = [...genreWeightMatrix]
  if (Array.isArray(data['matrix'])) {
    genreWeightMatrix = data['matrix'] as typeof genreWeightMatrix
  }
  await repo.createAuditLog({
    adminId, adminRole, action: 'update_genre_weights',
    entityType: 'genre_weights', entityId: 'global',
    beforeState: { matrix: before }, afterState: data,
  })
  return { matrix: genreWeightMatrix }
}
