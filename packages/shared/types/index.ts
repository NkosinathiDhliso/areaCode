import type { SocialLinks } from '../constants/social-platforms'

// Social handles are re-exported here so callers can import venue-related
// types from one place (`@area-code/shared/types`). The single source of truth
// for the platform list and validation lives in `constants/social-platforms`.
export type { SocialLinks, SocialPlatform } from '../constants/social-platforms'

// Node states
export type NodeState = 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'

/**
 * Honest presence momentum for a venue: whether the Live_Presence_Count is
 * rising, falling, or flat over a trailing window. Derived only from real
 * check-ins plus real departures (check-out + expiry), so `winding_down` can
 * never be shown without a genuine way for people to leave (honest-presence
 * rule 5). `steady` is also the "not enough data to claim a trend" value, so a
 * surface renders no momentum label rather than over-claiming.
 */
export type VenueMomentum = 'filling_up' | 'winding_down' | 'steady'

// Node categories
export type NodeCategory = 'food' | 'coffee' | 'nightlife' | 'retail' | 'fitness' | 'arts'

// User tiers
export type Tier = 'local' | 'regular' | 'fixture' | 'institution' | 'legend'

// Privacy levels
export type PrivacyLevel = 'public' | 'friends_only' | 'private'

// Business tiers
export type BusinessTier = 'free' | 'starter' | 'growth' | 'pro' | 'payg'

// Paid subscription billing interval (billing-revenue-integrity). Null on a
// business means no interval was bought — an admin Comp_Window, a legacy row, or
// a never-paid business.
export type PaidInterval = 'daily' | 'weekly' | 'monthly' | 'yearly'

// Check-in types
export type CheckInType = 'reward' | 'presence'

// Reward types (V1 only , referral and surprise are V2)
export type RewardType = 'nth_checkin' | 'daily_first' | 'streak' | 'milestone'

// Toast types with priority
export type ToastType =
  | 'surge'
  | 'city_pulse'
  | 'reward_pressure'
  | 'friend_checkin'
  | 'checkin'
  | 'reward_new'
  | 'streak'
  | 'leaderboard'

// Claim statuses
export type ClaimStatus = 'unclaimed' | 'pending' | 'claimed'
export type ClaimCipcStatus =
  | 'validated'
  | 'pending_manual'
  | 'cipc_unavailable'
  | 'manual_review'
  | 'admin_override'
  | 'rejected'

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

// Music genres , 12 South African-relevant genres
export type MusicGenre =
  | 'amapiano'
  | 'deep_house'
  | 'afrobeats'
  | 'hip_hop'
  | 'rnb'
  | 'kwaito'
  | 'gqom'
  | 'jazz'
  | 'rock'
  | 'pop'
  | 'gospel'
  | 'maskandi'

// Personality dimensions , 5 scoring axes
export type PersonalityDimension = 'energy' | 'cultural_rootedness' | 'sophistication' | 'edge' | 'spirituality'

// Dimension score vector , maps each dimension to 0.0-1.0
export type DimensionScoreVector = Record<PersonalityDimension, number>

// Streaming provider
export type StreamingProvider = 'spotify' | 'apple_music'

// Genre weight entry , one row of the 12×5 matrix
export interface GenreWeightEntry {
  genre: MusicGenre
  weights: DimensionScoreVector
}

// Music schedule day-of-week , two-letter ISO-style code (3-letter uppercase per design)
export type ScheduleDayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'

// Schedule slot mode , blanket = single genre set; lineup = ordered DJ entries
export type ScheduleSlotMode = 'blanket' | 'lineup'

// Lineup entry , one DJ slot inside a lineup-mode Schedule_Slot.
// `startTime` must equal the parent slot's `startTime` for index 0 (R3.7).
export interface LineupEntry {
  startTime: string // HH:mm
  startTimeMin: number // 0..1439, derived from startTime
  djName?: string
  genres: MusicGenre[]
}

// Schedule slot , one contiguous, half-open `[startTime, endTime)` segment
// of a venue's weekly Music_Schedule. The `startTimeMin` / `endTimeMin`
// fields are stored alongside `HH:mm` so ordering is cheap and cannot drift
// from the human-readable form (design Data Models).
export interface ScheduleSlot {
  slotId: string
  dayOfWeek: ScheduleDayOfWeek
  startTime: string // HH:mm
  endTime: string // HH:mm
  startTimeMin: number // 0..1439
  endTimeMin: number // 0..1439
  mode: ScheduleSlotMode
  genres?: MusicGenre[] // present iff mode === 'blanket'
  lineup?: LineupEntry[] // present iff mode === 'lineup'
}

