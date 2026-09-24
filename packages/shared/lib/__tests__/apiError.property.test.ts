/**
 * Feature: Proof of demand, Property 11: `describeApiError` never returns a
 * string containing `DOMException`, `TypeError`, `error_description`, a URL, or
 * a stack frame.
 *
 * The generators aim at the input space that actually produces those strings: a
 * thrown `DOMException` or `TypeError`, a Cognito `error_description` body, a
 * stack frame, a URL, and an API error on every status with an arbitrary
 * message. Whatever the shape, what comes back is either one of the approved
 * lines or a server sentence that passed the copy gate.
 *
 * Validates: Requirements 15.13
 */
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { API_ERROR_COPY, describeApiError } from '../apiError'

const BANNED = [
  'DOMException',
  'TypeError',
  'ReferenceError',
  'error_description',
  'Traceback',
  'node_modules',
  'http://',
  'https://',
  '    at ',
]

/** Strings that look like the machinery we must never render. */
const technicalMessageArb = fc.oneof(
  fc.constant('DOMException: The source image could not be decoded'),
  fc.constant('TypeError: Failed to fetch'),
  fc.constant('error_description=Required String parameter client_id is not present'),
  fc.constant('Error: boom\n    at request (/var/task/index.js:1:1)'),
  fc.constant('Request to https://payments.yoco.com/api/checkouts failed'),
  fc.constant('ValidationException: One or more parameter values were invalid'),
  fc.constant('ENOTFOUND dynamodb.af-south-1.amazonaws.com'),
  fc.string(),
  fc.string({ minLength: 1, maxLength: 400 }),
)

const statusArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 100, max: 599 }),
  fc.constantFrom(400, 401, 403, 404, 409, 410, 413, 422, 429, 500, 502, 503),
)

const apiErrorArb = fc.record({
  statusCode: statusArb,
  error: fc.oneof(fc.constantFrom('network', 'timeout', 'VALIDATION', 'FORBIDDEN'), fc.string()),
  message: technicalMessageArb,
})

const thrownArb = fc.oneof(
  apiErrorArb,
  technicalMessageArb.map((m) => new TypeError(m)),
  technicalMessageArb.map((m) => new Error(m)),
  fc.constant(null),
  fc.constant(undefined),
  fc.anything(),
)

const APPROVED = Object.values(API_ERROR_COPY)

describe('Feature: Proof of demand, Property 11: describeApiError leaks nothing technical', () => {
  it('never returns a string carrying machinery, for any thrown value', () => {
    fc.assert(
      fc.property(thrownArb, (err) => {
        const copy = describeApiError(err)
        expect(typeof copy).toBe('string')
        expect(copy.length).toBeGreaterThan(0)
        for (const token of BANNED) {
          expect(copy).not.toContain(token)
        }
        // No newlines, no angle brackets, no braces: copy, not structure.
        expect(copy).not.toMatch(/[\n<>{}\\]/)
      }),
      { numRuns: 300 },
    )
  })

  it('returns an approved line, or a server sentence that passed the copy gate', () => {
    fc.assert(
      fc.property(apiErrorArb, (err) => {
        const copy = describeApiError(err)
        if (APPROVED.includes(copy)) return
        // The only other possibility is the server's own message, and only for a
        // status where that message is the actionable specific.
        expect([400, 409, 429]).toContain(err.statusCode)
        expect(copy).toBe(err.message)
        expect(copy.length).toBeLessThanOrEqual(160)
      }),
      { numRuns: 300 },
    )
  })

  it('never returns a 5xx message body, whatever the body says', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 599 }), technicalMessageArb, (statusCode, message) => {
        const copy = describeApiError({ statusCode, error: 'SERVER', message }, 'caller fallback')
        expect(copy).toBe(API_ERROR_COPY.server)
        expect(copy).not.toBe(message)
      }),
      { numRuns: 200 },
    )
  })
})
