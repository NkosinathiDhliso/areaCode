/**
 * Mock route resolver — maps (method, path) to handler functions.
 * Maintains mutable MockState for session-level state changes.
 */
import type { Reward, Report, ConsentRecord, User, NodeState, MusicGenre } from '../types'
import { generateId, hoursAgo, randomBetween } from './helpers'
import { MOCK_NODES } from './data/nodes'
import { MOCK_PULSE_SCORES } from './data/pulseScores'
import { MOCK_USERS, CURRENT_USER_ID } from './data/users'
import { MOCK_BUSINESSES, CURRENT_BUSINESS_ID } from './data/businesses'
import { MOCK_REWARDS } from './data/rewards'
import { MOCK_REDEMPTIONS } from './data/redemptions'
import { MOCK_STAFF } from './data/staff'
import { MOCK_LEADERBOARD, CURRENT_USER_RANK } from './data/leaderboard'
import { MOCK_FEED } from './data/feed'
import { MOCK_REPORTS } from './data/reports'
import { MOCK_CONSENT, CURRENT_CONSENT_VERSION } from './data/consent'
import { MOCK_ABUSE_FLAGS } from './data/abuseFlags'
import { addFollow, removeFollow, isFollowing, isMutualFollow, getMutualFollowIds, getFollowingIds, getFollowerIds } from './data/follows'
import { buildCrowdVibeSnapshot, buildBusinessMusicAudience } from './data/crowdVibe'
import { ARCHETYPE_CATALOG } from '../constants/archetype-catalog'
import { GENRE_WEIGHT_MATRIX } from '../constants/genre-weights'
import { computeDimensionScores, resolveArchetype, matchesArchetype } from '../lib/archetypeResolver'

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------
interface MockState {
  pulseScores: Record<string, number>
  currentUser: User
  rewards: Reward[]
  reports: Report[]
  consents: ConsentRecord[]
  userCheckInCount: number
  userStreak: number
}

