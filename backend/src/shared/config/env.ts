// Single source of truth for backend environment configuration.
//
// Per `.kiro/steering/no-fallbacks-no-legacy.md`: required configuration is
// validated here and the process FAILS LOUD in production when a required value
// is missing. We never silently fall back to a dev/default value in prod — a
// missing env var is a deploy bug, not a runtime guess.
//
// Dev/test keep their explicit defaults so local runs and the test suite (which
// run with AREA_CODE_ENV=dev) behave exactly as before. The fail-fast branch is
// prod-only, which is the one place a wrong default is dangerous.

export const APP_ENV: string = process.env['AREA_CODE_ENV'] ?? 'dev'
export const IS_PROD: boolean = APP_ENV === 'prod'

/**
 * `DEV_MODE` is the single guard for synthetic/fixture data. True only when the
 * env is `dev` and the live-override flag is not set. All hardcoded/mock data
 * returns must sit behind this (see `code-style.md`).
 */
export const DEV_MODE: boolean = APP_ENV === 'dev' && !process.env['AREA_CODE_FORCE_LIVE']

/**
 * AWS region. The Lambda runtime always injects `AWS_REGION`; the literal is the
 * single home for the local/test default so it is not re-typed across modules.
 */
export const AWS_REGION: string = process.env['AWS_REGION'] ?? 'us-east-1'

/**
 * Read a required environment variable.
 *
 * - In production: throws if the variable is unset/empty. The Lambda crashes at
 *   init, surfacing the misconfiguration immediately instead of serving wrong
 *   data.
 * - In dev/test: returns the variable when set, otherwise `devDefault`. Passing
 *   `devDefault` is how we preserve the previous local behaviour without letting
 *   that default ever reach production.
 *
 * @param name        the environment variable name (UPPER_SNAKE)
 * @param devDefault  value used only outside production; omit to require the var
 *                    in every environment.
 */
export function requireEnv(name: string, devDefault?: string): string {
  const value = process.env[name]
  if (value && value.length > 0) return value
  if (IS_PROD) {
    throw new Error(`[config] Required environment variable ${name} is not set`)
  }
  if (devDefault !== undefined) return devDefault
  throw new Error(`[config] Environment variable ${name} is not set (no dev default)`)
}

/**
 * QR_Secret accessor (audit-gap-closure R1.1, R1.2).
 *
 * Single home for the `AREA_CODE_QR_HMAC_SECRET` HMAC key behind check-in QR
 * validation, business QR minting, and the music OAuth state signing. Obtained
 * via `requireEnv`, so a missing secret in production crashes rather than
 * signing/verifying over an empty string (the `?? ''` masking default this
 * replaces). DEV_MODE keeps a dev default so local runs and tests work.
 */
export function qrHmacSecret(): string {
  return requireEnv('AREA_CODE_QR_HMAC_SECRET', 'dev-qr-hmac-secret')
}

/**
 * Startup config validation (audit-gap-closure R1.5).
 *
 * Validates the security-critical secrets that would otherwise only fail on the
 * first request that needs them. Called once at cold start from `buildApp()`, so
 * a misdeploy crashes the Lambda at init — a visible deploy failure — instead of
 * signing/verifying over a missing key or recording consent under a bad version.
 *
 * - `AREA_CODE_QR_HMAC_SECRET`: HMAC key behind check-in QR validation, business
 *   QR minting, and music OAuth state (via `qrHmacSecret()`).
 * - `AREA_CODE_CONSENT_VERSION`: the single Consent_Version_Source
 *   (`currentConsentVersion()`); absent in prod it must fail loudly, never fall
 *   back to the clause-content identifier.
 *
 * Dev/test are unaffected: `requireEnv` returns early below since the throw path
 * is prod-only.
 */
export function assertStartupConfig(): void {
  if (!IS_PROD) return
  requireEnv('AREA_CODE_QR_HMAC_SECRET')
  requireEnv('AREA_CODE_CONSENT_VERSION')
}

/**
 * Payment_Config_Guard (billing-revenue-integrity R1.2).
 *
 * Fail-loud validation of the Yoco webhook signing secret. Called at module
 * load of the Billing_Service, which is loaded by both the API Lambda and the
 * webhook route it serves, so a prod cold-start with an unset or empty
 * `YOCO_WEBHOOK_SECRET` crashes at init. That surfaces the misconfiguration as
 * a visible deploy failure instead of a silent runtime 401 stream on every
 * payment webhook (the fail-closed signature gate would otherwise reject every
 * delivery and no payment would ever land).
 *
 * The environment is read from `process.env` directly (not the cached
 * `APP_ENV` const) so the check reflects the value present at the moment the
 * module loads. Dev/test (`AREA_CODE_ENV === 'dev'`) requires no secret and is
 * unaffected: the webhook path returns early in DEV_MODE and the signature
 * gate is exercised only via fail-closed unit tests.
 */
export function assertPaymentConfig(): void {
  const env = process.env['AREA_CODE_ENV'] ?? 'dev'
  if (env === 'dev') return
  const secret = process.env['YOCO_WEBHOOK_SECRET']
  if (!secret || secret.length === 0) {
    throw new Error('[config] Required environment variable YOCO_WEBHOOK_SECRET is not set')
  }
}
