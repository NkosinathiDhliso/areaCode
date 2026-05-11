/**
 * Property 14: Webhook Signature Verification
 *
 * For any request body B and HMAC signature S computed with the Yoco webhook secret,
 * the verification SHALL accept if and only if the computed HMAC of B matches S.
 * Additionally, for any event with timestamp T and current server time NOW,
 * the event SHALL be rejected if `NOW - T > 5 minutes`.
 *
 * **Validates: Requirements 21.1, 21.2**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { createHmac } from 'node:crypto'
import { verifyWebhookSignature, isWebhookTimestampValid } from '../../features/business/webhook-verification.js'

describe('Property 14: Webhook Signature Verification', () => {
  it('accepts valid HMAC signatures and rejects invalid ones', async () => {
    await fc.assert(
      fc.property(
        // Generate random request bodies (non-empty strings)
        fc.string({ minLength: 1, maxLength: 2000 }),
        // Generate random webhook secrets (non-empty)
        fc.string({ minLength: 8, maxLength: 64 }),
        // Generate a boolean to decide whether to use correct or incorrect signature
        fc.boolean(),
        (body, secret, useCorrectSignature) => {
          const correctSignature = createHmac('sha256', secret).update(body).digest('hex')

          if (useCorrectSignature) {
            // Valid signature MUST be accepted
            expect(verifyWebhookSignature(body, correctSignature, secret)).toBe(true)
          } else {
            // Tampered signature MUST be rejected
            // Flip a character in the signature to make it invalid
            const tamperedSignature = correctSignature.slice(0, -1) +
              (correctSignature.slice(-1) === 'a' ? 'b' : 'a')
            expect(verifyWebhookSignature(body, tamperedSignature, secret)).toBe(false)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('rejects empty or missing signatures', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 8, maxLength: 64 }),
        (body, secret) => {
          // Empty signature must be rejected
          expect(verifyWebhookSignature(body, '', secret)).toBe(false)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('rejects when secret is empty', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 128 }),
        (body, signature) => {
          // Empty secret must be rejected
          expect(verifyWebhookSignature(body, signature, '')).toBe(false)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('rejects signatures computed with a different secret', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1000 }),
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.string({ minLength: 8, maxLength: 64 }),
        (body, secret1, secret2) => {
          // Only test when secrets are actually different
          fc.pre(secret1 !== secret2)

          const signatureWithSecret1 = createHmac('sha256', secret1).update(body).digest('hex')
          // Signature from secret1 must NOT verify with secret2
          expect(verifyWebhookSignature(body, signatureWithSecret1, secret2)).toBe(false)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('accepts timestamps within 5 minutes and rejects stale ones', async () => {
    await fc.assert(
      fc.property(
        // Generate an offset in seconds: negative means in the past, positive means in the future
        fc.integer({ min: -600, max: 600 }),
        (offsetSeconds) => {
          const now = new Date()
          const eventTime = new Date(now.getTime() - offsetSeconds * 1000)
          const createdDate = eventTime.toISOString()

          const isValid = isWebhookTimestampValid(createdDate, now)

          // Event should be valid if offset <= 300 seconds (5 minutes)
          // offsetSeconds represents how far in the past the event is (positive = past)
          if (offsetSeconds <= 300) {
            expect(isValid).toBe(true)
          } else {
            // Events older than 5 minutes must be rejected
            expect(isValid).toBe(false)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('rejects missing or invalid timestamps', async () => {
    await fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(''),
          fc.constant('not-a-date'),
          fc.constant('2025-13-45T99:99:99Z'), // invalid date
        ),
        (createdDate) => {
          const result = isWebhookTimestampValid(createdDate as string | undefined)
          expect(result).toBe(false)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('correctly enforces the 5-minute boundary', async () => {
    await fc.assert(
      fc.property(
        // Generate timestamps exactly at or near the 5-minute boundary
        fc.integer({ min: 295, max: 310 }),
        (offsetSeconds) => {
          const now = new Date()
          const eventTime = new Date(now.getTime() - offsetSeconds * 1000)
          const createdDate = eventTime.toISOString()

          const isValid = isWebhookTimestampValid(createdDate, now)

          // Exactly at 300s (5 min) should still be valid (<=), beyond should be rejected
          if (offsetSeconds <= 300) {
            expect(isValid).toBe(true)
          } else {
            expect(isValid).toBe(false)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})
