/**
 * E2E Test Mock Setup
 * ===================
 * Mocks external dependencies at the SERVICE layer so handlers
 * execute their routing/validation logic against mock backends.
 * Production code has ZERO mock logic — all mocks live here.
 */
import { vi } from 'vitest'

// ─── Auth Middleware ─────────────────────────────────────────────────────────
vi.mock('../shared/middleware/auth.js', () => {
  function parseDevToken(request: any) {
    const h = request.headers?.authorization
    if (!h?.startsWith('Bearer ')) return null
    const t = h.slice(7)
    return t.startsWith('dev-') ? t.slice(4) : t
  }
  return {
    requireAuth:
      (...roles: string[]) =>
      async (request: any) => {
        const userId = parseDevToken(request)
        if (!userId)
          throw { statusCode: 401, error: 'unauthorized', message: 'Missing or invalid Authorization header' }
        ;(request as any).auth = {
          userId,
          role: roles[0] ?? 'consumer',
          cognitoSub: `sub-${userId}`,
          citySlug: 'johannesburg',
          email: `${userId}@test.co.za`,
        }
      },
    optionalAuth: () => async (request: any) => {
      const userId = parseDevToken(request)
      if (userId) {
        ;(request as any).auth = { userId, role: 'consumer', cognitoSub: `sub-${userId}`, citySlug: 'johannesburg' }
      }
    },
    getAuth: (request: any) => {
      if (!request.auth) throw { statusCode: 401, error: 'unauthorized', message: 'Not authenticated' }
      return request.auth
    },
    getOptionalAuth: (request: any) => request.auth ?? null,
  }
})

// ─── Rate Limiter ────────────────────────────────────────────────────────────
vi.mock('../shared/middleware/rate-limit.js', () => ({
  rateLimitMiddleware: () => async () => {},
}))

// ─── Sentry ──────────────────────────────────────────────────────────────────
vi.mock('../shared/monitoring/sentry.js', () => ({
  initSentry: vi.fn().mockResolvedValue(undefined),
  captureError: vi.fn(),
}))

// ─── Privacy Guard ───────────────────────────────────────────────────────────
vi.mock('../shared/privacy/privacy-guard.js', () => ({
  initPrivacyGuard: vi.fn(),
  checkPrivacy: vi.fn().mockResolvedValue({ visibility: 'full', reason: 'public' }),
  filterByPrivacy: vi
    .fn()
    .mockImplementation(async (e: any[]) => e.map((x: any) => ({ ...x, privacyVisibility: 'full' }))),
  canEmitIdentity: vi.fn().mockResolvedValue(true),
  sanitizeForBusiness: vi.fn().mockImplementation((d: any) => d),
}))

// ─── Cognito Client ─────────────────────────────────────────────────────────
vi.mock('../shared/cognito/client.js', () => ({
  initiateAuth: vi.fn().mockResolvedValue({ session: 'mock-session' }),
  respondToAuthChallenge: vi
    .fn()
    .mockResolvedValue({ accessToken: 'mock-at', refreshToken: 'mock-rt', idToken: 'mock-id' }),
  signUpUser: vi.fn().mockResolvedValue(undefined),
  getCognitoUser: vi.fn().mockResolvedValue({ sub: 'mock-sub', attributes: {} }),
  getConsumerVerifiedEmailBySub: vi.fn().mockResolvedValue('t@t.co.za'),
  updateUserAttributes: vi.fn().mockResolvedValue(undefined),
  updateUserAttributesByCognitoSub: vi.fn().mockResolvedValue(undefined),
  createEmailPasswordUser: vi.fn().mockResolvedValue({ sub: 'mock-sub' }),
  passwordAuth: vi.fn().mockResolvedValue({ accessToken: 'mock-at', refreshToken: 'mock-rt' }),
  adminLogin: vi.fn().mockResolvedValue({ accessToken: 'mock-at', refreshToken: 'mock-rt', sub: 'mock-sub' }),
  getCognitoUserAttrsBySub: vi.fn().mockResolvedValue({ 'custom:admin_role': 'super_admin' }),
  listAdminUsers: vi.fn().mockResolvedValue([]),
  createAdminUser: vi.fn().mockResolvedValue({ sub: 'new-sub' }),
  setAdminUserRole: vi.fn().mockResolvedValue(undefined),
  disableCognitoUser: vi.fn().mockResolvedValue(undefined),
}))

