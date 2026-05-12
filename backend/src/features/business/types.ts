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
    'view_live', 'view_check_ins', 'view_rewards', 'manage_rewards',
    'view_audience', 'manage_boost', 'view_staff', 'manage_staff',
    'invite_manager', 'invite_staff', 'view_reports', 'manage_reports',
    'view_plans', 'manage_billing', 'view_settings', 'manage_settings',
    'manage_nodes', 'view_qr', 'view_metrics', 'transfer_ownership',
  ],
  manager: [
    'view_live', 'view_check_ins', 'view_rewards', 'manage_rewards',
    'view_audience', 'manage_boost', 'view_staff', 'manage_staff',
    'invite_staff', 'view_reports', 'manage_reports',
    'view_settings', 'manage_nodes', 'view_qr', 'view_metrics',
  ],
  staff: [
    'redeem_codes',
  ],
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
