/**
 * Admin set-tier as Comp_Window (cross-portal-lifecycle-alignment task 1.1).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6
 *
 * Two layers:
 *   1. `setTierBodySchema` validation matrix (the HTTP boundary): paid tiers
 *      require a future `paidUntil`; starter forbids one; `trialEndsAt` is gone.
 *   2. `setBusinessTier` service behaviour: paid writes the Comp_Window via the
 *      shared `setBusinessCompWindow`, starter clears it, and the audit entry
 *      records the granted window. No Subscription_Payment_Row is written (R1.6):
 *      the service never touches the payment repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const compCalls = vi.hoisted(() => ({
  list: [] as Array<{ businessId: string; tier: string; paidUntil: string | null }>,
}))
const auditCalls = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }))

vi.mock('../../business/repository.js', () => ({
  setBusinessCompWindow: vi.fn(async (businessId: string, tier: string, paidUntil: string | null) => {
    compCalls.list.push({ businessId, tier, paidUntil })
  }),
}))

vi.mock('../repository.js', () => ({
  createAuditLog: vi.fn(async (entry: Record<string, unknown>) => {
    auditCalls.list.push(entry)
  }),
}))

// eslint-disable-next-line import/first
import { setBusinessTier } from '../service.js'
// eslint-disable-next-line import/first
import { setTierBodySchema } from '../types.js'

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

describe('setTierBodySchema validation matrix (R1.1, R1.2)', () => {
  it('accepts a paid tier with a future paidUntil', () => {
    expect(setTierBodySchema.safeParse({ tier: 'growth', reason: 'promo', paidUntil: FUTURE }).success).toBe(true)
    expect(setTierBodySchema.safeParse({ tier: 'pro', reason: 'deal', paidUntil: FUTURE }).success).toBe(true)
  })

  it('rejects a paid tier with no paidUntil', () => {
    expect(setTierBodySchema.safeParse({ tier: 'growth', reason: 'promo' }).success).toBe(false)
  })

  it('rejects a paid tier with a past paidUntil', () => {
    expect(setTierBodySchema.safeParse({ tier: 'pro', reason: 'deal', paidUntil: PAST }).success).toBe(false)
  })

  it('accepts starter with no paidUntil', () => {
    expect(setTierBodySchema.safeParse({ tier: 'starter', reason: 'downgrade' }).success).toBe(true)
  })

  it('rejects starter carrying a paidUntil', () => {
    expect(setTierBodySchema.safeParse({ tier: 'starter', reason: 'x', paidUntil: FUTURE }).success).toBe(false)
  })
})

describe('setBusinessTier service (R1.1, R1.2, R1.3, R1.6)', () => {
  beforeEach(() => {
    compCalls.list = []
    auditCalls.list = []
  })

  it('paid tier writes the Comp_Window and audits the granted paidUntil', async () => {
    const res = await setBusinessTier('admin-1', 'super_admin', 'biz-1', 'growth', 'promo', FUTURE)
    expect(res).toEqual({ success: true, tier: 'growth', paidUntil: FUTURE })
    expect(compCalls.list).toEqual([{ businessId: 'biz-1', tier: 'growth', paidUntil: FUTURE }])
    expect(auditCalls.list).toHaveLength(1)
    expect(auditCalls.list[0]).toMatchObject({
      action: 'set_tier',
      entityType: 'business',
      entityId: 'biz-1',
      afterState: { tier: 'growth', reason: 'promo', paidUntil: FUTURE },
    })
  })

  it('starter clears the window (paidUntil null) and audits null', async () => {
    await setBusinessTier('admin-1', 'super_admin', 'biz-1', 'starter', 'downgrade')
    expect(compCalls.list).toEqual([{ businessId: 'biz-1', tier: 'starter', paidUntil: null }])
    expect(auditCalls.list[0]).toMatchObject({ afterState: { tier: 'starter', paidUntil: null } })
  })

  it('throws when a paid tier arrives without paidUntil (defensive guard)', async () => {
    await expect(setBusinessTier('admin-1', 'super_admin', 'biz-1', 'pro', 'oops')).rejects.toThrow()
    expect(compCalls.list).toHaveLength(0)
    expect(auditCalls.list).toHaveLength(0)
  })

  it('super_admin permission is required (support_agent cannot set tier)', async () => {
    await expect(setBusinessTier('admin-1', 'support_agent', 'biz-1', 'starter', 'x')).rejects.toThrow()
  })
})
