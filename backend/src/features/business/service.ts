import { createHmac, randomUUID } from 'node:crypto'

import { APP_ENV, AWS_REGION, DEV_MODE, qrHmacSecret, requireEnv } from '../../shared/config/env.js'
import { sendRenewalReminderEmail, sendRenewalUpcomingEmail } from '../../shared/email/ses.js'
import { AppError } from '../../shared/errors/AppError.js'
import { digestsEqual } from '../../shared/security/hmac.js'
import { deactivateNodesForBusiness } from '../nodes/dynamodb-repository.js'
import { buildDigestCopy, type DigestData } from '../reports/digest.js'
import { getLatestDigest, queryDigestHistory } from '../reports/repository.js'
import type { DigestRow } from '../reports/types.js'
import { classifyLifecycle, type Lifecycle } from '../rewards/lifecycle.js'

import { decideBoostFloorWithMetric, type BoostMetricInput } from './floor-decision.js'
import * as repo from './repository.js'
import {
  BUSINESS_PLANS,
  BOOST_PRICING,
  BOOST_FLOOR_DEFAULTS,
  BOOST_FLOOR_MAX_CENTS,
  BOOST_FLOOR_MIN_CENTS,
  ADMIN_BOOST_REPORT_MAX_RANGE_DAYS,
  PAID_INTERVALS,
  SUBSCRIPTION_GRACE_DAYS,
  RENEWAL_REMINDER_LEAD_DAYS,
  addPaidInterval,
  boostWindowEnd,
  type AdminBoosterPurchaseView,
  type BoostDuration,
  type BoostFloorRow,
  type BoostFloorView,
  type BoosterCheckoutMarkerRow,
  type BoosterPurchaseRow,
  type BoosterPurchaseView,
  type BOOST_LOG_BRANCHES,
  type FloorChangeAuditRow,
  type FloorChangeAuditView,
  type PaidInterval,
  type SubscriptionPaymentRow,
  type SubscriptionPaymentView,
  type SubCheckoutMarkerRow,
} from './types.js'

// ─── Payment_Config_Guard (billing-revenue-integrity R1.2) ──────────────────
//
// The Yoco webhook secret is validated at API Lambda cold start in
// `assertStartupConfig()` (shared/config/env.ts), called from `buildApp()`.
// It is NOT validated here at module load: this file also exports the pure
// `getEffectiveTier` helper, imported by workers (reports, campaigns, rewards)
// that never serve the webhook. A module-load guard here crashed those workers
// on a secret they do not use. `processYocoWebhook` still fails closed at
// runtime on a missing/empty secret.

// ─── Booster structured logging ─────────────────────────────────────────────
//
// R9.3: every Booster_Service structured log entry includes a `branch` field
// drawn from the exhaustive `BOOST_LOG_BRANCHES` union. Typing the helper's
// `branch` parameter as that union turns a missing branch into a TypeScript
// error at the call site. The shape mirrors the rest of the backend's
// "single-line JSON to stdout" convention so CloudWatch log-metric filters
// can pick the fields up.
//
// `floor_loaded_from_const_fallback` and `floor_violation_rejected` log at
// `warn` level (operator-actionable signals); the rest log at `info`.

const BOOST_BRANCHES_AT_WARN_LEVEL: ReadonlySet<BOOST_LOG_BRANCHES> = new Set([
  'floor_loaded_from_const_fallback',
  'floor_violation_rejected',
])

function logBoostBranch(branch: BOOST_LOG_BRANCHES, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    feature: 'business',
    operation: 'purchaseBoost',
    branch,
    ...fields,
  })
  if (BOOST_BRANCHES_AT_WARN_LEVEL.has(branch)) {
    console.warn(line)
  } else {
    console.info(line)
  }
}

// ─── BoostFloorViolation CloudWatch metric adapter ──────────────────────────
//
// R9.5: a `BoostFloorViolation` metric is emitted with dimensions
// `{ duration, businessId }` whenever a checkout is rejected for being below
// the floor. The metric is emitted only on actual violations — no zero-count
// heartbeat. The CloudWatch client is constructed lazily so cold-starts that
// never reject a booster pay no SDK init cost, and a single instance is
// reused across invocations of the same Lambda container (one client per
// cold start, arm64-friendly).
//
// `decideBoostFloorWithMetric` (in `./floor-decision.ts`) already encodes the
// "metric-emission failure must not block rejection" contract — it swallows
// any throw from `putMetric` and still returns the reject decision. We adapt
// the SDK to that helper's `PutMetricFn` shape rather than duplicating the
// try/catch here.

let cloudWatchClientSingleton: import('@aws-sdk/client-cloudwatch').CloudWatchClient | null = null

async function getCloudWatchClient(): Promise<import('@aws-sdk/client-cloudwatch').CloudWatchClient> {
  if (cloudWatchClientSingleton) return cloudWatchClientSingleton
  const { CloudWatchClient } = await import('@aws-sdk/client-cloudwatch')
  cloudWatchClientSingleton = new CloudWatchClient({
    region: AWS_REGION,
  })
  return cloudWatchClientSingleton
}

async function putBoostMetric(input: BoostMetricInput): Promise<void> {
  const { PutMetricDataCommand } = await import('@aws-sdk/client-cloudwatch')
  const client = await getCloudWatchClient()
  await client.send(
    new PutMetricDataCommand({
      Namespace: 'AreaCode/Business',
      MetricData: [
        {
          MetricName: input.MetricName,
          Dimensions: input.Dimensions,
          Unit: 'Count',
          Value: 1,
          Timestamp: new Date(),
        },
      ],
    }),
  )
}

// ─── Const-fallback warn-log cold-start guard ───────────────────────────────
//
// R3.2 / R9.3: when any BoostFloor_Row is missing, fall back to
// `BOOST_PRICING[duration]` and emit a single `warn`-level log per cold start
// with `branch=floor_loaded_from_const_fallback`. The flag is module-scoped
// and reset by the Lambda runtime on every cold start.

let floorFallbackLoggedThisColdStart = false

// ─── Booster Floor Check (pure) ─────────────────────────────────────────────

/**
 * Pure decision function for the booster price-floor check.
 *
 * Used by both `purchaseBoost` (which integrates this into the checkout-creation
 * path in task 3.3) and the property test in
 * `__tests__/floor-check.property.test.ts`. Observably pure: no I/O, no
 * `Date.now()`, no globals — so the property test can run it 100+ times against
 * arbitrary inputs and rely on the result depending only on its arguments.
 *
 * Returns `accept` if and only if `computedPriceCents >= floorCents`.
 *
 * Validates: Requirements 3.3, 3.4, 10.1
 */
export function checkBoostFloor(
  computedPriceCents: number,
  floorCents: number,
): { decision: 'accept' } | { decision: 'reject'; code: 'BOOST_BELOW_FLOOR' } {
  if (computedPriceCents >= floorCents) {
    return { decision: 'accept' }
  }
  return { decision: 'reject', code: 'BOOST_BELOW_FLOOR' }
}

// ─── Onboarding Status ──────────────────────────────────────────────────────

export async function getOnboardingStatus(businessId: string) {
  if (DEV_MODE) return { hasNode: true, hasReward: true, hasStaff: true, hasQr: true }
  const nodes = await repo.getNodesForBusiness(businessId)
  const rewards = await getBusinessRewards(businessId)
  const staff = await repo.listStaffAccounts(businessId)
  return {
    hasNode: nodes.length > 0,
    hasReward: (rewards.items ?? []).length > 0,
    hasStaff: staff.length > 0,
    hasQr: nodes.some((n: any) => n.qrCheckinEnabled),
  }
}

// ─── Trial Expiry Enforcement ───────────────────────────────────────────────

// Tier_Resolver (billing-revenue-integrity R4.1, design Property 3). The single
// authority for "what tier is this business entitled to right now" on every
// feature-gating read path. A paid stored tier resolves only while at least one
// entitlement window is active — trial, paidUntil, or the payment grace window.
// When every window has lapsed the business falls back to starter. Free/starter
// stored tiers always resolve starter. Total: never throws on any input.
export function getEffectiveTier(
  biz: {
    tier?: string
    trialEndsAt?: string | null
    paidUntil?: string | null
    paymentGraceUntil?: string | null
  },
  nowMs: number = Date.now(),
): string {
  const tier = biz.tier ?? 'free'
  if (tier === 'free' || tier === 'starter') return 'starter'

  // Paid stored tier: entitled while any window is still open. A malformed date
  // parses to NaN, and `NaN > now` is false, so a bad value simply fails closed
  // to "window inactive" rather than throwing.
  const windowActive = (iso?: string | null): boolean => {
    if (!iso) return false
    return new Date(iso).getTime() > nowMs
  }

  if (windowActive(biz.trialEndsAt) || windowActive(biz.paidUntil) || windowActive(biz.paymentGraceUntil)) {
    return tier
  }
  return 'starter'
}

// ─── Business Profile ───────────────────────────────────────────────────────

function withoutPhoneFields<T extends object>(record: T): Omit<T, 'phone' | 'invitedPhone'> {
  const safe = { ...record } as T & { phone?: unknown; invitedPhone?: unknown }
  delete safe.phone
  delete safe.invitedPhone
  return safe
}

export async function getBusinessProfileById(businessId: string) {
  const biz = await repo.findBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business account not found')
  return withoutPhoneFields(biz)
}