// Music schedule , a venue's weekly programming, denormalised into slots.
// `timezone` is an IANA tz database id (e.g. "Africa/Johannesburg").
export interface MusicSchedule {
  businessId: string
  scheduleId: string
  timezone: string // IANA timezone id
  slots: ScheduleSlot[]
  updatedAt: string // ISO-8601 ms
  schemaVersion: 1
}

// Live_Archetype resolver branch , surfaced for observability and emitted
// on `node:archetype_change` so consumers can debug without a backend
// round-trip (design Components and Interfaces, R7.11).
export type LiveArchetypeBranch =
  | 'schedule_lineup'
  | 'schedule_blanket'
  | 'checkin_mode'
  | 'default'
  | 'eclectic_fallback'
  | 'declared_promise' // below Presence_Floor, showing the venue's declared intent (live-vibe-declaration)
  | 'crowd_live' // at/above Presence_Floor, showing the real crowd vibe (live-vibe-declaration)

// Personality archetype , stored in DB, managed by admins
export interface PersonalityArchetype {
  id: string
  name: string
  iconId: string
  description: string
  dimensionThresholds: Partial<Record<PersonalityDimension, number>>
  priority: number
  isActive: boolean
}

// Crowd vibe snapshot , aggregated per node
export interface CrowdVibeSnapshot {
  genreCounts: Partial<Record<MusicGenre, number>>
  archetypePercentages: Record<string, number>
  aggregateDimensionScores: DimensionScoreVector | null
  totalCheckedIn: number
}

// ─── Business analytics: Insufficient_Data_State contract ───────────────────
// A metric group is either a computed value or `null` (the wire signal for
// "not enough data yet"). Music audience carries an explicit
// `hasInsufficientData` flag. A hardcoded `0`/`{}`/`[]` is never a real value.
// See .kiro/specs/business-intelligence-honesty/design.md and honest-presence.md.

// Live panel payload: GET /v1/business/me/live-stats
export interface LiveStats {
  checkInsToday: number
  totalCheckIns: number
  rewardsClaimed: number
  // null => pulse unavailable; the Live panel omits the tile rather than showing 0.
  pulseScore: number | null
}

// Audience panel payload: GET /v1/business/me/audience
export interface AudienceAnalytics {
  totalUniqueVisitors: number
  // null => not enough data yet; the panel renders its honest empty state.
  repeatVsNew: { repeat: number; new: number } | null
  tierDistribution: Record<string, number> | null
  peakHours: string[] | null
}

