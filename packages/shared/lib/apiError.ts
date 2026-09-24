/**
 * One description for every API failure a user reads (proof-of-demand R15.13).
 *
 * Sibling of `api.ts` rather than part of it: `api.ts` owns the transport and is
 * already near the file-size limit, and this is the copy layer on top of it (the
 * same split as `venueOpen.ts`, and as `mapUploadError` for the upload-specific
 * case in `imageCompression.ts`).
 *
 * The rule this enforces: technical text never renders. A `DOMException`, a
 * `TypeError`, a Cognito `error_description`, a URL, a stack frame or a raw 5xx
 * body tells a user nothing they can act on, and on a 5xx it leaks our
 * internals. Every caller that used to write `err.message` into UI state calls
 * `describeApiError` instead.
 *
 * Server copy is passed through in exactly one situation: a 400, 409 or 429,
 * where the backend's own sentence is the actionable specific (which field is
 * wrong, how many seconds to wait, per-limiter 429 copy). Even then it must look
 * like a sentence written for a person, or it is dropped for the copy below.
 * Nothing else is ever passed through.
 */
import { ERROR_COPY } from '../constants/error-copy'

/** The cause of an API failure, one per line of copy. */
export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'conflict'
  | 'gone'
  | 'rateLimited'
  | 'server'
  | 'unknown'

/**
 * User-facing copy per cause. Single source of truth: callers render these and
 * the tests assert against them, so what a phone shows can never drift from
 * what is verified. Connectivity and server lines reuse `ERROR_COPY` so the
 * toast the API client raises and the inline message a screen renders are the
 * same sentence.
 */
export const API_ERROR_COPY: Record<ApiErrorKind, string> = {
  network: ERROR_COPY.network,
  timeout: ERROR_COPY.timeout,
  unauthorized: 'Your session has ended. Sign in and try again.',
  forbidden: "You don't have permission to do that.",
  notFound: "We couldn't find that. It may have been removed.",
  validation: 'Check the details and try again.',
  conflict: 'That has already been done.',
  gone: 'That is no longer available.',
  rateLimited: 'Too many attempts. Wait a moment and try again.',
  server: ERROR_COPY.serverError,
  unknown: 'Something went wrong. Please try again.',
}

/** Statuses whose server message is the actionable specific, when it reads safely. */
const PASS_THROUGH_STATUSES = new Set([400, 409, 429])

/**
 * Causes where the calling screen's own line beats the generic one, so the
 * optional `fallback` is used when there is no safe server copy.
 *
 * `unknown` is obvious. `rateLimited` is here because only the caller knows what
 * was too frequent ("too many check-ins"); "Too many attempts" is the line for a
 * caller that has nothing more specific to say. Every other cause carries an
 * instruction of its own (sign in again, no permission, and so on), and a 5xx
 * deliberately cannot take a caller line at all.
 */
const FALLBACK_KINDS = new Set<ApiErrorKind>(['unknown', 'rateLimited'])

function readStatusCode(err: unknown): number | null {
  const code = (err as { statusCode?: unknown })?.statusCode
  return typeof code === 'number' && Number.isFinite(code) ? code : null
}

function readErrorCode(err: unknown): string | null {
  const code = (err as { error?: unknown })?.error
  return typeof code === 'string' && code.length > 0 ? code : null
}

function readMessage(err: unknown): string | null {
  const message = (err as { message?: unknown })?.message
  return typeof message === 'string' && message.length > 0 ? message : null
}

/** Classify an API failure. Pure; exported for the per-branch unit tests. */
export function classifyApiError(err: unknown): ApiErrorKind {
  const status = readStatusCode(err)

  // The shared client normalises its own connectivity failures to statusCode 0
  // with a `network` or `timeout` code, so they are named rather than guessed.
  if (status === 0 || status === null) {
    const code = readErrorCode(err)
    if (code === 'timeout') return 'timeout'
    if (code === 'network') return 'network'
    return status === 0 ? 'network' : 'unknown'
  }

  if (status >= 500) return 'server'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status === 410) return 'gone'
  if (status === 429) return 'rateLimited'
  if (status === 400 || status === 422) return 'validation'
  return 'unknown'
}

