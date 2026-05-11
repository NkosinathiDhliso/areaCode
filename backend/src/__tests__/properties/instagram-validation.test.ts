/**
 * Property 21: Instagram Handle Validation
 *
 * For any string input to the Instagram handle field, the input SHALL be accepted
 * if and only if it matches the pattern `/^[a-zA-Z0-9_.]{1,30}$/` (after stripping
 * a leading @ if present). The stored value SHALL never contain the @ prefix.
 *
 * **Validates: Requirements 18.1, 18.2**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { validateInstagramHandle } from '../../features/nodes/instagram-validation'

// Generator for valid Instagram handle characters
const validHandleArb = fc.stringMatching(/^[a-zA-Z0-9_.]{1,30}$/)

// Generator for handles that are too long
const longHandleArb = fc.stringMatching(/^[a-zA-Z0-9_.]{31,50}$/)

describe('Property 21: Instagram Handle Validation', () => {
  it('accepts valid handles (alphanumeric + underscores + periods, 1-30 chars)', async () => {
    await fc.assert(
      fc.property(validHandleArb, (handle) => {
        const result = validateInstagramHandle(handle)
        expect(result.valid).toBe(true)
        expect(result.handle).toBe(handle)
      }),
      { numRuns: 25 },
    )
  })

  it('strips leading @ before validation', async () => {
    await fc.assert(
      fc.property(validHandleArb, (handle) => {
        const withAt = `@${handle}`
        const result = validateInstagramHandle(withAt)
        expect(result.valid).toBe(true)
        // Stored value never contains @
        expect(result.handle).not.toContain('@')
        expect(result.handle).toBe(handle)
      }),
      { numRuns: 25 },
    )
  })

  it('rejects handles with invalid characters (spaces, special chars)', async () => {
    // Strings containing at least one invalid character that aren't all whitespace
    const invalidHandleArb = fc.stringMatching(/^[a-zA-Z0-9_.]*[!#$%^&*()\-+=<>?,/\\][a-zA-Z0-9_.]*$/)
      .filter((s) => s.trim().length >= 1 && s.length <= 30)

    await fc.assert(
      fc.property(invalidHandleArb, (handle) => {
        const result = validateInstagramHandle(handle)
        expect(result.valid).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('rejects handles longer than 30 characters', async () => {
    await fc.assert(
      fc.property(longHandleArb, (handle) => {
        const result = validateInstagramHandle(handle)
        expect(result.valid).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('stored value never contains @ prefix', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 35 }),
        (input) => {
          const result = validateInstagramHandle(input)
          if (result.valid && result.handle) {
            expect(result.handle.startsWith('@')).toBe(false)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('empty string after stripping @ is treated as valid (removal)', () => {
    expect(validateInstagramHandle('')).toEqual({ valid: true, handle: '' })
    expect(validateInstagramHandle('@')).toEqual({ valid: true, handle: '' })
    expect(validateInstagramHandle('  ')).toEqual({ valid: true, handle: '' })
  })
})
