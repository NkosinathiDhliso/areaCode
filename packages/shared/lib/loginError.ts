/**
 * Classify an email/password sign-in failure into a stable kind, so every
 * portal maps the same status code to the same meaning (one source of truth
 * for auth error handling; see `dry-reuse-no-duplication.md`).
 *
 * Cognito deliberately answers the same 401 for a wrong password and an unknown
 * email (anti-enumeration), so `credentials` covers both. The backend maps the
 * other Cognito exceptions to specific statuses via `withCognitoErrorMapping`:
 *   - 403 UserNotConfirmedException      -> `unconfirmed` (verify email)
 *   - 403 PasswordResetRequiredException -> `reset-required`
 *   - 429 throttling                     -> `rate-limited`
 *   - 5xx                                -> `server`
 *
 * The `message` field carries the backend's own copy for the 403 cases (which
 * is already user-safe and specific) so callers can surface it verbatim.
 */
export type LoginErrorKind = 'credentials' | 'unconfirmed' | 'reset-required' | 'rate-limited' | 'server' | 'unknown'

export interface LoginErrorClassification {
  kind: LoginErrorKind
  /** Backend-provided user-safe message, when present. */
  message: string | null
}

export function classifyLoginError(err: unknown): LoginErrorClassification {
  const status = (err as { statusCode?: number } | null)?.statusCode
  const rawMessage = (err as { message?: unknown } | null)?.message
  const message = typeof rawMessage === 'string' && rawMessage.length > 0 ? rawMessage : null

  if (status === 429) return { kind: 'rate-limited', message }
  if (status !== undefined && status >= 500) return { kind: 'server', message }
  if (status === 403) {
    // Distinguish the two 403 causes by the backend's error copy so each can
    // guide the user to the right next step.
    if (message && /reset/i.test(message)) return { kind: 'reset-required', message }
    return { kind: 'unconfirmed', message }
  }
  if (status === 401) return { kind: 'credentials', message }
  // 400 / 404 / 0 (network/timeout) and anything unexpected.
  return { kind: 'unknown', message }
}