// Business music audience data: GET /v1/business/me/audience/music
export interface BusinessMusicAudience {
  // true => not enough visitors have music prefs; MusicInsightsSection shows
  // its honest "not enough music data" state.
  hasInsufficientData: boolean
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
  claimRegistrationNumber?: string | null
  nodeColour: string
  nodeIcon: string | null
  qrCheckinEnabled: boolean
  isVerified: boolean
  isActive: boolean
  headerImageKey?: string | null
  /** Venue social handles, one per platform, stored without a leading @. */
  socialLinks?: SocialLinks
  createdAt: string
  /**
   * The owning business's subscription tier, passed through from the
   * paid-tier filter in `getNodesByCitySlug`. Drives the tier-based
   * glyph size multiplier on the map (R8.1). Defaults to `'starter'`
   * when absent on the client.
   */
  businessTier?: BusinessTier
  /**
   * Optional fallback Archetype id used by the Live_Archetype resolver
   * (R7.7) when no Active_Slot exists and the 90-min check-in window
   * carries no catalog archetypeId. Stored as `defaultArchetypeId` on
   * the Node row (design Data Models, "Existing tables touched"). Absent
   * or unknown ids fall through to `archetype-eclectic` per R7.8.
   */
  defaultArchetypeId?: string | null
  /**
   * Cache of the previously emitted Live_Archetype id, written by the
   * `live-archetype-evaluator` Lambda so subsequent Evaluation_Ticks
   * can dedupe `node:archetype_change` events (design § R11). Not used
   * by the pure resolver - kept here so the Node row is the single
   * source of truth for the cache.
   */
  lastArchetypeId?: string | null
  /**
   * Cache of the previously emitted Resolution_Branch, written by the
   * `live-archetype-evaluator` Lambda alongside `lastArchetypeId` so the
   * evaluator can feed `previousBranch` into `resolveLiveArchetype` for
   * downward presence-grace (stay `crowd_live` until the qualifying
   * count drops below `Presence_Floor - Presence_Grace`)
   * (live-vibe-declaration design § Presence-grace, R3.1). Not used by
   * the pure resolver directly - kept here so the Node row is the single
   * source of truth for the cache. Absent ⇒ treated as `null`.
   */
  lastBranch?: LiveArchetypeBranch | null
  /**
   * Current Live_Archetype id carried on the live nodes payload (R11.1).
   * Populated by the backend on the read path (initial REST fetch and
   * post-reconnect replays) so the consumer client can prime
   * `useMapStore.archetypeIds` without waiting for a `node:archetype_change`
   * event. Stub field - the backend wire surface that fills it ships in a
   * later task; the consumer hook (`useNodeArchetype`) tolerates it being
   * absent.
   */
  liveArchetypeId?: string | null
  /**
   * Optional pulse seed from `GET /v1/nodes/:citySlug` so Constellation beams
   * render aliveness on first paint before the first socket event.
   */
  pulseScore?: number
  /** Live presence count seeded from the nodes list (honest read model). */
  liveCheckInCount?: number
  /**
   * End of the paid Boost_Window as an ISO 8601 ms UTC instant, passed through
   * from the node read paths (billing R5.2). Absent/null means no active boost.
   * This is a PAID reach signal, kept strictly separate from pulse/aliveness
   * (honest-presence): it never feeds the live count or beam brightness.
   */
  boostUntil?: string | null
  /**
   * Computed at read time on the server as `boostUntil > now` (billing R5.2,
   * R5.5). No expiry worker: once the window passes this reads false on the
   * next refresh with no residue. Consumed by `vibeRank` inside the level-3
   * tier signal only (boost first, then tier) and never allowed to outrank
   * taste-match or aliveness, per discovery-dna-vibe-over-convenience.
   */
  boostActive?: boolean
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

// Get category discriminator (event/offer gets). Absent => treated as 'loyalty'.
export type GetCategory = 'loyalty' | 'event' | 'offer'

// Lifecycle state for event/offer gets, derived from [startsAt, endsAt) at read time.
export type GetLifecycle = 'upcoming' | 'live' | 'ended'

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
  // Event & Offer gets (additive, optional on disk; absent getCategory => loyalty)
  getCategory?: GetCategory
  startsAt?: string
  endsAt?: string
  claimRequiresCheckIn?: boolean
  lifecycle?: GetLifecycle
  // Loyalty repeat redemption (additive, optional on disk; absent reads as 'once').
  // Valid as 'per_visit' only on loyalty nth_checkin gets.
  repeatPolicy?: RepeatPolicy
}

// Repeat behaviour of a loyalty get. Absent on disk reads as 'once'.
export type RepeatPolicy = 'once' | 'per_visit'

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
  citySlug?: string | null
  neighbourhoodId: string | null
  tier: Tier
  totalCheckIns: number
  cognitoSub: string | null
  createdAt: string
  musicGenres?: MusicGenre[]
  dimensionScores?: DimensionScoreVector | null
  archetypeId?: string | null
  streamingProvider?: StreamingProvider | null
  genresUpdatedAt?: string | null
  onboardingComplete?: boolean
  privacyLevel?: PrivacyLevel
  email?: string | null
  /** True once the user has confirmed their email via the verification link. */
  emailVerified?: boolean
  /**
   * Per-user opt-out for the GPS-proximity check-in nudge.
   * (Churn-defences spec, Requirement 4.6)
   * Defaults to true; the nudge is suppressed for `private` privacyLevel
   * regardless of this flag.
   */
  proximityNudgesEnabled?: boolean
}

export interface BusinessAccount {
  id: string
  email: string
  businessName: string
  registrationNumber: string | null
  cognitoSub: string | null
  tier: BusinessTier
  trialEndsAt: string | null
  // Paid_Until entitlement window (billing-revenue-integrity). Set by a paid
  // activation or an admin Comp_Window; null when no window is active. The
  // Tier_Resolver reads this alongside trial and grace to resolve the effective
  // tier (cross-portal-lifecycle-alignment R2.1).
  paidUntil: string | null
  paidInterval: PaidInterval | null
  paymentGraceUntil: string | null
  yocoCustomerId: string | null
  // Digest_Optout (weekly-attribution-digest R4.5). Disables the weekly digest
  // email; absent means emails are on. The dashboard card always renders.
  digestEmailOptOut?: boolean
  isActive: boolean
  createdAt: string
}

