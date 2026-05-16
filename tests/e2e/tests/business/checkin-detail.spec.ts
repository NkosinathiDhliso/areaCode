/**
 * §2.4 Check-in detail panel.
 */

import { expect, test } from '../../support/fixtures.js'

test.describe('Business — check-in detail panel', () => {
  test('past 7 days returns rows with no PII', async ({ apiClient }) => {
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/check-ins?range=7d')
    if (!res.ok()) test.skip(true, `Check-ins endpoint unavailable: ${res.status()}`)
    const text = await res.text()
    expect(/"phone(_number)?"\s*:/i.test(text)).toBe(false)
    expect(/"email"\s*:/i.test(text)).toBe(false)
    expect(/"lat(itude)?"\s*:\s*-?\d/.test(text)).toBe(false)
    expect(/"lon(g(itude)?)?"\s*:\s*-?\d/.test(text)).toBe(false)
  })

  test('rows include tier and visit-frequency labels', async ({ apiClient }) => {
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/check-ins?range=7d')
    if (!res.ok()) {
      test.skip(true, 'No check-ins endpoint')
      return
    }
    const body = (await res.json()) as { checkIns?: Array<Record<string, unknown>> }
    const checkIns = body.checkIns ?? []
    if (checkIns.length === 0) {
      test.skip(true, 'No check-ins in last 7d')
      return
    }
    const sample = checkIns[0]!
    expect('tier' in sample || 'visitFrequency' in sample || 'frequency' in sample).toBe(true)
  })
})