export async function getBusinessProfile(cognitoSub: string) {
  if (DEV_MODE) {
    // Representative paid window so the dev portal can render billing state
    // (R2.6). Values are illustrative only and never reach production.
    return {
      id: 'dev-biz-1',
      businessName: 'Dev Business',
      email: 'dev@areacode.co.za',
      tier: 'growth',
      cognitoSub,
      paidUntil: addPaidInterval(new Date().toISOString(), 'monthly'),
      paidInterval: 'monthly' as PaidInterval,
      // Digest_Optout (weekly-attribution-digest R4.5): surfaced so the dev
      // SettingsPanel can render the toggle's current state. Emails default on.
      digestEmailOptOut: false,
    }
  }
  // Strip phone fields from the live business response while preserving the
  // complete account shape used by billing and settings.
  const biz = await repo.findBusinessByCognitoSub(cognitoSub)
  if (!biz) throw AppError.notFound('Business account not found')
  return withoutPhoneFields(biz)
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

const YOCO_API_BASE = 'https://payments.yoco.com/api'

function getBusinessAppUrl(): string {
  // Required in prod: checkout redirect URLs must point at the real business
  // portal, never a masking default (no-fallbacks-no-legacy.md). `requireEnv`
  // crashes prod when unset; dev/test keep the local portal default.
  return requireEnv('BUSINESS_APP_URL', 'http://localhost:3001')
}

async function createYocoCheckout(
  amountCents: number,
  metadata: Record<string, unknown>,
  pathAfterReturn: string,
): Promise<{ id: string; redirectUrl: string }> {
  // R1.3: explicit env branch, no masking `??` fallback chain. Prod reads ONLY
  // the prod key; dev/test reads ONLY the dev key. A missing prod key is a
  // serviceUnavailable, never a silent fall-through to the dev key or an empty
  // string (`no-fallbacks-no-legacy.md`).
  const secretKey = APP_ENV === 'dev' ? process.env['YOCO_DEV_SECRET_KEY'] : process.env['YOCO_PROD_SECRET_KEY']
  if (!secretKey) {
    throw AppError.serviceUnavailable('Payment provider is not configured. Please contact support.')
  }

  const appUrl = getBusinessAppUrl()
  const body = {
    amount: amountCents,
    currency: 'ZAR',
    successUrl: `${appUrl}${pathAfterReturn}?status=success`,
    cancelUrl: `${appUrl}${pathAfterReturn}?status=cancelled`,
    failureUrl: `${appUrl}${pathAfterReturn}?status=failed`,
    metadata,
  }

  const res = await fetch(`${YOCO_API_BASE}/checkouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `${metadata['businessId'] as string}-${Date.now()}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw AppError.badGateway(`Yoco checkout failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as { id: string; redirectUrl: string }
  if (!data.redirectUrl) {
    throw AppError.badGateway('Yoco returned no redirectUrl')
  }
  return data
}

export async function createCheckoutSession(businessId: string, plan: 'growth' | 'pro' | 'payg', interval?: string) {
  if (DEV_MODE) {
    const amountCents = plan === 'payg' ? 2900 : 14900
    return {
      checkoutUrl: '#dev-checkout',
      amountCents,
      currency: 'ZAR',
      metadata: { businessId, plan, interval },
    }
  }
  const biz = await repo.findBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')

  // Determine amount based on plan + interval
  let amountCents: number
  if (plan === 'payg') {
    amountCents = interval === 'weekly' ? BUSINESS_PLANS.payg.weeklyPrice : BUSINESS_PLANS.payg.dailyPrice
  } else {
    const planConfig = BUSINESS_PLANS[plan]
    amountCents = interval === 'yearly' ? planConfig.yearlyPrice : planConfig.monthlyPrice
  }

  const metadata = { businessId, plan, interval: interval ?? '', type: 'subscription' }
  const { id, redirectUrl } = await createYocoCheckout(amountCents, metadata, '/plans')

  return {
    checkoutUrl: redirectUrl,
    checkoutId: id,
    amountCents,
    currency: 'ZAR',
    metadata,
  }
}

// ─── Boost ──────────────────────────────────────────────────────────────────

export async function purchaseBoost(businessId: string, nodeId: string, duration: BoostDuration) {
  if (DEV_MODE) {
    const amountCents = BOOST_PRICING[duration]
    return {
      checkoutUrl: '#dev-boost',
      amountCents,
      currency: 'ZAR',
      metadata: { businessId, nodeId, duration, type: 'boost' },
    }
  }
  const node = await repo.getNodeForBusiness(nodeId, businessId)
  if (!node) throw AppError.forbidden('You do not own this node')

  const amountCents = BOOST_PRICING[duration]

  // ── Floor enforcement (R3.1, R3.2, R3.3, R3.4, R9.1–R9.5) ────────────────
  //
  // Resolve the effective floor, preferring the persisted `BoostFloor_Row` and
  // falling back to `BOOST_PRICING[duration]` (which equals
  // `BOOST_FLOOR_DEFAULTS[duration]` by construction) when the row is missing.
  // The fallback warn-log fires once per cold start so an operator can answer
  // "why did the rejection branch never fire" without re-running the request
  // locally.
  const floorRow = await repo.getBoostFloor(duration)
  let effectiveFloor: number
  if (floorRow !== null) {
    effectiveFloor = floorRow.floorCents
    logBoostBranch('floor_loaded_from_dynamo', {
      businessId,
      duration,
      effectiveFloor,
    })
  } else {
    effectiveFloor = BOOST_PRICING[duration]
    if (!floorFallbackLoggedThisColdStart) {
      floorFallbackLoggedThisColdStart = true
      logBoostBranch('floor_loaded_from_const_fallback', {
        duration,
        effectiveFloor,
        reason: 'BoostFloor_Row missing; falling back to BOOST_PRICING const',
      })
    }
  }

  // `decideBoostFloorWithMetric` (task 3.2) encodes the
  // "metric-emission failure must not block rejection" contract from R9.5 —
  // it swallows any throw from `putBoostMetric` and still returns the reject
  // decision. We rely on that here rather than duplicating the try/catch.
  const decision = await decideBoostFloorWithMetric(amountCents, effectiveFloor, duration, businessId, putBoostMetric)

  if (decision.decision === 'reject') {
    logBoostBranch('floor_violation_rejected', {
      businessId,
      duration,
      amountCents,
      effectiveFloor,
    })
    throw new AppError(400, 'BOOST_BELOW_FLOOR', 'Booster price is below the configured floor for this duration')
  }

  const metadata = { businessId, nodeId, duration, type: 'boost' }
  const { id, redirectUrl } = await createYocoCheckout(amountCents, metadata, '/boost')

  return {
    checkoutUrl: redirectUrl,
    checkoutId: id,
    amountCents,
    currency: 'ZAR',
    metadata,
  }
}

// ─── Yoco Webhook ───────────────────────────────────────────────────────────

export async function processYocoWebhook(
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>,
  signature: string,
  rawBody?: string,
) {
  if (DEV_MODE) return { duplicate: false }

  // Verify signature using raw body bytes for accuracy.
  //
  // Fail closed on a missing secret (`no-fallbacks-no-legacy.md`): a payment
  // webhook must never be verified against a dev key or an empty string. With
  // an empty secret the HMAC is still a non-empty digest, so the `!expected`
  // guard would not catch it — reject before computing any HMAC instead.
  const secret = process.env['YOCO_WEBHOOK_SECRET']
  if (!secret) {
    throw AppError.unauthorized('Invalid webhook signature')
  }

  const bodyToSign = rawBody ?? JSON.stringify(payload)
  const expected = createHmac('sha256', secret).update(bodyToSign).digest('hex')

  if (!signature) {
    throw AppError.unauthorized('Invalid webhook signature')
  }

  // Use timing-safe comparison to prevent timing attacks
  if (!digestsEqual(signature, expected)) {
    throw AppError.unauthorized('Invalid webhook signature')
  }

  const claimResult = await repo.claimWebhookEvent(eventId, eventType)
  if (claimResult === 'processed') {
    // R2.5: log the duplicate-event-id branch when the inbound event is a
    // boost-typed payload, so an operator can answer "did this booster
    // payment get audited" by grepping the structured log alone.
    const metadata = payload['metadata'] as Record<string, string> | undefined
    if (metadata?.['type'] === 'boost') {
      logBoostBranch('purchase_audit_duplicate_event_id', {
        eventId,
        eventType,
        yocoCheckoutId: metadata['checkoutId'] ?? (payload['checkoutId'] as string | undefined),
        businessId: metadata['businessId'],
        duration: metadata['duration'],
      })
    }
    return { duplicate: true }
  }
  if (claimResult === 'processing') {
    throw AppError.conflict('Webhook event is already being processed')
  }

  try {
    if (eventType === 'payment.succeeded') {
      await handlePaymentSucceeded(payload)
    } else if (eventType === 'payment.failed') {
      await handlePaymentFailed(payload)
    }
    await repo.markWebhookEventProcessed(eventId)
  } catch (err) {
    const failureMessage = err instanceof Error ? err.message.slice(0, 500) : 'Webhook processing failed'
    await repo.markWebhookEventFailed(eventId, failureMessage)
    throw err
  }

  return { duplicate: false }
}

async function handlePaymentSucceeded(payload: Record<string, unknown>) {
  const metadata = payload['metadata'] as Record<string, string> | undefined

  // ── Booster purchase audit branch (R1.1) ────────────────────────────────
  // Booster events carry `metadata.type === 'boost'` rather than
  // `metadata.plan`. Dispatch to the audit-row writer before the
  // subscription-tier branch below.
  if (metadata?.['type'] === 'boost') {
    await persistBoosterPurchase(payload)
    return
  }

  // ── Subscription activation branch (billing-revenue-integrity R2) ────────
  // Everything past the boost branch is a subscription payment. Unlike the
  // boost branch (which logs-and-returns on unrecognised metadata), a
  // subscription with malformed metadata MUST throw so the webhook returns
  // non-2xx and Yoco retries rather than activating an undefined plan (R2.5).
  await persistSubscriptionPayment(payload)
}

// ─── Subscription payment activation (billing-revenue-integrity R2) ──────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md` Flow 1.
//
// Mirrors `persistBoosterPurchase`'s write choreography (marker-first
// conditional puts via `putSubscriptionPaymentWithMarker`, idempotent on
// `yocoCheckoutId`) but with two deliberate differences dictated by R2:
//
//   1. Malformed `metadata.plan` / `metadata.interval` THROWS (R2.5) instead of
//      logging-and-returning. A subscription webhook we cannot shape-validate
//      must trigger a Yoco retry, never a silent no-op that could strand a
//      paid business on the wrong tier.
//   2. The audit row stores `paidUntilProduced` (the exact window end this
//      payment bought). On a re-delivery under a fresh eventId the marker read
//      returns `duplicate`; the reconciliation branch re-asserts the
//      Business_Row from that stored value so a replay never extends the window
//      a second time (R2.4, design Flow 1 ordering note).
//
// Ordering (Flow 1): marker + audit row precede the Business_Row update. A
// crash between the audit write and the activation is healed by the Yoco
// retry landing on the duplicate marker and running the reconciliation branch.

const SUBSCRIPTION_PLANS_SET: ReadonlySet<'growth' | 'pro' | 'payg'> = new Set(['growth', 'pro', 'payg'])
const PAID_INTERVALS_SET: ReadonlySet<PaidInterval> = new Set(PAID_INTERVALS)

function logSubscriptionBranch(branch: string, fields: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      feature: 'business',
      operation: 'persistSubscriptionPayment',
      branch,
      ...fields,
    }),
  )
}

// Canonical price for a (plan, interval) pair, from the single source of truth
// `BUSINESS_PLANS` (the same table `createCheckoutSession` charges from). An
// unsupported combination (e.g. `growth` + `daily`) returns null and is treated
// as malformed metadata by the caller.
function subscriptionAmountCents(plan: 'growth' | 'pro' | 'payg', interval: PaidInterval): number | null {
  if (plan === 'payg') {
    if (interval === 'daily') return BUSINESS_PLANS.payg.dailyPrice
    if (interval === 'weekly') return BUSINESS_PLANS.payg.weeklyPrice
    return null
  }
  if (interval === 'monthly') return BUSINESS_PLANS[plan].monthlyPrice
  if (interval === 'yearly') return BUSINESS_PLANS[plan].yearlyPrice
  return null
}

async function persistSubscriptionPayment(payload: Record<string, unknown>): Promise<void> {
  const metadata = (payload['metadata'] ?? {}) as Record<string, unknown>
  const businessId = typeof metadata['businessId'] === 'string' ? metadata['businessId'] : ''
  const plan = metadata['plan']
  const interval = metadata['interval']

  // R2.5: shape-validate plan and interval. Anything malformed THROWS so the
  // webhook returns non-2xx and Yoco retries (never activate an undefined plan).
  if (
    businessId.length === 0 ||
    businessId.length > 64 ||
    typeof plan !== 'string' ||
    !SUBSCRIPTION_PLANS_SET.has(plan as 'growth' | 'pro' | 'payg') ||
    typeof interval !== 'string' ||
    !PAID_INTERVALS_SET.has(interval as PaidInterval)
  ) {
    throw AppError.badRequest('Subscription webhook metadata failed shape validation')
  }

  const validPlan = plan as 'growth' | 'pro' | 'payg'
  const validInterval = interval as PaidInterval

  const expectedAmountCents = subscriptionAmountCents(validPlan, validInterval)
  if (expectedAmountCents === null) {
    // A plan/interval pair with no price is malformed (e.g. growth + daily).
    throw AppError.badRequest(`Unsupported plan/interval combination: ${validPlan}/${validInterval}`)
  }

  const webhookAmount = payload['amount']
  const webhookCurrency = payload['currency']
  if (
    typeof webhookAmount !== 'number' ||
    !Number.isInteger(webhookAmount) ||
    webhookAmount <= 0 ||
    webhookAmount !== expectedAmountCents ||
    webhookCurrency !== 'ZAR'
  ) {
    throw AppError.badRequest('Subscription webhook amount or currency did not match the selected plan')
  }
  const amountCents = webhookAmount

  // Yoco quotes the checkout id back inside `metadata` or at the top level
  // (same extraction order as `persistBoosterPurchase`).
  const yocoCheckoutId =
    typeof metadata['checkoutId'] === 'string' && metadata['checkoutId'].length > 0
      ? metadata['checkoutId']
      : typeof payload['checkoutId'] === 'string'
        ? (payload['checkoutId'] as string)
        : typeof payload['id'] === 'string'
          ? (payload['id'] as string)
          : ''
  if (yocoCheckoutId.length === 0 || yocoCheckoutId.length > 128) {
    throw AppError.badRequest('Subscription webhook missing a usable yocoCheckoutId')
  }

  // The business must exist to activate the paid window on it. A missing
  // business is surfaced (throw → Yoco retry), never silently swallowed.
  const biz = await repo.findBusinessById(businessId)
  if (!biz) {
    throw AppError.notFound(`Business ${businessId} not found for subscription activation`)
  }

  // R2.3: extend from max(now, existing paidUntil) so a Renewal_Checkout adds
  // to the remaining window rather than resetting it.
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const existingPaidUntil =
    typeof (biz as { paidUntil?: unknown }).paidUntil === 'string'
      ? ((biz as { paidUntil?: string }).paidUntil as string)
      : null
  const fromIso = existingPaidUntil && new Date(existingPaidUntil).getTime() > nowMs ? existingPaidUntil : nowIso
  const paidUntil = addPaidInterval(fromIso, validInterval)

  // Yoco's `payment.succeeded` payload may include a top-level `paidAt`;
  // otherwise stamp "now" so the audit row always carries a sortable
  // millisecond-precision UTC timestamp (mirrors `persistBoosterPurchase`).
  const paidAtRaw = payload['paidAt']
  const paidAtIso = typeof paidAtRaw === 'string' && paidAtRaw.length > 0 ? paidAtRaw : new Date().toISOString()
  const createdAtIso = new Date().toISOString()

  const purchase: SubscriptionPaymentRow = {
    pk: `SUB#${businessId}`,
    sk: `SUB#${paidAtIso}#${yocoCheckoutId}`,
    gsi1pk: 'SUB_BY_TIME',
    gsi1sk: paidAtIso,
    businessId,
    plan: validPlan,
    interval: validInterval,
    amountCents,
    currency: 'ZAR',
    yocoCheckoutId,
    paidAt: paidAtIso,
    paidUntilProduced: paidUntil,
    createdAt: createdAtIso,
  }

  const marker: SubCheckoutMarkerRow = {
    pk: `SUB_CHECKOUT#${yocoCheckoutId}`,
    sk: `SUB_CHECKOUT#${yocoCheckoutId}`,
    businessId,
    subPk: purchase.pk,
    subSk: purchase.sk,
    createdAt: createdAtIso,
  }

  const { result } = await repo.putSubscriptionPaymentWithMarker({ purchase, marker })

  if (result === 'duplicate') {
    // Replay reconciliation (design Flow 1). Re-assert the Business_Row state
    // idempotently from the ALREADY-persisted row's `paidUntilProduced`, so a
    // re-delivery never extends the window a second time. Recompute nothing
    // from `now`.
    const existingMarker = await repo.getSubCheckoutMarker(yocoCheckoutId)
    const existingRow = existingMarker
      ? await repo.getSubscriptionPaymentByKey(existingMarker.subPk, existingMarker.subSk)
      : null
    if (existingRow) {
      await repo.activateSubscriptionOnBusiness(businessId, {
        tier: existingRow.plan,
        paidUntil: existingRow.paidUntilProduced,
        paidInterval: existingRow.interval,
      })
      logSubscriptionBranch('activation_replay_reconciled', {
        businessId,
        plan: existingRow.plan,
        interval: existingRow.interval,
        yocoCheckoutId,
        paidUntil: existingRow.paidUntilProduced,
      })
    } else {
      // Orphaned marker with no row (a compensating delete that itself failed,
      // per the repository's documented edge). Nothing to reconcile from; log
      // loudly so an operator can act rather than silently no-op.
      logSubscriptionBranch('activation_replay_row_missing', { businessId, yocoCheckoutId })
    }
    return
  }

  // `written`: activate the freshly-produced window.
  await repo.activateSubscriptionOnBusiness(businessId, {
    tier: validPlan,
    paidUntil,
    paidInterval: validInterval,
  })
  logSubscriptionBranch('activation_written', {
    businessId,
    plan: validPlan,
    interval: validInterval,
    yocoCheckoutId,
    amountCents,
    paidUntil,
  })
}

// ─── Booster purchase audit (R1) ────────────────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` Flow 2.
//
// When `processYocoWebhook → handlePaymentSucceeded` receives a
// `payment.succeeded` event with `metadata.type === 'boost'`, persist a
// durable `BoosterPurchase` audit row plus an `Idempotency_Marker`
// (`BOOST_CHECKOUT#<yocoCheckoutId>`) so the same Yoco checkout id can
// never produce two audit rows even if Yoco issues a fresh `eventId` for a
// re-delivery (R2.5).
//
// Validation here is intentionally lenient on shape (just enough to refuse
// to write a malformed row) and matches the existing webhook behaviour for
// unrecognised metadata: log and return without raising. If the actual
// `putBoosterPurchaseWithMarker` call fails for a non-conditional reason,
// emit a `BoostPurchaseAuditMissing` CloudWatch metric (R9.6) and re-throw
// so the webhook returns non-2xx and Yoco retries the delivery.

const BOOST_DURATIONS_SET: ReadonlySet<BoostDuration> = new Set(['2hr', '6hr', '24hr'])

function isPositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}

