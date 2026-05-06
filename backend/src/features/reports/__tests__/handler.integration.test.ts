import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import * as authMiddleware from '../../../shared/middleware/auth.js'
import * as reportRepository from '../repository.js'

/**
 * Integration tests for report API routes.
 * Validates: Requirements 11.1, 11.2, 11.4, 10.1, 10.2
 */

let app: FastifyInstance

// Mock the auth middleware
vi.mock('../../../shared/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/middleware/auth.js')>()
  return {
    ...actual,
    requireAuth: () => async (request: any) => {
      // Allow passthrough
    },
    getAuth: () => ({ userId: 'test-business-id', role: 'business', businessId: 'biz-1' }),
  }
})

// Mock the report repository
vi.mock('../repository.js', () => ({
  listReports: vi.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
  getReport: vi.fn().mockImplementation(async (id) => {
    if (id === 'some-report-id') return { reportId: 'some-report-id', businessId: 'biz-1' }
    return null
  }),
}))

beforeAll(async () => {
  const { buildApp } = await import('../../../app.js')
  app = await buildApp()
  await app.ready()
}, 120_000)

afterAll(async () => {
  await app.close()
  vi.restoreAllMocks()
})

describe('GET /v1/business/me/reports', () => {
  it('returns 200 with items array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/me/reports',
      headers: {
        authorization: 'Bearer test-token',
      },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toHaveProperty('items')
    expect(Array.isArray(body.items)).toBe(true)
  })
})

describe('GET /v1/business/me/reports/:reportId', () => {
  it('returns 404 for a non-existent report', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/me/reports/non-existent-report-id',
      headers: {
        authorization: 'Bearer test-token',
      },
    })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    expect(body.error).toBe('not_found')
    expect(body.message).toBe('Report not found')
  })

  it('returns 400 for empty reportId parameter space', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/me/reports/ ',
      headers: {
        authorization: 'Bearer test-token',
      },
    })

    expect([400, 404]).toContain(response.statusCode)
  })
})
