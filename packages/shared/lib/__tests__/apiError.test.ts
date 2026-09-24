/**
 * `describeApiError` per-branch unit tests (proof-of-demand R15.13, task 15.4).
 *
 * The rule under test: technical text never renders, and a 5xx body never
 * reaches a user at all. Server copy is passed through only for the statuses
 * where the backend's own sentence is the actionable specific, and only when it
 * reads like a sentence a person wrote.
 *
 * Validates: Requirements 15.13
 */
import { describe, it, expect } from 'vitest'

import { ERROR_COPY } from '../../constants/error-copy'
import { API_ERROR_COPY, classifyApiError, describeApiError, describeOAuthError } from '../apiError'

function apiError(statusCode: number, message = 'Something', error = 'TEST'): unknown {
  return { statusCode, message, error }
}

describe('classifyApiError', () => {
  it('names the connectivity failures the API client throws', () => {
    expect(classifyApiError({ statusCode: 0, error: 'network', message: 'x' })).toBe('network')
    expect(classifyApiError({ statusCode: 0, error: 'timeout', message: 'x' })).toBe('timeout')
  })

  it('maps each status to one cause', () => {
    expect(classifyApiError(apiError(401))).toBe('unauthorized')
    expect(classifyApiError(apiError(403))).toBe('forbidden')
    expect(classifyApiError(apiError(404))).toBe('notFound')
    expect(classifyApiError(apiError(409))).toBe('conflict')
    expect(classifyApiError(apiError(410))).toBe('gone')
    expect(classifyApiError(apiError(429))).toBe('rateLimited')
    expect(classifyApiError(apiError(400))).toBe('validation')
    expect(classifyApiError(apiError(422))).toBe('validation')
    expect(classifyApiError(apiError(500))).toBe('server')
    expect(classifyApiError(apiError(503))).toBe('server')
  })

  it('treats a value that is not an API error as unknown', () => {
    expect(classifyApiError(new TypeError('Failed to fetch'))).toBe('unknown')
    expect(classifyApiError(null)).toBe('unknown')
    expect(classifyApiError('boom')).toBe('unknown')
  })
})

describe('describeApiError', () => {
  it('never shows a 5xx body, on any status in the range', () => {
    for (const status of [500, 501, 502, 503, 504, 599]) {
      const copy = describeApiError(apiError(status, 'Internal server error: DynamoDB ProvisionedThroughputExceeded'))
      expect(copy).toBe(ERROR_COPY.serverError)
      expect(copy).not.toContain('DynamoDB')
    }
  })

  it('ignores the caller fallback for a 5xx, so no screen can re-leak it', () => {
    expect(describeApiError(apiError(500, 'stack trace here'), 'Failed to save the thing')).toBe(ERROR_COPY.serverError)
  })

  it('passes a 400 reason through when it reads as copy', () => {
    const reason = 'That get was switched off, pick another one.'
    expect(describeApiError(apiError(400, reason))).toBe(reason)
  })

  it('passes the per-limiter 429 copy through', () => {
    const reason = 'Too many check-in attempts, wait 30 seconds.'
    expect(describeApiError(apiError(429, reason))).toBe(reason)
  })

  it('drops a 400 message that is machinery, for the mapped line', () => {
    expect(describeApiError(apiError(400, 'ZodError: expected string at body.name'))).toBe(API_ERROR_COPY.validation)
    expect(describeApiError(apiError(400, 'body/slots[0].startTime must match pattern'))).toBe(
      API_ERROR_COPY.validation,
    )
    expect(describeApiError(apiError(400, 'see https://areacode.co.za/docs'))).toBe(API_ERROR_COPY.validation)
    expect(describeApiError(apiError(400, 'Bad'))).toBe(API_ERROR_COPY.validation)
  })

  it('never passes a message through on a status that is not a named specific', () => {
    const reason = 'This sentence reads perfectly well as copy.'
    expect(describeApiError(apiError(403, reason))).toBe(API_ERROR_COPY.forbidden)
    expect(describeApiError(apiError(404, reason))).toBe(API_ERROR_COPY.notFound)
    expect(describeApiError(apiError(401, reason))).toBe(API_ERROR_COPY.unauthorized)
  })

  it('uses the connectivity copy the API client already toasts', () => {
    expect(describeApiError({ statusCode: 0, error: 'network', message: 'x' })).toBe(ERROR_COPY.network)
    expect(describeApiError({ statusCode: 0, error: 'timeout', message: 'x' })).toBe(ERROR_COPY.timeout)
  })

  it('lets the caller name what was too frequent when the limiter sent no copy', () => {
    expect(describeApiError(apiError(429, ''), 'Easy there - too many check-ins. Try again in a moment.')).toBe(
      'Easy there - too many check-ins. Try again in a moment.',
    )
    expect(describeApiError(apiError(429, ''))).toBe(API_ERROR_COPY.rateLimited)
  })

  it('ignores the caller fallback for a cause that carries its own instruction', () => {
    expect(describeApiError(apiError(401), 'Failed to save the thing')).toBe(API_ERROR_COPY.unauthorized)
    expect(describeApiError(apiError(403), 'Failed to save the thing')).toBe(API_ERROR_COPY.forbidden)
    expect(describeApiError(apiError(404), 'Failed to save the thing')).toBe(API_ERROR_COPY.notFound)
  })

  it('uses the caller fallback only for a cause it cannot name', () => {
    expect(describeApiError(new TypeError('Failed to fetch'), 'Upload failed. Try again.')).toBe(
      'Upload failed. Try again.',
    )
    expect(describeApiError(new TypeError('Failed to fetch'))).toBe(API_ERROR_COPY.unknown)
  })
})

describe('describeOAuthError', () => {
  it('names a cancelled sign-in', () => {
    expect(describeOAuthError('access_denied')).toContain('cancelled')
  })

  it('never echoes the code it was given', () => {
    for (const code of ['invalid_request', 'unauthorized_client', 'server_error', null]) {
      const copy = describeOAuthError(code)
      if (code !== null) expect(copy).not.toContain(code)
      expect(copy.length).toBeGreaterThan(0)
    }
  })
})