function normaliseTierSnapshot(tier: string): 'starter' | 'growth' | 'pro' | 'payg' {
  return tier === 'growth' || tier === 'pro' || tier === 'payg' ? tier : 'starter'
}

async function persistBoosterPurchase(payload: Record<string, unknown>): Promise<void> {
  const metadata = (payload['metadata'] ?? {}) as Record<string, unknown>
  const businessId = typeof metadata['businessId'] === 'string' ? metadata['businessId'] : ''
  const nodeId = typeof metadata['nodeId'] === 'string' ? metadata['nodeId'] : ''
  const duration = metadata['duration']
  const amount = payload['amount']
  // Yoco quotes the checkout id back inside `metadata` or at the top level.
  const yocoCheckoutId =
    typeof metadata['checkoutId'] === 'string' && metadata['checkoutId'].length > 0
      ? metadata['checkoutId']
      : typeof payload['checkoutId'] === 'string'
        ? (payload['checkoutId'] as string)
        : typeof payload['id'] === 'string'
          ? (payload['id'] as string)
          : ''

  // R1.1: shape-validate the payload. Anything unrecognised is a webhook the
  // booster service is not expected to action — log and skip without raising,
  // matching the existing "unrecognised metadata" behaviour above.
  if (
    businessId.length === 0 ||
    businessId.length > 64 ||
    nodeId.length === 0 ||
    nodeId.length > 64 ||
    typeof duration !== 'string' ||
    !BOOST_DURATIONS_SET.has(duration as BoostDuration) ||
    !isPositiveInteger(amount) ||
    yocoCheckoutId.length === 0 ||
    yocoCheckoutId.length > 128
  ) {
    console.warn(
      JSON.stringify({
        feature: 'business',
        operation: 'persistBoosterPurchase',
        branch: 'purchase_audit_invalid_payload',
        reason: 'metadata or amount failed shape validation',
        businessId,
        nodeId,
        duration,
        amountType: typeof amount,
      }),
    )
    return
  }

  const validDuration = duration as BoostDuration

  // R1.2: snapshot tier and neighbourhood at write time so a future tier or
  // neighbourhood change does not retroactively rewrite the audit history.
  // Both lookups are point reads on existing tables; failures are surfaced
  // (we do not silently fall back) so a transient table error triggers a
  // Yoco retry rather than an audit row with empty snapshot fields.
  const biz = await repo.findBusinessById(businessId)
  const tierSnapshot: 'starter' | 'growth' | 'pro' | 'payg' = biz
    ? normaliseTierSnapshot(getEffectiveTier(biz as { tier?: string; trialEndsAt?: string | null }))
    : 'starter'

  const { getNodeById } = await import('../nodes/dynamodb-repository.js')
  const node = await getNodeById(nodeId)
  const nodeRec = node as unknown as Record<string, unknown> | null
  const neighbourhoodIdSnapshot =
    nodeRec && typeof nodeRec['neighbourhoodId'] === 'string' ? (nodeRec['neighbourhoodId'] as string) : null

  // R1.2: snapshot the effective floor at write time using the same fallback
  // semantics as `purchaseBoost` so the value persisted on the row reflects
  // the floor that was in force when the payment landed.
  const floorRow = await repo.getBoostFloor(validDuration)
  const floorAtPurchaseCents = floorRow?.floorCents ?? BOOST_PRICING[validDuration]

  // Yoco's `payment.succeeded` payload may include a top-level `paidAt`; if
  // not, fall back to "now" so the audit row always carries a sortable
  // millisecond-precision UTC timestamp.
  const paidAtRaw = payload['paidAt']
  const paidAtIso = typeof paidAtRaw === 'string' && paidAtRaw.length > 0 ? paidAtRaw : new Date().toISOString()
  const createdAtIso = new Date().toISOString()

  const purchase: BoosterPurchaseRow = {
    pk: `BOOST#${businessId}`,
    sk: `BOOST#${paidAtIso}#${yocoCheckoutId}`,
    gsi1pk: 'BOOST_BY_TIME',
    gsi1sk: paidAtIso,
    businessId,
    nodeId,
    duration: validDuration,
    amountCents: amount,
    currency: 'ZAR',
    yocoCheckoutId,
    paidAt: paidAtIso,
    tierSnapshot,
    neighbourhoodIdSnapshot,
    floorAtPurchaseCents,
    createdAt: createdAtIso,
  }

  const marker: BoosterCheckoutMarkerRow = {
    pk: `BOOST_CHECKOUT#${yocoCheckoutId}`,
    sk: `BOOST_CHECKOUT#${yocoCheckoutId}`,
    businessId,
    boostPk: purchase.pk,
    boostSk: purchase.sk,
    createdAt: createdAtIso,
  }

  try {
    const { result } = await repo.putBoosterPurchaseWithMarker({ purchase, marker })
    if (result === 'duplicate') {
      logBoostBranch('purchase_audit_duplicate_yoco_checkout_id', {
        businessId,
        duration: validDuration,
        yocoCheckoutId,
      })
    } else {
      logBoostBranch('purchase_audit_written', {
        businessId,
        duration: validDuration,
        yocoCheckoutId,
        amountCents: amount,
      })
    }
  } catch (err) {
    // R9.6: emit `BoostPurchaseAuditMissing` then re-throw so Yoco retries.
    // The metric emission MUST NOT swallow or suppress the original error —
    // the webhook needs to return non-2xx for the retry to fire.
    try {
      await putBoostMetric({
        MetricName: 'BoostPurchaseAuditMissing',
        Dimensions: [{ Name: 'duration', Value: validDuration }],
      })
    } catch (metricErr) {
      console.warn('[business] persistBoosterPurchase: BoostPurchaseAuditMissing metric emission failed', metricErr)
    }
    throw err
  }

  // R5.1 (Flow 2): once the audit row has landed, set the node's Boost_Window
  // to `paidAt + duration`. Runs after both a fresh `written` and a
  // `duplicate` result: `setNodeBoostWindow` max-merges (it writes only when
  // the new window ends later), so re-delivery recomputes the identical
  // `boostUntil` from the row's own `paidAt` and the conditional write is a
  // benign no-op — never a double-extension. Running it on `duplicate` too
  // heals the case where an earlier delivery wrote the audit row but crashed
  // before the window landed. A failure here throws so Yoco retries.
  const boostUntil = boostWindowEnd(paidAtIso, validDuration)
  const { setNodeBoostWindow } = await import('../nodes/dynamodb-repository.js')
  await setNodeBoostWindow(nodeId, boostUntil)
}