const state: MockState = {
  pulseScores: { ...MOCK_PULSE_SCORES },
  currentUser: { ...MOCK_USERS.find((u) => u.id === CURRENT_USER_ID)! },
  rewards: [...MOCK_REWARDS],
  reports: [...MOCK_REPORTS],
  consents: [...MOCK_CONSENT],
  userCheckInCount: MOCK_USERS.find((u) => u.id === CURRENT_USER_ID)!.totalCheckIns,
  userStreak: 4,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getNodeState(score: number): NodeState {
  if (score === 0) return 'dormant'
  if (score <= 10) return 'quiet'
  if (score <= 30) return 'active'
  if (score <= 60) return 'buzzing'
  return 'popping'
}

// ---------------------------------------------------------------------------
// Route types
// ---------------------------------------------------------------------------
export interface RouteParams {
  method: string
  path: string
  body?: unknown
  pathParams: Record<string, string>
  queryParams: Record<string, string>
}

export type RouteHandler = (params: RouteParams) => unknown

interface Route {
  method: string
  pattern: RegExp
  paramNames: string[]
  handler: RouteHandler
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------
const routes: Route[] = []

function register(method: string, pathPattern: string, handler: RouteHandler) {
  const paramNames: string[] = []
  const regexStr = pathPattern.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  routes.push({ method, pattern: new RegExp(`^${regexStr}$`), paramNames, handler })
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------
register('POST', '/v1/auth/consumer/login', () => ({ success: true }))

register('POST', '/v1/auth/consumer/verify-otp', () => ({
  accessToken: 'dev-access-mock-user-4',
  refreshToken: 'dev-refresh-mock-user-4',
  user: {
    id: CURRENT_USER_ID,
    username: state.currentUser.username,
    displayName: state.currentUser.displayName,
    tier: state.currentUser.tier,
  },
}))

register('POST', '/v1/auth/consumer/signup', () => ({
  userId: CURRENT_USER_ID,
  message: 'OTP sent (dev mode)',
}))

register('GET', '/v1/auth/account-type', () => ({ accountType: 'consumer' }))

register('POST', '/v1/auth/business/login', () => ({ success: true }))

register('POST', '/v1/auth/business/verify-otp', () => ({
  accessToken: 'dev-access-mock-biz-2',
  refreshToken: 'dev-refresh-mock-biz-2',
  businessId: CURRENT_BUSINESS_ID,
}))

register('POST', '/v1/auth/staff/login', () => ({ success: true }))

register('POST', '/v1/auth/staff/verify-otp', () => ({
  accessToken: 'dev-access-mock-staff-1',
  refreshToken: 'dev-refresh-mock-staff-1',
  staff: {
    id: 'mock-staff-1',
    businessId: CURRENT_BUSINESS_ID,
    name: 'Thabo Molefe',
    nodeName: 'Father Coffee',
  },
}))

register('POST', '/v1/auth/admin/login', () => ({
  accessToken: 'dev-access-admin',
  adminId: 'mock-admin-1',
  role: 'super_admin',
}))

register('POST', '/v1/auth/refresh', () => ({
  accessToken: 'dev-access-refreshed',
}))

register('POST', '/v1/auth/logout', () => ({ success: true }))

register('POST', '/v1/auth/consent', () => ({
  id: generateId(),
  userId: CURRENT_USER_ID,
  consentVersion: CURRENT_CONSENT_VERSION,
  analyticsOptIn: true,
  consentedAt: new Date().toISOString(),
}))

// ---------------------------------------------------------------------------
// Node endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/nodes/search', ({ queryParams }) => {
  const q = (queryParams['q'] ?? '').toLowerCase()
  if (!q) return MOCK_NODES
  return MOCK_NODES.filter((n) => n.name.toLowerCase().includes(q))
})

register('GET', '/v1/nodes/:nodeId/detail', ({ pathParams }) => {
  const node = MOCK_NODES.find((n) => n.id === pathParams['nodeId'])
  if (!node) return { error: 'not_found', message: 'Entity not found', statusCode: 404 }
  const score = state.pulseScores[node.id] ?? 0
  const rewards = state.rewards.filter((r) => r.nodeId === node.id && r.isActive)
  // 2-4 random users for who-is-here
  const count = randomBetween(2, 4)
  const shuffled = [...MOCK_USERS].sort(() => Math.random() - 0.5).slice(0, count)
  const whoIsHere = shuffled.map((u) => ({
    userId: u.id, username: u.username, displayName: u.displayName,
    avatarUrl: u.avatarUrl, tier: u.tier,
  }))
  return { ...node, pulseScore: score, state: getNodeState(score), rewards, whoIsHere }
})

register('GET', '/v1/nodes/:nodeSlug/public', ({ pathParams }) => {
  const node = MOCK_NODES.find((n) => n.slug === pathParams['nodeSlug'])
  if (!node) return { error: 'not_found', message: 'Entity not found', statusCode: 404 }
  const score = state.pulseScores[node.id] ?? 0
  const activeRewardCount = state.rewards.filter((r) => r.nodeId === node.id && r.isActive).length
  return { name: node.name, category: node.category, city: 'Johannesburg', pulseScore: score, activeRewardCount, ogImage: null }
})

register('GET', '/v1/nodes/:nodeId/rewards', ({ pathParams }) => {
  return state.rewards.filter((r) => r.nodeId === pathParams['nodeId'] && r.isActive)
})

register('GET', '/v1/nodes/:citySlug', () => MOCK_NODES)

// ---------------------------------------------------------------------------
// Check-in endpoint
// ---------------------------------------------------------------------------
register('POST', '/v1/check-in', ({ body }) => {
  const { nodeId } = (body ?? {}) as { nodeId?: string }
  if (nodeId && state.pulseScores[nodeId] !== undefined) {
    state.pulseScores[nodeId] = (state.pulseScores[nodeId] ?? 0) + 5
  }
  state.userCheckInCount += 1
  state.currentUser = { ...state.currentUser, totalCheckIns: state.userCheckInCount }
  return { success: true, cooldownUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() }
})

// ---------------------------------------------------------------------------
// Reward endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/rewards/near-me', () => {
  const active = state.rewards.filter((r) => r.isActive)
  return active.map((r, i) => {
    const node = MOCK_NODES.find((n) => n.id === r.nodeId)
    return { ...r, nodeName: node?.name ?? 'Unknown', distance: 150 + i * 150 }
  })
})

