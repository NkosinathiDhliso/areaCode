/**
 * Fail-fast security config accessors (audit-gap-closure R1).
 *
 * Validates: Requirements 1.1, 1.2, 1.5
 *
 * `qrHmacSecret()` and `assertStartupConfig()` are evaluated against the
 * environment captured at module load: `IS_PROD` / `DEV_MODE` are module-level
 * consts, so each case sets the environment, calls `vi.resetModules()`, then
 * dynamically imports `../env.js` and asserts. DEV_MODE derives from
 * `AREA_CODE_ENV === 'dev'` with `AREA_CODE_FORCE_LIVE` unset, so a non-dev env
 * (here `prod`) turns the fail-fast branch on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env['AREA_CODE_FORCE_LIVE']
  delete process.env['AREA_CODE_QR_HMAC_SECRET']
  delete process.env['AREA_CODE_CONSENT_VERSION']
}

beforeEach(() => {
  vi.resetModules()
  resetEnv()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('qrHmacSecret() (R1.1, R1.2)', () => {
  it('throws when AREA_CODE_QR_HMAC_SECRET is unset outside DEV_MODE', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    const { qrHmacSecret } = await import('../env.js')
    expect(() => qrHmacSecret()).toThrow(/AREA_CODE_QR_HMAC_SECRET is not set/)
  })

  it('returns the configured secret in prod when set', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    process.env['AREA_CODE_QR_HMAC_SECRET'] = 'prod-qr-secret'
    const { qrHmacSecret } = await import('../env.js')
    expect(qrHmacSecret()).toBe('prod-qr-secret')
  })

  it('returns the dev default in DEV_MODE when unset', async () => {
    process.env['AREA_CODE_ENV'] = 'dev'
    const { qrHmacSecret } = await import('../env.js')
    expect(qrHmacSecret()).toBe('dev-qr-hmac-secret')
  })
})

describe('assertStartupConfig() (R1.2, R1.5)', () => {
  it('throws in prod when AREA_CODE_QR_HMAC_SECRET is missing', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    process.env['AREA_CODE_CONSENT_VERSION'] = 'v1.0'
    const { assertStartupConfig } = await import('../env.js')
    expect(() => assertStartupConfig()).toThrow(/AREA_CODE_QR_HMAC_SECRET is not set/)
  })

  it('throws in prod when AREA_CODE_CONSENT_VERSION is missing', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    process.env['AREA_CODE_QR_HMAC_SECRET'] = 'prod-qr-secret'
    const { assertStartupConfig } = await import('../env.js')
    expect(() => assertStartupConfig()).toThrow(/AREA_CODE_CONSENT_VERSION is not set/)
  })

  it('passes in prod when both required keys are set', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    process.env['AREA_CODE_QR_HMAC_SECRET'] = 'prod-qr-secret'
    process.env['AREA_CODE_CONSENT_VERSION'] = 'v1.0'
    const { assertStartupConfig } = await import('../env.js')
    expect(() => assertStartupConfig()).not.toThrow()
  })

  it('is a no-op in dev even when both keys are missing', async () => {
    process.env['AREA_CODE_ENV'] = 'dev'
    const { assertStartupConfig } = await import('../env.js')
    expect(() => assertStartupConfig()).not.toThrow()
  })
})
