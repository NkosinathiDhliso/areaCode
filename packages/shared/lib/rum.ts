/**
 * Frontend monitoring via AWS CloudWatch RUM.
 *
 * Replaces the previous Sentry wrapper. We chose CloudWatch RUM because:
 *   1. It bills per event ($1 / 100k events) and scales to zero. Sentry's
 *      free tier (5k errors/mo) was tight; the paid tier wasn't justifiable
 *      pre-launch. AWS credits cover RUM.
 *   2. It lives inside our existing AWS account, in line with the
 *      serverless-only steering rule.
 *   3. The browser SDK can be configured with `allowCookies: false`, so we
 *      don't drop analytics cookies. That keeps us inside POPIA's
 *      "strictly necessary storage" envelope and means no cookie banner.
 *
 * Setup
 *   - Run Terraform in infra/environments/prod (the `module "rum"` block
 *     creates one app monitor per SPA + a Cognito Identity Pool for unauth
 *     credentials).
 *   - The terraform output `rum_monitors` gives you the values for these
 *     env vars per app:
 *       VITE_RUM_APP_MONITOR_ID
 *       VITE_RUM_IDENTITY_POOL_ID
 *       VITE_RUM_REGION                (e.g. "us-east-1")
 *   - Push them to Amplify with scripts/update-all-amplify-apps.ps1.
 *
 * Graceful degradation
 *   - If `aws-rum-web` isn't installed, or any env var is missing, this
 *     module silently no-ops so the app still boots. We use a runtime
 *     dynamic import wrapped in `new Function(...)` so the bundler doesn't
 *     try to resolve the dependency at build time.
 */

let initialized = false

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let awsRum: any = null

interface RumEnv {
  appMonitorId?: string
  identityPoolId?: string
  region?: string
  appVersion?: string
  releaseStage?: string
}

function readEnv(): RumEnv {
  // Vite exposes env vars on import.meta.env. Access it as a plain member
  // expression (no optional chaining on `import.meta`) so Vite statically
  // replaces it at build time; `(import.meta)?.env` is NOT replaced and reads
  // the browser's native, env-less import.meta. `.env ?? {}` keeps non-Vite
  // contexts (tests, SSR shims) safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (import.meta as any).env ?? {}
  return {
    appMonitorId: meta.VITE_RUM_APP_MONITOR_ID,
    identityPoolId: meta.VITE_RUM_IDENTITY_POOL_ID,
    region: meta.VITE_RUM_REGION,
    appVersion: meta.VITE_GIT_SHA ?? 'unknown',
    releaseStage: meta.MODE ?? 'development',
  }
}

export async function initRum(): Promise<void> {
  if (initialized) return

  const env = readEnv()
  if (!env.appMonitorId || !env.identityPoolId || !env.region) {
    // Not configured for this build - silently disabled.
    return
  }

  try {
    // Dynamic import via `new Function` so Vite/Rollup don't try to
    // resolve `aws-rum-web` at build time. Lets us ship without the
    // package installed.
    const mod = await (new Function('return import("aws-rum-web")')() as Promise<Record<string, unknown>>)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AwsRum = (mod as any).AwsRum

    awsRum = new AwsRum(env.appMonitorId, env.appVersion ?? 'unknown', env.region, {
      sessionSampleRate: 1.0,
      identityPoolId: env.identityPoolId,
      endpoint: `https://dataplane.rum.${env.region}.amazonaws.com`,
      telemetries: ['errors', 'performance', 'http'],
      // CRITICAL: no analytics cookies, no consent banner needed.
      allowCookies: false,
      enableXRay: false,
      releaseStage: env.releaseStage,
    })
    initialized = true
  } catch {
    // aws-rum-web not installed or runtime init failed - app runs fine.
  }
}

export function captureError(err: unknown): void {
  if (!initialized || !awsRum) return
  try {
    awsRum.recordError?.(err)
  } catch {
    // Never let monitoring crash the app.
  }
}

export function recordEvent(name: string, attributes: Record<string, unknown> = {}): void {
  if (!initialized || !awsRum) return
  try {
    awsRum.recordEvent?.(name, attributes)
  } catch {
    // Swallow - monitoring is best-effort.
  }
}

export function isInitialized(): boolean {
  return initialized
}
