import type { StaffAccount } from '../../types'
import { hoursAgo } from '../helpers'

export const MOCK_STAFF: StaffAccount[] = [
  { id: 'mock-staff-1', businessId: 'mock-biz-2', name: 'Thabo Molefe',
    phone: '+27060000101', cognitoSub: null, isActive: true,
    createdAt: hoursAgo(24 * 30) },
  { id: 'mock-staff-2', businessId: 'mock-biz-2', name: 'Palesa Nkomo',
    phone: '+27060000102', cognitoSub: null, isActive: true,
    createdAt: hoursAgo(24 * 14) },
]
