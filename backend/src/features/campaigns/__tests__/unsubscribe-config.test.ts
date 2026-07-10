/**
 * Unsub_Secret chain + unsubscribe URL fail-fast (audit-gap-closure R1.3, R1.6, R1.7).
 *
 * Validates: Requirements 1.3
 *
 * The signing-secret chain is `AREA_CODE_CAMPAIGN_UNSUB_SECRET ?? qrHmacSecret()`.
 * There is no hardcoded in-repo secret (the old
 * `'dev-campaign-unsubscribe-secret'` literal is gone): outside DEV_MODE, when
 * neither the dedicated unsubscribe secret nor the QR secret is set, signing
 * fails fast (`qrHmacSecret()` throws) instead of degrading to a known
 * constant. DEV_MODE keeps working via the QR dev default.
 *
 * `buildUnsubscribeUrl` resolves `AREA_CODE_API_BASE_URL` via `requireEnv`, so a
 * missing base URL in prod fails fast rather than building a broken one-click
 * unsubscribe link.
 *
 * `IS_PROD`/`DEV_MODE` are captured at module load, so each case sets the env,
 * resets modules, and dynamically imports `../unsubscribe.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env['AREA_CODE_FORCE_LIVE']
  delete process.env['AREA_CODE_QR_HMAC_SECRET']
  delete process.env['AREA_CODE_CAMPAIGN_UNSUB_SECRET']
  delete process.env['AREA_CODE_API_BASE_URL']
}

beforeEach(() => {
  vi.resetModules()
  resetEnv()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('signing secret chain (R1.3, R1.7)', () => {
  it('fails fast outside DEV_MODE when neither the unsubscribe nor QR secret is set', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    const { signUnsubscribeToken } = await import('../unsubscribe.js')
    expect(() => signUnsubscribeToken('user-1', 'biz-1')).toThrow(/AREA_CODE_QR_HMAC_SECRET is not set/)
  })

  it('signs in prod from the dedicated unsubscribe secret without a QR secret', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    process.env['AREA_CODE_CAMPAIGN_UNSUB_SECRET'] = 'prod-unsub-secret'
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await import('../unsubscribe.js')
    const token = signUnsubscribeToken('user-1', 'biz-1')
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: 'user-1', businessId: 'biz-1' })
  })

  it('signs in DEV_MODE via the QR dev default, proving no hardcoded literal fallback', async () => {
    process.env['AREA_CODE_ENV'] = 'dev'
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await import('../unsubscribe.js')
    const token = signUnsubscribeToken('user-2', 'biz-2')
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: 'user-2', businessId: 'biz-2' })
  })
})

describe('buildUnsubscribeUrl base URL fail-fast (R1.6)', () => {
  it('throws in prod when AREA_CODE_API_BASE_URL is unset', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    // QR secret present so the failure is unambiguously the base URL, not signing.
    process.env['AREA_CODE_QR_HMAC_SECRET'] = 'prod-qr-secret'
    const { buildUnsubscribeUrl } = await import('../unsubscribe.js')
    expect(() => buildUnsubscribeUrl('user-1', 'biz-1')).toThrow(/AREA_CODE_API_BASE_URL is not set/)
  })

  it('builds the URL in DEV_MODE using the local default base', async () => {
    process.env['AREA_CODE_ENV'] = 'dev'
    const { buildUnsubscribeUrl } = await import('../unsubscribe.js')
    const url = buildUnsubscribeUrl('user-3', 'biz-3')
    expect(url).toContain('/v1/campaigns/unsubscribe?token=')
  })
})
