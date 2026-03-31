import type { Tier, NodeCategory } from '../../types'
import { hoursAgo } from '../helpers'
import { MOCK_USERS } from './users'
import { MOCK_NODES } from './nodes'

export interface FeedItem {
  id: string
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  tier: Tier
  nodeId: string
  nodeName: string
  nodeCategory: NodeCategory
  checkedInAt: string
  isFriend: boolean
}

const feed: Array<{ userId: string; nodeIdx: number; h: number }> = [
  { userId: 'mock-user-1', nodeIdx: 2, h: 0.5 },
  { userId: 'mock-user-2', nodeIdx: 0, h: 1 },
  { userId: 'mock-user-3', nodeIdx: 5, h: 2 },
  { userId: 'mock-user-5', nodeIdx: 1, h: 3 },
  { userId: 'mock-user-8', nodeIdx: 3, h: 4.5 },
  { userId: 'mock-user-7', nodeIdx: 6, h: 6 },
  { userId: 'mock-user-11', nodeIdx: 8, h: 8 },
  { userId: 'mock-user-14', nodeIdx: 9, h: 10 },
]

export const MOCK_FEED: FeedItem[] = feed.map((f, i) => {
  const u = MOCK_USERS.find((u) => u.id === f.userId)!
  const n = MOCK_NODES[f.nodeIdx]!
  return {
    id: `mock-feed-${i + 1}`,
    userId: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    tier: u.tier,
    nodeId: n.id,
    nodeName: n.name,
    nodeCategory: n.category,
    checkedInAt: hoursAgo(f.h),
    isFriend: true,
  }
})
