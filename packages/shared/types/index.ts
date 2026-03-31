// Node states
export type NodeState = 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'

// Node categories
export type NodeCategory = 'food' | 'coffee' | 'nightlife' | 'retail' | 'fitness' | 'arts'

// User tiers
export type Tier = 'local' | 'regular' | 'fixture' | 'institution' | 'legend'

// Business tiers
export type BusinessTier = 'free' | 'starter' | 'growth' | 'pro' | 'payg'

// Check-in types
export type CheckInType = 'reward' | 'presence'

// Reward types (V1 only — referral and surprise are V2)
export type RewardType = 'nth_checkin' | 'daily_first' | 'streak' | 'milestone'

// Toast types with priority
export type ToastType = 'surge' | 'reward_pressure' | 'checkin' | 'reward_new' | 'streak' | 'leaderboard'

// Claim statuses
export type ClaimStatus = 'unclaimed' | 'pending' | 'claimed'
export type ClaimCipcStatus = 'validated' | 'pending_manual' | 'cipc_unavailable' | 'rejected'

// Report types
export type ReportType = 'wrong_location' | 'permanently_closed' | 'fake_rewards' | 'offensive_content' | 'other'
export type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'actioned'

// Abuse flag types
export type AbuseFlagType = 'device_velocity' | 'ip_subnet' | 'pulse_anomaly' | 'reward_drain' | 'new_account_velocity'
export type AbuseFlagEntityType = 'user' | 'node' | 'device'

// Admin roles
export type AdminRole = 'super_admin' | 'support_agent' | 'content_moderator'

// Push platforms
export type PushPlatform = 'expo' | 'web'

// Device platforms
export type DevicePlatform = 'web' | 'ios' | 'android'

// Music genres — 12 South African-relevant genres
export type MusicGenre =
  | 'amapiano' | 'deep_house' | 'afrobeats' | 'hip_hop' | 'rnb'
  | 'kwaito' | 'gqom' | 'jazz' | 'rock' | 'pop' | 'gospel' | 'maskandi'

// Personality dimensions — 5 scoring axes
export type PersonalityDimension =
  | 'energy' | 'cultural_rootedness' | 'sophistication' | 'edge' | 'spirituality'

// Dimension score vector — maps each dimension to 0.0–1.0
export type DimensionScoreVector = Record<PersonalityDimension, number>

// Streaming provider
export type StreamingProvider = 'spotify' | 'apple_music'

// Genre weight entry — one row of the 12×5 matrix
export interface GenreWeightEntry {
  genre: MusicGenre
  weights: DimensionScoreVector
}

// Personality archetype — stored in DB, managed by admins
export interface PersonalityArchetype {
  id: string
  name: string
  iconId: string
  description: string
  dimensionThresholds: Partial<Record<PersonalityDimension, number>>
  priority: number
  isActive: boolean
}

// Crowd vibe snapshot — aggregated per node
export interface CrowdVibeSnapshot {
  genreCounts: Partial<Record<MusicGenre, number>>
  archetypePercentages: Record<string, number>
  aggregateDimensionScores: DimensionScoreVector | null
  totalCheckedIn: number
}

// Business music audience data
export interface BusinessMusicAudience {
  genreDistribution: Partial<Record<MusicGenre, number>>
  archetypeBreakdown: Record<string, number>
  peakArchetypeByTime: Array<{
    timeSegment: string
    archetypeName: string
    archetypeIconId: string
  }>
  totalWithMusicPrefs: number
}

// Archetype test result (admin tool)
export interface ArchetypeTestResult {
  dimensionScores: DimensionScoreVector | null
  resolvedArchetype: PersonalityArchetype
  allMatches: PersonalityArchetype[]
}

// Core interfaces
export interface Node {
  id: string
  name: string
  slug: string
  category: NodeCategory
  lat: number
  lng: number
  cityId: string
  businessId: string | null
  submittedBy: string | null
  claimStatus: ClaimStatus
  claimCipcStatus: ClaimCipcStatus | null
  nodeColour: string
  nodeIcon: string | null
  qrCheckinEnabled: boolean
  isVerified: boolean
  isActive: boolean
  createdAt: string
}

export interface PulseScore {
  nodeId: string
  score: number
  state: NodeState
  checkInCount: number
}

export interface CheckIn {
  id: string
  userId: string
  nodeId: string
  type: CheckInType
  checkedInAt: string
}

export interface Reward {
  id: string
  nodeId: string
  type: RewardType
  title: string
  description: string | null
  triggerValue: number | null
  totalSlots: number | null
  claimedCount: number
  slotsLocked: boolean
  isActive: boolean
  expiresAt: string | null
  createdAt: string
}