register('GET', '/v1/rewards/unclaimed', () => {
  return MOCK_REDEMPTIONS.filter((rd) => rd.userId === CURRENT_USER_ID && !rd.redeemedAt)
    .map((rd) => {
      const reward = state.rewards.find((r) => r.id === rd.rewardId)
      const node = reward ? MOCK_NODES.find((n) => n.id === reward.nodeId) : null
      return { ...rd, rewardTitle: reward?.title ?? 'Reward', nodeName: node?.name ?? 'Unknown' }
    })
})

register('POST', '/v1/rewards/redeem', ({ body }) => {
  const { code } = (body ?? {}) as { code?: string }
  const codeStr = code ?? ''
  if (codeStr.length < 6) {
    return { error: 'invalid_code', message: 'Invalid code', statusCode: 400 }
  }
  return { success: true, rewardTitle: 'Free coffee with any breakfast', redeemedAt: new Date().toISOString() }
})

// ---------------------------------------------------------------------------
// Social — Leaderboard & Feed
// ---------------------------------------------------------------------------
register('GET', '/v1/leaderboard/:citySlug', () => ({
  entries: MOCK_LEADERBOARD,
  userRank: { rank: CURRENT_USER_RANK, checkInCount: MOCK_LEADERBOARD.find((e) => e.rank === CURRENT_USER_RANK)?.checkInCount ?? 0 },
}))

register('GET', '/v1/feed', () => ({
  items: MOCK_FEED.map((f) => ({
    id: f.id,
    checkedInAt: f.checkedInAt,
    user: {
      id: f.userId,
      username: f.username,
      displayName: f.displayName,
      avatarUrl: f.avatarUrl,
      tier: f.tier,
    },
    node: {
      id: f.nodeId,
      name: f.nodeName,
      slug: f.nodeId,
      category: f.nodeCategory,
    },
  })),
  nextCursor: null,
  hasMore: false,
}))

// ---------------------------------------------------------------------------
// Social — Follow / Friends
// ---------------------------------------------------------------------------
register('POST', '/v1/users/:id/follow', ({ pathParams }) => {
  addFollow(CURRENT_USER_ID, pathParams['id']!)
  return { success: true }
})

register('DELETE', '/v1/users/:id/follow', ({ pathParams }) => {
  removeFollow(CURRENT_USER_ID, pathParams['id']!)
  return { success: true }
})

register('GET', '/v1/users/me/friends', () => {
  const friendIds = getMutualFollowIds(CURRENT_USER_ID)
  const friends = friendIds.map((id) => {
    const u = MOCK_USERS.find((u) => u.id === id)
    if (!u) return null
    return {
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      tier: u.tier,
      totalCheckIns: u.totalCheckIns,
    }
  }).filter(Boolean)
  return { friends, count: friends.length }
})

register('GET', '/v1/users/me/following', () => {
  const ids = getFollowingIds(CURRENT_USER_ID)
  const users = ids.map((id) => {
    const u = MOCK_USERS.find((u) => u.id === id)
    if (!u) return null
    return {
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      tier: u.tier,
      isMutual: isMutualFollow(CURRENT_USER_ID, u.id),
    }
  }).filter(Boolean)
  return { users, count: users.length }
})

register('GET', '/v1/users/me/followers', () => {
  const ids = getFollowerIds(CURRENT_USER_ID)
  const users = ids.map((id) => {
    const u = MOCK_USERS.find((u) => u.id === id)
    if (!u) return null
    return {
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      tier: u.tier,
      isFollowingBack: isFollowing(CURRENT_USER_ID, u.id),
    }
  }).filter(Boolean)
  return { users, count: users.length }
})

