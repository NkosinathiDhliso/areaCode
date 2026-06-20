/**
 * Property 4: Channel Enum Closure (No SMS)
 *
 * For any campaign creation input, `createCampaignBodySchema` SHALL accept the
 * input only if every channel is in `{push, email}`, and the serialized
 * campaign SHALL contain no phone-number field; any input containing a channel
 * outside that set SHALL be rejected.
 *
 * This is the structural enforcement of Constraint C1 (no SMS / no phone) — the
 * `channels` enum is closed over exactly `['push', 'email']` and Zod strips any
 * unknown (e.g. phone) field, so a parsed campaign can never carry a phone
 * identifier. See `.kiro/steering/no-sms-no-phone-auth.md`.
 *
 * **Validates: Requirements 5.3, 5.4, C1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { createCampaignBodySchema, CAMPAIGN_CHANNELS } from '../types.js'

// ─── Generators ─────────────────────────────────────────────────────────────

/** The only channels the platform supports — email + push, never SMS (C1). */
const VALID_CHANNELS = [...CAMPAIGN_CHANNELS] as readonly string[]

/** Channel-like strings that MUST always be rejected — notably SMS/phone. */
const KNOWN_INVALID_CHANNELS = [
  'sms',
  'phone',
  'whatsapp',
  'telegram',
  'voice',
  'mms',
  'fax',
  'call',
  'push_email', // close-but-wrong
  'Push', // case-sensitive: not the same as 'push'
  'EMAIL',
] as const

/** A single valid channel. */
const validChannelArb = fc.constantFrom(...VALID_CHANNELS)

/** A single channel that is guaranteed NOT to be a valid channel. */
const invalidChannelArb = fc.oneof(
  fc.constantFrom(...KNOWN_INVALID_CHANNELS),
  // Random strings, filtered so they can never accidentally be a valid channel.
  fc.string().filter((s) => !VALID_CHANNELS.includes(s)),
)

/**
 * A mixed array of channel-like values: each element may be valid or invalid.
 * The property recomputes validity from the array itself, so this needs no
 * categorisation.
 */
const mixedChannelsArb = fc.array(fc.oneof(validChannelArb, invalidChannelArb), {
  minLength: 0,
  maxLength: 6,
})

/**
 * A base campaign input whose every NON-channel field is always valid, so that
 * acceptance/rejection is determined solely by the `channels` field.
 */
const baseInputArb = fc.record({
  segment: fc.constantFrom('lapsed', 'first_timers', 'regulars', 'all_past_visitors'),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  body: fc.string({ minLength: 1, maxLength: 500 }),
  nodeIds: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
})

// ─── Helpers ────────────────────────────────────────────────────────────────

const PHONE_FIELD_PATTERN = /phone|sms|mobile|msisdn|whatsapp|\btel\b/i

/** Recursively collect every object key in a parsed structure. */
function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc)
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      acc.push(key)
      collectKeys((value as Record<string, unknown>)[key], acc)
    }
  }
  return acc
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: winback-campaigns, Property 4: Channel Enum Closure (No SMS)', () => {
  it('accepts an input iff its channels are a non-empty subset of {push, email}', () => {
    fc.assert(
      fc.property(baseInputArb, mixedChannelsArb, (base, channels) => {
        const result = createCampaignBodySchema.safeParse({ ...base, channels })

        const everyChannelAllowed = channels.length >= 1 && channels.every((c) => VALID_CHANNELS.includes(c))

        expect(result.success).toBe(everyChannelAllowed)
      }),
      { numRuns: 25 },
    )
  })

  it('always accepts channel arrays drawn only from {push, email}', () => {
    const validChannelsArb = fc.array(validChannelArb, { minLength: 1, maxLength: 4 })

    fc.assert(
      fc.property(baseInputArb, validChannelsArb, (base, channels) => {
        const result = createCampaignBodySchema.safeParse({ ...base, channels })

        expect(result.success).toBe(true)
        if (result.success) {
          // The parsed channels are exactly what was supplied (no coercion).
          expect(result.data.channels).toEqual(channels)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('always rejects any input containing at least one channel outside {push, email} (incl. sms/phone)', () => {
    const tainedChannelsArb = fc
      .tuple(
        fc.array(validChannelArb, { minLength: 0, maxLength: 3 }),
        fc.array(invalidChannelArb, { minLength: 1, maxLength: 3 }),
      )
      .map(([valid, invalid]) => [...valid, ...invalid])

    fc.assert(
      fc.property(baseInputArb, tainedChannelsArb, (base, channels) => {
        const result = createCampaignBodySchema.safeParse({ ...base, channels })

        expect(result.success).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('strips any injected phone-number field: a parsed campaign carries no phone field anywhere (C1)', () => {
    const validChannelsArb = fc.array(validChannelArb, { minLength: 1, maxLength: 4 })
    const phoneArb = fc
      .array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 9, maxLength: 9 })
      .map((digits) => `+27${digits.join('')}`)

    fc.assert(
      fc.property(baseInputArb, validChannelsArb, phoneArb, (base, channels, phone) => {
        // Inject several phone-shaped fields that an SMS path might smuggle in.
        const withPhone = {
          ...base,
          channels,
          phone,
          phoneNumber: phone,
          mobile: phone,
          sms: phone,
        }

        const result = createCampaignBodySchema.safeParse(withPhone)
        expect(result.success).toBe(true)

        if (result.success) {
          const keys = collectKeys(result.data)
          const offending = keys.filter((k) => PHONE_FIELD_PATTERN.test(k))
          expect(offending).toEqual([])

          // And the serialized campaign contains no phone-number field.
          const serializedKeys = collectKeys(JSON.parse(JSON.stringify(result.data)))
          expect(serializedKeys.some((k) => PHONE_FIELD_PATTERN.test(k))).toBe(false)
        }
      }),
      { numRuns: 25 },
    )
  })
})
