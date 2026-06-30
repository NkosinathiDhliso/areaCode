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
