/**
 * Unit tests for privacy endpoints and block logic.
 *
 * Tests:
 * - Self-block returns 400
 * - Block/unblock round-trip
 * - Privacy level validation rejects invalid values
 * - Report submission creates high-priority flag for harassment category
 *
 * Requirements: 22.7, 22.8, 22.9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../shared/errors/AppError'
import {
  updatePrivacyBodySchema,
  blockParamsSchema,
  createReportBodySchema,
  privacyLevelSchema,
} from '../../features/privacy/types'
import {
  determineReportPriority,
  buildAbuseFlagForReport,
  HIGH_PRIORITY_CATEGORIES,
  type ReportCategory,
} from '../../features/social/report-repository'

// ─── Mock DynamoDB and dependencies ─────────────────────────────────────────

const mockPutCommand = vi.fn()
const mockDeleteCommand = vi.fn()
const mockGetCommand = vi.fn()
const mockQueryCommand = vi.fn()

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn().mockImplementation((params) => params),
  DeleteCommand: vi.fn().mockImplementation((params) => params),
  GetCommand: vi.fn().mockImplementation((params) => params),
  QueryCommand: vi.fn().mockImplementation((params) => params),
}))

vi.mock('../../shared/db/dynamodb', () => ({
  documentClient: {
    send: vi.fn().mockImplementation((cmd) => {
      if (cmd.TableName && cmd.Item) return mockPutCommand(cmd)
      if (cmd.TableName && cmd.Key && !cmd.Item) {
        if (cmd.KeyConditionExpression) return mockQueryCommand(cmd)
        if (Object.keys(cmd).includes('Key') && !Object.keys(cmd).includes('KeyConditionExpression')) {
          // Could be Get or Delete
          return mockGetCommand(cmd)
        }
      }
      return Promise.resolve({})
    }),
  },
  TableNames: {
    appData: 'area-code-dev-app-data',
    users: 'area-code-dev-users',
  },
}))

vi.mock('../../shared/db/entities', () => ({
  generateId: () => 'mock-generated-id',
}))

vi.mock('../../features/auth/dynamodb-repository', () => ({
  getUserById: vi.fn(),
  updateUser: vi.fn(),
}))

vi.mock('../../features/social/block-repository', () => ({
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  getBlockedUsers: vi.fn(),
}))

vi.mock('../../features/social/report-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/social/report-repository')>()
  return {
    ...actual,
    createReport: vi.fn(),
  }
})

// Import after mocks are set up
import { getUserById, updateUser } from '../../features/auth/dynamodb-repository'
import { blockUser, unblockUser, getBlockedUsers } from '../../features/social/block-repository'
import { createReport } from '../../features/social/report-repository'
import * as privacyService from '../../features/privacy/service'

const mockGetUserById = getUserById as ReturnType<typeof vi.fn>
const mockUpdateUser = updateUser as ReturnType<typeof vi.fn>
const mockBlockUser = blockUser as ReturnType<typeof vi.fn>
const mockUnblockUser = unblockUser as ReturnType<typeof vi.fn>
const mockGetBlockedUsers = getBlockedUsers as ReturnType<typeof vi.fn>
const mockCreateReport = createReport as ReturnType<typeof vi.fn>

// ─── 1. Self-Block Returns 400 ─────────────────────────────────────────────

describe('Block logic: self-block returns 400', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw AppError with status 400 when user tries to block themselves', async () => {
    const userId = 'user-123'

    try {
      await privacyService.blockUserAction(userId, userId)
      expect.fail('Should have thrown an error')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appErr = err as AppError
      expect(appErr.statusCode).toBe(400)
      expect(appErr.error).toBe('bad_request')
      expect(appErr.message).toBe('Cannot block yourself')
    }
  })

  it('should not call blockUser repository when self-blocking', async () => {
    const userId = 'user-abc'

    try {
      await privacyService.blockUserAction(userId, userId)
    } catch {
      // expected
    }

    expect(mockBlockUser).not.toHaveBeenCalled()
  })

  it('should allow blocking a different user', async () => {
    mockBlockUser.mockResolvedValue(undefined)

    await privacyService.blockUserAction('user-1', 'user-2')

    expect(mockBlockUser).toHaveBeenCalledWith('user-1', 'user-2')
  })
})

// ─── 2. Block/Unblock Round-Trip ────────────────────────────────────────────

describe('Block logic: block/unblock round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should successfully block a user', async () => {
    mockBlockUser.mockResolvedValue(undefined)

    await privacyService.blockUserAction('blocker-1', 'blocked-1')

    expect(mockBlockUser).toHaveBeenCalledWith('blocker-1', 'blocked-1')
  })

  it('should successfully unblock a user', async () => {
    mockUnblockUser.mockResolvedValue(undefined)

    await privacyService.unblockUserAction('blocker-1', 'blocked-1')

    expect(mockUnblockUser).toHaveBeenCalledWith('blocker-1', 'blocked-1')
  })

  it('should list blocked users after blocking', async () => {
    mockGetBlockedUsers.mockResolvedValue([
      { blockedId: 'blocked-1', createdAt: '2024-01-01T00:00:00.000Z' },
      { blockedId: 'blocked-2', createdAt: '2024-01-02T00:00:00.000Z' },
    ])

    const result = await privacyService.listBlockedUsers('blocker-1')

    expect(result).toHaveLength(2)
    expect(result[0]!.blockedId).toBe('blocked-1')
    expect(result[1]!.blockedId).toBe('blocked-2')
  })

  it('should return 409 conflict when blocking an already-blocked user', async () => {
    const conditionalError = new Error('Conditional check failed')
    ;(conditionalError as Error & { name: string }).name = 'ConditionalCheckFailedException'
    mockBlockUser.mockRejectedValue(conditionalError)

    try {
      await privacyService.blockUserAction('blocker-1', 'blocked-1')
      expect.fail('Should have thrown an error')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appErr = err as AppError
      expect(appErr.statusCode).toBe(409)
      expect(appErr.error).toBe('conflict')
      expect(appErr.message).toBe('User already blocked')
    }
  })

  it('should propagate unexpected errors from blockUser', async () => {
    const unexpectedError = new Error('DynamoDB timeout')
    mockBlockUser.mockRejectedValue(unexpectedError)

    try {
      await privacyService.blockUserAction('blocker-1', 'blocked-1')
      expect.fail('Should have thrown an error')
    } catch (err) {
      expect(err).toBe(unexpectedError)
    }
  })
})

// ─── 3. Privacy Level Validation ────────────────────────────────────────────

describe('Privacy level validation: rejects invalid values', () => {
  it('should accept "public" as a valid privacy level', () => {
    const result = privacyLevelSchema.safeParse('public')
    expect(result.success).toBe(true)
  })

  it('should accept "friends_only" as a valid privacy level', () => {
    const result = privacyLevelSchema.safeParse('friends_only')
    expect(result.success).toBe(true)
  })

  it('should accept "private" as a valid privacy level', () => {
    const result = privacyLevelSchema.safeParse('private')
    expect(result.success).toBe(true)
  })

  it('should reject "hidden" as an invalid privacy level', () => {
    const result = privacyLevelSchema.safeParse('hidden')
    expect(result.success).toBe(false)
  })

  it('should reject empty string as an invalid privacy level', () => {
    const result = privacyLevelSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('should reject numeric values', () => {
    const result = privacyLevelSchema.safeParse(1)
    expect(result.success).toBe(false)
  })

  it('should reject null', () => {
    const result = privacyLevelSchema.safeParse(null)
    expect(result.success).toBe(false)
  })

  it('should reject undefined', () => {
    const result = privacyLevelSchema.safeParse(undefined)
    expect(result.success).toBe(false)
  })

  it('should reject "PUBLIC" (case-sensitive)', () => {
    const result = privacyLevelSchema.safeParse('PUBLIC')
    expect(result.success).toBe(false)
  })

  it('updatePrivacyBodySchema rejects body with invalid privacy level', () => {
    const result = updatePrivacyBodySchema.safeParse({ privacyLevel: 'invisible' })
    expect(result.success).toBe(false)
  })

  it('updatePrivacyBodySchema rejects body with extra fields (strict mode)', () => {
    const result = updatePrivacyBodySchema.safeParse({
      privacyLevel: 'public',
      extraField: 'should fail',
    })
    expect(result.success).toBe(false)
  })

  it('updatePrivacyBodySchema accepts valid body', () => {
    const result = updatePrivacyBodySchema.safeParse({ privacyLevel: 'friends_only' })
    expect(result.success).toBe(true)
  })
})

// ─── 4. Report Submission: Harassment Creates High-Priority Flag ────────────

describe('Report submission: harassment category creates high-priority flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should determine high priority for harassment_report category', () => {
    const priority = determineReportPriority('harassment_report')
    expect(priority).toBe('high')
  })

  it('should determine high priority for stalking category', () => {
    const priority = determineReportPriority('stalking')
    expect(priority).toBe('high')
  })

  it('should determine normal priority for spam category', () => {
    const priority = determineReportPriority('spam')
    expect(priority).toBe('normal')
  })

  it('should determine normal priority for inappropriate_content category', () => {
    const priority = determineReportPriority('inappropriate_content')
    expect(priority).toBe('normal')
  })

  it('should determine normal priority for other category', () => {
    const priority = determineReportPriority('other')
    expect(priority).toBe('normal')
  })

  it('should build abuse flag for harassment_report', () => {
    const report = {
      reportId: 'report-1',
      reporterId: 'reporter-1',
      reportedUserId: 'target-1',
      category: 'harassment_report' as ReportCategory,
      description: 'Harassing messages',
    }

    const flag = buildAbuseFlagForReport(report)

    expect(flag).not.toBeNull()
    expect(flag!.type).toBe('harassment_report')
    expect(flag!.priority).toBe('high')
    expect(flag!.entityId).toBe('target-1')
  })

  it('should build abuse flag for stalking', () => {
    const report = {
      reportId: 'report-2',
      reporterId: 'reporter-1',
      reportedUserId: 'target-2',
      category: 'stalking' as ReportCategory,
      description: 'Following me to venues',
    }

    const flag = buildAbuseFlagForReport(report)

    expect(flag).not.toBeNull()
    expect(flag!.type).toBe('harassment_report')
    expect(flag!.priority).toBe('high')
    expect(flag!.entityId).toBe('target-2')
  })

  it('should NOT build abuse flag for spam category', () => {
    const report = {
      reportId: 'report-3',
      reporterId: 'reporter-1',
      reportedUserId: 'target-3',
      category: 'spam' as ReportCategory,
      description: 'Spamming messages',
    }

    const flag = buildAbuseFlagForReport(report)

    expect(flag).toBeNull()
  })

  it('should NOT build abuse flag for other category', () => {
    const report = {
      reportId: 'report-4',
      reporterId: 'reporter-1',
      reportedUserId: 'target-4',
      category: 'other' as ReportCategory,
      description: 'General complaint',
    }

    const flag = buildAbuseFlagForReport(report)

    expect(flag).toBeNull()
  })

  it('HIGH_PRIORITY_CATEGORIES contains exactly harassment_report and stalking', () => {
    expect(HIGH_PRIORITY_CATEGORIES.has('harassment_report')).toBe(true)
    expect(HIGH_PRIORITY_CATEGORIES.has('stalking')).toBe(true)
    expect(HIGH_PRIORITY_CATEGORIES.size).toBe(2)
  })

  it('submitReport calls createReport with correct data', async () => {
    const reportData = {
      reporterId: 'reporter-1',
      reportedUserId: 'target-1',
      category: 'harassment_report' as ReportCategory,
      description: 'Harassing behavior',
    }

    const mockReport = {
      reportId: 'mock-id',
      ...reportData,
      priority: 'high',
      status: 'pending',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    mockCreateReport.mockResolvedValue(mockReport)

    const result = await privacyService.submitReport(reportData)

    expect(mockCreateReport).toHaveBeenCalledWith(reportData)
    expect(result.priority).toBe('high')
    expect(result.status).toBe('pending')
  })
})

// ─── 5. Report Schema Validation ────────────────────────────────────────────

describe('Report schema validation', () => {
  it('should accept valid harassment_report', () => {
    const result = createReportBodySchema.safeParse({
      reportedUserId: 'user-123',
      category: 'harassment_report',
      description: 'This user is harassing me',
    })
    expect(result.success).toBe(true)
  })

  it('should accept valid stalking report', () => {
    const result = createReportBodySchema.safeParse({
      reportedUserId: 'user-456',
      category: 'stalking',
      description: 'Following me to every venue',
    })
    expect(result.success).toBe(true)
  })

  it('should reject report with invalid category', () => {
    const result = createReportBodySchema.safeParse({
      reportedUserId: 'user-123',
      category: 'invalid_category',
      description: 'Some description',
    })
    expect(result.success).toBe(false)
  })

  it('should reject report with empty description', () => {
    const result = createReportBodySchema.safeParse({
      reportedUserId: 'user-123',
      category: 'harassment_report',
      description: '',
    })
    expect(result.success).toBe(false)
  })

  it('should reject report with missing reportedUserId', () => {
    const result = createReportBodySchema.safeParse({
      category: 'harassment_report',
      description: 'Some description',
    })
    expect(result.success).toBe(false)
  })

  it('should reject report with extra fields (strict mode)', () => {
    const result = createReportBodySchema.safeParse({
      reportedUserId: 'user-123',
      category: 'harassment_report',
      description: 'Some description',
      extraField: 'should fail',
    })
    expect(result.success).toBe(false)
  })
})

// ─── 6. Block Params Validation ─────────────────────────────────────────────

describe('Block params validation', () => {
  it('should accept valid targetUserId', () => {
    const result = blockParamsSchema.safeParse({ targetUserId: 'user-123' })
    expect(result.success).toBe(true)
  })

  it('should reject empty targetUserId', () => {
    const result = blockParamsSchema.safeParse({ targetUserId: '' })
    expect(result.success).toBe(false)
  })

  it('should reject missing targetUserId', () => {
    const result = blockParamsSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
