import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import type { AdminRole } from './types.js'

// Role permissions
const ROLE_PERMISSIONS: Record<AdminRole, Set<string>> = {
  super_admin: new Set([
    'view_user',
    'disable_user',
    'reset_flags',
    'recalculate_tier',
    'override_streak',
    'process_erasure',
    'send_message',
    'impersonate',
    'view_business',
    'extend_trial',
    'revoke_staff',
    'deactivate_rewards',
    'override_cipc',
    'view_reports',
    'action_reports',
    'view_consent',
    'manage_user',
    'manage_business',
  ]),
  support_agent: new Set(['view_user', 'send_message', 'view_business', 'extend_trial', 'view_consent', 'manage_user']),
  content_moderator: new Set(['view_reports', 'action_reports', 'override_cipc']),
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

export async function resetAbuseFlags(adminId: string, adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'reset_flags')
  await repo.resetAbuseFlags(userId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'reset_abuse_flags',
    entityType: 'user',
    entityId: userId,
  })
}

export async function sendMessage(adminId: string, adminRole: AdminRole, targetUserId: string, message: string) {
  checkPermission(adminRole, 'send_message')
  const msg = await repo.sendAdminMessage(adminId, targetUserId, message)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'send_message',
    entityType: 'user',
    entityId: targetUserId,
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

export async function extendTrial(adminId: string, adminRole: AdminRole, businessId: string, days: number) {
  checkPermission(adminRole, 'extend_trial')
  const result = await repo.extendBusinessTrial(businessId, days)
  if (!result) throw AppError.notFound('Business not found')
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'extend_trial',
    entityType: 'business',
    entityId: businessId,
    afterState: { days, newTrialEnd: result.trialEndsAt },
  })
  return result
}

export async function setBusinessTier(
  adminId: string,
  adminRole: AdminRole,
  businessId: string,
  tier: 'starter' | 'growth' | 'pro',
  reason: string,
  trialEndsAt?: string,
) {
  checkPermission(adminRole, 'manage_business')
  const { updateBusinessTier } = await import('../business/repository.js')
  await updateBusinessTier(businessId, tier, trialEndsAt)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'set_tier',
    entityType: 'business',
    entityId: businessId,
    afterState: { tier, reason, trialEndsAt },
  })
  return { success: true, tier, trialEndsAt }
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getReportQueue(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_reports')
  const rawItems = await repo.getReportQueue()
  const items = rawItems.map((r: Record<string, unknown>) => ({
    ...r,
    nodeName: ((r['node'] as Record<string, unknown> | null)?.['name'] ?? 'Unknown') as string,
    sameTypeCount: 0,
  }))
  return { items }
}

export async function actionReport(adminId: string, adminRole: AdminRole, reportId: string, action: string) {
  checkPermission(adminRole, 'action_reports')
  const report = await repo.updateReportStatus(reportId, action)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: `report_${action}`,
    entityType: 'report',
    entityId: reportId,
    afterState: { status: action },
  })
  return report
}

// ─── Impersonation ──────────────────────────────────────────────────────────

