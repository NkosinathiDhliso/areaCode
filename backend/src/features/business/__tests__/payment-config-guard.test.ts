/**
 * Payment_Config_Guard and the createYocoCheckout key selection.
 *
 * Validates: Requirements 1.2, 1.3
 *
 * R1.2 (Payment_Config_Guard): the Billing_Service module runs a fail-loud
 * config check at load. In any non-dev environment an unset/empty
 * `YOCO_WEBHOOK_SECRET` must crash the module at import (a visible deploy
 * failure) instead of degrading into a runtime 401 stream on every webhook.
 * The `dev` environment requires no secret and is unaffected.
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

describe('Payment_Config_Guard at Billing_Service startup (R1.2)', () => {
  it('throws at module load in a non-dev env when YOCO_WEBHOOK_SECRET is unset', async () => {
    process.env['AREA_CODE_ENV'] = 'staging'
    delete process.env['YOCO_WEBHOOK_SECRET']

    await expect(import('../service.js')).rejects.toThrow(/YOCO_WEBHOOK_SECRET is not set/)
  })

  it('throws at module load in a non-dev env when YOCO_WEBHOOK_SECRET is empty', async () => {
    process.env['AREA_CODE_ENV'] = 'staging'
    process.env['YOCO_WEBHOOK_SECRET'] = ''

    await expect(import('../service.js')).rejects.toThrow(/YOCO_WEBHOOK_SECRET is not set/)
  })

  it('loads cleanly on a correctly configured prod cold-start', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    process.env['YOCO_WEBHOOK_SECRET'] = 'whsec_prod_secret'
    // Transitive prod-only requireEnv (anonymization salt) must be present so
    // the only thing under test is that the guard does NOT throw here.
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