// Tokens that mark a string as machinery rather than copy. Matched
// case-insensitively anywhere in the message.
const TECHNICAL_TOKENS = [
  'domexception',
  'typeerror',
  'referenceerror',
  'syntaxerror',
  'rangeerror',
  'error_description',
  'exception',
  'traceback',
  'stack',
  'undefined',
  'null',
  'nan',
  'internal server error',
  'econnrefused',
  'enotfound',
  'etimedout',
  'dynamodb',
  'lambda',
]

// The characters a sentence written for a person uses. Anything else (slashes,
// braces, angle brackets, backslashes, at-signs, quotes around JSON) means the
// string is carrying structure, not copy.
const SENTENCE_CHARS = /^[A-Za-z0-9 ,.'’!?%:;()-]+$/

// A dot glued to letters is a host or a property path (`areacode.co.za`,
// `err.message`), never the end of a sentence.
const HOST_OR_PATH = /\.[A-Za-z]{2,}/

/**
 * Is this string safe to show a user as-is?
 *
 * Deliberately strict, and strictness is free: a rejected message falls back to
 * the copy above, which is always readable. Being lenient is what leaks a
 * `DOMException` onto an owner's screen.
 */
function isSafeCopy(message: string): boolean {
  if (message.length < 8 || message.length > 160) return false
  if (!SENTENCE_CHARS.test(message)) return false
  if (HOST_OR_PATH.test(message)) return false
  if (!/^[A-Z]/.test(message)) return false
  // A sentence a person wrote has at least one space.
  if (!message.includes(' ')) return false
  const lowered = message.toLowerCase()
  return !TECHNICAL_TOKENS.some((token) => lowered.includes(token))
}

/**
 * The one line to show a user for a failed API call.
 *
 * @param err The caught value, of any shape. Never inspected beyond
 *   `statusCode`, `error` and `message`.
 * @param fallback Copy for a failure this module cannot name (`unknown`), when
 *   the calling screen has something more useful to say than the generic line.
 *   Only ever used for `unknown`, so a 5xx can never take it.
 */
export function describeApiError(err: unknown, fallback?: string): string {
  const kind = classifyApiError(err)

  if (PASS_THROUGH_STATUSES.has(readStatusCode(err) ?? -1)) {
    const message = readMessage(err)
    if (message !== null && isSafeCopy(message)) return message
  }

  if (FALLBACK_KINDS.has(kind) && fallback !== undefined && fallback.length > 0) return fallback
  return API_ERROR_COPY[kind]
}

/**
 * "<prefix> in about 2h." / "<prefix> in 15m." for a 429 that carried a
 * `cooldownUntil` instant still in the future, or null when there is no usable
 * cooldown left and the caller should use its generic rate-limit line instead.
 *
 * One home for the arithmetic, shared by the check-in and check-out hooks, so the
 * two can differ in wording but never in the time they quote.
 */
export function cooldownRetryMessage(cooldownUntil: string | undefined, prefix: string): string | null {
  if (!cooldownUntil) return null
  const remainingMs = new Date(cooldownUntil).getTime() - Date.now()
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null

  const mins = Math.ceil(remainingMs / 60_000)
  if (mins >= 60) return `${prefix} in about ${Math.ceil(mins / 60)}h.`
  return `${prefix} in ${mins}m.`
}

/**
 * Cognito Hosted UI error codes that reach an OAuth callback as `?error=`.
 * `error_description` is never rendered: it is machinery
 * (`Required String parameter 'client_id' is not present`), so callbacks log it
 * and render one of these lines.
 */
export function describeOAuthError(code: string | null): string {
  if (code === 'access_denied') return 'Sign-in was cancelled. Try again when you are ready.'
  if (code === 'invalid_request' || code === 'unauthorized_client') {
    return "Sign-in isn't set up correctly. Please contact support."
  }
  return 'Sign-in failed. Try again.'
}
