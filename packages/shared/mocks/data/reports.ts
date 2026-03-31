import type { Report } from '../../types'
import { hoursAgo } from '../helpers'

export const MOCK_REPORTS: Report[] = [
  { id: 'mock-report-1', reporterId: 'mock-user-6', nodeId: 'mock-node-3',
    type: 'fake_rewards', detail: 'Reward was not honoured at the venue',
    status: 'pending', createdAt: hoursAgo(2) },
  { id: 'mock-report-2', reporterId: 'mock-user-10', nodeId: 'mock-node-7',
    type: 'wrong_location', detail: 'Pin is on the wrong side of the mall',
    status: 'pending', createdAt: hoursAgo(5) },
  { id: 'mock-report-3', reporterId: 'mock-user-13', nodeId: 'mock-node-10',
    type: 'offensive_content', detail: 'Inappropriate node description',
    status: 'pending', createdAt: hoursAgo(8) },
  { id: 'mock-report-4', reporterId: 'mock-user-9', nodeId: 'mock-node-8',
    type: 'permanently_closed', detail: 'This coffee shop closed last month',
    status: 'reviewed', createdAt: hoursAgo(24) },
  { id: 'mock-report-5', reporterId: 'mock-user-15', nodeId: 'mock-node-4',
    type: 'fake_rewards', detail: null,
    status: 'dismissed', createdAt: hoursAgo(48) },
  { id: 'mock-report-6', reporterId: 'mock-user-6', nodeId: 'mock-node-9',
    type: 'wrong_location', detail: 'Pin is about 200m off from the actual restaurant',
    status: 'actioned', createdAt: hoursAgo(72) },
]