// ─── KV Store ────────────────────────────────────────────────────────────────
vi.mock('../shared/kv/dynamodb-kv.js', () => ({
  kvGet: vi.fn().mockResolvedValue(null),
  kvSet: vi.fn().mockResolvedValue(undefined),
  kvDel: vi.fn().mockResolvedValue(undefined),
  kvIncr: vi.fn().mockResolvedValue(1),
  kvTtl: vi.fn().mockResolvedValue(60),
}))

// ─── SMS Feedback ────────────────────────────────────────────────────────────
vi.mock('../shared/sms/feedback.js', () => ({
  reportOtpFeedback: vi.fn().mockResolvedValue(undefined),
}))

// ─── Auth Repository ─────────────────────────────────────────────────────────
const mockUser = {
  userId: 'test-consumer-1',
  username: 'testuser',
  displayName: 'Test User',
  phone: '+27601234567',
  cognitoSub: 'mock-sub',
  tier: 'local',
  cityId: 'city-jhb',
  totalCheckIns: 5,
  streakCount: 2,
  streakStartDate: new Date().toISOString(),
  privacyLevel: 'public',
  isDisabled: false,
  avatarUrl: null,
}

vi.mock('../features/auth/repository.js', () => ({
  findUserByPhone: vi.fn().mockResolvedValue(null),
  findUserByUsername: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue(mockUser),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  getUserByCognitoSub: vi.fn().mockResolvedValue(mockUser),
  createUser: vi
    .fn()
    .mockImplementation(async (d: any) => ({ userId: `user-${Date.now()}`, ...d, tier: 'local', totalCheckIns: 0 })),
  getCityBySlug: vi.fn().mockResolvedValue({ id: 'city-jhb', slug: 'johannesburg', name: 'Johannesburg' }),
  insertConsentRecord: vi.fn().mockResolvedValue(undefined),
  updateUser: vi.fn().mockResolvedValue(mockUser),
  findStaffByPhone: vi.fn().mockResolvedValue(null),
  getStaffById: vi.fn().mockResolvedValue({ staffId: 'staff-1', businessId: 'biz-1' }),
}))

// ─── Auth DynamoDB Repository ────────────────────────────────────────────────
vi.mock('../features/auth/dynamodb-repository.js', () => ({
  getUserById: vi.fn().mockResolvedValue(mockUser),
  getUserByCognitoSub: vi.fn().mockResolvedValue({ userId: 'test-consumer-1', cognitoSub: 'sub-test' }),
  getStaffByCognitoSub: vi.fn().mockResolvedValue({ staffId: 'staff-1', businessId: 'biz-1' }),
}))

// ─── Session Service ─────────────────────────────────────────────────────────
vi.mock('../features/auth/session-service.js', () => ({
  createLoginSession: vi.fn().mockResolvedValue({ sessionId: 'mock-sess' }),
  listSessions: vi.fn().mockResolvedValue([]),
  revokeSession: vi.fn().mockResolvedValue(undefined),
  revokeAllSessions: vi.fn().mockResolvedValue(undefined),
  getUserSessions: vi.fn().mockResolvedValue([]),
  deleteLoginSession: vi.fn().mockResolvedValue(undefined),
  revokeAllOtherSessions: vi.fn().mockResolvedValue(undefined),
}))

