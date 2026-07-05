/**
 * Socket event types , local copy for standalone Docker builds.
 * Source of truth: packages/shared/types/index.ts
 */

export type NodeState = 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'
export type ToastType = 'surge' | 'city_pulse' | 'reward_pressure' | 'checkin' | 'reward_new' | 'streak' | 'leaderboard'

/**
 * Honest presence momentum. Mirrors `VenueMomentum` in
 * `packages/shared/types/index.ts`; duplicated here for standalone builds, the
 * same way `NodeState` / `LiveArchetypeBranch` are.
 */
export type VenueMomentum = 'filling_up' | 'winding_down' | 'steady'

/**
 * Branch tag returned alongside `node:archetype_change`. Mirrors
 * `LiveArchetypeBranch` in `packages/shared/types/index.ts` (kept in
 * sync per R7.11) so the consumer client can debug which Live_Archetype
 * branch fired without a backend round-trip.
 */
export type LiveArchetypeBranch =
  | 'schedule_lineup'
  | 'schedule_blanket'
  | 'checkin_mode'
  | 'default'
  | 'eclectic_fallback'
  | 'declared_promise' // below Presence_Floor, showing the venue's declared intent (live-vibe-declaration)
  | 'crowd_live' // at/above Presence_Floor, showing the real crowd vibe (live-vibe-declaration)

export interface BusinessCheckinPayload {
  nodeId: string
  nodeName: string
  consumerDisplayName?: string
  checkInCount?: number
  timestamp: string
}

export interface BusinessCheckinDetailPayload {
  nodeId: string
  nodeName: string
  displayName?: string
  tier: string
  visitCount: number
  timestamp: string
}

export interface TierChangedPayload {
  oldTier: string
  newTier: string
  benefits?: string[]
}

export interface BusinessRewardClaimedPayload {
  nodeId: string
  nodeName: string
  rewardId?: string
  rewardTitle?: string
  consumerDisplayName?: string
  timestamp: string
}

export interface NotificationNewPayload {
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  createdAt: string
}

export interface ServerToClientEvents {
  'node:pulse_update': (payload: { nodeId: string; pulseScore: number; checkInCount: number; state: NodeState }) => void
  /**
   * Honest live-presence count for a venue. Dedicated event (NOT a repurpose of
   * `node:pulse_update.checkInCount`) so no existing consumer silently keeps
   * reading the old cumulative tally as if it were presence (founder decision
   * 13.4 / Requirement 8.4). Carries only `nodeId`, the new count, and the cause
   * — no consumer identity (Requirements 7.4, 10.4).
   */
  'node:presence_update': (payload: {
    nodeId: string
    livePresenceCount: number
    cause: 'check_in' | 'check_out' | 'expiry'
    /**
     * Honest momentum derived from the trailing count series. Optional so an
     * emitter that has not computed it (or has no trend) omits it and the
     * client shows no momentum label rather than over-claiming.
     */
    momentum?: VenueMomentum
  }) => void
  'node:state_surge': (payload: { nodeId: string; fromState: NodeState; toState: NodeState }) => void
  'node:state_change': (payload: { nodeId: string; state: NodeState }) => void
  'node:archetype_change': (payload: { nodeId: string; liveArchetypeId: string; branch: LiveArchetypeBranch }) => void
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
  'business:checkin_detail': (payload: BusinessCheckinDetailPayload) => void
  'business:reward_claimed': (payload: BusinessRewardClaimedPayload) => void
  'toast:friend_checkin': (payload: {
    type: ToastType
    message: string
    userId: string
    nodeId: string
    avatarUrl?: string
  }) => void
  'friend:checkout': (payload: { userId: string; nodeId: string }) => void
  'tier:changed': (payload: TierChangedPayload) => void
  'notification:new': (payload: NotificationNewPayload) => void
}

export interface ClientToServerEvents {
  'room:join': (payload: { room: string }) => void
  'room:leave': (payload: { room: string }) => void
  'presence:join': (payload: { nodeId: string }) => void
  'presence:leave': (payload: { nodeId: string }) => void
}
