import { CURRENT_USER_ID } from './users'

/**
 * Mock follow graph. Each entry is [followerId, followingId].
 * Mutual follows (friends) exist when both directions are present.
 *
 * Current user (mock-user-4) is mutual friends with:
 *   - mock-user-1 (Sipho)
 *   - mock-user-2 (Thandi)
 *   - mock-user-7 (Kagiso)
 *
 * Current user follows but is NOT followed back by:
 *   - mock-user-8 (Naledi) — one-way
 *
 * mock-user-5 follows current user but current user does NOT follow back:
 *   - mock-user-5 (Neo) — one-way inbound
 */
export const MOCK_FOLLOWS: Array<[string, string]> = [
  // Mutual: current user <-> mock-user-1
  [CURRENT_USER_ID, 'mock-user-1'],
  ['mock-user-1', CURRENT_USER_ID],
  // Mutual: current user <-> mock-user-2
  [CURRENT_USER_ID, 'mock-user-2'],
  ['mock-user-2', CURRENT_USER_ID],
  // Mutual: current user <-> mock-user-7
  [CURRENT_USER_ID, 'mock-user-7'],
  ['mock-user-7', CURRENT_USER_ID],
  // One-way: current user -> mock-user-8
  [CURRENT_USER_ID, 'mock-user-8'],
  // One-way: mock-user-5 -> current user
  ['mock-user-5', CURRENT_USER_ID],
  // Some other follows between users
  ['mock-user-1', 'mock-user-2'],
  ['mock-user-2', 'mock-user-1'],
  ['mock-user-3', 'mock-user-1'],
  ['mock-user-1', 'mock-user-3'],
]

/** Mutable follow set — used by mock router for follow/unfollow */
export const followSet = new Set(MOCK_FOLLOWS.map(([a, b]) => `${a}:${b}`))

export function isFollowing(followerId: string, followingId: string): boolean {
  return followSet.has(`${followerId}:${followingId}`)
}

export function isMutualFollow(userA: string, userB: string): boolean {
  return isFollowing(userA, userB) && isFollowing(userB, userA)
}

export function addFollow(followerId: string, followingId: string): void {
  followSet.add(`${followerId}:${followingId}`)
}

export function removeFollow(followerId: string, followingId: string): void {
  followSet.delete(`${followerId}:${followingId}`)
}

/** Get all mutual follow user IDs for a given user */
export function getMutualFollowIds(userId: string): string[] {
  const following: string[] = []
  const followedBy: string[] = []

  for (const key of followSet) {
    const [a, b] = key.split(':')
    if (a === userId) following.push(b!)
    if (b === userId) followedBy.push(a!)
  }

  const followedBySet = new Set(followedBy)
  return following.filter((id) => followedBySet.has(id))
}

/** Get all user IDs that this user follows */
export function getFollowingIds(userId: string): string[] {
  const result: string[] = []
  for (const key of followSet) {
    const [a, b] = key.split(':')
    if (a === userId) result.push(b!)
  }
  return result
}

/** Get all user IDs that follow this user */
export function getFollowerIds(userId: string): string[] {
  const result: string[] = []
  for (const key of followSet) {
    const [a, b] = key.split(':')
    if (b === userId) result.push(a!)
  }
  return result
}
