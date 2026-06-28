import type { NodeState } from '@area-code/shared/types'

/**
 * A get surfaced in the "near you" feed. Extends the API shape with the honest
 * aliveness signals the card leads with. The list is already ranked taste-first
 * server-side (taste -> aliveness -> tier -> live gets -> proximity); these
 * fields drive the "who's here now" lead, never the order.
 */
export interface NearbyReward {
  id: string
  title: string
  type: string
  totalSlots: number | null
  claimedCount: number
  nodeId: string
  nodeName: string
  nodeSlug: string
  distance: number
  expiresAt: string | null
  liveCount?: number
  pulseScore?: number
  pulseState?: NodeState
  getCategory?: 'loyalty' | 'event' | 'offer'
  lifecycle?: 'upcoming' | 'live' | 'ended'
}

/** An anonymised recent claim at a nearby venue (social proof). No identity. */
export interface RecentClaim {
  id: string
  rewardTitle: string
  nodeId: string
  nodeName: string
  distance: number
  claimedAt: string
}

/** A get the viewer has already claimed and used (their history). */
export interface ClaimedGet {
  id: string
  rewardTitle: string
  nodeName: string
  redeemedAt: string
}
