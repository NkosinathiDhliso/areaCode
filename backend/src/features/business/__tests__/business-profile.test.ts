/**
 * Unit tests for `getBusinessProfile` billing-state surfacing
 * (billing-revenue-integrity R2.6).
 *
 * Validates: Requirements 2.6
 *
 * R2.6 requires the `GET /v1/business/me` response to carry `paidUntil` and
 * `paidInterval` so the portals can render billing state. The handler returns
 * `service.getBusinessProfile(...)` verbatim, which reads the business row via
 * `repo.findBusinessByCognitoSub`. That repo function delegates to the auth
 * repository's `mapBiz`, which spreads the whole stored item, so any attribute
 * persisted on the business row (including `paidUntil` / `paidInterval` /
 * `paymentGraceUntil`) reaches the response with no explicit field projection.
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * `getBusinessProfile` short-circuits in DEV_MODE (returns a canned stub), so
 * the live branch runs with DEV_MODE off: env stays `dev` (so `requireEnv`
 * keeps local defaults and the Payment_Config_Guard is lenient at import) and
 * `AREA_CODE_FORCE_LIVE` is set. The service is imported dynamically in
 * `beforeAll` because `DEV_MODE` is a module-level const captured at import
 * time — the same pattern as the sibling billing tests. The repository is
 * mocked so the row shape is under test control without a live DynamoDB.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const COGNITO_SUB = 'sub-biz-42'

const h = vi.hoisted(() => {
  const findBusinessByCognitoSub = vi.fn(async (_sub: string) => null as Record<string, unknown> | null)
  return { findBusinessByCognitoSub }
})

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, findBusinessByCognitoSub: h.findBusinessByCognitoSub }
})

let getBusinessProfile: (typeof import('../service.js'))['getBusinessProfile']

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  ;({ getBusinessProfile } = await import('../service.js'))
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
})

beforeEach(() => {
  h.findBusinessByCognitoSub.mockReset()
})

describe('getBusinessProfile — R2.6 billing state surfacing', () => {
  it('includes paidUntil and paidInterval when present on the business row', async () => {
    const paidUntil = '2026-08-09T00:00:00.000Z'
    h.findBusinessByCognitoSub.mockResolvedValue({
      id: 'biz-42',
      businessId: 'biz-42',
      businessName: 'Test Venue',
      email: 'owner@areacode.co.za',
      tier: 'growth',
      paidUntil,
      paidInterval: 'monthly',
      paymentGraceUntil: null,
    })

    const profile = (await getBusinessProfile(COGNITO_SUB)) as Record<string, unknown>

    expect(profile['paidUntil']).toBe(paidUntil)
    expect(profile['paidInterval']).toBe('monthly')
    // paymentGraceUntil surfaces on the same spread path.
    expect(profile).toHaveProperty('paymentGraceUntil')
    expect(h.findBusinessByCognitoSub).toHaveBeenCalledWith(COGNITO_SUB)
  })

  it('surfaces a null paid window unchanged (never on a paid plan)', async () => {
    h.findBusinessByCognitoSub.mockResolvedValue({
      id: 'biz-7',
      businessId: 'biz-7',
      businessName: 'Free Venue',
      email: 'free@areacode.co.za',
      tier: 'starter',
      paidUntil: null,
      paidInterval: null,
    })

    const profile = (await getBusinessProfile(COGNITO_SUB)) as Record<string, unknown>

    expect(profile['paidUntil']).toBeNull()
    expect(profile['paidInterval']).toBeNull()
  })
})
