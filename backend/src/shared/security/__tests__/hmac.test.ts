import { createHmac } from 'node:crypto'

import { describe, it, expect } from 'vitest'

import { digestsEqual } from '../hmac.js'

/**
 * `digestsEqual` is the one home for constant-time HMAC digest comparison.
 * It must accept only exact matches and reject unequal-length inputs without
 * throwing (guarding the `timingSafeEqual` equal-length precondition).
 */
describe('digestsEqual', () => {
  it('returns true for identical digests', () => {
    const digest = createHmac('sha256', 'secret').update('payload').digest('hex')
    expect(digestsEqual(digest, digest)).toBe(true)
  })

  it('returns false for a single-character difference of equal length', () => {
    const a = 'a'.repeat(32)
    const b = 'a'.repeat(31) + 'b'
    expect(digestsEqual(a, b)).toBe(false)
  })

  it('returns false (never throws) for unequal-length inputs', () => {
    expect(digestsEqual('short', 'a'.repeat(32))).toBe(false)
    expect(digestsEqual('a'.repeat(32), '')).toBe(false)
  })

  it('returns true for two empty strings', () => {
    expect(digestsEqual('', '')).toBe(true)
  })

  it('accepts a valid QR-shaped digest and rejects a forged one (Requirement 1.4)', () => {
    const secret = 'test-qr-secret'
    const expected = createHmac('sha256', secret).update('node-123window').digest('hex').slice(0, 32)
    expect(digestsEqual(expected, expected)).toBe(true)
    expect(digestsEqual('f'.repeat(32), expected)).toBe(false)
  })
})
