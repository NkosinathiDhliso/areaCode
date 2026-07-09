import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

/**
 * Token-based guest-claim model — Churn-defences spec, Requirement 6.
 *
 * The phone-based variant was retired alongside SMS auth (carrier
 * delivery to SA networks proved unreliable in pilot, see ops decision
 * log). The replacement is a one-time 8-character token issued by
 * staff at the till and redeemed by the customer post-signup. No PII is
 * collected at the till.
 *
 * These properties exercise the format guarantees of the token, which
 * are the only thing left to test purely (the lifecycle now lives
 * inside DynamoDB conditional writes).
 */

const TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function generateTokenFromBuf(buf: Uint8Array): string {
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    out += ALPHABET[buf[i]! % ALPHABET.length]
  }
  return out
}

describe('Guest claim token format', () => {
  it('Crockford base32 alphabet excludes the visually ambiguous letters', () => {
    expect(ALPHABET.includes('I')).toBe(false)
    expect(ALPHABET.includes('L')).toBe(false)
    expect(ALPHABET.includes('O')).toBe(false)
    expect(ALPHABET.includes('U')).toBe(false)
  })

  it('any 8-byte buffer produces a token that matches the regex', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 8, maxLength: 8 }), (buf) => {
        const token = generateTokenFromBuf(buf)
        expect(token).toMatch(TOKEN_RE)
      }),
    )
  })

  it('tokens are exactly 8 characters', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 8, maxLength: 8 }), (buf) => {
        expect(generateTokenFromBuf(buf).length).toBe(8)
      }),
    )
  })

  it('the regex rejects lowercase, ambiguous letters, and wrong lengths', () => {
    expect(TOKEN_RE.test('abcdefgh')).toBe(false)
    expect(TOKEN_RE.test('ABCDEIGH')).toBe(false) // contains I
    expect(TOKEN_RE.test('ABCDEFGHI')).toBe(false) // 9 chars
    expect(TOKEN_RE.test('ABCDEFG')).toBe(false) // 7 chars
    expect(TOKEN_RE.test('OBCDEFGH')).toBe(false) // contains O
    expect(TOKEN_RE.test('LBCDEFGH')).toBe(false) // contains L
    expect(TOKEN_RE.test('UBCDEFGH')).toBe(false) // contains U
  })

  it('valid tokens generated from the alphabet pass the regex', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: ALPHABET.length - 1 }), { minLength: 8, maxLength: 8 }),
        (indexes) => {
          const token = indexes.map((i) => ALPHABET[i]!).join('')
          expect(token).toMatch(TOKEN_RE)
        },
      ),
    )
  })
})