async function handlePaymentFailed(payload: Record<string, unknown>) {
  const metadata = payload['metadata'] as Record<string, string> | undefined
  if (!metadata?.['businessId']) return

  const businessId = metadata['businessId']
  const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  await repo.setPaymentGrace(businessId, graceUntil)
  // Email notifications on day 1, 4, 7 handled by SES worker
}

// ─── Staff Management ───────────────────────────────────────────────────────

// Single source of truth for staff head-count per tier. Consumed here (invite
// creation) and by the auth accept paths (auth/service.ts) via
// `assertStaffCapacity`, so the check at invite time and accept time can never
// drift. `null` means unlimited.
export const STAFF_LIMITS: Record<string, number | null> = {
  free: 2,
  starter: 2,
  growth: 5,
  pro: null,
  payg: 2,
}

// Throws AppError.forbidden when the business is already at its staff limit for
// its EFFECTIVE tier (honouring trial expiry). One home for the limit check so
// invite creation and invite acceptance always agree.
export async function assertStaffCapacity(businessId: string): Promise<void> {
  const biz = await repo.findBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')

  const effectiveTier = getEffectiveTier(biz as { tier?: string; trialEndsAt?: string | null })
  const limit = STAFF_LIMITS[effectiveTier]
  if (limit === null || limit === undefined) return

  const count = await repo.countStaffForBusiness(businessId)
  if (count >= limit) {
    throw AppError.forbidden(`Staff limit reached for ${effectiveTier} tier (max ${limit})`)
  }
}

export async function inviteStaff(businessId: string, email: string, role: 'manager' | 'staff' = 'staff') {
  if (DEV_MODE) {
    return {
      id: `dev-invite-${Date.now()}`,
      businessId,
      invitedEmail: email,
      role,
      inviteToken: 'dev-token',
      accepted: false,
    }
  }
  await assertStaffCapacity(businessId)

  return repo.createStaffInvite(businessId, email, role)
}

export async function listStaffInvites(businessId: string) {
  if (DEV_MODE) return []
  const invites = await repo.listStaffInvites(businessId)
  return invites.map(withoutPhoneFields)
}

export async function revokeStaffInvite(businessId: string, token: string) {
  if (DEV_MODE) return { revoked: true }
  const result = await repo.deleteStaffInvite(businessId, token)
  if (result.count === 0) throw AppError.notFound('Invite not found or already accepted')
  return { revoked: true }
}

export async function listStaff(businessId: string) {
  if (DEV_MODE) return []
  const staff = await repo.listStaffAccounts(businessId)
  return staff.map(withoutPhoneFields)
}

export async function removeStaff(staffId: string, businessId: string) {
  if (DEV_MODE) return

  // Soft-delete in DynamoDB
  const result = await repo.removeStaffAccount(staffId, businessId)
  if (result.count === 0) throw AppError.notFound('Staff member not found')

  // Disable the Cognito user so they can't log in anymore
  try {
    const { getStaffById } = await import('../auth/dynamodb-repository.js')
    const staff = await getStaffById(staffId)
    if (staff?.cognitoSub) {
      const cognito = await import('../../shared/cognito/client.js')
      await cognito.disableCognitoUser('staff', staff.cognitoSub)
    }
  } catch {
    // Best effort — staff is already deactivated in DynamoDB
  }
}

// ─── QR Code ────────────────────────────────────────────────────────────────

export function generateQrToken(nodeId: string): string {
  const secret = qrHmacSecret()
  const flooredTs = Math.floor(Date.now() / (15 * 60 * 1000))
  return createHmac('sha256', secret).update(`${nodeId}${flooredTs}`).digest('hex').slice(0, 32)
}

