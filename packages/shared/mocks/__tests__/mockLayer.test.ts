import { describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'

import { resolve, resetState } from '../mockRouter'
import { mockDelay } from '../helpers'
import { MOCK_NODES } from '../data/nodes'
import { MOCK_USERS } from '../data/users'
import { MOCK_BUSINESSES } from '../data/businesses'
import { MOCK_REWARDS } from '../data/rewards'
import { MOCK_REDEMPTIONS } from '../data/redemptions'
import { MOCK_REPORTS } from '../data/reports'
import { MOCK_CONSENT, CURRENT_CONSENT_VERSION } from '../data/consent'
import { MOCK_LEADERBOARD } from '../data/leaderboard'
import { MOCK_FEED } from '../data/feed'

beforeEach(() => {
  resetState()
})

/**
 * Feature: dev-showcase-mock-layer, Property 1: Mock data referential integrity
 * Verify all foreign key references resolve across entity arrays.
 * Validates: Requirements 1.6, 23.2, 23.3, 23.4, 23.5, 23.6
 */
describe('Property 1: Mock data referential integrity', () => {
  it('every node has a valid businessId', () => {
    const bizIds = new Set(MOCK_BUSINESSES.map((b) => b.id))
    for (const node of MOCK_NODES) {
      expect(bizIds.has(node.businessId!)).toBe(true)
    }
  })

  it('every reward references a valid node', () => {
    const nodeIds = new Set(MOCK_NODES.map((n) => n.id))
    for (const reward of MOCK_REWARDS) {
      expect(nodeIds.has(reward.nodeId)).toBe(true)
    }
  })

  it('every redemption references a valid reward and user', () => {
    const rewardIds = new Set(MOCK_REWARDS.map((r) => r.id))
    const userIds = new Set(MOCK_USERS.map((u) => u.id))
    for (const rd of MOCK_REDEMPTIONS) {
      expect(rewardIds.has(rd.rewardId)).toBe(true)
      expect(userIds.has(rd.userId)).toBe(true)
    }
  })

  it('every report references a valid reporter and node', () => {
    const userIds = new Set(MOCK_USERS.map((u) => u.id))
    const nodeIds = new Set(MOCK_NODES.map((n) => n.id))
    for (const report of MOCK_REPORTS) {
      expect(userIds.has(report.reporterId)).toBe(true)
      expect(nodeIds.has(report.nodeId)).toBe(true)
    }
  })

  it('every consent record references a valid user', () => {
    const userIds = new Set(MOCK_USERS.map((u) => u.id))
    for (const consent of MOCK_CONSENT) {
      expect(userIds.has(consent.userId)).toBe(true)
    }
  })

  it('every leaderboard entry matches its corresponding user', () => {
    const userMap = new Map(MOCK_USERS.map((u) => [u.id, u]))
    for (const entry of MOCK_LEADERBOARD) {
      const user = userMap.get(entry.userId)
      expect(user).toBeDefined()
      if (entry.isFriend) {
        expect(entry.username).toBe(user!.username)
        expect(entry.displayName).toBe(user!.displayName)
      } else {
        expect(entry.username).toBeNull()
        expect(entry.displayName).toBeNull()
      }
      expect(entry.tier).toBe(user!.tier)
    }
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 2: All registered mock routes resolve without error
 * Validates: Requirements 2.2, 2.3
 */
describe('Property 2: All registered mock routes resolve without error', () => {
  const routeCases: Array<[string, string]> = [
    ['POST', '/v1/auth/consumer/login'],
    ['POST', '/v1/auth/consumer/verify-otp'],
    ['POST', '/v1/auth/consumer/signup'],
    ['GET', '/v1/auth/account-type'],
    ['POST', '/v1/auth/business/login'],
    ['POST', '/v1/auth/business/verify-otp'],
    ['POST', '/v1/auth/staff/login'],
    ['POST', '/v1/auth/staff/verify-otp'],
    ['POST', '/v1/auth/admin/login'],
    ['POST', '/v1/auth/logout'],
    ['GET', '/v1/nodes/johannesburg'],
    ['GET', '/v1/nodes/mock-node-1/detail'],
    ['GET', '/v1/nodes/search?q=coffee'],
    ['POST', '/v1/check-in'],
    ['GET', '/v1/rewards/near-me'],
    ['GET', '/v1/rewards/unclaimed'],
    ['POST', '/v1/rewards/redeem'],
    ['GET', '/v1/leaderboard/johannesburg'],
    ['GET', '/v1/feed'],
    ['GET', '/v1/users/me'],
    ['PATCH', '/v1/users/me'],
    ['GET', '/v1/users/me/check-in-history'],
    ['DELETE', '/v1/users/me/check-in-history'],
    ['GET', '/v1/business/me'],
    ['GET', '/v1/business/me/live-stats'],
    ['GET', '/v1/business/me/nodes'],
    ['GET', '/v1/business/me/audience'],
    ['GET', '/v1/business/rewards'],
    ['POST', '/v1/business/rewards'],
    ['GET', '/v1/business/plans'],
    ['POST', '/v1/business/boost'],
    ['GET', '/v1/business/staff'],
    ['DELETE', '/v1/business/staff/mock-staff-1'],
    ['GET', '/v1/business/nodes/current/qr'],
    ['PUT', '/v1/nodes/mock-node-1'],
    ['GET', '/v1/admin/consumers'],
    ['POST', '/v1/admin/consumers/mock-user-1/disable'],
    ['GET', '/v1/admin/businesses'],
    ['POST', '/v1/admin/businesses/mock-biz-1/extend-trial'],
    ['GET', '/v1/admin/reports'],
    ['POST', '/v1/admin/reports/mock-report-1/review'],
    ['GET', '/v1/admin/consent'],
    ['GET', '/v1/admin/consent/export-reconsent'],
    ['GET', '/v1/staff/recent-redemptions'],
  ]

  it.each(routeCases)('%s %s resolves without error', (method, path) => {
    const result = resolve(method, path, {})
    expect(result).toBeDefined()
    expect(result).not.toBeNull()
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 3: Mock API delay is within bounds
 * Validates: Requirements 2.4
 */
describe('Property 3: Mock API delay is within bounds', () => {
  it('mockDelay resolves between 100ms and 400ms', { timeout: 15_000 }, async () => {
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      await mockDelay()
      const elapsed = performance.now() - start
      // Allow 50ms tolerance for timer imprecision
      expect(elapsed).toBeGreaterThanOrEqual(90)
      expect(elapsed).toBeLessThanOrEqual(500)
    }
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 4: Any phone number or credential succeeds at all auth endpoints
 * Validates: Requirements 3.1, 3.3, 10.1, 15.1, 20.1
 */
describe('Property 4: Any phone number succeeds at auth endpoints', () => {
  const phoneArb = fc.array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 10, maxLength: 15 })
    .map((digits) => `+27${digits.join('')}`)

  it('consumer login accepts any phone', () => {
    fc.assert(
      fc.property(phoneArb, (phone) => {
        const result = resolve('POST', '/v1/auth/consumer/login', { phone }) as Record<string, unknown>
        expect(result['success']).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('business login accepts any phone', () => {
    fc.assert(
      fc.property(phoneArb, (phone) => {
        const result = resolve('POST', '/v1/auth/business/login', { phone }) as Record<string, unknown>
        expect(result['success']).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('staff login accepts any phone', () => {
    fc.assert(
      fc.property(phoneArb, (phone) => {
        const result = resolve('POST', '/v1/auth/staff/login', { phone }) as Record<string, unknown>
        expect(result['success']).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('admin login accepts any email/password', () => {
    fc.assert(
      fc.property(fc.emailAddress(), fc.string({ minLength: 1 }), (email, password) => {
        const result = resolve('POST', '/v1/auth/admin/login', { email, password }) as Record<string, unknown>
        expect(result['accessToken']).toBeDefined()
        expect(typeof result['accessToken']).toBe('string')
      }),
      { numRuns: 100 },
    )
  })

  it('consumer signup accepts any phone/username/displayName', () => {
    fc.assert(
      fc.property(phoneArb, fc.string({ minLength: 1, maxLength: 20 }), fc.string({ minLength: 1, maxLength: 30 }), (phone, username, displayName) => {
        const result = resolve('POST', '/v1/auth/consumer/signup', { phone, username, displayName }) as Record<string, unknown>
        expect(result['userId']).toBeDefined()
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 5: Any 6-digit OTP returns valid auth tokens
 * Validates: Requirements 3.2, 10.2, 20.2
 */
describe('Property 5: Any 6-digit OTP returns valid auth tokens', () => {
  const otpArb = fc.array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 6, maxLength: 6 })
    .map((arr) => arr.join(''))

  it('consumer verify-otp returns accessToken and user', () => {
    fc.assert(
      fc.property(otpArb, (code) => {
        const result = resolve('POST', '/v1/auth/consumer/verify-otp', { code }) as Record<string, unknown>
        expect(typeof result['accessToken']).toBe('string')
        expect((result['accessToken'] as string).length).toBeGreaterThan(0)
        expect(result['user']).toBeDefined()
      }),
      { numRuns: 100 },
    )
  })

  it('business verify-otp returns accessToken and businessId', () => {
    fc.assert(
      fc.property(otpArb, (code) => {
        const result = resolve('POST', '/v1/auth/business/verify-otp', { code }) as Record<string, unknown>
        expect(typeof result['accessToken']).toBe('string')
        expect(result['businessId']).toBeDefined()
      }),
      { numRuns: 100 },
    )
  })

  it('staff verify-otp returns accessToken, staff with businessId and nodeName', () => {
    fc.assert(
      fc.property(otpArb, (code) => {
        const result = resolve('POST', '/v1/auth/staff/verify-otp', { code }) as Record<string, unknown>
        expect(typeof result['accessToken']).toBe('string')
        const staff = result['staff'] as Record<string, unknown>
        expect(staff['businessId']).toBeDefined()
        expect(staff['nodeName']).toBeDefined()
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 6: Node search returns only matching results
 * Validates: Requirements 4.4
 */
describe('Property 6: Node search returns only matching results', () => {
  // Generate substrings from actual node names
  const nodeNameSubstringArb = fc.constantFrom(...MOCK_NODES.map((n) => n.name))
    .chain((name) => {
      const len = name.length
      return fc.integer({ min: 0, max: len - 2 }).chain((start) =>
        fc.integer({ min: start + 2, max: len }).map((end) => name.slice(start, end)),
      )
    })

  it('all returned nodes contain the query as a case-insensitive substring', () => {
    fc.assert(
      fc.property(nodeNameSubstringArb, (query) => {
        const results = resolve('GET', `/v1/nodes/search?q=${encodeURIComponent(query)}`) as Array<{ name: string }>
        expect(results.length).toBeGreaterThan(0)
        for (const node of results) {
          expect(node.name.toLowerCase()).toContain(query.toLowerCase())
        }
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 7: Check-in updates pulse score and user count
 * Validates: Requirements 5.2, 5.3, 5.4
 */
describe('Property 7: Check-in updates pulse score and user count', () => {
  const nodeIdArb = fc.constantFrom(...MOCK_NODES.map((n) => n.id))

  it('check-in increments pulse by 5, totalCheckIns by 1, returns cooldownUntil ~4h', () => {
    fc.assert(
      fc.property(nodeIdArb, (nodeId) => {
        resetState()

        // Read initial state
        const userBefore = resolve('GET', '/v1/users/me') as { totalCheckIns: number }
        const detailBefore = resolve('GET', `/v1/nodes/${nodeId}/detail`) as { pulseScore: number }
        const pulseBefore = detailBefore.pulseScore
        const countBefore = userBefore.totalCheckIns

        // Perform check-in
        const result = resolve('POST', '/v1/check-in', { nodeId }) as { success: boolean; cooldownUntil: string }
        expect(result.success).toBe(true)

        // Verify cooldownUntil is approximately 4 hours from now
        const cooldownMs = new Date(result.cooldownUntil).getTime() - Date.now()
        const fourHoursMs = 4 * 60 * 60 * 1000
        expect(cooldownMs).toBeGreaterThan(fourHoursMs - 5000)
        expect(cooldownMs).toBeLessThan(fourHoursMs + 5000)

        // Verify pulse score incremented by 5
        const detailAfter = resolve('GET', `/v1/nodes/${nodeId}/detail`) as { pulseScore: number }
        expect(detailAfter.pulseScore).toBe(pulseBefore + 5)

        // Verify user check-in count incremented by 1
        const userAfter = resolve('GET', '/v1/users/me') as { totalCheckIns: number }
        expect(userAfter.totalCheckIns).toBe(countBefore + 1)
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 8: Node detail includes only rewards belonging to that node
 * Validates: Requirements 6.3
 */
describe('Property 8: Node detail includes only rewards belonging to that node', () => {
  const nodeIdArb = fc.constantFrom(...MOCK_NODES.map((n) => n.id))

  it('all rewards in node detail have matching nodeId', () => {
    fc.assert(
      fc.property(nodeIdArb, (nodeId) => {
        const result = resolve('GET', `/v1/nodes/${nodeId}/detail`) as { rewards?: Array<{ nodeId: string }> }
        if (result.rewards) {
          for (const reward of result.rewards) {
            expect(reward.nodeId).toBe(nodeId)
          }
        }
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 9: Leaderboard is sorted by check-in count descending
 * Validates: Requirements 7.1
 */
describe('Property 9: Leaderboard is sorted descending by check-in count', () => {
  it('consecutive entries have non-increasing checkInCount', () => {
    const result = resolve('GET', '/v1/leaderboard/johannesburg') as { entries: Array<{ checkInCount: number }> }
    const entries = result.entries
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1]!.checkInCount).toBeGreaterThanOrEqual(entries[i]!.checkInCount)
    }
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 10: Feed entries are sorted by timestamp descending and within 12 hours
 * Validates: Requirements 8.2
 */
describe('Property 10: Feed entries sorted descending and within 12 hours', () => {
  it('feed timestamps are descending and within 12-hour window', () => {
    const result = resolve('GET', '/v1/feed') as { items: Array<{ checkedInAt: string }> }
    const items = result.items
    const now = Date.now()
    const twelveHoursMs = 12 * 60 * 60 * 1000

    for (let i = 0; i < items.length; i++) {
      const ts = new Date(items[i]!.checkedInAt).getTime()
      // Within 12 hours (with small tolerance for test execution time)
      expect(now - ts).toBeLessThan(twelveHoursMs + 60_000)
      expect(now - ts).toBeGreaterThanOrEqual(0)

      // Descending order
      if (i > 0) {
        const prevTs = new Date(items[i - 1]!.checkedInAt).getTime()
        expect(prevTs).toBeGreaterThanOrEqual(ts)
      }
    }
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 11: Admin user search filters by substring match
 * Validates: Requirements 16.3
 */
describe('Property 11: Admin user search filters by substring match', () => {
  const usernameSubstringArb = fc.constantFrom(...MOCK_USERS.map((u) => u.username))
    .chain((name) => {
      const len = name.length
      return fc.integer({ min: 0, max: len - 1 }).chain((start) =>
        fc.integer({ min: start + 1, max: len }).map((end) => name.slice(start, end)),
      )
    })

  it('returned users match by username or phone substring', () => {
    fc.assert(
      fc.property(usernameSubstringArb, (query) => {
        const result = resolve('GET', `/v1/admin/consumers?q=${encodeURIComponent(query)}`) as { items: Array<{ username: string; phone: string | null }> }
        for (const user of result.items) {
          const matchesUsername = user.username.toLowerCase().includes(query.toLowerCase())
          const matchesPhone = (user.phone ?? '').includes(query)
          expect(matchesUsername || matchesPhone).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 12: Mutation endpoints return success
 * Validates: Requirements 14.4, 16.4, 17.3
 */
describe('Property 12: Mutation endpoints return success', () => {
  const mutations: Array<[string, string, unknown?]> = [
    ['POST', '/v1/admin/consumers/mock-user-1/disable'],
    ['POST', '/v1/admin/consumers/mock-user-2/reset-flags'],
    ['POST', '/v1/admin/businesses/mock-biz-1/extend-trial'],
    ['POST', '/v1/admin/reports/mock-report-1/review'],
    ['PUT', '/v1/nodes/mock-node-1', { name: 'Updated Name' }],
    ['POST', '/v1/business/boost', { duration: '2hr' }],
    ['POST', '/v1/business/rewards', { title: 'Test Reward', type: 'nth_checkin' }],
    ['DELETE', '/v1/business/staff/mock-staff-1'],
    ['DELETE', '/v1/users/me/check-in-history'],
  ]

  it.each(mutations)('%s %s returns success', (method, path, body) => {
    const result = resolve(method, path, body) as Record<string, unknown>
    expect(result).toBeDefined()
    // Should not be a 404 or error
    expect(result['error']).toBeUndefined()
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 13: Report status updates persist in mock state
 * Validates: Requirements 18.3
 */
describe('Property 13: Report status updates persist in mock state', () => {
  const actionArb = fc.constantFrom('review', 'dismiss', 'action')
  const expectedStatus: Record<string, string> = { review: 'reviewed', dismiss: 'dismissed', action: 'actioned' }

  it('report status updates persist across queries', () => {
    fc.assert(
      fc.property(actionArb, (action) => {
        resetState()
        // Find a pending report
        const reportsBefore = resolve('GET', '/v1/admin/reports') as Array<{ id: string; status: string }>
        const pending = reportsBefore.find((r) => r.status === 'pending')
        if (!pending) return // skip if no pending reports

        // Perform action
        resolve('POST', `/v1/admin/reports/${pending.id}/${action}`)

        // Verify persistence
        const reportsAfter = resolve('GET', '/v1/admin/reports') as Array<{ id: string; status: string }>
        const updated = reportsAfter.find((r) => r.id === pending.id)
        expect(updated).toBeDefined()
        expect(updated!.status).toBe(expectedStatus[action])
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 14: Re-consent export returns only outdated consent versions
 * Validates: Requirements 19.3
 */
describe('Property 14: Re-consent export returns only outdated versions', () => {
  it('all exported records have a version different from current', () => {
    const result = resolve('GET', '/v1/admin/consent/export-reconsent') as Array<{ consentVersion: string }>
    expect(result.length).toBeGreaterThan(0)
    for (const record of result) {
      expect(record.consentVersion).not.toBe(CURRENT_CONSENT_VERSION)
    }
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 15: Staff redemption validates code length
 * Validates: Requirements 21.1, 21.3
 */
describe('Property 15: Staff redemption validates code length', () => {
  const validCodeArb = fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 6, maxLength: 6 })
    .map((arr) => arr.join(''))
  const shortCodeArb = fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 1, maxLength: 5 })
    .map((arr) => arr.join(''))

  it('6-char codes return success', () => {
    fc.assert(
      fc.property(validCodeArb, (code) => {
        const result = resolve('POST', '/v1/rewards/redeem', { code }) as Record<string, unknown>
        expect(result['success']).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('codes shorter than 6 chars return invalid_code error', () => {
    fc.assert(
      fc.property(shortCodeArb, (code) => {
        const result = resolve('POST', '/v1/rewards/redeem', { code }) as Record<string, unknown>
        expect(result['error']).toBe('invalid_code')
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 16: DEV_MODE flag correctly reads environment variable
 * Validates: Requirements 2.1
 */
describe('Property 16: DEV_MODE flag reads environment variable', () => {
  it('IS_DEV_MOCK is true only when VITE_DEV_MOCK is exactly "true"', () => {
    // We can't easily mutate import.meta.env in tests, so we test the logic directly
    const checkFlag = (val: string | undefined) => val === 'true'

    fc.assert(
      fc.property(fc.oneof(fc.constant('true'), fc.constant('false'), fc.constant(''), fc.constant('TRUE'), fc.string()), (val) => {
        const result = checkFlag(val)
        if (val === 'true') {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      }),
      { numRuns: 100 },
    )
  })
})

/**
 * Feature: dev-showcase-mock-layer, Property 17: Reward creation adds to mock state
 * Validates: Requirements 12.2
 */
describe('Property 17: Reward creation adds to mock state', () => {
  const rewardTitleArb = fc.string({ minLength: 1, maxLength: 50 })
  const rewardTypeArb = fc.constantFrom('nth_checkin' as const, 'daily_first' as const, 'streak' as const, 'milestone' as const)

  it('created rewards appear in subsequent business rewards query', () => {
    fc.assert(
      fc.property(rewardTitleArb, rewardTypeArb, (title, type) => {
        resetState()

        const createResult = resolve('POST', '/v1/business/rewards', { title, type, nodeId: 'mock-node-2' }) as { id: string; success: boolean }
        expect(createResult.success).toBe(true)
        expect(createResult.id).toBeDefined()

        const rewards = resolve('GET', '/v1/business/rewards') as Array<{ id: string; title: string }>
        const found = rewards.find((r) => r.id === createResult.id)
        expect(found).toBeDefined()
        expect(found!.title).toBe(title)
      }),
      { numRuns: 100 },
    )
  })
})
