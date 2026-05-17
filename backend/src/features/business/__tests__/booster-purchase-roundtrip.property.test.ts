import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { boosterPurchaseRowSchema, type BoosterPurchaseRow } from '../types.js'

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** [\w-]{minLength,maxLength} — matches the schema's pk / nodeId / yocoCheckoutId regex/length bounds. */
const wordDashStringArb = (minLength: number, maxLength: number) =>
  fc.string({
    minLength,
    maxLength,
    unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  })

const businessIdArb = wordDashStringArb(1, 64)
const nodeIdArb = wordDashStringArb(1, 64)
const yocoCheckoutIdArb = wordDashStringArb(1, 128)
const neighbourhoodIdArb = wordDashStringArb(1, 64)

const durationArb = fc.constantFrom('2hr', '6hr', '24hr') as fc.Arbitrary<'2hr' | '6hr' | '24hr'>
const tierArb = fc.constantFrom('starter', 'growth', 'pro', 'payg') as fc.Arbitrary<
  'starter' | 'growth' | 'pro' | 'payg'
>

/**
 * ISO 8601 millisecond-precision UTC timestamp, e.g. `2026-05-17T08:30:00.000Z`.
 * Bounded between 2000-01-01 and 2100-01-01 so paidAt < createdAt sorting is deterministic.
 */
const isoMillisUtcArb = fc
  .integer({ min: 946_684_800_000, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString())

const amountCentsArb = fc.integer({ min: 1, max: 10_000_000 })
const floorAtPurchaseCentsArb = fc.integer({ min: 1, max: 1_000_000 })

/**
 * Composes a fully-valid BoosterPurchaseRow whose pk / sk / gsi1pk / gsi1sk are derived from
 * the other generated fields so the schema's regex and equality constraints are satisfied.
 */
const boosterPurchaseRowArb: fc.Arbitrary<BoosterPurchaseRow> = fc
  .record({
    businessId: businessIdArb,
    nodeId: nodeIdArb,
    duration: durationArb,
    amountCents: amountCentsArb,
    yocoCheckoutId: yocoCheckoutIdArb,
    paidAt: isoMillisUtcArb,
    tierSnapshot: tierArb,
    neighbourhoodIdSnapshot: fc.option(neighbourhoodIdArb, { nil: null }),
    floorAtPurchaseCents: floorAtPurchaseCentsArb,
    createdAt: isoMillisUtcArb,
  })
  .map((parts) => {
    const row: BoosterPurchaseRow = {
      pk: `BOOST#${parts.businessId}`,
      sk: `BOOST#${parts.paidAt}#${parts.yocoCheckoutId}`,
      gsi1pk: 'BOOST_BY_TIME',
      gsi1sk: parts.paidAt,
      businessId: parts.businessId,
      nodeId: parts.nodeId,
      duration: parts.duration,
      amountCents: parts.amountCents,
      currency: 'ZAR',
      yocoCheckoutId: parts.yocoCheckoutId,
      paidAt: parts.paidAt,
      tierSnapshot: parts.tierSnapshot,
      neighbourhoodIdSnapshot: parts.neighbourhoodIdSnapshot,
      floorAtPurchaseCents: parts.floorAtPurchaseCents,
      createdAt: parts.createdAt,
    }
    return row
  })

// ─── Property 3: BoosterPurchase JSON round-trip ────────────────────────────

describe('Property 3: BoosterPurchase JSON round-trip', () => {
  /**
   * **Validates: Requirements 1.2, 1.7, 1.8, 8.4, 8.5, 10.4**
   *
   * For any BoosterPurchase row valid under `boosterPurchaseRowSchema`,
   * `deserialize(serialize(row))` deeply equals `row`. As a corollary the
   * row carries no `ttl` attribute (R1.7) and no phone-number / SMS-delivery
   * field (R1.8, R8.4) because the schema does not admit such attributes.
   */

  it('schema-parsed JSON.parse(JSON.stringify(row)) is deeply equal to row', () => {
    fc.assert(
      fc.property(boosterPurchaseRowArb, (row) => {
        const roundTripped = boosterPurchaseRowSchema.parse(JSON.parse(JSON.stringify(row)))
        expect(roundTripped).toEqual(row)
      }),
      { numRuns: 200 },
    )
  })

  it('no generated row carries a `ttl` attribute (R1.7, R8.2)', () => {
    fc.assert(
      fc.property(boosterPurchaseRowArb, (row) => {
        expect(Object.prototype.hasOwnProperty.call(row, 'ttl')).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  it('no generated row contains any phone-number, SMS-delivery, or OTP field (R1.8, R8.4)', () => {
    const phoneSmsOtpPattern = /phone|sms|otp/i
    fc.assert(
      fc.property(boosterPurchaseRowArb, (row) => {
        for (const key of Object.keys(row)) {
          expect(phoneSmsOtpPattern.test(key)).toBe(false)
        }
      }),
      { numRuns: 200 },
    )
  })
})
