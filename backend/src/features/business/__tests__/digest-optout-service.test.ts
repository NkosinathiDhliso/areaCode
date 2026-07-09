/**
 * Unit tests for the Digest_Optout service layer (task 5.2).
 *
 * Validates: Requirements 4.5
 *
 * `updateDigestOptOut` must persist the preference through the shared
 * repository write (`setDigestEmailOptOut` → `updateBusiness`) and surface a
 * missing business as a typed 404, never a silent no-op. DEV_MODE is OFF so the
 * live persistence branch runs (the DEV branch short-circuits before the repo).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const setDigestEmailOptOut = vi.fn()

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, setDigestEmailOptOut }
})

let service: typeof import('../service.js')

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  service = await import('../service.js')
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
})

beforeEach(() => {
  setDigestEmailOptOut.mockReset()
})

describe('updateDigestOptOut (R4.5)', () => {
  it('persists the flag via the repository and returns the saved value', async () => {
    setDigestEmailOptOut.mockResolvedValueOnce({ businessId: 'biz-1', digestEmailOptOut: true })
    const result = await service.updateDigestOptOut('biz-1', true)
    expect(setDigestEmailOptOut).toHaveBeenCalledTimes(1)
    expect(setDigestEmailOptOut).toHaveBeenCalledWith('biz-1', true)
    expect(result).toEqual({ digestEmailOptOut: true })
  })

  it('persists false when opting back in', async () => {
    setDigestEmailOptOut.mockResolvedValueOnce({ businessId: 'biz-1', digestEmailOptOut: false })
    const result = await service.updateDigestOptOut('biz-1', false)
    expect(setDigestEmailOptOut).toHaveBeenCalledWith('biz-1', false)
    expect(result).toEqual({ digestEmailOptOut: false })
  })

  it('throws a 404 when the business does not exist', async () => {
    setDigestEmailOptOut.mockResolvedValueOnce(null)
    await expect(service.updateDigestOptOut('missing', true)).rejects.toMatchObject({ statusCode: 404 })
  })
})
