import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import {
  subscriptionPaymentRowSchema,
  subCheckoutMarkerRowSchema,
  PAID_INTERVALS,
  type SubscriptionPaymentRow,
  type SubCheckoutMarkerRow,
} from '../types.js'

/**
 * Feature: billing-revenue-integrity, Property 6: Subscription row JSON round-trip.
 *
 * For any Subscription_Payment_Row (and its Sub_Checkout_Marker) valid under the
 * Zod schema, `subscriptionPaymentRowSchema.parse(JSON.parse(JSON.stringify(row)))`
 * is deeply equal to the original row, and no row carries a `ttl` attribute
 * (7-year financial retention, no TTL) nor any phone-number / SMS-delivery field.
 *
 * Validates: Requirements 2.2
 */

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** [\w-]{minLength,maxLength} — matches the schema's pk / businessId / yocoCheckoutId regex/length bounds. */
const wordDashStringArb = (minLength: number, maxLength: number) =>
  fc.string({
    minLength,
    maxLength,
    unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  })

const businessIdArb = wordDashStringArb(1, 64)
const yocoCheckoutIdArb = wordDashStringArb(1, 128)

const planArb = fc.constantFrom('growth', 'pro', 'payg') as fc.Arbitrary<'growth' | 'pro' | 'payg'>
const intervalArb = fc.constantFrom(...PAID_INTERVALS)

/**
 * ISO 8601 millisecond-precision UTC timestamp, e.g. `2026-05-17T08:30:00.000Z`.
 * Bounded between 2000-01-01 and 2100-01-01 so the derived sort keys are deterministic.
 */
const isoMillisUtcArb = fc
  .integer({ min: 946_684_800_000, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString())

const amountCentsArb = fc.integer({ min: 1, max: 10_000_000 })

/**
 * Composes a fully-valid SubscriptionPaymentRow whose pk / sk / gsi1pk / gsi1sk are
 * derived from the other generated fields so the schema's regex and equality
 * constraints are satisfied.
 */
const subscriptionPaymentRowArb: fc.Arbitrary<SubscriptionPaymentRow> = fc
  .record({
    businessId: businessIdArb,
    plan: planArb,
    interval: intervalArb,
    amountCents: amountCentsArb,
    yocoCheckoutId: yocoCheckoutIdArb,
    paidAt: isoMillisUtcArb,
    paidUntilProduced: isoMillisUtcArb,
    createdAt: isoMillisUtcArb,
  })
  .map((parts) => {
    const row: SubscriptionPaymentRow = {
      pk: `SUB#${parts.businessId}`,
      sk: `SUB#${parts.paidAt}#${parts.yocoCheckoutId}`,
      gsi1pk: 'SUB_BY_TIME',
      gsi1sk: parts.paidAt,
      businessId: parts.businessId,
      plan: parts.plan,
      interval: parts.interval,
      amountCents: parts.amountCents,
      currency: 'ZAR',
      yocoCheckoutId: parts.yocoCheckoutId,
      paidAt: parts.paidAt,
      paidUntilProduced: parts.paidUntilProduced,
      createdAt: parts.createdAt,
    }
    return row
  })

/** Composes a fully-valid Sub_Checkout_Marker row from the same generated identifiers. */
const subCheckoutMarkerRowArb: fc.Arbitrary<SubCheckoutMarkerRow> = fc
  .record({
    businessId: businessIdArb,
    yocoCheckoutId: yocoCheckoutIdArb,
    paidAt: isoMillisUtcArb,
    createdAt: isoMillisUtcArb,
  })
  .map((parts) => {
    const row: SubCheckoutMarkerRow = {
      pk: `SUB_CHECKOUT#${parts.yocoCheckoutId}`,
      sk: `SUB_CHECKOUT#${parts.yocoCheckoutId}`,
      businessId: parts.businessId,
      subPk: `SUB#${parts.businessId}`,
      subSk: `SUB#${parts.paidAt}#${parts.yocoCheckoutId}`,
      createdAt: parts.createdAt,
    }
    return row
  })

const RUN = { numRuns: 100 } as const

const phoneSmsPattern = /phone|sms/i

// ─── Property 6: Subscription row JSON round-trip ───────────────────────────

describe('Feature: billing-revenue-integrity, Property 6: Subscription row JSON round-trip', () => {
  it('schema-parsed JSON.parse(JSON.stringify(row)) is deeply equal to the subscription row', () => {
    fc.assert(
      fc.property(subscriptionPaymentRowArb, (row) => {
        const roundTripped = subscriptionPaymentRowSchema.parse(JSON.parse(JSON.stringify(row)))
        expect(roundTripped).toEqual(row)
      }),
      RUN,
    )
  })

  it('schema-parsed JSON.parse(JSON.stringify(row)) is deeply equal to the checkout marker row', () => {
    fc.assert(
      fc.property(subCheckoutMarkerRowArb, (row) => {
        const roundTripped = subCheckoutMarkerRowSchema.parse(JSON.parse(JSON.stringify(row)))
        expect(roundTripped).toEqual(row)
      }),
      RUN,
    )
  })

  it('no generated subscription or marker row carries a `ttl` attribute (7-year retention, no TTL)', () => {
    fc.assert(
      fc.property(subscriptionPaymentRowArb, subCheckoutMarkerRowArb, (paymentRow, markerRow) => {
        expect(Object.prototype.hasOwnProperty.call(paymentRow, 'ttl')).toBe(false)
        expect(Object.prototype.hasOwnProperty.call(markerRow, 'ttl')).toBe(false)
      }),
      RUN,
    )
  })

  it('no generated subscription or marker row contains any phone-number or SMS field', () => {
    fc.assert(
      fc.property(subscriptionPaymentRowArb, subCheckoutMarkerRowArb, (paymentRow, markerRow) => {
        for (const key of Object.keys(paymentRow)) {
          expect(phoneSmsPattern.test(key)).toBe(false)
        }
        for (const key of Object.keys(markerRow)) {
          expect(phoneSmsPattern.test(key)).toBe(false)
        }
      }),
      RUN,
    )
  })
})
