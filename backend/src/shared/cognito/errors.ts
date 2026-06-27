/**
 * Translate AWS Cognito (and other AWS SDK) exceptions into typed AppErrors.
 *
 * Without this, a Cognito failure (wrong password, unconfirmed user, duplicate
 * email, throttling) propagates as a raw Error. The global handler can't read a
 * status off it, so it falls through to a generic 500 "Internal server error".
 * That is why a simple wrong password was surfacing as a scary server error and
 * why every auth path felt broken. Mapping these to real 4xx codes gives the
 * frontend the right status to show a calm, specific message.
 */
import { AppError } from '../errors/AppError.js'

interface AwsSdkErrorLike {
  name?: string
  message?: string
  $metadata?: { httpStatusCode?: number }
}

/**
 * Map a thrown value to an AppError when it is a recognizable AWS SDK / Cognito
 * exception. Returns `undefined` when the error is not AWS-shaped so the caller
 * can rethrow the original (and let it surface as a genuine 500).
 *
 * Messages are deliberately generic and never leak which field was wrong, to
 * avoid account enumeration.
 */
export function mapCognitoError(err: unknown): AppError | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as AwsSdkErrorLike
  const name = e.name
  if (!name) return undefined

  switch (name) {
    // Wrong password, disabled user, attempts exceeded. Same copy for missing
    // user to avoid revealing whether an email is registered.
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return AppError.unauthorized('Invalid email or password.')

    case 'UserNotConfirmedException':
      return AppError.forbidden('Please verify your email before signing in.')

    case 'PasswordResetRequiredException':
      return AppError.forbidden('Please reset your password to continue.')

    case 'InvalidPasswordException':
      return AppError.badRequest('Password does not meet the requirements.')

    case 'InvalidParameterException':
      return AppError.badRequest('Please check your details and try again.')

    case 'UsernameExistsException':
      return AppError.conflict('Email already registered')

    case 'CodeMismatchException':
    case 'ExpiredCodeException':
      return AppError.badRequest('That code is invalid or has expired.')

    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return AppError.tooManyRequests('Too many attempts. Please try again in a few minutes.')

    default: {
      // Unknown AWS error with a 4xx status is still a client-side problem, not
      // a server crash. Map it to a generic 400 so it does not masquerade as a
      // 500. 5xx and config errors (e.g. ResourceNotFoundException) fall through
      // to the caller and surface as a real 500.
      const status = e.$metadata?.httpStatusCode
      if (typeof status === 'number' && status >= 400 && status < 500) {
        return AppError.badRequest('Please check your details and try again.')
      }
      return undefined
    }
  }
}

/**
 * Run an AWS SDK call and rethrow any recognizable Cognito error as a typed
 * AppError. Unknown / server-side errors are rethrown unchanged.
 */
export async function withCognitoErrorMapping<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const mapped = mapCognitoError(err)
    if (mapped) throw mapped
    throw err
  }
}