export function validateQrToken(nodeId: string, token: string): boolean {
  const secret = qrHmacSecret()
  // Check current and previous window (handles edge cases)
  for (let offset = 0; offset <= 1; offset++) {
    const ts = Math.floor(Date.now() / (15 * 60 * 1000)) - offset
    const expected = createHmac('sha256', secret).update(`${nodeId}${ts}`).digest('hex').slice(0, 32)
    if (digestsEqual(token, expected)) return true
  }
  return false
}

export async function getQrData(nodeId: string, businessId: string) {
  if (DEV_MODE) {
    const token = generateQrToken(nodeId)
    return { url: `https://areacode.co.za/qr/${nodeId}/${token}`, token, nodeId }
  }
  const node = await repo.getNodeForBusiness(nodeId, businessId)
  if (!node) throw AppError.forbidden('You do not own this node')

  // Auto-enable QR check-ins when a business generates a QR code
  if (!(node as Record<string, unknown>)['qrCheckinEnabled']) {
    const { updateNode } = await import('../nodes/dynamodb-repository.js')
    await updateNode(nodeId, { qrCheckinEnabled: true })
  }

  const token = generateQrToken(nodeId)
  return {
    url: `https://areacode.co.za/qr/${nodeId}/${token}`,
    token,
    nodeId,
  }
}

// ─── Trial Management ───────────────────────────────────────────────────────

const TRIAL_DAYS = 14

