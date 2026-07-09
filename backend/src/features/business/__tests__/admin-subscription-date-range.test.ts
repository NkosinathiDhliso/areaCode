/**
 * Admin subscription payment report service unit tests
 * (billing-revenue-integrity task 8.3).
 *
 * Validates: Requirements 8.1, 8.2
 *
 * Exercises `service.listSubscriptionPaymentsByDateRange`, the admin-scope
 * read backing `GET /v1/admin/subscription-payments?from&to`. Mirrors the
 * admin boost report (`listBoosterPurchasesByDateRange`): the service
 * validates the ISO range BEFORE any DynamoDB call, then queries
 * `repo.querySubscriptionPaymentsByTimeRange` and projects each
 * Subscription_Payment_Row to the PII-free `SubscriptionPaymentView`.
 *
 * Coverage:
 *   1. Range validation (runs before any repo call):
 *      - unparseable ISO on either bound -> 400 INVALID_DATE_RANGE
 *      - from > to -> 400 INVALID_DATE_RANGE
 *      - span > ADMIN_BOOST_REPORT_MAX_RANGE_DAYS -> 400 INVALID_DATE_RANGE
 *      - the repo is never touched when the range is invalid
 *   2. Happy path — same-instant and exactly-max-window ranges are allowed;
 *      a stored row is projected to exactly the view fields and the
 *      storage-only key attributes and `createdAt` are dropped.
 *   3. Cursor + limit passthrough and nextCursor propagation; default limit.
 *
 * Strategy: `../repository.js` is partially mocked — only
 * `querySubscriptionPaymentsByTimeRange` is stubbed; the real
 * `MalformedCursorError` class is preserved so `instanceof` still holds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { SubscriptionPaymentRow } from '../types.js'

const h = vi.hoisted(() => ({
  querySubscriptionPaymentsByTimeRange: vi.fn(),
}))

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repository.js')>()
  return {
    ...actual,
    querySubscriptionPaymentsByTimeRange: h.querySubscriptionPaymentsByTimeRange,
  }
})

import { listSubscriptionPaymentsByDateRange } from '../service.js'
import { ADMIN_BOOST_REPORT_MAX_RANGE_DAYS } from '../types.js'
import { AppError } from '../../../shared/errors/AppError.js'

const MAX_RANGE_MS = ADMIN_BOOST_REPORT_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000

function makeRow(overrides: Partial<SubscriptionPaymentRow> = {}): SubscriptionPaymentRow {
  const businessId = overrides.businessId ?? 'biz-42'
  const paidAt = overrides.paidAt ?? '2026-03-15T10:00:00.000Z'
  const yocoCheckoutId = overrides.yocoCheckoutId ?? 'ch_test_123'
  return {
    pk: `SUB#${businessId}`,
    sk: `SUB#${paidAt}#${yocoCheckoutId}`,
    gsi1pk: 'SUB_BY_TIME',
    gsi1sk: paidAt,
    businessId,
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
  h.querySubscriptionPaymentsByTimeRange.mockReset()
})

describe('listSubscriptionPaymentsByDateRange range validation (R8.1)', () => {
  it('rejects an unparseable from with 400 INVALID_DATE_RANGE and never touches the repo', async () => {
    await expect(
      listSubscriptionPaymentsByDateRange('not-a-date', '2026-03-15T00:00:00.000Z', null, 25),
    ).rejects.toMatchObject({ statusCode: 400, error: 'INVALID_DATE_RANGE' })
    expect(h.querySubscriptionPaymentsByTimeRange).not.toHaveBeenCalled()
  })

  it('rejects an unparseable to with 400 INVALID_DATE_RANGE and never touches the repo', async () => {
    await expect(
      listSubscriptionPaymentsByDateRange('2026-03-15T00:00:00.000Z', 'garbage', null, 25),
    ).rejects.toMatchObject({ statusCode: 400, error: 'INVALID_DATE_RANGE' })
    expect(h.querySubscriptionPaymentsByTimeRange).not.toHaveBeenCalled()
  })

  it('rejects from > to with 400 INVALID_DATE_RANGE and never touches the repo', async () => {
    await expect(
      listSubscriptionPaymentsByDateRange('2026-03-16T00:00:00.000Z', '2026-03-15T00:00:00.000Z', null, 25),
    ).rejects.toMatchObject({ statusCode: 400, error: 'INVALID_DATE_RANGE' })
    expect(h.querySubscriptionPaymentsByTimeRange).not.toHaveBeenCalled()
  })

  it('rejects a span exceeding the max window with 400 INVALID_DATE_RANGE', async () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const to = new Date(from.getTime() + MAX_RANGE_MS + 1)
    await expect(
      listSubscriptionPaymentsByDateRange(from.toISOString(), to.toISOString(), null, 25),
    ).rejects.toMatchObject({ statusCode: 400, error: 'INVALID_DATE_RANGE' })
    expect(h.querySubscriptionPaymentsByTimeRange).not.toHaveBeenCalled()
  })

  it('allows a same-instant range (from === to)', async () => {
    h.querySubscriptionPaymentsByTimeRange.mockResolvedValue({ items: [], nextCursor: null })
    const iso = '2026-03-15T10:00:00.000Z'
    await expect(listSubscriptionPaymentsByDateRange(iso, iso, null, 25)).resolves.toEqual({
      items: [],
      nextCursor: null,
    })
    expect(h.querySubscriptionPaymentsByTimeRange).toHaveBeenCalledWith(iso, iso, null, 25)
  })

  it('allows a span of exactly the max window', async () => {
    h.querySubscriptionPaymentsByTimeRange.mockResolvedValue({ items: [], nextCursor: null })
    const from = new Date('2026-01-01T00:00:00.000Z')
    const to = new Date(from.getTime() + MAX_RANGE_MS)
    await expect(listSubscriptionPaymentsByDateRange(from.toISOString(), to.toISOString(), null, 25)).resolves.toEqual({
      items: [],
      nextCursor: null,
    })
    expect(h.querySubscriptionPaymentsByTimeRange).toHaveBeenCalledOnce()
  })
})

describe('listSubscriptionPaymentsByDateRange happy path (R8.1, R8.2)', () => {
  it('projects a stored row to the PII-free SubscriptionPaymentView and drops storage-only fields', async () => {
    const row = makeRow()
    h.querySubscriptionPaymentsByTimeRange.mockResolvedValue({ items: [row], nextCursor: null })

    const result = await listSubscriptionPaymentsByDateRange(
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
      null,
      25,
    )

    expect(result.items).toEqual([
      {
        businessId: 'biz-42',
        plan: 'growth',
        interval: 'monthly',
        amountCents: 9900,
        currency: 'ZAR',
        yocoCheckoutId: 'ch_test_123',
        paidAt: '2026-03-15T10:00:00.000Z',
        paidUntilProduced: '2026-04-15T10:00:00.000Z',
      },
    ])
    // Storage-only concerns never leak into the admin view (R8.2).
    const view = result.items[0] as Record<string, unknown>
    expect(view).not.toHaveProperty('pk')
    expect(view).not.toHaveProperty('sk')
    expect(view).not.toHaveProperty('gsi1pk')
    expect(view).not.toHaveProperty('gsi1sk')
    expect(view).not.toHaveProperty('createdAt')
  })

  it('passes cursor and limit through and propagates nextCursor', async () => {
    h.querySubscriptionPaymentsByTimeRange.mockResolvedValue({ items: [], nextCursor: 'next-page' })

    const result = await listSubscriptionPaymentsByDateRange(
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
      'cursor-1',
      10,
    )

    expect(h.querySubscriptionPaymentsByTimeRange).toHaveBeenCalledWith(
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
      'cursor-1',
      10,
    )
    expect(result.nextCursor).toBe('next-page')
  })

  it('defaults the limit to 25 when omitted', async () => {
    h.querySubscriptionPaymentsByTimeRange.mockResolvedValue({ items: [], nextCursor: null })

    await listSubscriptionPaymentsByDateRange('2026-03-01T00:00:00.000Z', '2026-03-31T00:00:00.000Z', null)

    expect(h.querySubscriptionPaymentsByTimeRange).toHaveBeenCalledWith(
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
      null,
      25,
    )
  })

  it('throws AppError (not a generic error) on an invalid range', async () => {
    const err = await listSubscriptionPaymentsByDateRange('bad', 'bad', null, 25).catch((e) => e)
    expect(err).toBeInstanceOf(AppError)
  })
})
