import type { ConsentRecord } from '../../types'
import { hoursAgo } from '../helpers'

export const CURRENT_CONSENT_VERSION = 'v1.0'

export const MOCK_CONSENT: ConsentRecord[] = [
  { id: 'mock-consent-1', userId: 'mock-user-1', consentVersion: 'v1.0',
    analyticsOptIn: true, consentedAt: hoursAgo(24 * 30) },
  { id: 'mock-consent-2', userId: 'mock-user-2', consentVersion: 'v1.0',
    analyticsOptIn: false, consentedAt: hoursAgo(24 * 28) },
  { id: 'mock-consent-3', userId: 'mock-user-3', consentVersion: 'v0.9',
    analyticsOptIn: false, consentedAt: hoursAgo(24 * 60) },
  { id: 'mock-consent-4', userId: 'mock-user-4', consentVersion: 'v1.0',
    analyticsOptIn: false, consentedAt: hoursAgo(24 * 20) },
  { id: 'mock-consent-5', userId: 'mock-user-5', consentVersion: 'v0.9',
    analyticsOptIn: true, consentedAt: hoursAgo(24 * 50) },
  { id: 'mock-consent-6', userId: 'mock-user-6', consentVersion: 'v0.9',
    analyticsOptIn: false, consentedAt: hoursAgo(24 * 45) },
  { id: 'mock-consent-7', userId: 'mock-user-7', consentVersion: 'v1.0',
    analyticsOptIn: true, consentedAt: hoursAgo(24 * 15) },
  { id: 'mock-consent-8', userId: 'mock-user-8', consentVersion: 'v1.0',
    analyticsOptIn: false, consentedAt: hoursAgo(24 * 10) },
]
