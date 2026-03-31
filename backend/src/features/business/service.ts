import { createHmac } from 'node:crypto'
import { AppError } from '../../shared/errors/AppError.js'
import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'
import {
  BUSINESS_PLANS,
  BOOST_PRICING,
  type BoostDuration,
} from './types.js'

const DEV_MODE = !isDbAvailable

// ─── Business Profile ───────────────────────────────────────────────────────

export async function getBusinessProfile(cognitoSub: string) {
  if (DEV_MODE) {
    return { id: 'dev-biz-1', businessName: 'Dev Business', email: 'dev@areacode.co.za', tier: 'growth', cognitoSub }
  }
  const biz = await repo.findBusinessByCognitoSub(cognitoSub)
  if (!biz) throw AppError.notFound('Business account not found')
  return biz
}

export function getPlans() {
  return {
    starter: {
      name: BUSINESS_PLANS.starter.name,
      monthlyPriceCents: BUSINESS_PLANS.starter.monthlyPrice,
      yearlyPriceCents: BUSINESS_PLANS.starter.yearlyPrice,
      maxNodes: BUSINESS_PLANS.starter.maxNodes,
      maxRewards: BUSINESS_PLANS.starter.maxRewards,
      maxStaff: BUSINESS_PLANS.starter.maxStaff,
    },
    growth: {
      name: BUSINESS_PLANS.growth.name,
      monthlyPriceCents: BUSINESS_PLANS.growth.monthlyPrice,
      yearlyPriceCents: BUSINESS_PLANS.growth.yearlyPrice,
      maxNodes: BUSINESS_PLANS.growth.maxNodes,
      maxRewards: BUSINESS_PLANS.growth.maxRewards,
      maxStaff: BUSINESS_PLANS.growth.maxStaff,
      trialDays: BUSINESS_PLANS.growth.trialDays,
    },
    pro: {
      name: BUSINESS_PLANS.pro.name,
      monthlyPriceCents: BUSINESS_PLANS.pro.monthlyPrice,
      yearlyPriceCents: BUSINESS_PLANS.pro.yearlyPrice,
      maxNodes: BUSINESS_PLANS.pro.maxNodes,
      maxRewards: BUSINESS_PLANS.pro.maxRewards,
      maxStaff: BUSINESS_PLANS.pro.maxStaff,
      trialDays: BUSINESS_PLANS.pro.trialDays,
    },
    payg: {
      name: BUSINESS_PLANS.payg.name,
      dailyPriceCents: BUSINESS_PLANS.payg.dailyPrice,
      weeklyPriceCents: BUSINESS_PLANS.payg.weeklyPrice,
      maxNodes: BUSINESS_PLANS.payg.maxNodes,
      maxRewards: BUSINESS_PLANS.payg.maxRewards,
      maxStaff: BUSINESS_PLANS.payg.maxStaff,
    },
    boost: {
      '2hr': BOOST_PRICING['2hr'],
      '6hr': BOOST_PRICING['6hr'],
      '24hr': BOOST_PRICING['24hr'],
    },
  }
}

// ─── Checkout (Yoco) ────────────────────────────────────────────────────────

export async function createCheckoutSession(
  businessId: string,
  plan: 'growth' | 'pro' | 'payg',
  interval?: string,
) {
  if (DEV_MODE) {
    const amountCents = plan === 'payg' ? 2900 : 14900
    return { checkoutUrl: '#dev-checkout', amountCents, currency: 'ZAR', metadata: { businessId, plan, interval } }
  }
  const biz = await repo.findBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')

  // Determine amount based on plan + interval
  let amountCents: number
  if (plan === 'payg') {
    amountCents = interval === 'weekly'
      ? BUSINESS_PLANS.payg.weeklyPrice
      : BUSINESS_PLANS.payg.dailyPrice
  } else {
    const planConfig = BUSINESS_PLANS[plan]
    amountCents = interval === 'yearly'
      ? planConfig.yearlyPrice
      : planConfig.monthlyPrice
  }

  // In production, this calls Yoco API to create a checkout session
  // For now, return the session data structure
  return {
    checkoutUrl: `https://payments.yoco.com/checkout?amount=${amountCents}`,
    amountCents,
    currency: 'ZAR',
    metadata: { businessId, plan, interval },
  }
}

// ─── Boost ──────────────────────────────────────────────────────────────────

export async function purchaseBoost(
  businessId: string,
  nodeId: string,
  duration: BoostDuration,
) {
  if (DEV_MODE) {
    const amountCents = BOOST_PRICING[duration]
    return { checkoutUrl: '#dev-boost', amountCents, currency: 'ZAR', metadata: { businessId, nodeId, duration, type: 'boost' } }
  }
  const node = await repo.getNodeForBusiness(nodeId, businessId)
  if (!node) throw AppError.forbidden('You do not own this node')

  const amountCents = BOOST_PRICING[duration]

  return {
    checkoutUrl: `https://payments.yoco.com/checkout?amount=${amountCents}`,
    amountCents,
    currency: 'ZAR',
    metadata: { businessId, nodeId, duration, type: 'boost' },
  }
}

