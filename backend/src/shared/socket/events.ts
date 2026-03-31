import type { NodeState, ToastType, BusinessCheckinPayload, BusinessRewardClaimedPayload } from './types.js';
import { getIO } from './server.js';
import { cityRoom, nodeRoom, userRoom, businessRoom } from './rooms.js';

/**
 * Typed event emitters for Socket.io broadcasts.
 */

export function emitPulseUpdate(
  citySlug: string,
  payload: { nodeId: string; pulseScore: number; checkInCount: number; state: NodeState }
) {
  getIO().to(cityRoom(citySlug)).emit('node:pulse_update', payload);
}

export function emitStateSurge(
  citySlug: string,
  payload: { nodeId: string; fromState: NodeState; toState: NodeState }
) {
  getIO().to(cityRoom(citySlug)).emit('node:state_surge', payload);
}

export function emitStateChange(
  citySlug: string,
  payload: { nodeId: string; state: NodeState }
) {
  getIO().to(cityRoom(citySlug)).emit('node:state_change', payload);
}

export function emitToast(
  citySlug: string,
  payload: {
    type: ToastType;
    message: string;
    nodeId?: string;
    nodeLat?: number;
    nodeLng?: number;
    avatarUrl?: string;
  }
) {
  getIO().to(cityRoom(citySlug)).emit('toast:new', payload);
}

export function emitRewardClaimed(
  userId: string,
  payload: {
    rewardId: string;
    rewardTitle: string;
    redemptionCode: string;
    codeExpiresAt: string;
  }
) {
  getIO().to(userRoom(userId)).emit('reward:claimed', payload);
}

export function emitRewardSlotsUpdate(
  nodeId: string,
  payload: { rewardId: string; slotsRemaining: number }
) {
  getIO().to(nodeRoom(nodeId)).emit('reward:slots_update', payload);
}

export function emitLeaderboardUpdate(
  userId: string,
  payload: { userId: string; rank: number; delta: number }
) {
  getIO().to(userRoom(userId)).emit('leaderboard:update', payload);
}

export function emitBusinessCheckin(
  businessId: string,
  payload: BusinessCheckinPayload,
) {
  getIO().to(businessRoom(businessId)).emit('business:checkin', payload);
}

export function emitBusinessRewardClaimed(
  businessId: string,
  payload: BusinessRewardClaimedPayload,
) {
  getIO().to(businessRoom(businessId)).emit('business:reward_claimed', payload);
}

export function emitFriendToast(
  userId: string,
  payload: {
    type: ToastType;
    message: string;
    nodeId?: string;
    avatarUrl?: string;
  }
) {
  getIO().to(userRoom(userId)).emit('toast:friend_checkin', payload);
}
