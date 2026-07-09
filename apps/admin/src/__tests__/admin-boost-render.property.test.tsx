/**
 * Property test - Admin-side render visibility (Property 8).
 *
 * For any arbitrary `AdminBoosterPurchaseView` row, the cross-business
 * `BoostPurchaseReport` admin screen must render the operator-hidden
 * snapshot fields plus the `yocoCheckoutId` so admins can reconcile a
 * payment from the Yoco merchant dashboard.
 *
 * **Validates: Requirements 6.6, 7.6**
 */
// @vitest-environment jsdom
import { render, fireEvent, waitFor } from '@testing-library/react'
import * as fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// `BoostPurchaseReport` fetches via `api.get`. We stub the whole shared API
// module so no real network call leaves the test, and we feed each iteration
// of the property a single generated row through the mocked response.

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    setTokenProvider: vi.fn(),
    setRefreshHandler: vi.fn(),
    setRefreshPath: vi.fn(),
    ensureValidToken: vi.fn(),
  },
  setApiErrorHandler: vi.fn(),
  onTokenRefresh: vi.fn(() => () => {}),
}))

import { api } from '@area-code/shared/lib/api'

import { BoostPurchaseReport } from '../screens/BoostPurchaseReport'

// ─── Arbitraries ────────────────────────────────────────────────────────────
//
// Mirror of `AdminBoosterPurchaseView` from
// `backend/src/features/business/types.ts` (R7.6). Distinguishing prefixes
// (`biz_…`, `ch_…`, `nbr_…`) keep generated values from accidentally
// colliding with table header text such as "businessId".

const alphanumChar = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(''))

const businessIdArb = fc.string({ minLength: 4, maxLength: 16, unit: alphanumChar }).map((s) => `biz_${s}`)

const nodeIdArb = fc.string({ minLength: 4, maxLength: 16, unit: alphanumChar }).map((s) => `node_${s}`)

const yocoCheckoutIdArb = fc.string({ minLength: 6, maxLength: 24, unit: alphanumChar }).map((s) => `ch_${s}`)

const neighbourhoodIdArb = fc.option(
  fc.string({ minLength: 4, maxLength: 16, unit: alphanumChar }).map((s) => `nbr_${s}`),
  { nil: null, freq: 4 },
)

const durationArb = fc.constantFrom('2hr' as const, '6hr' as const, '24hr' as const)
const tierArb = fc.constantFrom('starter' as const, 'growth' as const, 'pro' as const, 'payg' as const)

// Use a finite ISO range so `Intl.DateTimeFormat` can format reliably
// across all platforms. 2024-01-01 → 2030-12-31.
const isoTimestampArb = fc
  .integer({ min: 1_704_067_200_000, max: 1_924_991_999_000 })
  .map((ms) => new Date(ms).toISOString())

const adminRowArb = fc.record({
  businessId: businessIdArb,
  nodeId: nodeIdArb,
  duration: durationArb,
  amountCents: fc.integer({ min: 1, max: 1_000_000 }),
  currency: fc.constant('ZAR' as const),
  yocoCheckoutId: yocoCheckoutIdArb,
  paidAt: isoTimestampArb,
  tierSnapshot: tierArb,
  neighbourhoodIdSnapshot: neighbourhoodIdArb,
  floorAtPurchaseCents: fc.integer({ min: 1, max: 1_000_000 }),
})

// `R<X>.<YY>` - same formatter used by `BoostPurchaseReport` (R7.6).
function formatAmountCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const fraction = (cents % 100).toString().padStart(2, '0')
  return `R${whole}.${fraction}`
}

// ─── Test ───────────────────────────────────────────────────────────────────

describe('Admin BoostPurchaseReport renders all admin-visible fields', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * For any generated `AdminBoosterPurchaseView`, the rendered DOM after a
   * date-range search submit shall contain the row's `businessId`,
   * `tierSnapshot`, `neighbourhoodIdSnapshot` (when not null),
   * `floorAtPurchaseCents` (formatted), and `yocoCheckoutId`.
   *
   * **Validates: Requirements 6.6, 7.6**
   */
  it('shows businessId, tierSnapshot, neighbourhoodIdSnapshot, floorAtPurchaseCents, and yocoCheckoutId', async () => {
    await fc.assert(
      fc.asyncProperty(adminRowArb, async (row) => {
        ;(api.get as ReturnType<typeof vi.fn>).mockReset()
        ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          items: [row],
          nextCursor: null,
        })

        const { container, getByText, unmount } = render(<BoostPurchaseReport />)

        // Date-range form submits via the "Search" button. Click triggers
        // `runDateRangeQuery` → `api.get` → setItems(rows) → table render.
        const searchBtn = getByText('Search')
        fireEvent.click(searchBtn)

        await waitFor(() => {
          expect(container.textContent ?? '').toContain(row.businessId)
        })

        const text = container.textContent ?? ''
        expect(text).toContain(row.businessId)
        expect(text).toContain(row.yocoCheckoutId)
        expect(text).toContain(row.tierSnapshot)
        expect(text).toContain(formatAmountCents(row.floorAtPurchaseCents))
        if (row.neighbourhoodIdSnapshot !== null) {
          expect(text).toContain(row.neighbourhoodIdSnapshot)
        }

        unmount()
      }),
      { numRuns: 50 },
    )
  }, 30_000)
})