export async function startImpersonation(
  adminId: string,
  adminRole: AdminRole,
  targetUserId: string,
  targetAccountType: string,
  note: string,
) {
  checkPermission(adminRole, 'impersonate')
  if (!note) throw AppError.badRequest('Note is mandatory for impersonation')
  return repo.createImpersonationLog({
    adminId,
    targetUserId,
    targetAccountType,
    note,
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

async function seedArchetypesIfEmpty() {
  const existing = await repo.getArchetypes()
  if (existing.length > 0) return existing
  // Seed defaults
  for (const a of DEFAULT_ARCHETYPES) {
    await repo.createArchetype(a)
  }
  return DEFAULT_ARCHETYPES
}

export async function getArchetypes() {
  return seedArchetypesIfEmpty()
}

export async function createArchetype(adminId: string, adminRole: AdminRole, data: Record<string, unknown>) {
  checkPermission(adminRole, 'view_user') // super_admin only in practice
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
  // Get current state for audit log
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

// ─── Genre Weight Management ────────────────────────────────────────────────

// Default genre weight matrix — seeded to DynamoDB on first read
const DEFAULT_GENRE_WEIGHTS = [
  {
    genre: 'amapiano',
    weights: { energy: 0.9, cultural_rootedness: 0.6, sophistication: 0.3, edge: 0.2, spirituality: 0.1 },
  },
  {
    genre: 'deep_house',
    weights: { energy: 0.5, cultural_rootedness: 0.2, sophistication: 0.8, edge: 0.1, spirituality: 0.3 },
  },
  {
    genre: 'afrobeats',
    weights: { energy: 0.8, cultural_rootedness: 0.7, sophistication: 0.3, edge: 0.3, spirituality: 0.2 },
  },
  {
    genre: 'hip_hop',
    weights: { energy: 0.6, cultural_rootedness: 0.4, sophistication: 0.4, edge: 0.8, spirituality: 0.2 },
  },
  {
    genre: 'rnb',
    weights: { energy: 0.4, cultural_rootedness: 0.3, sophistication: 0.8, edge: 0.2, spirituality: 0.4 },
  },
  {
    genre: 'kwaito',
    weights: { energy: 0.7, cultural_rootedness: 0.9, sophistication: 0.2, edge: 0.5, spirituality: 0.3 },
  },
  {
    genre: 'gqom',
    weights: { energy: 0.9, cultural_rootedness: 0.5, sophistication: 0.1, edge: 0.8, spirituality: 0.1 },
  },
  {
    genre: 'jazz',
    weights: { energy: 0.3, cultural_rootedness: 0.3, sophistication: 0.9, edge: 0.2, spirituality: 0.7 },
  },
  {
    genre: 'rock',
    weights: { energy: 0.8, cultural_rootedness: 0.1, sophistication: 0.2, edge: 0.9, spirituality: 0.1 },
  },
  {
    genre: 'pop',
    weights: { energy: 0.6, cultural_rootedness: 0.2, sophistication: 0.4, edge: 0.3, spirituality: 0.2 },
  },
  {
    genre: 'gospel',
    weights: { energy: 0.4, cultural_rootedness: 0.7, sophistication: 0.4, edge: 0.1, spirituality: 0.9 },
  },
  {
    genre: 'maskandi',
    weights: { energy: 0.5, cultural_rootedness: 0.9, sophistication: 0.3, edge: 0.3, spirituality: 0.6 },
  },
]

async function seedGenreWeightsIfEmpty() {
  const existing = await repo.getGenreWeights()
  if (existing) return existing
  await repo.updateGenreWeightsRecord(DEFAULT_GENRE_WEIGHTS)
  return DEFAULT_GENRE_WEIGHTS
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

// ─── Node Management ────────────────────────────────────────────────────────

export async function searchNodes(adminRole: AdminRole, query: string) {
  checkPermission(adminRole, 'view_business')
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb')
  const { documentClient, TableNames } = await import('../../shared/db/dynamodb.js')
  const q = query.toLowerCase()
  const result = await documentClient.send(
    new ScanCommand({ TableName: TableNames.nodes }),
  )
  const nodes = (result.Items ?? [])
    .filter((n) => {
      if (!q) return true
      const name = ((n['name'] as string) ?? '').toLowerCase()
      return name.includes(q)
    })
    .slice(0, 50)
  return { items: nodes }
}

export async function nodeAction(
  adminId: string,
  adminRole: AdminRole,
  nodeId: string,
  action: string,
  body?: Record<string, unknown>,
) {
  checkPermission(adminRole, 'manage_business')
  const { getNodeById, updateNode } = await import('../nodes/dynamodb-repository.js')

  switch (action) {
    case 'deactivate':
      await updateNode(nodeId, { isActive: false })
      await createAuditLog(adminId, adminRole, 'node_deactivate', nodeId, { before: { isActive: true }, after: { isActive: false } })
      return { success: true }
    case 'activate':
      await updateNode(nodeId, { isActive: true })
      await createAuditLog(adminId, adminRole, 'node_activate', nodeId, { before: { isActive: false }, after: { isActive: true } })
      return { success: true }
    case 'update':
      if (!body) throw AppError.badRequest('Body required')
      const node = await getNodeById(nodeId)
      const allowedFields: Record<string, unknown> = {}
      if (body['name']) allowedFields['name'] = body['name']
      if (body['category']) allowedFields['category'] = body['category']
      await updateNode(nodeId, allowedFields as any)
      await createAuditLog(adminId, adminRole, 'node_update', nodeId, { before: node, after: allowedFields })
      return { success: true }
    default:
      throw AppError.badRequest(`Unknown action: ${action}`)
  }
}

async function createAuditLog(adminId: string, adminRole: AdminRole, action: string, entityId: string, state?: { before?: unknown; after?: unknown }) {
  await repo.createAuditLog({
    adminId,
    adminRole,
    action,
    entityType: 'node',
    entityId,
    ...(state?.before ? { beforeState: state.before } : {}),
    ...(state?.after ? { afterState: state.after } : {}),
  })
}

// ─── Consumer Search ────────────────────────────────────────────────────────

export async function searchConsumers(adminRole: AdminRole, query: string) {
  checkPermission(adminRole, 'view_user')
  const items = await repo.searchConsumers(query)
  return { items, nextCursor: null, hasMore: false }
}

export async function consumerAction(
  adminId: string,
  adminRole: AdminRole,
  userId: string,
  action: string,
  note?: string,
) {
  // Route to dedicated implementations where they exist
  switch (action) {
    case 'reset-flags':
      return resetAbuseFlags(adminId, adminRole, userId)
    case 'send-message':
      if (!note) throw AppError.badRequest('Message text is required')
      return sendMessage(adminId, adminRole, userId, note)
    case 'disable':
      return disableUser(adminId, adminRole, userId)
    default: {
      // For actions without dedicated implementations, create audit log
      const destructiveActions = ['override-streak', 'recalculate-tier', 'process-erasure']
      const requiredPermission =
        action === 'process-erasure'
          ? 'process_erasure'
          : destructiveActions.includes(action)
            ? 'manage_user'
            : 'view_user'
      checkPermission(adminRole, requiredPermission)
      await repo.createAuditLog({
        adminId,
        adminRole,
        action: `consumer_${action}`,
        entityType: 'user',
        entityId: userId,
        afterState: { note },
      })
      return { success: true }
    }
  }
}

// ─── Business Staff ──────────────────────────────────────────────────────────

export async function getBusinessStaff(adminRole: AdminRole, businessId: string) {
  checkPermission(adminRole, 'view_business')
  const { listStaffAccounts } = await import('../business/repository.js')
  const items = await listStaffAccounts(businessId)
  return { items }
}

export async function revokeStaffAccess(adminId: string, adminRole: AdminRole, businessId: string, staffId: string) {
  checkPermission(adminRole, 'revoke_staff')
  const { removeStaffAccount } = await import('../business/repository.js')
  await removeStaffAccount(staffId, businessId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'revoke_staff',
    entityType: 'staff',
    entityId: staffId,
    afterState: { businessId, revokedBy: adminId },
  })
  return { success: true }
}

// ─── Business Search ────────────────────────────────────────────────────────

export async function searchBusinesses(adminRole: AdminRole, query: string) {
  checkPermission(adminRole, 'view_business')
  const items = await repo.searchBusinesses(query)
  return { items, nextCursor: null, hasMore: false }
}

export async function businessAction(adminId: string, adminRole: AdminRole, businessId: string, action: string) {
  // Route to dedicated implementations where they exist
  switch (action) {
    case 'extend-trial':
      return extendTrial(adminId, adminRole, businessId, 14) // default 14 days
    case 'disable':
      return disableBusiness(adminId, adminRole, businessId)
    default: {
      // For actions without dedicated implementations, create audit log
      const destructiveActions = ['deactivate', 'revoke', 'delete', 'downgrade', 'deactivate-rewards']
      const requiredPermission = destructiveActions.includes(action) ? 'manage_business' : 'view_business'
      checkPermission(adminRole, requiredPermission)
      await repo.createAuditLog({
        adminId,
        adminRole,
        action: `business_${action}`,
        entityType: 'business',
        entityId: businessId,
      })
      return { success: true }
    }
  }
}

// ─── Consent List ───────────────────────────────────────────────────────────

export async function listConsents(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_consent')
  const items = await repo.listConsents()
  return { items }
}

// ─── Erasure Queue ──────────────────────────────────────────────────────────

export async function getErasureQueue(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_consent')
  const items = await repo.getErasureQueue()
  return { items }
}

// ─── Abuse Flags ────────────────────────────────────────────────────────────

export async function getAbuseFlags(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_user')
  const items = await repo.getUnreviewedAbuseFlags()
  return { items }
}

export async function reviewAbuseFlag(adminId: string, adminRole: AdminRole, flagId: string) {
  checkPermission(adminRole, 'reset_flags')
  const flag = await repo.reviewAbuseFlag(flagId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'review_abuse_flag',
    entityType: 'abuse_flag',
    entityId: flagId,
  })
  return flag
}

export async function actionAbuseFlag(adminId: string, adminRole: AdminRole, flagId: string, action: string) {
  checkPermission(adminRole, 'reset_flags')
  if (action === 'disable_user') {
    const flags = await repo.getUnreviewedAbuseFlags()
    const flag = flags.find((f) => (f.id ?? (f as Record<string, unknown>)['flagId']) === flagId)
    if (flag) {
      const entityId = (flag as Record<string, unknown>)['entityId'] as string
      if (entityId) {
        await disableUser(adminId, adminRole, entityId)
      }
    }
  } else if (action === 'reset_flags') {
    const flags = await repo.getUnreviewedAbuseFlags()
    const flag = flags.find((f) => (f.id ?? (f as Record<string, unknown>)['flagId']) === flagId)
    if (flag) {
      const entityId = (flag as Record<string, unknown>)['entityId'] as string
      if (entityId) {
        await resetAbuseFlags(adminId, adminRole, entityId)
      }
    }
  }
  await repo.reviewAbuseFlag(flagId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: `abuse_flag_${action}`,
    entityType: 'abuse_flag',
    entityId: flagId,
    afterState: { action },
  })
  return { success: true }
}

// ─── Dashboard Metrics ──────────────────────────────────────────────────────

export async function getDashboardMetrics(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_user')
  return repo.getDashboardMetrics()
}

// ─── Audit Logs ─────────────────────────────────────────────────────────────

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

// ─── Disable User / Business ────────────────────────────────────────────────

export async function disableUser(adminId: string, adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'disable_user')
  const user = await repo.getUserById(userId)
  if (!user) throw AppError.notFound('User not found')

  // Set isDisabled on user record
  const { updateUser } = await import('../auth/dynamodb-repository.js')
  await updateUser(userId, {
    isDisabled: true,
    disabledAt: new Date().toISOString(),
  } as any)

  // Revoke Cognito tokens
  const cognitoSub = (user as Record<string, unknown>)['cognitoSub'] as string | undefined
  if (cognitoSub) {
    try {
      const { CognitoIdentityProviderClient, AdminUserGlobalSignOutCommand } =
        await import('@aws-sdk/client-cognito-identity-provider')
      const region = process.env['AWS_REGION'] ?? 'us-east-1'
      const userPoolId = process.env['AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID'] ?? ''
      if (userPoolId) {
        const client = new CognitoIdentityProviderClient({ region })
        await client.send(
          new AdminUserGlobalSignOutCommand({
            UserPoolId: userPoolId,
            Username: cognitoSub,
          }),
        )
      }
    } catch {
      // Cognito sign-out failure is non-critical — user is still disabled in DB
    }
  }

  // Create audit log
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'disable_user',
    entityType: 'user',
    entityId: userId,
    afterState: { isDisabled: true },
  })

  return { success: true, userId, isDisabled: true }
}

export async function disableBusiness(adminId: string, adminRole: AdminRole, businessId: string) {
  checkPermission(adminRole, 'disable_user') // super_admin permission
  const biz = await repo.getBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')

  // Set isActive = false on all nodes owned by this business
  const { getNodesByBusinessId, updateNode } = await import('../nodes/dynamodb-repository.js')
  const nodes = await getNodesByBusinessId(businessId)
  for (const node of nodes) {
    await updateNode(node.nodeId, { isActive: false })
  }

  // Create audit log
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'disable_business',
    entityType: 'business',
    entityId: businessId,
    afterState: { isActive: false, nodesDeactivated: nodes.length },
  })

  return { success: true, businessId, nodesDeactivated: nodes.length }
}
