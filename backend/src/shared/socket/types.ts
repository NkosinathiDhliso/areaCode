/**
 * Socket event types — local copy for standalone Docker builds.
 * Source of truth: packages/shared/types/index.ts
 */

export type NodeState = 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'
export type ToastType = 'surge' | 'reward_pressure' | 'checkin' | 'reward_new' | 'streak' | 'leaderboard'

export interface BusinessCheckinPayload {
  nodeId: string
  nodeName: string
  consumerDisplayName?: string
  checkInCount?: number
  timestamp: string
}

export interface BusinessRewardClaimedPayload {
  nodeId: string
  nodeName: string
  rewardId?: string
  rewardTitle?: string
  consumerDisplayName?: string
  timestamp: string
}

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
  'toast:friend_checkin': (payload: { type: ToastType; message: string; nodeId?: string; avatarUrl?: string }) => void
}

export interface ClientToServerEvents {
  'room:join': (payload: { room: string }) => void
  'room:leave': (payload: { room: string }) => void
  'presence:join': (payload: { nodeId: string }) => void
  'presence:leave': (payload: { nodeId: string }) => void
}
