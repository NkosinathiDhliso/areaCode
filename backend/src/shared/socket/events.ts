import type {
  NodeState,
  ToastType,
  VenueMomentum,
  BusinessCheckinPayload,
  BusinessCheckinDetailPayload,
  BusinessRewardClaimedPayload,
  TierChangedPayload,
  LiveArchetypeBranch,
} from './types.js'
import { broadcastToRoom, broadcastToUser } from '../websocket/broadcast.js'
import { cityRoom, businessRoom } from './rooms.js'

/**
 * Typed realtime event emitters. The single emit path for every feature and
 * worker: each emitter fans out over the API Gateway WebSocket transport via
 * broadcastToRoom / broadcastToUser (connections tracked in DynamoDB).
 *
 * Best-effort by contract: the source-of-truth state has already been
 * committed to DynamoDB by the time these are called, so a fan-out failure is
 * logged loudly and swallowed here — it must never roll back or 500 the write
 * that triggered it.
 *
 * Callers MUST await these. Lambda freezes the process as soon as the handler
 * returns, so a fire-and-forget emit is silently lost.
 *
 * Each emitter resolves to the number of connections reached (0 on failure),
 * so callers that care (e.g. push fallback) can react.
 */

async function safeRoomBroadcast(room: string, type: string, payload: Record<string, unknown>): Promise<number> {
  try {
    return await broadcastToRoom(room, { type, payload })
  } catch (error) {
    console.error(`Realtime broadcast failed (${type} -> ${room}):`, error)
    return 0
  }
}

async function safeUserBroadcast(userId: string, type: string, payload: Record<string, unknown>): Promise<number> {
  try {
    return await broadcastToUser(userId, { type, payload })
  } catch (error) {
    console.error(`Realtime broadcast failed (${type} -> user ${userId}):`, error)
    return 0
  }
}

export async function emitPulseUpdate(
  citySlug: string,
  payload: { nodeId: string; pulseScore: number; checkInCount: number; state: NodeState },
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'node:pulse_update', payload)
}

/**
 * Emit the honest live-presence count for a venue.
 *
 * Dedicated event carrying only `{ nodeId, livePresenceCount, cause }` — no
 * consumer identity (Requirements 7.4, 10.4). Does NOT repurpose
 * `node:pulse_update.checkInCount` (founder decision 13.4 / Requirement 8.4).
 * A fan-out failure never rolls back the committed check-in / check-out /
 * expiry (Requirement 7.5).
 */
export async function emitPresenceUpdate(
  citySlug: string,
  payload: {
    nodeId: string
    livePresenceCount: number
    cause: 'check_in' | 'check_out' | 'expiry'
    momentum?: VenueMomentum
  },
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'node:presence_update', payload)
}

export async function emitStateSurge(
  citySlug: string,
  payload: { nodeId: string; fromState: NodeState; toState: NodeState },
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'node:state_surge', payload)
}

export async function emitStateChange(
  citySlug: string,
  payload: { nodeId: string; state: NodeState },
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'node:state_change', payload)
}

export async function emitNodeCreated(
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
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'node:created', payload)
}

export async function emitToast(
  citySlug: string,
  payload: {
    type: ToastType
    message: string
    nodeId?: string
    nodeLat?: number
    nodeLng?: number
    avatarUrl?: string
  },
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'toast:new', payload)
}

export async function emitRewardClaimed(
  userId: string,
  payload: {
    rewardId: string
    rewardTitle: string
    redemptionCode: string
    codeExpiresAt: string
    nodeName?: string
  },
): Promise<number> {
  return safeUserBroadcast(userId, 'reward:claimed', payload)
}

/**
 * Slots updates fan out to the city room: clients filter by rewardId, and the
 * city room is the one consumers are actually joined to (there is no
 * node-scoped room membership in the connections table).
 */
export async function emitRewardSlotsUpdate(
  citySlug: string,
  payload: { rewardId: string; slotsRemaining: number },
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'reward:slots_update', payload)
}

export async function emitLeaderboardUpdate(
  userId: string,
  payload: { userId: string; rank: number; delta: number },
): Promise<number> {
  return safeUserBroadcast(userId, 'leaderboard:update', payload)
}

export async function emitBusinessCheckin(businessId: string, payload: BusinessCheckinPayload): Promise<number> {
  return safeRoomBroadcast(businessRoom(businessId), 'business:checkin', { ...payload })
}

export async function emitBusinessRewardClaimed(
  businessId: string,
  payload: BusinessRewardClaimedPayload,
): Promise<number> {
  return safeRoomBroadcast(businessRoom(businessId), 'business:reward_claimed', { ...payload })
}

export async function emitFriendToast(
  userId: string,
  payload: {
    type: ToastType
    message: string
    userId: string
    nodeId: string
    avatarUrl?: string
  },
): Promise<number> {
  return safeUserBroadcast(userId, 'toast:friend_checkin', payload)
}

/**
 * Emit `friend:checkout` to a specific user when one of their mutual friends
 * checks out (manual) or their presence expires (serverless sweep). The client
 * uses this to call `removeFriendPresence(nodeId, userId)` so the taste-match
 * score stays honest (Requirement 3.5).
 */
export async function emitFriendCheckout(
  recipientUserId: string,
  payload: { userId: string; nodeId: string },
): Promise<number> {
  return safeUserBroadcast(recipientUserId, 'friend:checkout', payload)
}

export async function emitBusinessCheckinDetail(
  businessId: string,
  payload: BusinessCheckinDetailPayload,
): Promise<number> {
  return safeRoomBroadcast(businessRoom(businessId), 'business:checkin_detail', { ...payload })
}

export async function emitTierChanged(userId: string, payload: TierChangedPayload): Promise<number> {
  return safeUserBroadcast(userId, 'tier:changed', { ...payload })
}

/**
 * Emit a Live_Archetype change for a venue to its city room (R7.11).
 */
export async function emitArchetypeChange(
  citySlug: string,
  payload: { nodeId: string; liveArchetypeId: string; branch: LiveArchetypeBranch },
): Promise<number> {
  return safeRoomBroadcast(cityRoom(citySlug), 'node:archetype_change', payload)
}

/**
 * Emit an in-app notification to a user's live connections. Returns the number
 * of connections reached so the notification service can fall back to push.
 */
export async function emitNotificationNew(
  userId: string,
  payload: {
    type: string
    title: string
    body: string
    data: Record<string, unknown>
    createdAt: string
  },
): Promise<number> {
  return safeUserBroadcast(userId, 'notification:new', payload)
}

/**
 * Emit an arbitrary user-directed event. Prefer a typed emitter above; this
 * exists for the notification service's generic `notifyUser` delivery path.
 */
export async function emitToUser(userId: string, event: string, payload: Record<string, unknown>): Promise<number> {
  return safeUserBroadcast(userId, event, payload)
}
