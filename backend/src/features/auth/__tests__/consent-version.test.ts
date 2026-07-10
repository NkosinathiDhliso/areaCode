/**
 * Consent_Version_Source fail-fast (audit-gap-closure R1.5).
 *
 * Validates: Requirements 1.5
 *
 * `currentConsentVersion()` is the single source of truth for the consent
 * version. Outside DEV_MODE a missing `AREA_CODE_CONSENT_VERSION` must fail
 * loudly rather than fall back to `LEGAL_CLAUSES_VERSION` (whose `2026.05.1`
 * format is incomparable with recorded `v1.0` versions and would re-prompt
 * every user for consent). DEV_MODE keeps a `v1.0` dev default.
 *
 * `DEV_MODE`/`IS_PROD` are captured at module load, so each case sets the env,
 * resets modules, and dynamically imports `../profile-service.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env['AREA_CODE_FORCE_LIVE']
  delete process.env['AREA_CODE_CONSENT_VERSION']
}

beforeEach(() => {
  vi.resetModules()
  resetEnv()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('currentConsentVersion() (R1.5)', () => {
  it('throws when AREA_CODE_CONSENT_VERSION is unset outside DEV_MODE', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    const { currentConsentVersion } = await import('../profile-service.js')
    expect(() => currentConsentVersion()).toThrow(/AREA_CODE_CONSENT_VERSION is not set/)
  })

  it('returns the configured version in prod with no LEGAL_CLAUSES_VERSION fallback', async () => {
    process.env['AREA_CODE_ENV'] = 'prod'
    process.env['AREA_CODE_CONSENT_VERSION'] = 'v2.0'
    const { currentConsentVersion } = await import('../profile-service.js')
    const version = currentConsentVersion()
    expect(version).toBe('v2.0')
    // Never the clause-content identifier shape (e.g. 2026.05.1).
    expect(version).not.toMatch(/^\d{4}\./)
  })

  it('returns the v1.0 dev default in DEV_MODE when unset', async () => {
    process.env['AREA_CODE_ENV'] = 'dev'
    const { currentConsentVersion } = await import('../profile-service.js')
    expect(currentConsentVersion()).toBe('v1.0')
  })
})
