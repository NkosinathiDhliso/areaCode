import { z } from 'zod'

// ─── Business Member Roles ──────────────────────────────────────────────────

/**
 * Role hierarchy for business portal access:
 * - owner: Full access. Billing, plan changes, delete business, transfer ownership.
 * - manager: Day-to-day operations. Rewards, nodes, analytics, staff, QR codes.
 *            Cannot touch billing or delete the business.
 * - staff: Scan redemption codes only (uses the separate staff app).
 */
export type BusinessMemberRole = 'owner' | 'manager' | 'staff'

/**
 * Permissions map. Each role has a fixed set of capabilities.
 * No custom permissions — keeps it simple for small business owners.
 */
export const ROLE_PERMISSIONS: Record<BusinessMemberRole, readonly string[]> = {
  owner: [
    'view_live',
    'view_check_ins',
    'view_rewards',
    'manage_rewards',
    'view_audience',
    'manage_boost',
    'view_staff',
    'manage_staff',
    'invite_manager',
    'invite_staff',
    'view_reports',
    'manage_reports',
    'view_plans',
    'manage_billing',
    'view_settings',
    'manage_settings',
    'manage_nodes',
    'view_qr',
    'view_metrics',
    'transfer_ownership',
  ],
  manager: [
    'view_live',
    'view_check_ins',
    'view_rewards',
    'manage_rewards',
    'view_audience',
    'manage_boost',
    'view_staff',
    'manage_staff',
    'invite_staff',
    'view_reports',
    'manage_reports',
    'view_settings',
    'manage_nodes',
    'view_qr',
    'view_metrics',
  ],
  staff: ['redeem_codes'],
} as const