// ─── Yoco Webhook ───────────────────────────────────────────────────────────

export async function processYocoWebhook(
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>,
  signature: string,
) {
  if (DEV_MODE) return { duplicate: false }

  // Verify signature
  const secret = process.env['YOCO_DEV_SECRET_KEY'] ?? ''
  const expected = createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex')

  if (signature !== expected) {
    throw AppError.unauthorized('Invalid webhook signature')
  }

  // Idempotency check
  const existing = await repo.findWebhookEvent(eventId)
  if (existing) return { duplicate: true }

  await repo.createWebhookEvent(eventId, eventType)

  if (eventType === 'payment.succeeded') {
    await handlePaymentSucceeded(payload)
  } else if (eventType === 'payment.failed') {
    await handlePaymentFailed(payload)
  }

  return { duplicate: false }
}

async function handlePaymentSucceeded(payload: Record<string, unknown>) {
  const metadata = payload['metadata'] as Record<string, string> | undefined
  if (!metadata?.['businessId'] || !metadata['plan']) return

  const businessId = metadata['businessId']
  const plan = metadata['plan']

  // Clear grace period on successful payment
  await repo.setPaymentGrace(businessId, null)
  await repo.updateBusinessTier(businessId, plan)
}

async function handlePaymentFailed(payload: Record<string, unknown>) {
  const metadata = payload['metadata'] as Record<string, string> | undefined
  if (!metadata?.['businessId']) return

  const businessId = metadata['businessId']
  const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await repo.setPaymentGrace(businessId, graceUntil)
  // Email notifications on day 1, 4, 7 handled by SES worker
}

// ─── Staff Management ───────────────────────────────────────────────────────

const STAFF_LIMITS: Record<string, number | null> = {
  free: 2, starter: 2, growth: 5, pro: null, payg: 2,
}

export async function inviteStaff(
  businessId: string,
  phone?: string,
  email?: string,
) {
  if (DEV_MODE) {
    return { id: `dev-invite-${Date.now()}`, businessId, phone, email, inviteToken: 'dev-token', accepted: false }
  }
  const biz = await repo.findBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')

  const limit = STAFF_LIMITS[biz.tier]
  if (limit !== null) {
    const count = await repo.countStaffForBusiness(businessId)
    if (count >= limit) {
      throw AppError.forbidden(
        `Staff limit reached for ${biz.tier} tier (max ${limit})`,
      )
    }
  }

  return repo.createStaffInvite(businessId, phone, email)
}

export async function listStaff(businessId: string) {
  if (DEV_MODE) return []
  return repo.listStaffAccounts(businessId)
}

export async function removeStaff(staffId: string, businessId: string) {
  if (DEV_MODE) return
  const result = await repo.removeStaffAccount(staffId, businessId)
  if (result.count === 0) throw AppError.notFound('Staff member not found')
}

// ─── QR Code ────────────────────────────────────────────────────────────────

export function generateQrToken(nodeId: string): string {
  const secret = process.env['AREA_CODE_QR_HMAC_SECRET'] ?? ''
  const flooredTs = Math.floor(Date.now() / (15 * 60 * 1000))
  return createHmac('sha256', secret)
    .update(`${nodeId}${flooredTs}`)
    .digest('hex')
    .slice(0, 32)
}

export function validateQrToken(nodeId: string, token: string): boolean {
  const secret = process.env['AREA_CODE_QR_HMAC_SECRET'] ?? ''
  // Check current and previous window (handles edge cases)
  for (let offset = 0; offset <= 1; offset++) {
    const ts = Math.floor(Date.now() / (15 * 60 * 1000)) - offset
    const expected = createHmac('sha256', secret)
      .update(`${nodeId}${ts}`)
      .digest('hex')
      .slice(0, 32)
    if (token === expected) return true
  }
  return false
}

export async function getQrData(nodeId: string, businessId: string) {
  if (DEV_MODE) {
    const token = generateQrToken(nodeId)
    return { url: `areacode.co.za/qr/${nodeId}/${token}`, token, nodeId }
  }
  const node = await repo.getNodeForBusiness(nodeId, businessId)
  if (!node) throw AppError.forbidden('You do not own this node')

  const token = generateQrToken(nodeId)
  return {
    url: `areacode.co.za/qr/${nodeId}/${token}`,
    token,
    nodeId,
  }
}

// ─── Trial Management ───────────────────────────────────────────────────────

export async function startTrial(businessId: string, plan: 'growth' | 'pro') {
  if (DEV_MODE) return { id: businessId, tier: plan, trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString() }
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  return repo.updateBusinessTier(businessId, plan, trialEndsAt)
}
