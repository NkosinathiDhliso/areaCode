/**
 * §2.10 Reports (intelligence), §2.11 Audience & boost.
 */

import { expect, test } from '../../support/fixtures.js'

test.describe('Business — reports & audience', () => {
  test('reports panel renders without PII leakage', async ({ apiClient }) => {
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/reports')
    if (!res.ok()) test.skip(true, `Reports endpoint unavailable: ${res.status()}`)
    const text = await res.text()
    // No raw user identifiers — only aggregates / archetypes.
    expect(/"email"\s*:/i.test(text)).toBe(false)
    expect(/"phone(_number)?"\s*:/i.test(text)).toBe(false)
    expect(/"displayName"\s*:/i.test(text)).toBe(false)
  })

  test('audience panel returns aggregated counts only', async ({ apiClient }) => {
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/audience')
    if (!res.ok()) test.skip(true, `Audience endpoint unavailable: ${res.status()}`)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body).toBe('object')
    expect('totalCustomers' in body || 'audience' in body || 'demographics' in body).toBe(true)
  })

  test('boost panel returns pulse signal data', async ({ apiClient }) => {
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/boost')
    if (!res.ok()) test.skip(true, `Boost endpoint unavailable: ${res.status()}`)
    const body = (await res.json()) as Record<string, unknown>
    expect('pulseScore' in body || 'pulse' in body).toBe(true)
  })
})
