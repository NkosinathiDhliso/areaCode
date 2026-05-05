import type {
  NodeState,
  ToastType,
  BusinessCheckinPayload,
  BusinessCheckinDetailPayload,
  BusinessRewardClaimedPayload,
  TierChangedPayload,
} from './types.js'
import { tryGetIO } from './server.js'
import { cityRoom, nodeRoom, userRoom, businessRoom } from './rooms.js'

/**
 * Typed event emitters for Socket.io broadcasts.
 */

export function emitPulseUpdate(
  citySlug: string,
  payload: { nodeId: string; pulseScore: number; checkInCount: number; state: NodeState },
) {
  tryGetIO()?.to(cityRoom(citySlug)).emit('node:pulse_update', payload)
}

export function emitStateSurge(
  citySlug: string,
  payload: { nodeId: string; fromState: NodeState; toState: NodeState },
) {
  tryGetIO()?.to(cityRoom(citySlug)).emit('node:state_surge', payload)
}

export function emitStateChange(citySlug: string, payload: { nodeId: string; state: NodeState }) {
  tryGetIO()?.to(cityRoom(citySlug)).emit('node:state_change', payload)
}

export function emitNodeCreated(
  citySlug: string,
  payload: {
    id: string
    name: string
    slug: string
    category: string
    lat: number
    lng: number
    claimStatus?: string
    nodeColour?: string
    isVerified?: boolean
  },
) {
  tryGetIO()?.to(cityRoom(citySlug)).emit('node:created', payload)
}

export function emitToast(
  citySlug: string,
  payload: {
    type: ToastType
    message: string
    nodeId?: string
    nodeLat?: number
    nodeLng?: number
    avatarUrl?: string
  },
) {
  tryGetIO()?.to(cityRoom(citySlug)).emit('toast:new', payload)
}

export function emitRewardClaimed(
  userId: string,
  payload: {
    rewardId: string
    rewardTitle: string
    redemptionCode: string
    codeExpiresAt: string
  },
) {
  tryGetIO()?.to(userRoom(userId)).emit('reward:claimed', payload)
}

export function emitRewardSlotsUpdate(nodeId: string, payload: { rewardId: string; slotsRemaining: number }) {
  tryGetIO()?.to(nodeRoom(nodeId)).emit('reward:slots_update', payload)
}

export function emitLeaderboardUpdate(userId: string, payload: { userId: string; rank: number; delta: number }) {
  tryGetIO()?.to(userRoom(userId)).emit('leaderboard:update', payload)
}

export function emitBusinessCheckin(businessId: string, payload: BusinessCheckinPayload) {
  tryGetIO()?.to(businessRoom(businessId)).emit('business:checkin', payload)
}

export function emitBusinessRewardClaimed(businessId: string, payload: BusinessRewardClaimedPayload) {
  tryGetIO()?.to(businessRoom(businessId)).emit('business:reward_claimed', payload)
}

export function emitFriendToast(
  userId: string,
  payload: {
    type: ToastType
    message: string
    nodeId?: string
    avatarUrl?: string
  },
) {
  tryGetIO()?.to(userRoom(userId)).emit('toast:friend_checkin', payload)
}

export function emitBusinessCheckinDetail(businessId: string, payload: BusinessCheckinDetailPayload) {
  tryGetIO()?.to(businessRoom(businessId)).emit('business:checkin_detail', payload)
}

export function emitTierChanged(userId: string, payload: TierChangedPayload) {
  tryGetIO()?.to(userRoom(userId)).emit('tier:changed', payload)
}
