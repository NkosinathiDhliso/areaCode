import type { AbuseFlag } from '../../types'
import { hoursAgo } from '../helpers'

export const MOCK_ABUSE_FLAGS: AbuseFlag[] = [
  { id: 'mock-flag-1', type: 'device_velocity', entityId: 'mock-user-6',
    entityType: 'user', evidenceJson: { checkIns: 4, windowMinutes: 25, nodes: ['mock-node-3', 'mock-node-4', 'mock-node-6', 'mock-node-7'] },
    reviewed: false, autoActioned: false, createdAt: hoursAgo(6) },
  { id: 'mock-flag-2', type: 'reward_drain', entityId: 'mock-user-13',
    entityType: 'user', evidenceJson: { rewardsClaimed: 3, nodeId: 'mock-node-1', windowHours: 24 },
    reviewed: false, autoActioned: false, createdAt: hoursAgo(12) },
]
