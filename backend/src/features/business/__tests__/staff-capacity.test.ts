/**
 * Staff head-count capacity check (`assertStaffCapacity`).
 *
 * One source of truth for the per-tier staff limit, consumed by invite
 * creation (`inviteStaff`) and both invite-acceptance paths in
 * `auth/service.ts`. These tests lock two things:
 *
 *   1. The limit is enforced against the business's EFFECTIVE tier
 *      (`getEffectiveTier`, honouring the entitlement windows), not the raw
 *      stored tier. This is the drift the consolidation fixed: a `pro` business
 *      whose trial, paidUntil, and grace windows have all lapsed falls back to
 *      `starter` (limit 2), so it must NOT be treated as unlimited at
 *      acceptance time. A live paidUntil window keeps the paid tier.
 *   2. `null` limits (pro, paid) are genuinely unlimited.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findBusinessById: vi.fn(),
  countStaffForBusiness: vi.fn(),
}))

vi.mock('../repository.js', () => ({
  findBusinessById: mocks.findBusinessById,
  countStaffForBusiness: mocks.countStaffForBusiness,
}))

import { assertStaffCapacity } from '../service.js'

const EXPIRED = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertStaffCapacity', () => {
  it('resolves when under the tier limit', async () => {
    mocks.findBusinessById.mockResolvedValue({ businessId: 'b1', tier: 'growth', paidUntil: FUTURE })
    mocks.countStaffForBusiness.mockResolvedValue(3)
    await expect(assertStaffCapacity('b1')).resolves.toBeUndefined()
  })

  it('throws forbidden when at the tier limit', async () => {
    mocks.findBusinessById.mockResolvedValue({ businessId: 'b1', tier: 'growth', paidUntil: FUTURE })
    mocks.countStaffForBusiness.mockResolvedValue(5)
    await expect(assertStaffCapacity('b1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('never throws for an unlimited (pro) tier', async () => {
    mocks.findBusinessById.mockResolvedValue({ businessId: 'b1', tier: 'pro', paidUntil: FUTURE })
    mocks.countStaffForBusiness.mockResolvedValue(100)
    await expect(assertStaffCapacity('b1')).resolves.toBeUndefined()
    // pro is unlimited, so we should not even bother counting past the null check
    expect(mocks.countStaffForBusiness).not.toHaveBeenCalled()
  })

  it('uses effective tier: pro with every window lapsed falls back to starter (limit 2)', async () => {
    // Raw tier is "pro" (would be unlimited) but the trial expired and there is
    // no active paidUntil or grace window, so the effective tier is "starter"
    // (limit 2).
    mocks.findBusinessById.mockResolvedValue({ businessId: 'b1', tier: 'pro', trialEndsAt: EXPIRED })
    mocks.countStaffForBusiness.mockResolvedValue(2)
    await expect(assertStaffCapacity('b1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('keeps the paid pro tier unlimited while the paidUntil window is active', async () => {
    mocks.findBusinessById.mockResolvedValue({
      businessId: 'b1',
      tier: 'pro',
      trialEndsAt: EXPIRED,
      paidUntil: FUTURE,
    })
    mocks.countStaffForBusiness.mockResolvedValue(50)
    await expect(assertStaffCapacity('b1')).resolves.toBeUndefined()
  })

  it('throws notFound when the business is missing', async () => {
    mocks.findBusinessById.mockResolvedValue(null)
    await expect(assertStaffCapacity('missing')).rejects.toMatchObject({ statusCode: 404 })
  })
})
