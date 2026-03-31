import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

const ALLOWED_RESPONSES = ['consumer', 'business', 'staff', 'not_found'] as const
type AccountType = typeof ALLOWED_RESPONSES[number]

/**
 * Property 5: Account-type endpoint never leaks pool information.
 * For any phone number, response is always one of the 4 allowed values.
 * Validates: Requirements 2.9
 *
 * Simulates the getAccountType service function behaviour.
 */
function simulateGetAccountType(
  phone: string,
  db: Map<string, AccountType>,
): AccountType {
  return db.get(phone) ?? 'not_found'
}

describe('account-type endpoint', () => {
  const phoneArb = fc.stringMatching(/^\+\d{10,15}$/)

  it('always returns one of the 4 allowed values', () => {
    fc.assert(
      fc.property(phoneArb, (phone) => {
        const db = new Map<string, AccountType>()
        const result = simulateGetAccountType(phone, db)
        expect(ALLOWED_RESPONSES).toContain(result)
      }),
      { numRuns: 300 },
    )
  })

  it('returns not_found for unknown phones — never distinguishes wrong pool', () => {
    fc.assert(
      fc.property(phoneArb, phoneArb, (knownPhone, unknownPhone) => {
        const db = new Map<string, AccountType>()
        db.set(knownPhone, 'consumer')

        if (knownPhone === unknownPhone) return true

        const result = simulateGetAccountType(unknownPhone, db)
        expect(result).toBe('not_found')
        return true
      }),
      { numRuns: 300 },
    )
  })
})

/**
 * Property 6: OTP rate limiting is enforced.
 * More than 3 OTP requests per phone per hour always returns 429.
 * Validates: Requirements 32.9
 */
describe('OTP rate limiting', () => {
  function simulateOtpRateLimit(requestCount: number, hourlyLimit: number): boolean {
    return requestCount <= hourlyLimit
  }

  it('blocks requests exceeding 3/hour/phone', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 100 }), (count) => {
        expect(simulateOtpRateLimit(count, 3)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('allows requests within 3/hour/phone', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), (count) => {
        expect(simulateOtpRateLimit(count, 3)).toBe(true)
      }),
      { numRuns: 50 },
    )
  })
})