export function hasPermission(role: BusinessMemberRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

// Business plans , never hardcoded in frontend
export const BUSINESS_PLANS = {
  starter: { name: 'Starter', monthlyPrice: 0, yearlyPrice: 0, maxNodes: 1, maxRewards: 3, maxStaff: 2 },
  growth: {
    name: 'Growth',
    monthlyPrice: 29900,
    yearlyPrice: 299000,
    maxNodes: 5,
    maxRewards: 10,
    maxStaff: 5,
    trialDays: 14,
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 79900,
    yearlyPrice: 799000,
    maxNodes: null,
    maxRewards: null,
    maxStaff: null,
    trialDays: 14,
  },
  payg: { name: 'Pay-as-you-go', dailyPrice: 9900, weeklyPrice: 19900, maxNodes: 1, maxRewards: 3, maxStaff: 2 },
} as const

export const BOOST_PRICING = {
  '2hr': 2500,
  '6hr': 5000,
  '24hr': 15000,
} as const

export type BoostDuration = keyof typeof BOOST_PRICING

// ─── Booster Pricing Floor & Audit ──────────────────────────────────────────
//
// See `.kiro/specs/booster-pricing-floor-and-audit/`.
//
// `BOOST_PRICING` (above) remains the price source-of-truth (R9.2). The
// `BoostFloor_Row` introduced here only gates the lower bound and is seeded
// equal to `BOOST_PRICING` so the rejection branch never fires on day one
// (R3.5, R9.4).

/**
 * Initial seed values for `BoostFloor_Row` per duration. Mirrors `BOOST_PRICING`
 * so launch behaviour is unchanged (R3.5).
 */
export const BOOST_FLOOR_DEFAULTS: Record<BoostDuration, number> = {
  '2hr': BOOST_PRICING['2hr'], // 2500
  '6hr': BOOST_PRICING['6hr'], // 5000
  '24hr': BOOST_PRICING['24hr'], // 15000
}

/** Minimum admin-settable floor (1 cent — 0.01 ZAR). R4.3. */
export const BOOST_FLOOR_MIN_CENTS = 1
/** Maximum admin-settable floor (1 000 000 cents — 10 000.00 ZAR). R4.3. */
export const BOOST_FLOOR_MAX_CENTS = 1_000_000
/**
 * Maximum width (in days) of a single Admin_Boost_Report date-range query.
 * One full year plus a day to allow exact year-on-year comparisons (R7.5).
 */
export const ADMIN_BOOST_REPORT_MAX_RANGE_DAYS = 367

/**
 * Exhaustive union of structured-log `branch` values emitted by the booster
 * service. Typing log calls as `BOOST_LOG_BRANCHES` makes a missing branch a
 * compile-time error (R9.3).
 */
export type BOOST_LOG_BRANCHES =
  | 'floor_loaded_from_dynamo'
  | 'floor_loaded_from_const_fallback'
  | 'floor_violation_rejected'
  | 'purchase_audit_written'
  | 'purchase_audit_duplicate_yoco_checkout_id'
  | 'purchase_audit_duplicate_event_id'

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const boostDurationSchema = z.enum(['2hr', '6hr', '24hr'])
const boostTierSnapshotSchema = z.enum(['starter', 'growth', 'pro', 'payg'])
const zarCurrencySchema = z.literal('ZAR')

// ─── BoosterPurchase row (audit row) ────────────────────────────────────────
// R1.2 / R1.7 / R1.8 — no `ttl`, no phone-number / SMS-delivery field, no
// consumer PII. Schema rejects unknown attributes by default.

export const boosterPurchaseRowSchema = z.object({
  pk: z.string().regex(/^BOOST#[\w-]{1,64}$/),
  sk: z.string().min(1),
  gsi1pk: z.literal('BOOST_BY_TIME'),
  gsi1sk: z.string().min(1),
  businessId: z.string().min(1).max(64),
  nodeId: z.string().min(1).max(64),
  duration: boostDurationSchema,
  amountCents: z.number().int().positive(),
  currency: zarCurrencySchema,
  yocoCheckoutId: z.string().min(1).max(128),
  paidAt: z.string().min(1),
  tierSnapshot: boostTierSnapshotSchema,
  neighbourhoodIdSnapshot: z.string().min(1).max(64).nullable(),
  floorAtPurchaseCents: z.number().int().positive(),
  createdAt: z.string().min(1),
})

export type BoosterPurchaseRow = z.infer<typeof boosterPurchaseRowSchema>

// ─── Idempotency marker row (BOOST_CHECKOUT#<yocoCheckoutId>) ───────────────
// R2.1.

export const boosterCheckoutMarkerRowSchema = z.object({
  pk: z.string().regex(/^BOOST_CHECKOUT#[\w-]{1,128}$/),
  sk: z.string().regex(/^BOOST_CHECKOUT#[\w-]{1,128}$/),
  businessId: z.string().min(1).max(64),
  boostPk: z.string().regex(/^BOOST#[\w-]{1,64}$/),
  boostSk: z.string().min(1),
  createdAt: z.string().min(1),
})

export type BoosterCheckoutMarkerRow = z.infer<typeof boosterCheckoutMarkerRowSchema>

// ─── BoostFloor row (one per duration) ──────────────────────────────────────
// R4.1.

export const boostFloorRowSchema = z.object({
  pk: z.literal('BOOST_FLOOR'),
  sk: boostDurationSchema,
  duration: boostDurationSchema,
  floorCents: z.number().int().min(BOOST_FLOOR_MIN_CENTS).max(BOOST_FLOOR_MAX_CENTS),
  currency: zarCurrencySchema,
  updatedAt: z.string().min(1),
  updatedBy: z.string().min(1),
})

export type BoostFloorRow = z.infer<typeof boostFloorRowSchema>

// ─── Floor change audit row ─────────────────────────────────────────────────
// R5.1. `previousFloorCents` is `null` on the very first set.

export const floorChangeAuditRowSchema = z.object({
  pk: z.string().regex(/^BOOST_FLOOR_AUDIT#(2hr|6hr|24hr)$/),
  sk: z.string().min(1),
  duration: boostDurationSchema,
  previousFloorCents: z.number().int().positive().nullable(),
  newFloorCents: z.number().int().positive(),
  currency: zarCurrencySchema,
  changedBy: z.string().min(1),
  changedByEmail: z.string().min(3).max(254),
  changedAt: z.string().min(1),
  changeReason: z.string().min(1).max(280).nullable(),
})

export type FloorChangeAuditRow = z.infer<typeof floorChangeAuditRowSchema>

// ─── API response views ─────────────────────────────────────────────────────
//
// Views mirror their underlying rows but expose only the fields the API
// returns. Each pair of (row, view) keeps `serialize(deserialize(row))`
// symmetric for Property 3 (R10.4). The operator view deliberately omits
// `tierSnapshot`, `neighbourhoodIdSnapshot`, and `floorAtPurchaseCents`
// (R6.6); the admin view includes them (R7.6).

export const boosterPurchaseViewSchema = z.object({
  businessId: z.string().min(1).max(64),
  nodeId: z.string().min(1).max(64),
  duration: boostDurationSchema,
  amountCents: z.number().int().positive(),
  currency: zarCurrencySchema,
  yocoCheckoutId: z.string().min(1).max(128),
  paidAt: z.string().min(1),
})

export type BoosterPurchaseView = z.infer<typeof boosterPurchaseViewSchema>

export const adminBoosterPurchaseViewSchema = boosterPurchaseViewSchema.extend({
  tierSnapshot: boostTierSnapshotSchema,
  neighbourhoodIdSnapshot: z.string().min(1).max(64).nullable(),
  floorAtPurchaseCents: z.number().int().positive(),
})

export type AdminBoosterPurchaseView = z.infer<typeof adminBoosterPurchaseViewSchema>

export const boostFloorViewSchema = z.object({
  duration: boostDurationSchema,
  floorCents: z.number().int().min(BOOST_FLOOR_MIN_CENTS).max(BOOST_FLOOR_MAX_CENTS),
  currency: zarCurrencySchema,
  updatedAt: z.string().min(1).nullable(),
  updatedBy: z.string().min(1).nullable(),
  /** True when no `BoostFloor_Row` has been written for this duration yet (R4.8). */
  isDefault: z.boolean(),
})

export type BoostFloorView = z.infer<typeof boostFloorViewSchema>

export const floorChangeAuditViewSchema = z.object({
  duration: boostDurationSchema,
  previousFloorCents: z.number().int().positive().nullable(),
  newFloorCents: z.number().int().positive(),
  currency: zarCurrencySchema,
  changedBy: z.string().min(1),
  changedByEmail: z.string().min(3).max(254),
  changedAt: z.string().min(1),
  changeReason: z.string().min(1).max(280).nullable(),
})

export type FloorChangeAuditView = z.infer<typeof floorChangeAuditViewSchema>

// Zod schemas
export const checkoutBodySchema = z.object({
  plan: z.enum(['growth', 'pro', 'payg']),
  interval: z.enum(['monthly', 'yearly', 'daily', 'weekly']).optional(),
})

export const trialStartBodySchema = z.object({
  plan: z.enum(['growth', 'pro']),
})

export const boostBodySchema = z.object({
  nodeId: z.string().uuid(),
  duration: z.enum(['2hr', '6hr', '24hr']),
})

export const staffInviteBodySchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().email().optional(),
    role: z.enum(['manager', 'staff']).default('staff'),
  })
  .refine((d) => d.phone || d.email, { message: 'Phone or email required' })

export const staffIdParamsSchema = z.object({
  id: z.string().uuid(),
})

export type CheckoutBody = z.infer<typeof checkoutBodySchema>
export type BoostBody = z.infer<typeof boostBodySchema>
export type StaffInviteBody = z.infer<typeof staffInviteBodySchema>
