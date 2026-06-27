import { describe, it, expect } from 'vitest'

import { AppError } from '../../errors/AppError.js'
import { mapCognitoError } from '../errors.js'

/**
 * Cognito exceptions must surface as typed 4xx AppErrors, never as a generic
 * 500 "Internal server error". This is what made wrong passwords and duplicate
 * signups look like server crashes.
 */
describe('mapCognitoError', () => {
  const cognitoErr = (name: string, httpStatusCode = 400) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode } })

  it.each([
    ['NotAuthorizedException', 401],
    ['UserNotFoundException', 401],
    ['UserNotConfirmedException', 403],
    ['PasswordResetRequiredException', 403],
    ['InvalidPasswordException', 400],
    ['InvalidParameterException', 400],
    ['UsernameExistsException', 409],
    ['CodeMismatchException', 400],
    ['ExpiredCodeException', 400],
    ['LimitExceededException', 429],
    ['TooManyRequestsException', 429],
  ])('maps %s to %i', (name, status) => {
    const mapped = mapCognitoError(cognitoErr(name))
    expect(mapped).toBeInstanceOf(AppError)
    expect(mapped?.statusCode).toBe(status)
  })

  it('never leaks "Internal server error" in the mapped message', () => {
    const mapped = mapCognitoError(cognitoErr('NotAuthorizedException'))
    expect(mapped?.message.toLowerCase()).not.toContain('internal server error')
  })

  it('does not reveal whether the email exists', () => {
    const wrongPassword = mapCognitoError(cognitoErr('NotAuthorizedException'))
    const noSuchUser = mapCognitoError(cognitoErr('UserNotFoundException'))
    expect(wrongPassword?.message).toBe(noSuchUser?.message)
  })

  it('maps an unknown AWS error with a 4xx status to a 400', () => {
    const mapped = mapCognitoError(cognitoErr('SomethingWeirdException', 400))
    expect(mapped?.statusCode).toBe(400)
  })

  it('returns undefined for unknown AWS errors with a 5xx status (real server fault)', () => {
    expect(mapCognitoError(cognitoErr('ResourceNotFoundException', 500))).toBeUndefined()
  })

  it('returns undefined for non-AWS errors so they surface as a real 500', () => {
    expect(mapCognitoError(new Error('boom'))).toBeUndefined()
    expect(mapCognitoError(undefined)).toBeUndefined()
    expect(mapCognitoError('nope')).toBeUndefined()
  })
})