register('GET', '/v1/users/search', ({ queryParams }) => {
  const q = (queryParams['q'] ?? '').toLowerCase()
  if (!q || q.length < 2) return { users: [] }
  const results = MOCK_USERS
    .filter((u) => u.id !== CURRENT_USER_ID)
    .filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q))
    .slice(0, 10)
    .map((u) => ({
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      tier: u.tier,
      isFollowing: isFollowing(CURRENT_USER_ID, u.id),
      isMutual: isMutualFollow(CURRENT_USER_ID, u.id),
    }))
  return { users: results }
})

// ---------------------------------------------------------------------------
// User profile endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/users/me', () => ({
  ...state.currentUser,
  totalCheckIns: state.userCheckInCount,
  streakCount: state.userStreak,
}))

register('PATCH', '/v1/users/me', ({ body }) => {
  if (body && typeof body === 'object') {
    state.currentUser = { ...state.currentUser, ...(body as Partial<User>) }
  }
  return { ...state.currentUser, totalCheckIns: state.userCheckInCount, streakCount: state.userStreak }
})

register('GET', '/v1/users/me/check-in-history', () => ({
  items: [
    { id: generateId(), userId: CURRENT_USER_ID, nodeId: 'mock-node-2', type: 'presence', checkedInAt: hoursAgo(2) },
    { id: generateId(), userId: CURRENT_USER_ID, nodeId: 'mock-node-1', type: 'presence', checkedInAt: hoursAgo(26) },
    { id: generateId(), userId: CURRENT_USER_ID, nodeId: 'mock-node-4', type: 'reward', checkedInAt: hoursAgo(50) },
  ],
  nextCursor: null,
  hasMore: false,
}))

register('DELETE', '/v1/users/me/check-in-history', () => ({ success: true }))

// ---------------------------------------------------------------------------
// Business endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/business/me', () => {
  return MOCK_BUSINESSES.find((b) => b.id === CURRENT_BUSINESS_ID)!
})

register('GET', '/v1/business/me/live-stats', () => ({
  checkInsToday: 34,
  rewardsClaimed: 12,
  pulseScore: 45,
  totalCheckIns: 1247,
}))

register('GET', '/v1/business/me/nodes', () => {
  return { items: MOCK_NODES.filter((n) => n.businessId === CURRENT_BUSINESS_ID) }
})

register('GET', '/v1/business/me/audience', () => ({
  tierDistribution: { local: 40, regular: 30, fixture: 20, institution: 8, legend: 2 },
  repeatVsNew: { repeat: 180, new: 67 },
  totalUniqueVisitors: 247,
  peakHours: ['12:00-14:00', '18:00-21:00'],
  topRepeatVisitors: MOCK_USERS.slice(0, 5).map((u) => ({
    displayName: u.displayName, tier: u.tier, visitCount: randomBetween(3, 12),
  })),
}))

register('GET', '/v1/business/me/recent-redemptions', () => {
  return MOCK_REDEMPTIONS.filter((rd) => rd.redeemedAt).map((rd) => {
    const reward = MOCK_REWARDS.find((r) => r.id === rd.rewardId)
    const user = MOCK_USERS.find((u) => u.id === rd.userId)
    return {
      code: rd.redemptionCode,
      rewardTitle: reward?.title ?? 'Reward',
      displayName: user?.displayName ?? 'Unknown',
      redeemedAt: rd.redeemedAt,
    }
  })
})

register('GET', '/v1/business/rewards', () => {
  return state.rewards.filter((r) => {
    const node = MOCK_NODES.find((n) => n.id === r.nodeId)
    return node?.businessId === CURRENT_BUSINESS_ID
  })
})

register('POST', '/v1/business/rewards', ({ body }) => {
  const payload = body as Partial<Reward> | undefined
  const newReward: Reward = {
    id: generateId(),
    nodeId: payload?.nodeId ?? 'mock-node-2',
    type: payload?.type ?? 'nth_checkin',
    title: payload?.title ?? 'New Reward',
    description: payload?.description ?? null,
    triggerValue: payload?.triggerValue ?? 5,
    totalSlots: payload?.totalSlots ?? 50,
    claimedCount: 0,
    slotsLocked: false,
    isActive: true,
    expiresAt: payload?.expiresAt ?? null,
    createdAt: new Date().toISOString(),
  }
  state.rewards.push(newReward)
  return { id: newReward.id, success: true }
})