export interface RewardRedemption {
  id: string
  rewardId: string
  userId: string
  redemptionCode: string
  codeExpiresAt: string
  redeemedAt: string | null
  createdAt: string
}

export interface User {
  id: string
  phone: string | null
  username: string
  displayName: string
  avatarUrl: string | null
  cityId: string | null
  neighbourhoodId: string | null
  tier: Tier
  totalCheckIns: number
  cognitoSub: string | null
  createdAt: string
  musicGenres?: MusicGenre[]
  dimensionScores?: DimensionScoreVector | null
  archetypeId?: string | null
  streamingProvider?: StreamingProvider | null
}

export interface BusinessAccount {
  id: string
  email: string
  businessName: string
  registrationNumber: string | null
  cognitoSub: string | null
  tier: BusinessTier
  trialEndsAt: string | null
  paymentGraceUntil: string | null
  yocoCustomerId: string | null
  isActive: boolean
  createdAt: string
}

export interface StaffAccount {
  id: string
  businessId: string
  name: string
  phone: string
  cognitoSub: string | null
  isActive: boolean
  createdAt: string
}

export interface Toast {
  id: string
  type: ToastType
  message: string
  nodeId?: string
  nodeLat?: number
  nodeLng?: number
  avatarUrl?: string
  priority: number
  timestamp: number
}

export interface ConsentRecord {
  id: string
  userId: string
  consentVersion: string
  analyticsOptIn: boolean
  consentedAt: string
}

export interface AbuseFlag {
  id: string
  type: AbuseFlagType
  entityId: string
  entityType: AbuseFlagEntityType
  evidenceJson: Record<string, unknown> | null
  reviewed: boolean
  autoActioned: boolean
  createdAt: string
}

export interface Report {
  id: string
  reporterId: string
  nodeId: string
  type: ReportType
  detail: string | null
  status: ReportStatus
  createdAt: string
}

export interface LeaderboardEntry {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  tier: Tier
  rank: number
  checkInCount: number
  isFriend: boolean
}

export interface City {
  id: string
  name: string
  slug: string
  country: string
}

export interface NotificationPreferences {
  streakAtRisk: boolean
  rewardActivated: boolean
  rewardClaimedPush: boolean
  leaderboardPrewarning: boolean
  followedUserCheckin: boolean
}

// MapInstance — generic interface abstracting Mapbox GL JS / @rnmapbox/maps
export interface MapInstance {
  flyTo(options: { center: [number, number]; zoom?: number }): void
  setFeatureState(feature: { source: string; id: string }, state: Record<string, unknown>): void
  getZoom(): number
  getBounds(): { toArray(): [[number, number], [number, number]] }
}

// Business room event payloads
export interface BusinessCheckinPayload {
  nodeId: string
  nodeName: string
  checkInCount: number
  avatarUrl?: string
  username?: string
  timestamp: string
}

export interface BusinessRewardClaimedPayload {
  nodeId: string
  nodeName: string
  rewardId: string
  rewardTitle: string
  timestamp: string
}

// Socket event types
export interface ServerToClientEvents {
  'node:pulse_update': (payload: { nodeId: string; pulseScore: number; checkInCount: number; state: NodeState }) => void
  'node:state_surge': (payload: { nodeId: string; fromState: NodeState; toState: NodeState }) => void
  'node:state_change': (payload: { nodeId: string; state: NodeState }) => void
  'toast:new': (payload: { type: ToastType; message: string; nodeId?: string; nodeLat?: number; nodeLng?: number; avatarUrl?: string }) => void
  'reward:claimed': (payload: { rewardId: string; rewardTitle: string; redemptionCode: string; codeExpiresAt: string }) => void
  'reward:slots_update': (payload: { rewardId: string; slotsRemaining: number }) => void
  'leaderboard:update': (payload: { userId: string; rank: number; delta: number }) => void
  'business:checkin': (payload: BusinessCheckinPayload) => void
  'business:reward_claimed': (payload: BusinessRewardClaimedPayload) => void
  'toast:friend_checkin': (payload: { type: 'checkin'; message: string; nodeId?: string; avatarUrl?: string }) => void
}

export interface ClientToServerEvents {
  'room:join': (payload: { room: string }) => void
  'room:leave': (payload: { room: string }) => void
  'presence:join': (payload: { nodeId: string }) => void
  'presence:leave': (payload: { nodeId: string }) => void
}

// Reward proximity (for node detail "one more visit" line)
export interface RewardProximity {
  rewardId: string
  rewardTitle: string
  stepsAway: 1
}

// Check-in request/response
export interface CheckInRequest {
  nodeId: string
  lat?: number
  lng?: number
  qrToken?: string
  type: CheckInType
}

export interface CheckInResponse {
  success: boolean
  cooldownUntil: string
}

// Paginated response
export interface PaginatedResponse<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}