export async function startTrial(businessId: string, plan: 'growth' | 'pro') {
  if (DEV_MODE) {
    return {
      id: businessId,
      tier: plan,
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
    }
  }

  const biz = await repo.findBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')

  // One trial per business ever. trialEndsAt is set to a non-null value on
  // trial start and stays non-null even after the trial expires, so its
  // presence is a reliable marker that a trial has been used.
  if (biz.trialEndsAt) {
    throw AppError.conflict('You have already used your free trial. Upgrade to continue with this plan.')
  }

  // Trials only apply to plans that offer them.
  if (!BUSINESS_PLANS[plan].trialDays) {
    throw AppError.badRequest('This plan does not include a free trial')
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await repo.updateBusinessTier(businessId, plan, trialEndsAt)
  return { success: true, tier: plan, trialEndsAt }
}

// ─── Live Stats ─────────────────────────────────────────────────────────────

export async function getLiveStats(businessId: string) {
  if (DEV_MODE) {
    return { checkInsToday: 34, rewardsClaimed: 12, pulseScore: 45, totalCheckIns: 1247 }
  }
  return repo.getLiveStats(businessId)
}

// ─── Business Nodes ─────────────────────────────────────────────────────────

export async function getBusinessNodes(businessId: string) {
  if (DEV_MODE) {
    return { items: [] }
  }
  const items = await repo.getNodesForBusiness(businessId)
  return { items }
}

// ─── Audience Analytics ─────────────────────────────────────────────────────

export async function getAudienceAnalytics(businessId: string) {
  if (DEV_MODE) {
    return {
      tierDistribution: { local: 40, regular: 30, fixture: 20, institution: 8, legend: 2 },
      repeatVsNew: { repeat: 180, new: 67 },
      totalUniqueVisitors: 247,
      peakHours: ['12:00-14:00', '18:00-21:00'],
    }
  }
  return repo.getAudienceAnalytics(businessId)
}

// ─── Music Audience ─────────────────────────────────────────────────────────

export async function getMusicAudience(businessId: string) {
  if (DEV_MODE) {
    return {
      totalWithMusicPrefs: 0,
      genreDistribution: {},
      archetypeBreakdown: {},
      peakArchetypeByTime: [],
    }
  }
  return repo.getMusicAudience(businessId)
}

// ─── Recent Redemptions ─────────────────────────────────────────────────────

export async function getRecentRedemptions(businessId: string) {
  if (DEV_MODE) {
    return []
  }
  return repo.getRecentRedemptions(businessId)
}

// ─── Business Rewards (list) ────────────────────────────────────────────────

/**
 * Operator-facing get list. Returns every get the business owns, annotated
 * with a `lifecycle` field so the portal can show scheduled/live/past
 * happenings (R3.6, R6.3). The annotation is additive — every existing
 * reward field is preserved, so the response stays a superset of today's
 * shape (R7.2).
 *
 * Lifecycle rules:
 *   - event/offer gets carrying a valid `[startsAt, endsAt)` window get their
 *     true lifecycle via `classifyLifecycle(startsAt, endsAt, Date.now())`.
 *   - loyalty gets (or any get without a window) are always `live` — they have
 *     no Active_Window and are perpetually available.
 *
 * `getCategory` is normalised to `'loyalty'` when absent so callers never see
 * `undefined` (R1.1, R7.1). The raw reward attributes (including
 * `getCategory`/`startsAt`/`endsAt`/`claimRequiresCheckIn`) flow through from
 * `repo.getRewardsForBusiness`, which reads full reward rows.
 *
 * Authorization (the business JWT) is enforced at the route layer
 * (`requireAuth('business', 'staff')`) — R6.6.
 */
export async function getBusinessRewards(businessId: string) {
  if (DEV_MODE) {
    return { items: [] }
  }
  const items = await repo.getRewardsForBusiness(businessId)
  const nowMs = Date.now()
  const annotated = items.map((item) => {
    const rec = item as Record<string, unknown>
    const getCategory = (rec['getCategory'] as string | undefined) ?? 'loyalty'
    const startsAt = rec['startsAt'] as string | undefined
    const endsAt = rec['endsAt'] as string | undefined

    const lifecycle: Lifecycle =
      (getCategory === 'event' || getCategory === 'offer') && startsAt && endsAt
        ? classifyLifecycle(startsAt, endsAt, nowMs)
        : 'live'

    return { ...rec, getCategory, lifecycle }
  })
  return { items: annotated }
}

// ─── Check-In Details ───────────────────────────────────────────────────────

export async function getCheckInDetails(businessId: string, date?: string, cursor?: string) {
  if (DEV_MODE) {
    return {
      items: [
        {
          displayName: 'Thabo M.',
          tier: 'regular',
          visitCount: 12,
          timestamp: new Date(Date.now() - 600000).toISOString(),
        },
        {
          displayName: 'Naledi K.',
          tier: 'fixture',
          visitCount: 3,
          timestamp: new Date(Date.now() - 1800000).toISOString(),
        },
        {
          displayName: 'Sipho D.',
          tier: 'local',
          visitCount: 1,
          timestamp: new Date(Date.now() - 3600000).toISOString(),
        },
      ],
      nextCursor: null,
    }
  }
  return repo.getCheckInDetails(businessId, date, cursor)
}

// ─── Staff Leaderboard ──────────────────────────────────────────────────────

export async function getStaffLeaderboard(businessId: string, period: 'week' | 'month' | 'all') {
  if (DEV_MODE) {
    return {
      period,
      generatedAt: new Date().toISOString(),
      entries: [
        {
          staffId: 'dev-staff-1',
          staffName: 'Thandi (dev)',
          redemptions: 24,
          prevRedemptions: 18,
          delta: 6,
          attributedReturnVisits: 11,
          uniqueConsumersServed: 19,
        },
        {
          staffId: 'dev-staff-2',
          staffName: 'Sipho (dev)',
          redemptions: 14,
          prevRedemptions: 16,
          delta: -2,
          attributedReturnVisits: 4,
          uniqueConsumersServed: 12,
        },
      ],
    }
  }
  const { getStaffLeaderboard } = await import('./staff-leaderboard.js')
  return getStaffLeaderboard(businessId, period)
}

// ─── Reward Metrics ─────────────────────────────────────────────────────────

export async function getRewardMetrics(rewardId: string, businessId: string) {
  if (DEV_MODE) {
    return { claimRate: 0.65, timeToClaimMinutes: 42, redemptionRate: 0.38 }
  }
  return repo.getRewardMetrics(rewardId, businessId)
}

export async function getRewardsSummary(businessId: string) {
  if (DEV_MODE) {
    return {
      items: [
        {
          rewardId: 'rew-1',
          title: 'Free Coffee',
          claimRate: 0.65,
          timeToClaimMinutes: 42,
          redemptionRate: 0.38,
          isLowPerformance: false,
        },
        {
          rewardId: 'rew-2',
          title: '20% Off Cocktails',
          claimRate: 0.22,
          timeToClaimMinutes: 120,
          redemptionRate: 0.1,
          isLowPerformance: false,
        },
        {
          rewardId: 'rew-3',
          title: 'Free Starter',
          claimRate: 0,
          timeToClaimMinutes: 0,
          redemptionRate: 0,
          isLowPerformance: true,
        },
      ],
    }
  }
  return repo.getRewardsSummary(businessId)
}

// ─── Current Node QR (convenience) ──────────────────────────────────────────

export async function getCurrentNodeQr(businessId: string) {
  if (DEV_MODE) {
    const nodeId = 'dev-node-1'
    const token = generateQrToken(nodeId)
    return { url: `https://areacode.co.za/qr/${nodeId}/${token}`, token, nodeId }
  }
  const nodes = await repo.getNodesForBusiness(businessId)
  if (!nodes.length) throw AppError.notFound('No nodes found')
  const node = nodes[0]!
  const nodeId = node.id

  // Auto-enable QR check-ins when a business generates a QR code
  if (!(node as Record<string, unknown>)['qrCheckinEnabled']) {
    const { updateNode } = await import('../nodes/dynamodb-repository.js')
    await updateNode(nodeId, { qrCheckinEnabled: true })
  }

  const token = generateQrToken(nodeId)
  return { url: `https://areacode.co.za/qr/${nodeId}/${token}`, token, nodeId }
}

// ─── Downgrade / Cancel Subscription & non-payment enforcement ──────────────
//
// Map presence is paid-only (see nodes/repository.ts `getNodesByCitySlug`). To
// actually remove a business that stops paying, we must demote them in storage
// - a read-time filter alone cannot set their nodes inactive. `handlePayment
// Failed` sets a 7-day `paymentGraceUntil`; once that lapses the daily cleanup
// worker calls `enforceLapsedPayments`, which routes through the single home
// below.
//
// `deactivateForNonPayment` is that single home for "take a business off the
// map":
//   - business → tier 'free' + isActive false (`repo.deactivateBusiness`)
//   - every owned node → isActive false (`deactivateNodesForBusiness`), so both
//     the map's `isActive` filter and its paid-tier filter exclude them, and
//     rewards on those nodes stop surfacing (rewards skip inactive nodes)
//   - `paymentGraceUntil` cleared so the next sweep does not re-process it
// Idempotent: re-running on an already-demoted business just re-asserts state.

export async function deactivateForNonPayment(
  businessId: string,
): Promise<{ businessId: string; nodesDeactivated: number }> {
  if (DEV_MODE) return { businessId, nodesDeactivated: 0 }
  await repo.deactivateBusiness(businessId)
  const nodesDeactivated = await deactivateNodesForBusiness(businessId)
  await repo.setPaymentGrace(businessId, null)
  // System-actor audit entry (cross-portal-lifecycle-alignment R2.3) so admin can
  // answer "why did this venue leave the map". Reuses the admin audit-log write
  // (one home for audit rows); actor `system:lapse-sweep` renders in the existing
  // AuditTrailViewer unchanged. A failed audit write must not undo the demotion,
  // so it is logged and swallowed rather than thrown.
  try {
    const { createAuditLog } = await import('../admin/repository.js')
    await createAuditLog({
      adminId: 'system:lapse-sweep',
      adminRole: 'system',
      action: 'deactivate_for_non_payment',
      entityType: 'business',
      entityId: businessId,
      afterState: { tier: 'free', nodesDeactivated },
    })
  } catch (err) {
    console.warn(`[business] deactivateForNonPayment: audit write failed for ${businessId}: ${String(err)}`)
  }
  return { businessId, nodesDeactivated }
}

// ─── Lapse_Sweep phase 1 (billing-revenue-integrity R3.1, R3.6) ─────────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md` Flow 3.
//
// The daily cleanup worker runs this BEFORE `enforceLapsedPayments` (phase 2).
// Phase 1 moves a lapsed-but-not-yet-graced paid business into the 7-day
// renewal grace window and sends one renewal-reminder email; phase 2 later
// demotes anyone whose grace has itself lapsed via `deactivateForNonPayment`.
//
// Selection (`listBusinessesWithLapsedPaidUntil`, R3.1): paid tier, `paidUntil`
// in the past, no grace set, no active trial. While the grace window is active
// the Tier_Resolver (getEffectiveTier, R3.2) still returns the paid tier, so the
// business is not visibly downgraded during grace.
//
// Idempotence / one-email-per-lapse (R3.6): grace is set BEFORE the email so a
// business that has entered grace is excluded from the next run's selection.
// Setting grace is therefore the dedup key — a lapse produces exactly one email,
// and a re-run never re-emails a business already in grace. A per-business
// failure is logged and skipped so one bad row never aborts the sweep (mirrors
// `enforceLapsedPayments`).
export async function startLapseSweep(nowMs: number = Date.now()): Promise<{ graced: number }> {
  if (DEV_MODE) return { graced: 0 }
  const nowIso = new Date(nowMs).toISOString()
  const graceUntilIso = new Date(nowMs + SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const businesses = await repo.listBusinessesWithLapsedPaidUntil(nowIso)
  let graced = 0
  for (const biz of businesses) {
    try {
      // Grace first (the dedup key), then the single email. If the email throws
      // after grace is set, the business is already excluded from the next run,
      // so it is never re-emailed — at most one email per lapse.
      await repo.setPaymentGrace(biz.businessId, graceUntilIso)
      await sendRenewalReminderEmail(biz.email, biz.businessName)
      graced++
    } catch (err) {
      console.warn(`[business] startLapseSweep: failed to grace ${biz.businessId}: ${String(err)}`)
    }
  }
  return { graced }
}

// ─── Pre-lapse renewal reminder (billing-revenue-integrity R3.4) ────────────
//
// Composed into `handleTrialReminders` (trial-reminder.ts): the same daily
// worker that nudges expiring trials also sends this pre-lapse renewal nudge.
//
// See design.md: "trial-reminder worker gains the renewal-reminder query (paid
// tier, `paidUntil` within 7 days, interval monthly/yearly, one send per window
// recorded on the row as `renewalReminderSentFor = paidUntil`)".
//
// Only `monthly` / `yearly` windows get a pre-lapse reminder (R3.4): a `daily`
// or `weekly` payg window is too short for a 7-day lead to be meaningful, so
// the selection query excludes them.
//
// Dedup / one-send-per-window: `listBusinessesForRenewalReminder` excludes any
// row whose `renewalReminderSentFor` already equals its current `paidUntil`, and
// we set that marker after sending. A renewal extends `paidUntil`, so the new
// window's value differs and re-arms the reminder — exactly one email per paid
// window. A per-business failure is logged and skipped so one bad row never
// aborts the sweep (mirrors `startLapseSweep`).
export async function sendRenewalReminders(nowMs: number = Date.now()): Promise<{ reminded: number }> {
  if (DEV_MODE) return { reminded: 0 }
  const nowIso = new Date(nowMs).toISOString()
  const windowEndIso = new Date(nowMs + RENEWAL_REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const businesses = await repo.listBusinessesForRenewalReminder(nowIso, windowEndIso)
  let reminded = 0
  for (const biz of businesses) {
    try {
      const msLeft = Date.parse(biz.paidUntil) - nowMs
      const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))
      await sendRenewalUpcomingEmail(biz.email, biz.businessName, daysLeft)
      await repo.setRenewalReminderSent(biz.businessId, biz.paidUntil)
      reminded++
    } catch (err) {
      console.warn(`[business] sendRenewalReminders: failed for ${biz.businessId}: ${String(err)}`)
    }
  }
  return { reminded }
}

/**
 * Daily sweep (invoked by the cleanup worker): demote every business whose
 * payment grace window has lapsed so their venues drop off the paid-only map.
 * Per-business failures are logged and skipped so one bad row never aborts the
 * sweep. Returns how many businesses were processed.
 */
export async function enforceLapsedPayments(nowMs: number = Date.now()): Promise<{ processed: number }> {
  if (DEV_MODE) return { processed: 0 }
  const businessIds = await repo.listBusinessesWithLapsedGrace(new Date(nowMs).toISOString())
  let processed = 0
  for (const businessId of businessIds) {
    try {
      await deactivateForNonPayment(businessId)
      processed++
    } catch (err) {
      console.warn(`[business] enforceLapsedPayments: failed to deactivate ${businessId}: ${String(err)}`)
    }
  }
  return { processed }
}

// A self-serve cancel is the same policy as a lapsed payment: the business is
// no longer paying, so their venues come off the map and go inactive.
export async function downgradeToFree(businessId: string) {
  if (DEV_MODE) return { success: true, tier: 'free' }
  await deactivateForNonPayment(businessId)
  return { success: true, tier: 'free' }
}

// ─── Business settings: Digest_Optout (weekly-attribution-digest R4.5) ──────
//
// Persist the `digestEmailOptOut` preference on the Business_Row through the
// shared repository write. The report generator reads `business?.digestEmailOptOut`
// on each weekly run, so a change takes effect from the next run (the dashboard
// card always renders; only the email is suppressed). Returns the resolved
// value so the client can reflect the saved state. A missing business surfaces
// as a typed 404, never a silent no-op.
export async function updateDigestOptOut(businessId: string, optOut: boolean) {
  if (DEV_MODE) return { digestEmailOptOut: optOut }
  const updated = await repo.setDigestEmailOptOut(businessId, optOut)
  if (!updated) throw AppError.notFound('Business not found')
  return { digestEmailOptOut: optOut }
}

// ─── Business API: Digest read views (weekly-attribution-digest R4.1) ───────
//
// The dashboard DigestCard and history list render entirely from the API, and
// the copy strings are the SAME strings the Digest_Email sends: one source of
// truth for the copy (R4.3). Rather than duplicate the sentence-building in the
// client, the API returns the raw Attribution_Metrics PLUS the rendered copy,
// rebuilt from the persisted row via `buildDigestCopy` (the reports feature owns
// digest logic; these views only read from its repository and copy builder — no
// forked reads, no re-derived metrics).
//
// Copy is rebuilt from the row's own `tierAtBuild` snapshot, not the business's
// current tier: a digest reads with the close it was generated under, so history
// stays stable if the business later changes tier.

/** The per-week digest as the business API returns it: the stored metrics and
 * the rendered copy strings together, so the card and email share one copy. */
export interface DigestView {
  weekStart: string
  metrics: DigestRow['metrics']
  deltas: DigestRow['deltas'] | null
  suppressed: DigestRow['suppressed']
  tierAtBuild: string
  copy: string[]
  createdAt: string
}

/** Assemble a Digest_Row into the API view: raw metrics plus the copy strings
 * rebuilt from the row's own tier snapshot (one source of truth for copy). */
function toDigestView(row: DigestRow): DigestView {
  const data: DigestData = {
    metrics: row.metrics,
    ...(row.deltas ? { deltas: row.deltas } : {}),
    suppressed: row.suppressed,
  }
  return {
    weekStart: row.weekStart,
    metrics: row.metrics,
    deltas: row.deltas ?? null,
    suppressed: row.suppressed,
    tierAtBuild: row.tierAtBuild,
    copy: buildDigestCopy(data, row.tierAtBuild),
    createdAt: row.createdAt,
  }
}

/**
 * The latest Digest for a business as the dashboard card renders it, or a clean
 * `{ digest: null }` empty state when no digest has been generated yet (R4.1).
 * The empty state is honest, never an error: a business with no closed
 * Digest_Week has nothing to show, not a fault.
 */
export async function getLatestDigestView(businessId: string): Promise<{ digest: DigestView | null }> {
  const row = await getLatestDigest(businessId)
  return { digest: row ? toDigestView(row) : null }
}

/**
 * A page of prior Digests for a business, newest first, with cursor pagination
 * (R4.1). Each item carries the metrics plus the rendered copy strings, so the
 * history list renders from the same copy source as the card and email.
 */
export async function getDigestHistoryView(
  businessId: string,
  cursor?: string,
): Promise<{ items: DigestView[]; nextCursor: string | null }> {
  const { items, nextCursor } = await queryDigestHistory(businessId, cursor)
  return { items: items.map(toDigestView), nextCursor: nextCursor ?? null }
}

// ─── Admin Boost Floor Management (R4, R5) ──────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` Flow 3
// (audit-row-first floor update). The three functions below back the admin
// portal Floor_Editor: `getBoostFloors` returns the three floors merged with
// their `BOOST_FLOOR_DEFAULTS` fallback (R4.8), `updateBoostFloor` writes the
// `Floor_Change_Audit_Row` before the `BoostFloor_Row` so no reader observes
// a new floor before its audit row is durable (R5.2/R5.3), and
// `listFloorChangeAudit` thin-wraps the repo for the per-duration history
// list rendered next to each floor card (R4.7, R5.5).
//
// All three live inside the existing `business-handler` Lambda. No new
// always-on resources, no SMS, no phone-OTP — consistent with the workspace
// steering rules.

/**
 * Return one `BoostFloorView` per duration (`2hr`, `6hr`, `24hr`).
 *
 * For any duration whose `BoostFloor_Row` is missing from `AppData_Table`,
 * synthesise a view populated from `BOOST_FLOOR_DEFAULTS[duration]` flagged
 * `isDefault: true` so the editor can render the "default — never edited"
 * label (R4.8). For present rows, set `isDefault: false`, populate
 * `updatedAt` / `updatedBy` from the row, and stamp `currency: 'ZAR'`.
 *
 * Validates: Requirements 4.1, 4.2, 4.8
 */
export async function getBoostFloors(): Promise<BoostFloorView[]> {
  const rows = await repo.listBoostFloors()
  const byDuration = new Map<BoostDuration, BoostFloorRow>()
  for (const row of rows) byDuration.set(row.duration, row)

  const durations: readonly BoostDuration[] = ['2hr', '6hr', '24hr']
  return durations.map((duration) => {
    const row = byDuration.get(duration)
    if (row) {
      return {
        duration,
        floorCents: row.floorCents,
        currency: 'ZAR',
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        isDefault: false,
      }
    }
    return {
      duration,
      floorCents: BOOST_FLOOR_DEFAULTS[duration],
      currency: 'ZAR',
      updatedAt: null,
      updatedBy: null,
      isDefault: true,
    }
  })
}

/**
 * Update the `BoostFloor_Row` for one duration. Writes the
 * `Floor_Change_Audit_Row` first (audit-first ordering, R5.2); if the audit
 * write fails the error propagates so the handler returns 500 with no floor
 * change (R5.3).
 *
 * Validates input per R4.3 (`floorCents` integer in
 * `[BOOST_FLOOR_MIN_CENTS, BOOST_FLOOR_MAX_CENTS]`), R4.6 (`duration ∈
 * {'2hr','6hr','24hr'}`), and R5.1 (`changeReason` is `null` or 1-280 chars).
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.6, 5.1, 5.2, 5.3
 */
export async function updateBoostFloor(
  duration: BoostDuration,
  floorCents: number,
  changeReason: string | null,
  admin: { sub: string; email: string },
): Promise<BoostFloorView> {
  // R4.6: validate duration. The handler also validates this but the service
  // layer does its own check so a direct call (e.g. from a test) cannot
  // bypass it.
  if (!BOOST_DURATIONS_SET.has(duration as BoostDuration)) {
    throw new AppError(400, 'INVALID_DURATION', `Invalid boost duration: ${String(duration)}`)
  }

  // R4.3: integer in [BOOST_FLOOR_MIN_CENTS, BOOST_FLOOR_MAX_CENTS].
  if (
    typeof floorCents !== 'number' ||
    !Number.isInteger(floorCents) ||
    floorCents < BOOST_FLOOR_MIN_CENTS ||
    floorCents > BOOST_FLOOR_MAX_CENTS
  ) {
    throw new AppError(
      400,
      'INVALID_FLOOR_CENTS',
      `floorCents must be an integer in [${BOOST_FLOOR_MIN_CENTS}, ${BOOST_FLOOR_MAX_CENTS}]`,
    )
  }

  // R5.1: `changeReason` is `null` or 1-280 chars.
  if (changeReason !== null) {
    if (typeof changeReason !== 'string' || changeReason.length < 1 || changeReason.length > 280) {
      throw new AppError(400, 'INVALID_CHANGE_REASON', 'changeReason must be null or a string of 1-280 characters')
    }
  }

  // R5.1: read the previous floor (if any) to populate
  // `previousFloorCents` on the audit row. `null` on the first set.
  const previous = await repo.getBoostFloor(duration)
  const previousFloorCents = previous ? previous.floorCents : null

  const changedAtIso = new Date().toISOString()
  const changeId = randomUUID()

  const audit: FloorChangeAuditRow = {
    pk: `BOOST_FLOOR_AUDIT#${duration}`,
    sk: `${changedAtIso}#${changeId}`,
    duration,
    previousFloorCents,
    newFloorCents: floorCents,
    currency: 'ZAR',
    changedBy: admin.sub,
    changedByEmail: admin.email,
    changedAt: changedAtIso,
    changeReason,
  }

  const next: BoostFloorRow = {
    pk: 'BOOST_FLOOR',
    sk: duration,
    duration,
    floorCents,
    currency: 'ZAR',
    updatedAt: changedAtIso,
    updatedBy: admin.sub,
  }

  // R5.2/R5.3: audit-first ordering. `writeFloorAuditThenUpdateFloor` writes
  // the audit row before the floor row; on audit-write failure the error
  // propagates and the floor row is not touched. Do NOT catch it here — the
  // handler maps a thrown error to a 500.
  await repo.writeFloorAuditThenUpdateFloor({ audit, next })

  return {
    duration,
    floorCents,
    currency: 'ZAR',
    updatedAt: changedAtIso,
    updatedBy: admin.sub,
    isDefault: false,
  }
}

/**
 * Return the most recent `Floor_Change_Audit_Row`s for one duration,
 * newest-first, paginated. Thin-wraps `repo.queryFloorChangeAudit` and
 * projects rows to `FloorChangeAuditView` (drops `pk`/`sk`, keeps the rest).
 *
 * The repo's `MalformedCursorError` propagates as-is so the handler can map
 * to 400 (R6.4-style cursor handling).
 *
 * Validates: Requirements 4.6, 4.7, 5.5
 */
export async function listFloorChangeAudit(
  duration: BoostDuration,
  cursor: string | null,
  limit: number = 25,
): Promise<{ items: FloorChangeAuditView[]; nextCursor: string | null }> {
  if (!BOOST_DURATIONS_SET.has(duration as BoostDuration)) {
    throw new AppError(400, 'INVALID_DURATION', `Invalid boost duration: ${String(duration)}`)
  }

  const { items, nextCursor } = await repo.queryFloorChangeAudit(duration, cursor, limit)

  const views: FloorChangeAuditView[] = items.map((row) => ({
    duration: row.duration,
    previousFloorCents: row.previousFloorCents,
    newFloorCents: row.newFloorCents,
    currency: 'ZAR',
    changedBy: row.changedBy,
    changedByEmail: row.changedByEmail,
    changedAt: row.changedAt,
    changeReason: row.changeReason,
  }))

  return { items: views, nextCursor }
}
// ─── Operator Booster Purchase Queries (R6) ─────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` Operator
// Boost Panel. The operator-facing endpoint queries `pk = BOOST#<businessId>`
// newest-first and returns the rows projected to the operator-safe
// `BoosterPurchaseView`. The view deliberately omits `tierSnapshot`,
// `neighbourhoodIdSnapshot`, and `floorAtPurchaseCents` (R6.6) — those exist
// for ops and future-pricing use only.
//
// The repo's `MalformedCursorError` propagates as-is so the handler can map
// it to 400 Bad Request (R6.4).

/**
 * List a business's own `BoosterPurchase` rows newest-first, paginated at
 * `limit` rows per page (default 25, R6.4). Each row is projected to the
 * operator-facing `BoosterPurchaseView` so `tierSnapshot`,
 * `neighbourhoodIdSnapshot`, and `floorAtPurchaseCents` are NOT included in
 * the response (R6.6).
 *
 * If `cursor` is malformed, the underlying repo throws `MalformedCursorError`
 * which propagates so the handler can return 400 (R6.4).
 *
 * Validates: Requirements 6.2, 6.4, 6.6
 */
export async function listBoosterPurchasesForBusiness(
  businessId: string,
  cursor: string | null,
  limit: number = 25,
): Promise<{ items: BoosterPurchaseView[]; nextCursor: string | null }> {
  const { items, nextCursor } = await repo.queryBoosterPurchasesForBusiness(businessId, cursor, limit)

  // R6.6: project to the operator-safe view. Drop `tierSnapshot`,
  // `neighbourhoodIdSnapshot`, `floorAtPurchaseCents`, plus the row's
  // partition/sort/GSI key attributes which are storage-only concerns.
  const views: BoosterPurchaseView[] = items.map((row) => ({
    businessId: row.businessId,
    nodeId: row.nodeId,
    duration: row.duration,
    amountCents: row.amountCents,
    currency: 'ZAR',
    yocoCheckoutId: row.yocoCheckoutId,
    paidAt: row.paidAt,
  }))

  return { items: views, nextCursor }
}

// ─── Subscription payment history (billing-revenue-integrity R7.5) ──────────
//
// Mirrors `listBoosterPurchasesForBusiness`: the business-scope endpoint
// queries `pk = SUB#<businessId>` newest-first and projects each
// Subscription_Payment_Row to the `SubscriptionPaymentView`. The view carries
// only business identifiers and amounts, so there is nothing to strip; it
// drops the storage-only partition/sort/GSI key attributes and `createdAt`.
//
// The repo's `MalformedCursorError` propagates as-is so the handler can map
// it to 400 Bad Request.

/**
 * List a business's own `Subscription_Payment_Row`s newest-first, paginated
 * at `limit` rows per page (default 25). Each row is projected to the
 * `SubscriptionPaymentView` (businessId, plan, interval, amountCents,
 * currency, yocoCheckoutId, paidAt, paidUntilProduced).
 *
 * If `cursor` is malformed, the underlying repo throws `MalformedCursorError`
 * which propagates so the handler can return 400.
 *
 * Validates: Requirements 7.5
 */
export async function listSubscriptionPaymentsForBusiness(
  businessId: string,
  cursor: string | null,
  limit: number = 25,
): Promise<{ items: SubscriptionPaymentView[]; nextCursor: string | null }> {
  const { items, nextCursor } = await repo.querySubscriptionPaymentsForBusiness(businessId, cursor, limit)

  // Project to the API view. Drop the row's partition/sort/GSI key attributes
  // and `createdAt`, which are storage-only concerns.
  const views: SubscriptionPaymentView[] = items.map((row) => ({
    businessId: row.businessId,
    plan: row.plan,
    interval: row.interval,
    amountCents: row.amountCents,
    currency: row.currency,
    yocoCheckoutId: row.yocoCheckoutId,
    paidAt: row.paidAt,
    paidUntilProduced: row.paidUntilProduced,
  }))

  return { items: views, nextCursor }
}

// ─── Admin Booster Purchase Queries (R7) ────────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/design.md` Admin Boost
// Report. The admin-facing surface supports two mutually-exclusive query
// modes (R7.2):
//
//   - Date-range mode: `Query` GSI1 with `gsi1pk='BOOST_BY_TIME'` and
//     `gsi1sk BETWEEN :from AND :to`, paginated.
//   - Single-payment mode: `GetItem` the `Idempotency_Marker`
//     (`BOOST_CHECKOUT#<yocoCheckoutId>`), then a follow-up `GetItem` for
//     the BoosterPurchase row using the marker's stored `boostPk` /
//     `boostSk`.
//
// Both surfaces project rows to `AdminBoosterPurchaseView`, which exposes
// `businessId`, `tierSnapshot`, `neighbourhoodIdSnapshot`,
// `floorAtPurchaseCents`, and `yocoCheckoutId` (R7.6).

const ADMIN_BOOST_REPORT_MAX_RANGE_MS = ADMIN_BOOST_REPORT_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000

function projectAdminBoosterPurchaseView(row: BoosterPurchaseRow): AdminBoosterPurchaseView {
  return {
    businessId: row.businessId,
    nodeId: row.nodeId,
    duration: row.duration,
    amountCents: row.amountCents,
    currency: 'ZAR',
    yocoCheckoutId: row.yocoCheckoutId,
    paidAt: row.paidAt,
    tierSnapshot: row.tierSnapshot,
    neighbourhoodIdSnapshot: row.neighbourhoodIdSnapshot,
    floorAtPurchaseCents: row.floorAtPurchaseCents,
  }
}

/**
 * List `BoosterPurchase` rows across all businesses whose `paidAt` falls in
 * the inclusive ISO-8601 range `[fromIso, toIso]`, paginated newest-first
 * via `nextCursor`. Each row is projected to the admin-facing
 * `AdminBoosterPurchaseView` (R7.6).
 *
 * R7.5: range validation runs BEFORE any DynamoDB call. The repo is never
 * touched on a malformed range — the function throws an `AppError` with
 * status 400 and code `INVALID_DATE_RANGE`. The bounds use `<=` so a
 * same-instant range (matching exactly one row) is allowed and exactly
 * 367 days is allowed.
 *
 * Validates: Requirements 7.2, 7.5, 7.6
 */
export async function listBoosterPurchasesByDateRange(
  fromIso: string,
  toIso: string,
  cursor: string | null,
  limit: number = 25,
): Promise<{ items: AdminBoosterPurchaseView[]; nextCursor: string | null }> {
  // R7.5: parseable ISO-8601 timestamps. `Date.parse` returns NaN on garbage.
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'from and to must be parseable ISO 8601 timestamps')
  }

  // R7.5: `from <= to`. Use `<=` so a same-instant range (matching exactly
  // one row) is allowed.
  if (fromMs > toMs) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'from must be less than or equal to to')
  }

  // R7.5: `(to - from) <= ADMIN_BOOST_REPORT_MAX_RANGE_DAYS`. Use `<=` so
  // exactly 367 days is allowed.
  if (toMs - fromMs > ADMIN_BOOST_REPORT_MAX_RANGE_MS) {
    throw new AppError(400, 'INVALID_DATE_RANGE', `Date range cannot exceed ${ADMIN_BOOST_REPORT_MAX_RANGE_DAYS} days`)
  }

  const { items, nextCursor } = await repo.queryBoosterPurchasesByTimeRange(fromIso, toIso, cursor, limit)

  return {
    items: items.map(projectAdminBoosterPurchaseView),
    nextCursor,
  }
}