export interface StaffAccount {
  id: string
  businessId: string
  name: string
  phone?: string
  email?: string
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

/**
 * Consumer-facing consent status from GET /v1/users/me/consent. Carries the
 * current required consent version, the user's latest recorded version, and a
 * derived `needsReconsent` flag so the client can gate the re-consent prompt
 * without duplicating the comparison. `recordedVersion` is null when the user
 * has no recorded consent yet.
 */
export interface ConsentStatus {
  analyticsOptIn: boolean
  currentVersion: string
  recordedVersion: string | null
  needsReconsent: boolean
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

// MapInstance , generic interface abstracting Mapbox GL JS / @rnmapbox/maps
export interface MapInstance {
  flyTo(options: {
    center: [number, number]
    zoom?: number
    /**
     * Screen-space offset of the target center, in pixels [x, y]. Negative y
     * lifts the point above the container centre - used so a focused node is
     * not hidden behind the bottom sheet when it opens.
     */
    offset?: [number, number]
    duration?: number
    /**
     * Zoom level at the peak of the flight path (Mapbox `flyTo` `minZoom`). The
     * camera pulls back to this zoom mid-flight, then returns to the
     * destination zoom - the "rise up, fly over, descend" arc used for the 3D
     * dramatic venue-switch fly-through. Does not change where the camera ends.
     */
    minZoom?: number
    /**
     * Easing curve for the camera move, matching Mapbox's `easing` option:
     * maps animation progress `t` (0-1) to eased progress. Lets store-driven
     * fly-tos carry the shared `cameraEasing` motion signature.
     */
    easing?: (t: number) => number
  }): void
  setFeatureState(feature: { source: string; id: string }, state: Record<string, unknown>): void
  getZoom(): number
  /**
   * Current camera pitch in degrees (0 = top-down/flat, higher = tilted 3D).
   * Optional so lightweight test stubs need not implement it; callers treat an
   * absent reader as "pitch unknown / flat".
   */
  getPitch?(): number
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
  /**
   * Honest live-presence count for a venue. Dedicated event (NOT a repurpose of
   * `node:pulse_update.checkInCount`) so no existing consumer silently keeps
   * reading the old cumulative tally as if it were presence (founder decision
   * 13.4 / Requirement 8.4). Carries only `nodeId`, the new count, and the cause
   * - no consumer identity (Requirements 7.4, 10.4).
   */
  'node:presence_update': (payload: {
    nodeId: string
    livePresenceCount: number
    cause: 'check_in' | 'check_out' | 'expiry'
  }) => void
  'node:state_surge': (payload: { nodeId: string; fromState: NodeState; toState: NodeState }) => void
  'node:state_change': (payload: { nodeId: string; state: NodeState }) => void
  'node:created': (payload: {
    id: string
    name: string
    slug: string
    category: string
    lat: number
    lng: number
    claimStatus?: string
    nodeColour?: string
    isVerified?: boolean
  }) => void
  'toast:new': (payload: {
    type: ToastType
    message: string
    nodeId?: string
    nodeLat?: number
    nodeLng?: number
    avatarUrl?: string
  }) => void
  'reward:claimed': (payload: {
    rewardId: string
    rewardTitle: string
    redemptionCode: string
    codeExpiresAt: string
    nodeName?: string
  }) => void
  'reward:slots_update': (payload: { rewardId: string; slotsRemaining: number }) => void
  'leaderboard:update': (payload: { userId: string; rank: number; delta: number }) => void
  'business:checkin': (payload: BusinessCheckinPayload) => void
  'business:reward_claimed': (payload: BusinessRewardClaimedPayload) => void
  'toast:friend_checkin': (payload: {
    type: 'checkin'
    message: string
    userId: string
    nodeId: string
    avatarUrl?: string
  }) => void
  'friend:checkout': (payload: { userId: string; nodeId: string }) => void
  'node:archetype_change': (payload: { nodeId: string; liveArchetypeId: string; branch: LiveArchetypeBranch }) => void
  'tier:changed': (payload: { oldTier: string; newTier: string; benefits?: string[] }) => void
  'notification:new': (payload: {
    type: string
    title: string
    body: string
    data: Record<string, unknown>
    createdAt: string
  }) => void
}

export interface ClientToServerEvents {
  'room:join': (payload: { room: string }) => void
  'room:leave': (payload: { room: string }) => void
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
  /** Device-reported GPS accuracy in metres, when a position was acquired. */
  accuracy?: number
  qrToken?: string
  type: CheckInType
}

export interface CheckInResponse {
  success: boolean
  cooldownUntil: string
}

// Check-out response. Mirrors backend/src/features/check-out/types.ts
// `presenceState` is `checked_out` when an active presence was ended, or
// `no_active_presence` when the request was a successful no-op (never checked
// in, already checked out, or already expired). `dwellSeconds` is whole seconds
// of dwell when a record was ended, and `null` on a no-op.
export interface CheckOutResponse {
  nodeId: string
  presenceState: 'checked_out' | 'no_active_presence'
  dwellSeconds: number | null
}

// Paginated response
export interface PaginatedResponse<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}