// ─── Business Repository ─────────────────────────────────────────────────────
vi.mock('../features/business/repository.js', () => ({
  findBusinessByCognitoSub: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  getBusinessById: vi.fn().mockResolvedValue({ businessId: 'biz-1', name: 'Test Biz', plan: 'free' }),
  createBusiness: vi.fn().mockImplementation(async (d: any) => ({ businessId: `biz-${Date.now()}`, ...d })),
  updateBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
}))

// ─── Social Repositories ─────────────────────────────────────────────────────
vi.mock('../features/social/repository.js', () => ({
  isFollowing: vi.fn().mockResolvedValue(false),
  follow: vi.fn().mockResolvedValue(undefined),
  unfollow: vi.fn().mockResolvedValue(undefined),
  getFollowers: vi.fn().mockResolvedValue([]),
  getFollowing: vi.fn().mockResolvedValue([]),
  getMutualFollows: vi.fn().mockResolvedValue([]),
}))

vi.mock('../features/social/block-repository.js', () => ({
  isBlocked: vi.fn().mockResolvedValue(false),
  blockUser: vi.fn().mockResolvedValue(undefined),
  unblockUser: vi.fn().mockResolvedValue(undefined),
  getBlockedUsers: vi.fn().mockResolvedValue([]),
}))

// ─── Auth Service (consumer/business/staff/admin/shared/profile/utils) ──────
vi.mock('../features/auth/service.js', () => ({
  consumerSignup: vi.fn().mockResolvedValue({ userId: 'new-user-1', message: 'OTP sent' }),
  consumerLogin: vi.fn().mockResolvedValue({ success: true }),
  consumerVerifyOtp: vi.fn().mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    sessionId: 'sid',
    user: { id: 'u1', username: 'u', displayName: 'U', tier: 'local' },
  }),
  consumerOAuthSync: vi.fn().mockResolvedValue({ userId: 'u1', sessionId: 's1' }),
  consumerEmailSignup: vi
    .fn()
    .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', sessionId: 'sid', user: { id: 'u1' } }),
  consumerEmailLogin: vi
    .fn()
    .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', sessionId: 'sid', user: { id: 'u1' } }),
  businessSignup: vi.fn().mockResolvedValue({ businessId: 'biz-new', message: 'OTP sent' }),
  businessLogin: vi.fn().mockResolvedValue({ success: true }),
  businessVerifyOtp: vi
    .fn()
    .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', sessionId: 'sid', businessId: 'biz-1' }),
  staffLogin: vi.fn().mockResolvedValue({ success: true }),
  staffVerifyOtp: vi.fn().mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    sessionId: 'sid',
    staff: { id: 'staff-1', businessId: 'biz-1' },
  }),
  adminLogin: vi
    .fn()
    .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', adminId: 'admin-1', role: 'super_admin' }),
  refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-at' }),
  getAccountType: vi.fn().mockResolvedValue('consumer'),
  suggestedUsernameFromEmail: vi.fn().mockReturnValue('testuser'),
  checkOtpRateLimit: vi.fn().mockResolvedValue(undefined),
  getUserProfile: vi.fn().mockResolvedValue(mockUser),
  completeOnboarding: vi.fn().mockResolvedValue(undefined),
  updateProfile: vi.fn().mockResolvedValue(mockUser),
  getCheckInHistory: vi.fn().mockResolvedValue({ items: [], cursor: null }),
  deleteCheckInHistory: vi.fn().mockResolvedValue(undefined),
  updateConsent: vi.fn().mockResolvedValue({ success: true }),
  getUserConsent: vi.fn().mockResolvedValue({ consentVersion: 'v1.0', analyticsOptIn: true }),
  requestAccountDeletion: vi.fn().mockResolvedValue({ success: true, message: 'Deletion queued' }),
  acceptStaffInvite: vi.fn().mockResolvedValue({ success: true }),
  revokeUserTokens: vi.fn().mockResolvedValue(undefined),
  createLoginSession: vi.fn().mockResolvedValue({ sessionId: 'mock-sess' }),
  getUserSessions: vi.fn().mockResolvedValue([]),
  revokeSession: vi.fn().mockResolvedValue({ success: true }),
  revokeAllOtherSessions: vi.fn().mockResolvedValue({ success: true }),
  deleteLoginSession: vi.fn().mockResolvedValue(undefined),
}))

