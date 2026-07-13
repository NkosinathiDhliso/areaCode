/**
 * Payment_Config_Guard and the createYocoCheckout key selection.
 *
 * Validates: Requirements 1.2, 1.3
 *
 * R1.2 (Payment_Config_Guard): the Yoco webhook secret is validated at API
 * Lambda cold start in `assertStartupConfig()` (shared/config/env.ts), covered
 * by shared/config/__tests__/env.test.ts. It is NOT validated at module load of
 * the Billing_Service, because that module also exports the pure
 * `getEffectiveTier` helper imported by workers (reports, campaigns, rewards)
 * that never serve the webhook. These cases therefore assert the module loads
 * cleanly without the secret; the fail-loud deploy guard lives in env.test.ts.
 *
 * R1.3 (createYocoCheckout): prod reads ONLY `YOCO_PROD_SECRET_KEY`. The old
 * `?? YOCO_DEV_SECRET_KEY ?? ''` fallback chain is gone, so a missing prod key
 * throws `serviceUnavailable` even when a dev key is present. Dev selects the
 * dev key by an explicit environment branch.
 *
 * Strategy:
 *   - The guard fires at MODULE LOAD, so each case sets the environment, calls
 *     `vi.resetModules()`, then dynamically imports `../service.js` and asserts
 *     on the import promise (resolve = clean cold-start, reject = guard fired).
 *   - A non-dev, non-prod value (`staging`) engages the guard (`!= 'dev'`)
 *     while keeping `IS_PROD`-gated `requireEnv` calls in transitive imports
 *     lenient (they return their dev defaults), so the ONLY thing that can
 *     throw at import is the Payment_Config_Guard itself. The realistic `prod`
 *     happy path is covered separately with the transitive salt provided.
 *   - `../repository.js` is stubbed so `createCheckoutSession` reaches
 *     `createYocoCheckout` without a live DynamoDB connection.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

// Repository stub: createCheckoutSession only needs findBusinessById before it
// reaches createYocoCheckout.
const findBusinessById = vi.fn()
vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, findBusinessById }
})

const ORIGINAL_ENV = { ...process.env }

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env['YOCO_WEBHOOK_SECRET']
  delete process.env['YOCO_PROD_SECRET_KEY']
  delete process.env['YOCO_DEV_SECRET_KEY']
  delete process.env['AREA_CODE_FORCE_LIVE']
}

beforeEach(() => {
  vi.resetModules()
  findBusinessById.mockReset()
  resetEnv()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('Billing_Service module load does not require the webhook secret (R1.2)', () => {
  // The guard moved from this module's load to the API Lambda bootstrap
  // (assertStartupConfig), so the Billing_Service must import cleanly even in a
  // prod-like env with no YOCO_WEBHOOK_SECRET. Workers (reports/campaigns/
  // rewards) import getEffectiveTier from here and must not crash on a payment
  // secret they never use.
  it('loads cleanly in a prod-like env when YOCO_WEBHOOK_SECRET is unset', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    delete process.env['YOCO_WEBHOOK_SECRET']
    // Transitive prod-only requireEnv (anonymization salt) must be present so
    // the only variable under test is the (now absent) webhook secret.
    process.env['AREA_CODE_ANONYMIZATION_SALT'] = 'prod-salt'

    const mod = await import('../service.js')
    expect(typeof mod.processYocoWebhook).toBe('function')
  })

  it('does not require the secret in dev (dev path unaffected)', async () => {
    process.env['AREA_CODE_ENV'] = 'dev'
    delete process.env['YOCO_WEBHOOK_SECRET']

    const mod = await import('../service.js')
    expect(typeof mod.processYocoWebhook).toBe('function')
  })
})

describe('createYocoCheckout key selection (R1.3)', () => {
  it('throws serviceUnavailable in prod-like env when the prod key is missing, even if a dev key is set', async () => {
    // Non-dev env so DEV_MODE is off and createYocoCheckout runs; secret set so
    // the module loads past the Payment_Config_Guard.
    process.env['AREA_CODE_ENV'] = 'staging'
    process.env['YOCO_WEBHOOK_SECRET'] = 'whsec_x'
    process.env['YOCO_DEV_SECRET_KEY'] = 'sk_test_dev_should_be_ignored'
    delete process.env['YOCO_PROD_SECRET_KEY']

    findBusinessById.mockResolvedValue({ businessId: 'b1', tier: 'growth' })

    const { createCheckoutSession } = await import('../service.js')

    // No fall-through to the dev key: a missing prod key is serviceUnavailable.
    await expect(createCheckoutSession('b1', 'growth')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('uses only the dev key on the dev branch', async () => {
    // dev + FORCE_LIVE turns DEV_MODE off so createYocoCheckout actually runs,
    // while the env branch still selects the dev key.
    process.env['AREA_CODE_ENV'] = 'dev'
    process.env['AREA_CODE_FORCE_LIVE'] = '1'
    process.env['YOCO_DEV_SECRET_KEY'] = 'sk_test_dev'
    delete process.env['YOCO_PROD_SECRET_KEY']

    findBusinessById.mockResolvedValue({ businessId: 'b1', tier: 'growth' })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'chk_1', redirectUrl: 'https://pay.example/chk_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createCheckoutSession } = await import('../service.js')
    const result = await createCheckoutSession('b1', 'growth')

    expect(result.checkoutUrl).toBe('https://pay.example/chk_1')
    // The dev key was used as the bearer token, never the (absent) prod key.
    const authHeader = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers['Authorization']
    expect(authHeader).toBe('Bearer sk_test_dev')

    vi.unstubAllGlobals()
  })
})
