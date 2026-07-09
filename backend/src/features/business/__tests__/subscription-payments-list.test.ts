/**
 * Subscription payment history service unit tests
 * (billing-revenue-integrity task 8.2).
 *
 * Validates: Requirements 7.5
 *
 * Exercises `service.listSubscriptionPaymentsForBusiness`, the business-scope
 * read backing `GET /v1/business/subscription-payments`. Mirrors the
 * operator boost-purchases path: the service queries
 * `repo.querySubscriptionPaymentsForBusiness` and projects each
 * Subscription_Payment_Row to the `SubscriptionPaymentView`.
 *
 * Coverage:
 *   1. Projection — a stored row is projected to exactly the view fields
 *      (businessId, plan, interval, amountCents, currency, yocoCheckoutId,
 *      paidAt, paidUntilProduced) and drops the storage-only key attributes
 *      (pk / sk / gsi1pk / gsi1sk) and `createdAt`.
 *   2. Cursor + limit passthrough and nextCursor propagation.
 *   3. A malformed cursor surfaces from the repo as MalformedCursorError and
 *      propagates unchanged so the handler can map it to 400.
 *
 * Strategy: `../repository.js` is partially mocked — only
 * `querySubscriptionPaymentsForBusiness` is stubbed; the real
 * `MalformedCursorError` class is preserved so `instanceof` still holds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { SubscriptionPaymentRow } from '../types.js'

const h = vi.hoisted(() => ({
  querySubscriptionPaymentsForBusiness: vi.fn(),
}))

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repository.js')>()
  return {
    ...actual,
    querySubscriptionPaymentsForBusiness: h.querySubscriptionPaymentsForBusiness,
  }
})

import { listSubscriptionPaymentsForBusiness } from '../service.js'
import { MalformedCursorError } from '../repository.js'

const BUSINESS_ID = 'biz-42'

function makeRow(overrides: Partial<SubscriptionPaymentRow> = {}): SubscriptionPaymentRow {
  const paidAt = overrides.paidAt ?? '2026-03-15T10:00:00.000Z'
  const yocoCheckoutId = overrides.yocoCheckoutId ?? 'ch_test_123'
  return {
    pk: `SUB#${BUSINESS_ID}`,
    sk: `SUB#${paidAt}#${yocoCheckoutId}`,
    gsi1pk: 'SUB_BY_TIME',
    gsi1sk: paidAt,
    businessId: BUSINESS_ID,
    plan: 'growth',
    interval: 'monthly',
    amountCents: 9900,
    currency: 'ZAR',
    yocoCheckoutId,
    paidAt,
    paidUntilProduced: '2026-04-15T10:00:00.000Z',
    createdAt: paidAt,
    ...overrides,
  }
}

beforeEach(() => {
  h.querySubscriptionPaymentsForBusiness.mockReset()
})

describe('listSubscriptionPaymentsForBusiness (R7.5)', () => {
  it('projects a stored row to the SubscriptionPaymentView and drops storage-only fields', async () => {
    const row = makeRow()
    h.querySubscriptionPaymentsForBusiness.mockResolvedValue({ items: [row], nextCursor: null })

    const result = await listSubscriptionPaymentsForBusiness(BUSINESS_ID, null, 25)

    expect(result.items).toEqual([
      {
        businessId: BUSINESS_ID,
        plan: 'growth',
        interval: 'monthly',
        amountCents: 9900,
        currency: 'ZAR',
        yocoCheckoutId: 'ch_test_123',
        paidAt: '2026-03-15T10:00:00.000Z',
        paidUntilProduced: '2026-04-15T10:00:00.000Z',
      },
    ])
    // Storage-only concerns never leak into the view.
    const view = result.items[0] as Record<string, unknown>
    expect(view).not.toHaveProperty('pk')
    expect(view).not.toHaveProperty('sk')
    expect(view).not.toHaveProperty('gsi1pk')
    expect(view).not.toHaveProperty('gsi1sk')
    expect(view).not.toHaveProperty('createdAt')
  })

  it('passes cursor and limit through and propagates nextCursor', async () => {
    h.querySubscriptionPaymentsForBusiness.mockResolvedValue({ items: [], nextCursor: 'next-page' })

    const result = await listSubscriptionPaymentsForBusiness(BUSINESS_ID, 'cursor-1', 10)

    expect(h.querySubscriptionPaymentsForBusiness).toHaveBeenCalledWith(BUSINESS_ID, 'cursor-1', 10)
    expect(result.nextCursor).toBe('next-page')
  })

  it('defaults the limit to 25 when omitted', async () => {
    h.querySubscriptionPaymentsForBusiness.mockResolvedValue({ items: [], nextCursor: null })

    await listSubscriptionPaymentsForBusiness(BUSINESS_ID, null)

    expect(h.querySubscriptionPaymentsForBusiness).toHaveBeenCalledWith(BUSINESS_ID, null, 25)
  })

  it('propagates MalformedCursorError from the repo unchanged (handler maps to 400)', async () => {
    h.querySubscriptionPaymentsForBusiness.mockRejectedValue(new MalformedCursorError('bad cursor'))

    await expect(listSubscriptionPaymentsForBusiness(BUSINESS_ID, '###bad###', 25)).rejects.toBeInstanceOf(
      MalformedCursorError,
    )
  })
})