// ─── Node Service ────────────────────────────────────────────────────────────
vi.mock('../features/nodes/service.js', () => ({
  getTrendingNodes: vi.fn().mockResolvedValue({ items: [] }),
  searchNodes: vi.fn().mockResolvedValue([]),
  getNodesByCity: vi.fn().mockResolvedValue([]),
  getNodesByCitySlug: vi.fn().mockResolvedValue([]),
  getNodeDetail: vi.fn().mockResolvedValue({ id: 'n1', name: 'Test Node', category: 'food' }),
  getNodePublic: vi.fn().mockResolvedValue({ id: 'n1', name: 'Test Node', category: 'food' }),
  createNode: vi.fn().mockResolvedValue({ id: 'n-new', name: 'New Node' }),
  businessCreateNode: vi.fn().mockResolvedValue({ id: 'n-new', name: 'New Node' }),
  updateNode: vi.fn().mockResolvedValue({ id: 'n1' }),
  claimNode: vi.fn().mockResolvedValue({ success: true }),
  reportNode: vi.fn().mockResolvedValue(undefined),
  getWhoIsHere: vi.fn().mockResolvedValue({ totalCount: 0, tierDistribution: {}, friends: [] }),
  getCrowdVibe: vi.fn().mockResolvedValue({ topGenres: [], archetype: null }),
  getQrToken: vi.fn().mockResolvedValue({ token: 'mock-qr' }),
  getNodeRewards: vi.fn().mockResolvedValue([]),
  createPresignedUpload: vi.fn().mockResolvedValue({ url: 'https://s3.mock', key: 'k' }),
  registerNodeImage: vi.fn().mockResolvedValue({ imageId: 'img-1' }),
}))

// ─── Check-In Service ────────────────────────────────────────────────────────
vi.mock('../features/check-in/service.js', () => ({
  processCheckIn: vi
    .fn()
    .mockResolvedValue({ success: true, cooldownUntil: new Date(Date.now() + 3600000).toISOString() }),
}))

// ─── Reward Service ──────────────────────────────────────────────────────────
vi.mock('../features/rewards/service.js', () => ({
  getRewardsNearMe: vi.fn().mockResolvedValue([]),
  getUnclaimedRewards: vi.fn().mockResolvedValue([]),
  getBusinessRewards: vi.fn().mockResolvedValue([]),
  createReward: vi.fn().mockResolvedValue({ id: 'r-new' }),
  updateReward: vi.fn().mockResolvedValue({ id: 'r1' }),
  redeemReward: vi.fn().mockResolvedValue({ success: true, rewardTitle: 'Test', redeemedAt: new Date().toISOString() }),
  previewRedemption: vi.fn().mockResolvedValue({ rewardTitle: 'Test', valid: true }),
  confirmRedemption: vi.fn().mockResolvedValue({ success: true }),
  getRecentRedemptions: vi.fn().mockResolvedValue({ items: [] }),
  getStaffRecentRedemptions: vi.fn().mockResolvedValue({ items: [] }),
}))

// ─── Reward Repository ───────────────────────────────────────────────────────
vi.mock('../features/rewards/repository.js', () => ({
  findRedemptionByCode: vi.fn().mockResolvedValue(null),
  getRewardById: vi.fn().mockResolvedValue(null),
}))

