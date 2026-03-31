import type { LeaderboardEntry } from '../../types'
import { MOCK_USERS, CURRENT_USER_ID } from './users'

// Friends of the current user (mock-user-4) for demo purposes
const FRIEND_IDS = new Set(['mock-user-1', 'mock-user-2', 'mock-user-7', CURRENT_USER_ID])

function userEntry(userId: string, rank: number, weeklyCount: number): LeaderboardEntry {
  const u = MOCK_USERS.find((u) => u.id === userId)!
  const isFriend = FRIEND_IDS.has(userId) || userId === CURRENT_USER_ID
  return {
    userId,
    username: isFriend ? u.username : null,
    displayName: isFriend ? u.displayName : null,
    avatarUrl: isFriend ? u.avatarUrl : null,
    tier: u.tier,
    rank,
    checkInCount: weeklyCount,
    isFriend,
  }
}

/** Top 10 + current user entry. Sorted descending by checkInCount. */
export const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  userEntry('mock-user-1', 1, 42),
  userEntry('mock-user-14', 2, 38),
  userEntry('mock-user-8', 3, 31),
  userEntry('mock-user-2', 4, 27),
  userEntry('mock-user-11', 5, 22),
  userEntry('mock-user-3', 6, 19),
  userEntry('mock-user-7', 7, 16),
  userEntry('mock-user-12', 8, 14),
  userEntry('mock-user-5', 9, 11),
  userEntry('mock-user-9', 10, 9),
  // Current user outside top 10
  userEntry(CURRENT_USER_ID, 12, 6),
]

export const CURRENT_USER_RANK: number = 12