register('GET', '/v1/business/plans', () => ({
  subscriptions: [
    { tier: 'starter', monthlyPrice: 0, yearlyPrice: 0 },
    { tier: 'growth', monthlyPrice: 299, yearlyPrice: 2990 },
    { tier: 'pro', monthlyPrice: 799, yearlyPrice: 7990 },
    { tier: 'payg', dailyPrice: 99, weeklyPrice: 199 },
  ],
  boosts: [
    { duration: '2hr', price: 25 },
    { duration: '6hr', price: 50 },
    { duration: '24hr', price: 150 },
  ],
}))

register('POST', '/v1/business/boost', () => ({
  success: true,
  checkoutUrl: 'https://pay.yoco.com/mock',
}))

register('GET', '/v1/business/staff', () => ({ items: MOCK_STAFF }))

register('DELETE', '/v1/business/staff/:staffId', () => ({ success: true }))

register('GET', '/v1/business/nodes/current/qr', () => ({
  qrUrl: 'https://areacode.co.za/qr/mock-node-2',
}))

register('PUT', '/v1/nodes/:nodeId', () => ({ success: true }))

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/admin/consumers', ({ queryParams }) => {
  const q = (queryParams['q'] ?? '').toLowerCase()
  let users = MOCK_USERS
  if (q) {
    users = users.filter((u) => u.username.toLowerCase().includes(q) || (u.phone ?? '').includes(q))
  }
  return {
    items: users.map((u) => ({
      ...u,
      abuseFlags: MOCK_ABUSE_FLAGS.filter((f) => f.entityId === u.id),
    })),
    nextCursor: null,
    hasMore: false,
  }
})

register('POST', '/v1/admin/consumers/:userId/:action', () => ({ success: true }))

register('GET', '/v1/admin/businesses', () => ({
  items: MOCK_BUSINESSES,
  nextCursor: null,
  hasMore: false,
}))

register('POST', '/v1/admin/businesses/:businessId/:action', () => ({ success: true }))

register('GET', '/v1/admin/reports', () => state.reports)

register('POST', '/v1/admin/reports/:reportId/:action', ({ pathParams }) => {
  const report = state.reports.find((r) => r.id === pathParams['reportId'])
  if (report) {
    const action = pathParams['action'] as string
    if (action === 'reviewed' || action === 'review') report.status = 'reviewed'
    else if (action === 'dismissed' || action === 'dismiss') report.status = 'dismissed'
    else if (action === 'actioned' || action === 'action') report.status = 'actioned'
  }
  return { success: true }
})

register('GET', '/v1/admin/consent', () => state.consents)

register('GET', '/v1/admin/consent/export-reconsent', () => {
  return state.consents.filter((c) => c.consentVersion !== CURRENT_CONSENT_VERSION)
})

register('GET', '/v1/admin/erasure-queue', () => [])

// ---------------------------------------------------------------------------
// Staff endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/staff/recent-redemptions', () => {
  return MOCK_REDEMPTIONS.filter((rd) => rd.redeemedAt).map((rd) => {
    const reward = MOCK_REWARDS.find((r) => r.id === rd.rewardId)
    const user = MOCK_USERS.find((u) => u.id === rd.userId)
    return {
      code: rd.redemptionCode,
      rewardTitle: reward?.title ?? 'Reward',
      displayName: user?.displayName ?? 'Unknown',
      redeemedAt: rd.redeemedAt,
    }
  })
})

// ---------------------------------------------------------------------------
// Crowd Vibe endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/nodes/:nodeId/crowd-vibe', ({ pathParams }) => {
  return buildCrowdVibeSnapshot(pathParams['nodeId']!)
})

register('POST', '/v1/users/me/streaming/connect', ({ body }) => {
  const { provider } = (body ?? {}) as { provider?: string }
  state.currentUser = { ...state.currentUser, streamingProvider: provider as 'spotify' | 'apple_music' }
  return { success: true, provider, genres: ['amapiano', 'deep_house', 'hip_hop'] }
})