// ─── Social Service ──────────────────────────────────────────────────────────
vi.mock('../features/social/service.js', () => ({
  followUser: vi.fn().mockResolvedValue(undefined),
  unfollowUser: vi.fn().mockResolvedValue(undefined),
  getActivityFeed: vi.fn().mockResolvedValue({ items: [] }),
  getNearbyRecentEvent: vi.fn().mockResolvedValue(null),
  getCityLeaderboard: vi.fn().mockResolvedValue([]),
  getWhoIsHere: vi.fn().mockResolvedValue({ totalCount: 0, friends: [] }),
  getFriendsList: vi.fn().mockResolvedValue([]),
  getFollowingList: vi.fn().mockResolvedValue([]),
  getFollowersList: vi.fn().mockResolvedValue([]),
  searchUsers: vi.fn().mockResolvedValue([]),
}))

// ─── Business Service ────────────────────────────────────────────────────────
vi.mock('../features/business/service.js', () => ({
  getBusinessProfile: vi.fn().mockResolvedValue({ businessId: 'biz-1', name: 'Test Biz' }),
  updateBusinessProfile: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  getLiveStats: vi.fn().mockResolvedValue({ activeVisitors: 0, todayCheckIns: 0 }),
  getBusinessNodes: vi.fn().mockResolvedValue([]),
  getAudienceAnalytics: vi.fn().mockResolvedValue({}),
  getRecentRedemptions: vi.fn().mockResolvedValue([]),
  getBusinessRewards: vi.fn().mockResolvedValue([]),
  getCurrentNodeQr: vi.fn().mockResolvedValue({ token: 'qr' }),
  getPlans: vi.fn().mockResolvedValue([{ id: 'free', name: 'Free' }]),
  startTrial: vi.fn().mockResolvedValue({ success: true }),
  createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout' }),
  purchaseBoost: vi.fn().mockResolvedValue({ success: true }),
  processYocoWebhook: vi.fn().mockResolvedValue({ received: true }),
  inviteStaff: vi.fn().mockResolvedValue({ inviteId: 'inv-1' }),
  listStaff: vi.fn().mockResolvedValue([]),
  listStaffInvites: vi.fn().mockResolvedValue([]),
  removeStaff: vi.fn().mockResolvedValue(undefined),
  getQrData: vi.fn().mockResolvedValue({ qr: 'data' }),
  getCheckInDetails: vi.fn().mockResolvedValue({ items: [] }),
  getRewardMetrics: vi.fn().mockResolvedValue({}),
  getRewardsSummary: vi.fn().mockResolvedValue({}),
}))

// ─── Music Service ───────────────────────────────────────────────────────────
vi.mock('../features/music/service.js', () => ({
  updateGenres: vi.fn().mockResolvedValue({ success: true }),
  connectStreaming: vi.fn().mockResolvedValue({ success: true }),
  handleSpotifyCallback: vi.fn().mockResolvedValue('https://app/callback'),
  disconnectStreaming: vi.fn().mockResolvedValue(undefined),
  getCrowdVibe: vi.fn().mockResolvedValue({ topGenres: [], archetype: null }),
  getBusinessAudienceMusic: vi.fn().mockResolvedValue({ topGenres: [] }),
}))

