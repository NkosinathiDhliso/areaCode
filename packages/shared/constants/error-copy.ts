/**
 * User-facing error copy — one source of truth across every portal.
 *
 * These strings are deliberately reassuring and never leak backend internals
 * such as "Internal server error", stack traces, or raw status text.
 *
 * Toast policy (keep customer-facing errors minimal to avoid churn):
 *   - Only genuine server-side failures (5xx) are auto-toasted by the API
 *     client. A silent server failure makes the user think their action worked
 *     when it didn't, so that one is worth surfacing.
 *   - Connectivity failures (offline / DNS / timeout) are NOT auto-toasted —
 *     the user can already see their connection is down, so a toast is noise.
 *     The `network` / `timeout` copy below is still thrown on the error object
 *     so a specific screen can render its own inline state if it chooses to.
 *
 * The wording matches the approved UX contract in
 * `.kiro/specs/ux-completeness-re-audit/requirements.md` (Requirement 7 & 8).
 */
export const ERROR_COPY = {
  /** HTTP 500 / 503 — server-side failure the user did nothing to cause. */
  serverError: 'Something went wrong on our side. Please try again.',
  /** Request failed before any HTTP response (offline, DNS, connection drop). */
  network: 'Check your internet connection and try again.',
  /** Request exceeded the client timeout. */
  timeout: 'Check your internet connection and try again.',
} as const

export type ErrorCopyKey = keyof typeof ERROR_COPY