register('DELETE', '/v1/users/me/streaming/disconnect', () => {
  state.currentUser = { ...state.currentUser, streamingProvider: null }
  return { success: true }
})

register('PATCH', '/v1/users/me/genres', ({ body }) => {
  const { musicGenres } = (body ?? {}) as { musicGenres?: string[] }
  if (!musicGenres || musicGenres.length < 1) {
    return { error: 'validation_error', message: 'At least 1 genre required', statusCode: 400 }
  }
  if (musicGenres.length > 5) {
    return { error: 'validation_error', message: 'Maximum 5 genres allowed', statusCode: 400 }
  }
  state.currentUser = { ...state.currentUser, musicGenres: musicGenres as MusicGenre[] }
  return { success: true, musicGenres }
})

register('GET', '/v1/business/me/audience/music', () => {
  return buildBusinessMusicAudience()
})

// ---------------------------------------------------------------------------
// Admin archetype & genre-weight endpoints
// ---------------------------------------------------------------------------
register('GET', '/v1/admin/archetypes', () => {
  return [...ARCHETYPE_CATALOG].sort((a, b) => b.priority - a.priority)
})

register('POST', '/v1/admin/archetypes', ({ body }) => {
  return { id: generateId(), ...(body as object), success: true }
})

register('PATCH', '/v1/admin/archetypes/:id', ({ body }) => {
  return { success: true, ...(body as object) }
})

register('POST', '/v1/admin/archetypes/test', ({ body }) => {
  const { genres } = (body ?? {}) as { genres?: MusicGenre[] }
  const scores = computeDimensionScores(genres ?? [], GENRE_WEIGHT_MATRIX)
  const resolved = resolveArchetype(scores, ARCHETYPE_CATALOG)
  const allMatches = scores
    ? ARCHETYPE_CATALOG
        .filter((a) => a.isActive && a.name !== 'The Eclectic' && a.name !== 'The Uncharted' && matchesArchetype(scores, a))
        .sort((a, b) => b.priority - a.priority)
    : []
  return { dimensionScores: scores, resolvedArchetype: resolved, allMatches }
})

register('GET', '/v1/admin/genre-weights', () => {
  return GENRE_WEIGHT_MATRIX
})

register('PATCH', '/v1/admin/genre-weights', ({ body }) => {
  return { success: true, ...(body as object) }
})

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------
export function resolve(method: string, fullPath: string, body?: unknown): unknown {
  // Split path and query string
  const [path, qs] = fullPath.split('?') as [string, string | undefined]
  const queryParams: Record<string, string> = {}
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=')
      if (k) queryParams[k] = decodeURIComponent(v ?? '')
    }
  }

  for (const route of routes) {
    if (route.method !== method) continue
    const match = route.pattern.exec(path!)
    if (!match) continue

    const pathParams: Record<string, string> = {}
    route.paramNames.forEach((name, i) => {
      pathParams[name] = match[i + 1]!
    })

    return route.handler({ method, path: path!, body, pathParams, queryParams })
  }

  console.warn(`[MockRouter] Unmatched route: ${method} ${fullPath}`)
  return { error: 'not_found', message: 'Mock route not registered', statusCode: 404 }
}

/** Exported for testing — returns the registered route count */
export function getRegisteredRouteCount(): number {
  return routes.length
}

/** Exported for testing — returns all registered route patterns */
export function getRegisteredRoutes(): Array<{ method: string; pattern: string }> {
  return routes.map((r) => ({ method: r.method, pattern: r.pattern.source }))
}

/** Exported for testing — reset mutable state */
export function resetState(): void {
  state.pulseScores = { ...MOCK_PULSE_SCORES }
  state.currentUser = { ...MOCK_USERS.find((u) => u.id === CURRENT_USER_ID)! }
  state.rewards = [...MOCK_REWARDS]
  state.reports = [...MOCK_REPORTS]
  state.consents = [...MOCK_CONSENT]
  state.userCheckInCount = MOCK_USERS.find((u) => u.id === CURRENT_USER_ID)!.totalCheckIns
  state.userStreak = 4
}
