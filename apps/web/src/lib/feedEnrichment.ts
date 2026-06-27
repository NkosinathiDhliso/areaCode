import type { NodeState } from '@area-code/shared/types'

/**
 * Pure helpers for the vibe-enriched City Feed.
 *
 * The feed's vibe data (pulse state, live count, archetype) is derived
 * CLIENT-SIDE from `mapStore`, which already holds the live socket-fed values.
 * This is honest (always the current state, R11.1.3) and adds zero server-side
 * N+1 queries (R14.2): the data is already in memory. These functions are pure
 * and total so they can be property-tested.
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.6
 */

export type FeedType = 'checkin' | 'milestone' | 'live_get' | 'archetype_cluster'

/** The checking-in user as returned by the feed endpoint. */
export interface FeedUser {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  tier: string
  archetypeId?: string | null
}

/** The venue as returned by the feed endpoint. */
export interface FeedNode {
  id: string
  name: string
  slug: string
  category: string
}

/**
 * A raw feed item as returned by `GET /v1/feed`. Check-in items carry `user` +
 * `node`; milestone items carry `title` + `body` instead (R11.5).
 */
export interface RawFeedItem {
  id: string
  checkedInAt: string
  user?: FeedUser
  node?: FeedNode
  feedType?: FeedType
  /** Milestone items only. */
  title?: string
  body?: string
}

/**
 * A feed item after client-side vibe enrichment from `mapStore`. Live-get items
 * reuse this shape with `user` omitted and `getTitle` set; milestone items omit
 * `user`/`node` and carry `title`/`body`.
 */
export interface EnrichedFeedItem {
  id: string
  feedType: FeedType
  checkedInAt: string
  user?: FeedUser
  node?: FeedNode
  /** Current venue pulse state, or null when no live data is available. */
  venuePulseState: NodeState | null
  venueCheckInCount: number
  venueArchetypeId: string | null
  friendStillPresent: boolean
  /** For `live_get` items: the get title shown with the "Live now" badge. */
  getTitle?: string
  /** For `milestone` items: the milestone headline + detail (R11.5). */
  title?: string
  body?: string
}

/** Pulse states that mean the venue is alive enough to send someone to now. */
const ALIVE_STATES: ReadonlySet<NodeState> = new Set<NodeState>(['active', 'buzzing', 'popping'])

/** True when the venue's current pulse state is active, buzzing, or popping. */
export function isAlive(state: NodeState | null | undefined): boolean {
  return state != null && ALIVE_STATES.has(state)
}

/**
 * "Join them?" CTA eligibility (Property 10).
 *
 * Shown if and only if the friend is still currently present (active,
 * non-expired check-in) AND the venue's current pulse state is alive
 * (active/buzzing/popping). Never send someone to a dead spot (R11.2.3).
 */
export function isJoinEligible(friendStillPresent: boolean, pulseState: NodeState | null | undefined): boolean {
  return friendStillPresent && isAlive(pulseState)
}

/**
 * Archetype cluster membership (Property 11).
 *
 * Keeps only items made by users whose archetype matches the consumer's. When
 * the consumer has no archetype, the cluster is empty (R11.3.1 gates on having
 * an archetypeId).
 */
export function filterArchetypeCluster<T extends { user?: { archetypeId?: string | null } | null }>(
  items: T[],
  consumerArchetypeId: string | null | undefined,
): T[] {
  if (!consumerArchetypeId) return []
  return items.filter((i) => i.user?.archetypeId === consumerArchetypeId)
}

/**
 * Live-gets filter (Property 12).
 *
 * Keeps only rewards that are genuinely live events/offers: `getCategory` of
 * 'event' or 'offer' AND `lifecycle === 'live'`. Loyalty, upcoming, and ended
 * gets never qualify (R11.4.4).
 */
export function filterLiveGets<T extends { getCategory?: string | null; lifecycle?: string | null }>(
  rewards: T[],
): T[] {
  return rewards.filter((r) => (r.getCategory === 'event' || r.getCategory === 'offer') && r.lifecycle === 'live')
}

/** Minimal shape `sortFeedItems` needs to order a heterogeneous feed. */
export interface SortableFeedItem {
  feedType: FeedType
  checkedInAt: string
  friendStillPresent?: boolean
  venuePulseState?: NodeState | null
}

/**
 * Feed ordering (Property 14).
 *
 * 1. Archetype-cluster items pinned at the top (position 0+).
 * 2. "Happening now" items (a friend is currently present at an alive venue)
 *    promoted next, reverse-chronological.
 * 3. All remaining items reverse-chronological.
 *
 * Stable and total: every input item appears exactly once in the output.
 */
export function sortFeedItems<T extends SortableFeedItem>(items: T[]): T[] {
  const cluster: T[] = []
  const happeningNow: T[] = []
  const rest: T[] = []

  for (const item of items) {
    if (item.feedType === 'archetype_cluster') {
      cluster.push(item)
    } else if (item.feedType === 'checkin' && item.friendStillPresent === true && isAlive(item.venuePulseState)) {
      happeningNow.push(item)
    } else {
      rest.push(item)
    }
  }

  const byTimeDesc = (a: T, b: T): number => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt)
  return [...cluster, ...happeningNow.sort(byTimeDesc), ...rest.sort(byTimeDesc)]
}