// ─── Notification Service ────────────────────────────────────────────────────
vi.mock('../features/notifications/service.js', () => ({
  registerPushToken: vi.fn().mockResolvedValue(undefined),
  getPreferences: vi.fn().mockResolvedValue({ streakAtRisk: true }),
  updatePreferences: vi.fn().mockResolvedValue({ streakAtRisk: true }),
  getNotificationHistory: vi.fn().mockResolvedValue([]),
  markAllNotificationsAsRead: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── Privacy Service ─────────────────────────────────────────────────────────
vi.mock('../features/privacy/service.js', () => ({
  getPrivacySettings: vi.fn().mockResolvedValue({ privacyLevel: 'public' }),
  updatePrivacyLevel: vi.fn().mockResolvedValue({ privacyLevel: 'friends_only' }),
  blockUserAction: vi.fn().mockResolvedValue(undefined),
  unblockUserAction: vi.fn().mockResolvedValue(undefined),
  listBlockedUsers: vi.fn().mockResolvedValue([]),
  submitReport: vi.fn().mockResolvedValue({ reportId: 'rpt-1' }),
}))

// ─── Staff Service ───────────────────────────────────────────────────────────
vi.mock('../features/staff/service.js', () => ({
  previewRedemption: vi.fn().mockResolvedValue({ rewardTitle: 'Test', valid: true }),
  confirmRedemption: vi.fn().mockResolvedValue({ success: true }),
  getRecentRedemptions: vi.fn().mockResolvedValue({ items: [] }),
}))

// ─── Admin Service ───────────────────────────────────────────────────────────
vi.mock('../features/admin/service.js', () => ({
  searchConsumers: vi.fn().mockResolvedValue([]),
  searchBusinesses: vi.fn().mockResolvedValue([]),
  getDashboardMetrics: vi.fn().mockResolvedValue({ totalUsers: 0, totalCheckIns: 0 }),
  getReportQueue: vi.fn().mockResolvedValue([]),
  getAbuseFlags: vi.fn().mockResolvedValue([]),
  getAuditLogs: vi.fn().mockResolvedValue({ items: [] }),
  listConsents: vi.fn().mockResolvedValue([]),
  getErasureQueue: vi.fn().mockResolvedValue([]),
  getArchetypes: vi.fn().mockResolvedValue([]),
  getGenreWeights: vi.fn().mockResolvedValue({}),
  getConsentHistory: vi.fn().mockResolvedValue([]),
  getReconsentList: vi.fn().mockResolvedValue([]),
  consumerAction: vi.fn().mockResolvedValue({ success: true }),
  businessAction: vi.fn().mockResolvedValue({ success: true }),
  actionReport: vi.fn().mockResolvedValue({ success: true }),
  actionAbuseFlag: vi.fn().mockResolvedValue({ success: true }),
  reviewAbuseFlag: vi.fn().mockResolvedValue({ success: true }),
  getUser: vi.fn().mockResolvedValue(mockUser),
  getBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  getUserCheckInHistory: vi.fn().mockResolvedValue({ items: [] }),
  resetAbuseFlags: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue({ success: true }),
  extendTrial: vi.fn().mockResolvedValue({ success: true }),
  setBusinessTier: vi.fn().mockResolvedValue({ success: true }),
  getBusinessStaff: vi.fn().mockResolvedValue([]),
  revokeStaffAccess: vi.fn().mockResolvedValue({ success: true }),
  startImpersonation: vi.fn().mockResolvedValue({ token: 'imp-token' }),
  disableUser: vi.fn().mockResolvedValue({ success: true }),
  disableBusiness: vi.fn().mockResolvedValue({ success: true }),
  createArchetype: vi.fn().mockResolvedValue({ id: 'a1' }),
  updateArchetype: vi.fn().mockResolvedValue({ id: 'a1' }),
  testArchetype: vi.fn().mockResolvedValue({ archetype: 'test' }),
  updateGenreWeights: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── Report Service (business reports) ───────────────────────────────────────
vi.mock('../features/reports/service.js', () => ({
  listReports: vi.fn().mockResolvedValue({ items: [] }),
  getReport: vi.fn().mockResolvedValue(null),
}))

// ─── Helmet (security headers plugin) ────────────────────────────────────────
vi.mock('@fastify/helmet', () => ({
  default: vi.fn().mockImplementation(async (app: any) => {
    app.addHook('onSend', async (_req: any, reply: any) => {
      reply.header('x-content-type-options', 'nosniff')
      reply.header('x-frame-options', 'DENY')
      reply.header('referrer-policy', 'strict-origin-when-cross-origin')
      reply.header('permissions-policy', 'camera=(), microphone=()')
    })
  }),
}))
