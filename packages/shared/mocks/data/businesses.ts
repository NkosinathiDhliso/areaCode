import type { BusinessAccount } from '../../types'
import { daysFromNow, hoursAgo } from '../helpers'

/**
 * 8 South African mock businesses distributed across all BusinessTier levels.
 * Current business is mock-biz-2 (Father Coffee Roasters, growth).
 */

export const CURRENT_BUSINESS_ID = 'mock-biz-2'

export const MOCK_BUSINESSES: BusinessAccount[] = [
  { id: 'mock-biz-1', email: 'nandos@example.co.za',
    businessName: "Nando's SA (Pty) Ltd", registrationNumber: '2018/123456/07',
    cognitoSub: null, tier: 'pro', trialEndsAt: null,
    paymentGraceUntil: null, yocoCustomerId: 'yoco_nandos_001',
    isActive: true, createdAt: hoursAgo(24 * 365) },
  { id: 'mock-biz-2', email: 'fathercoffee@example.co.za',
    businessName: 'Father Coffee Roasters', registrationNumber: '2022/654321/07',
    cognitoSub: null, tier: 'growth', trialEndsAt: daysFromNow(10),
    paymentGraceUntil: null, yocoCustomerId: 'yoco_father_002',
    isActive: true, createdAt: hoursAgo(24 * 200) },
  { id: 'mock-biz-3', email: 'kitcheners@example.co.za',
    businessName: "Kitchener's Hospitality", registrationNumber: null,
    cognitoSub: null, tier: 'starter', trialEndsAt: null,
    paymentGraceUntil: null, yocoCustomerId: null,
    isActive: true, createdAt: hoursAgo(24 * 180) },
  { id: 'mock-biz-4', email: 'neighbourgoods@example.co.za',
    businessName: 'Neighbourgoods Trust', registrationNumber: '2020/111222/08',
    cognitoSub: null, tier: 'growth', trialEndsAt: null,
    paymentGraceUntil: null, yocoCustomerId: 'yoco_ngoods_004',
    isActive: true, createdAt: hoursAgo(24 * 150) },
  { id: 'mock-biz-5', email: 'virginactive@example.co.za',
    businessName: 'Virgin Active SA', registrationNumber: '2015/998877/07',
    cognitoSub: null, tier: 'pro', trialEndsAt: null,
    paymentGraceUntil: null, yocoCustomerId: 'yoco_virgin_005',
    isActive: true, createdAt: hoursAgo(24 * 300) },
  { id: 'mock-biz-6', email: 'artsonmain@example.co.za',
    businessName: 'Arts on Main Collective', registrationNumber: null,
    cognitoSub: null, tier: 'free', trialEndsAt: null,
    paymentGraceUntil: null, yocoCustomerId: null,
    isActive: true, createdAt: hoursAgo(24 * 120) },
  { id: 'mock-biz-7', email: 'sandtoncity@example.co.za',
    businessName: 'Sandton City Management', registrationNumber: null,
    cognitoSub: null, tier: 'payg', trialEndsAt: null,
    paymentGraceUntil: daysFromNow(5), yocoCustomerId: null,
    isActive: true, createdAt: hoursAgo(24 * 90) },
  { id: 'mock-biz-8', email: 'taboo@example.co.za',
    businessName: 'Taboo Entertainment', registrationNumber: null,
    cognitoSub: null, tier: 'starter', trialEndsAt: null,
    paymentGraceUntil: null, yocoCustomerId: null,
    isActive: true, createdAt: hoursAgo(24 * 60) },
]