// ─── Admin Subscription Payment Report (R8) ─────────────────────────────────
//
// See `.kiro/specs/billing-revenue-integrity/design.md` access-pattern table
// (Admin range). Mirrors `listBoosterPurchasesByDateRange` exactly: the
// admin-facing surface queries GSI1 with `gsi1pk='SUB_BY_TIME'` and
// `gsi1sk BETWEEN :from AND :to`, paginated newest-first. The single
// `SubscriptionPaymentView` is already PII-free — rows carry business
// identifiers and amounts only (R8.2) — so there is no separate admin-only
// shape to project and nothing to strip beyond the storage-only key
// attributes and `createdAt`, matching `listSubscriptionPaymentsForBusiness`.

/**
 * List `Subscription_Payment_Row`s across all businesses whose `paidAt` falls
 * in the inclusive ISO-8601 range `[fromIso, toIso]`, paginated newest-first
 * via `nextCursor`. Each row is projected to the `SubscriptionPaymentView`
 * (R8.2 — business identifiers and amounts only, no consumer PII).
 *
 * R8.1: range validation runs BEFORE any DynamoDB call, identical to the
 * admin boost report. The repo is never touched on a malformed range — the
 * function throws an `AppError` with status 400 and code `INVALID_DATE_RANGE`.
 * The bounds use `<=` so a same-instant range (matching exactly one row) is
 * allowed and exactly `ADMIN_BOOST_REPORT_MAX_RANGE_DAYS` days is allowed.
 *
 * Validates: Requirements 8.1, 8.2
 */
export async function listSubscriptionPaymentsByDateRange(
  fromIso: string,
  toIso: string,
  cursor: string | null,
  limit: number = 25,
): Promise<{ items: SubscriptionPaymentView[]; nextCursor: string | null }> {
  // R8.1: parseable ISO-8601 timestamps. `Date.parse` returns NaN on garbage.
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'from and to must be parseable ISO 8601 timestamps')
  }

  // R8.1: `from <= to`. Use `<=` so a same-instant range (matching exactly
  // one row) is allowed.
  if (fromMs > toMs) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'from must be less than or equal to to')
  }

  // R8.1: `(to - from) <= ADMIN_BOOST_REPORT_MAX_RANGE_DAYS`. Use `<=` so
  // exactly 367 days is allowed. Same window as the admin boost report.
  if (toMs - fromMs > ADMIN_BOOST_REPORT_MAX_RANGE_MS) {
    throw new AppError(400, 'INVALID_DATE_RANGE', `Date range cannot exceed ${ADMIN_BOOST_REPORT_MAX_RANGE_DAYS} days`)
  }

  const { items, nextCursor } = await repo.querySubscriptionPaymentsByTimeRange(fromIso, toIso, cursor, limit)

  // Project to the API view. The view is already PII-free (R8.2); this drops
  // only the storage-only partition/sort/GSI key attributes and `createdAt`,
  // identical to `listSubscriptionPaymentsForBusiness`.
  const views: SubscriptionPaymentView[] = items.map((row) => ({
    businessId: row.businessId,
    plan: row.plan,
    interval: row.interval,
    amountCents: row.amountCents,
    currency: row.currency,
    yocoCheckoutId: row.yocoCheckoutId,
    paidAt: row.paidAt,
    paidUntilProduced: row.paidUntilProduced,
  }))

  return { items: views, nextCursor }
}

/**
 * Look up a single `BoosterPurchase` row by `yocoCheckoutId`. Reads the
 * `Idempotency_Marker` first; if no marker exists, returns `null`.
 * Otherwise issues a follow-up `GetItem` for the row using the marker's
 * stored `boostPk` / `boostSk` and projects to `AdminBoosterPurchaseView`.
 *
 * Validates: Requirements 7.2, 7.6
 */
export async function getBoosterPurchaseByYocoCheckoutId(
  yocoCheckoutId: string,
): Promise<AdminBoosterPurchaseView | null> {
  const marker = await repo.getBoosterCheckoutMarker(yocoCheckoutId)
  if (!marker) return null

  const row = await repo.getBoosterPurchaseByKey(marker.boostPk, marker.boostSk)
  if (!row) return null

  return projectAdminBoosterPurchaseView(row)
}
