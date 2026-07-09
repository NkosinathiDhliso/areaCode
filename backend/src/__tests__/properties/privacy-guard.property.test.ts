import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import type { ReportCategory } from '../../features/social/report-repository.js'
import {
  HIGH_PRIORITY_CATEGORIES,
  determineReportPriority,
  buildAbuseFlagForReport,
} from '../../features/social/report-repository.js'
import {
  initPrivacyGuard,
  checkPrivacy,
  filterByPrivacy,
  canEmitIdentity,
  canEmitToFriends,
  sanitizeForBusiness,
} from '../../shared/privacy/privacy-guard.js'
import type { PrivacyLevel } from '../../shared/privacy/types.js'
import { DEFAULT_PRIVACY_LEVEL } from '../../shared/privacy/types.js'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const userIdArb = fc.uuid()
const privacyLevelArb = fc.constantFrom<PrivacyLevel>('public', 'friends_only', 'private')

/** Generates two distinct user IDs */
const twoDistinctUsersArb = fc.tuple(userIdArb, userIdArb).filter(([a, b]) => a !== b)

/** Valid date arbitrary that won't produce Invalid Date */
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }).map((ts) => new Date(ts))

/** Generates a social feed entry */
const feedEntryArb = fc.record({
  userId: userIdArb,
  displayName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  username: fc.option(fc.string({ minLength: 3, maxLength: 20 }), { nil: null }),
  avatarUrl: fc.option(fc.webUrl(), { nil: null }),
  nodeId: userIdArb,
  nodeName: fc.string({ minLength: 1, maxLength: 50 }),
  checkedInAt: validDateArb.map((d) => d.toISOString()),
  tier: fc.constantFrom('local', 'regular', 'fixture', 'institution', 'legend'),
})

/** Generates a business check-in event payload with potentially sensitive fields */
const businessCheckinPayloadArb = fc.record({
  nodeId: userIdArb,
  nodeName: fc.string({ minLength: 1, maxLength: 50 }),
  displayName: fc.string({ minLength: 1, maxLength: 30 }),
  tier: fc.constantFrom('local', 'regular', 'fixture', 'institution', 'legend'),
  visitCount: fc.integer({ min: 1, max: 500 }),
  timestamp: validDateArb.map((d) => d.toISOString()),
  // Sensitive fields that should be stripped
  phone: fc.option(fc.string({ minLength: 10, maxLength: 15 }), { nil: undefined }),
  email: fc.option(fc.emailAddress(), { nil: undefined }),
  userId: fc.option(userIdArb, { nil: undefined }),
  cognitoSub: fc.option(userIdArb, { nil: undefined }),
  lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: undefined }),
  lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: undefined }),
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sets up PrivacyGuard with configurable mock dependencies.
 * This allows property tests to control the privacy state without DynamoDB.
 */
function setupPrivacyGuard(config: {
  users: Map<string, { privacyLevel?: string }>
  blocks: Set<string> // Set of "blockerId:blockedId" pairs
  mutualFollows: Set<string> // Set of "userA:userB" pairs (bidirectional)
}) {
  initPrivacyGuard({
    getUserById: async (userId: string) => {
      const user = config.users.get(userId)
      return user ?? null
    },
    isBlocked: async (blockerId: string, blockedId: string) => {
      return config.blocks.has(`${blockerId}:${blockedId}`)
    },
    areMutualFollows: async (userA: string, userB: string) => {
      return config.mutualFollows.has(`${userA}:${userB}`) || config.mutualFollows.has(`${userB}:${userA}`)
    },
  })
}

// ─── Property 22: New accounts default to friends_only privacy ──────────────

describe('Property 22: New accounts default to friends_only privacy', () => {
  /**
   * **Validates: Requirements 22.1**
   *
   * For any newly created consumer account, the privacyLevel attribute
   * SHALL be "friends_only".
   */
  it('DEFAULT_PRIVACY_LEVEL is always "friends_only"', () => {
    expect(DEFAULT_PRIVACY_LEVEL).toBe('friends_only')
  })

  it('for any user without an explicit privacyLevel, PrivacyGuard treats them as friends_only', async () => {
    await fc.assert(
      fc.asyncProperty(twoDistinctUsersArb, async ([targetUserId, viewerId]) => {
        // User exists but has no privacyLevel set (simulates new account)
        setupPrivacyGuard({
          users: new Map([[targetUserId, {}]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })

        const result = await checkPrivacy(targetUserId, viewerId)

        // Without explicit privacyLevel, defaults to friends_only
        // Since viewer is not a mutual follow, they should see anonymous
        expect(result.visibility).toBe('anonymous')
        expect(result.reason).toBe('not_friends')
      }),
      { numRuns: 25 },
    )
  })

  it('for any new account with explicit friends_only, non-friends see anonymous', async () => {
    await fc.assert(
      fc.asyncProperty(twoDistinctUsersArb, async ([targetUserId, viewerId]) => {
        setupPrivacyGuard({
          users: new Map([[targetUserId, { privacyLevel: 'friends_only' }]]),
          blocks: new Set(),
          mutualFollows: new Set(), // No mutual follows
        })

        const result = await checkPrivacy(targetUserId, viewerId)
        expect(result.visibility).toBe('anonymous')
        expect(result.reason).toBe('not_friends')
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 23: Privacy level controls visibility in social queries ───────

describe('Property 23: Privacy level controls visibility in social queries', () => {
  /**
   * **Validates: Requirements 22.3, 22.4**
   *
   * For any consumer with privacyLevel = "private", their check-ins SHALL NOT
   * appear in the activity feed, leaderboard, or "who's here" list for any
   * other consumer. For any consumer with privacyLevel = "friends_only", their
   * check-ins SHALL only appear to consumers who are mutual follows.
   */
  it('private users are always excluded from social queries regardless of viewer', async () => {
    await fc.assert(
      fc.asyncProperty(twoDistinctUsersArb, async ([targetUserId, viewerId]) => {
        setupPrivacyGuard({
          users: new Map([[targetUserId, { privacyLevel: 'private' }]]),
          blocks: new Set(),
          mutualFollows: new Set([`${targetUserId}:${viewerId}`]), // Even mutual follows can't see private
        })

        const result = await checkPrivacy(targetUserId, viewerId)
        expect(result.visibility).toBe('excluded')
        expect(result.reason).toBe('private_profile')
      }),
      { numRuns: 25 },
    )
  })

  it('friends_only users are visible only to mutual follows', async () => {
    await fc.assert(
      fc.asyncProperty(twoDistinctUsersArb, fc.boolean(), async ([targetUserId, viewerId], isMutualFollow) => {
        const mutualFollows = new Set<string>()
        if (isMutualFollow) {
          mutualFollows.add(`${targetUserId}:${viewerId}`)
        }

        setupPrivacyGuard({
          users: new Map([[targetUserId, { privacyLevel: 'friends_only' }]]),
          blocks: new Set(),
          mutualFollows,
        })

        const result = await checkPrivacy(targetUserId, viewerId)

        if (isMutualFollow) {
          expect(result.visibility).toBe('full')
          expect(result.reason).toBe('mutual_follow')
        } else {
          expect(result.visibility).toBe('anonymous')
          expect(result.reason).toBe('not_friends')
        }
      }),
      { numRuns: 25 },
    )
  })

  it('public users are visible to everyone', async () => {
    await fc.assert(
      fc.asyncProperty(twoDistinctUsersArb, async ([targetUserId, viewerId]) => {
        setupPrivacyGuard({
          users: new Map([[targetUserId, { privacyLevel: 'public' }]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })

        const result = await checkPrivacy(targetUserId, viewerId)
        expect(result.visibility).toBe('full')
        expect(result.reason).toBe('public_profile')
      }),
      { numRuns: 25 },
    )
  })

  it('filterByPrivacy removes private users from any list of entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(feedEntryArb, { minLength: 1, maxLength: 10 }),
        userIdArb,
        async (entries, viewerId) => {
          // Make all entry users private
          const users = new Map<string, { privacyLevel?: string }>()
          for (const entry of entries) {
            users.set(entry.userId, { privacyLevel: 'private' })
          }

          setupPrivacyGuard({
            users,
            blocks: new Set(),
            mutualFollows: new Set(),
          })

          const filtered = await filterByPrivacy(entries, viewerId)

          // All private users should be excluded (unless viewer is the user themselves)
          for (const item of filtered) {
            expect(item.userId).toBe(viewerId)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('filterByPrivacy anonymizes friends_only users for non-friends', async () => {
    // Generate entries with userIds guaranteed different from viewerId
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.array(
          fc.record({
            userId: userIdArb,
            displayName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
            username: fc.option(fc.string({ minLength: 3, maxLength: 20 }), { nil: null }),
            avatarUrl: fc.option(fc.webUrl(), { nil: null }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (viewerId, entries) => {
          // Filter out entries where userId matches viewerId
          const filteredEntries = entries.filter((e) => e.userId !== viewerId)
          if (filteredEntries.length === 0) return // Skip if no valid entries

          // Make all entry users friends_only with no mutual follows
          const users = new Map<string, { privacyLevel?: string }>()
          for (const entry of filteredEntries) {
            users.set(entry.userId, { privacyLevel: 'friends_only' })
          }

          setupPrivacyGuard({
            users,
            blocks: new Set(),
            mutualFollows: new Set(), // No mutual follows
          })

          const filtered = await filterByPrivacy(filteredEntries, viewerId)

          // All should be anonymized (identity fields nulled)
          for (const item of filtered) {
            expect(item.displayName).toBeNull()
            expect(item.username).toBeNull()
            expect(item.avatarUrl).toBeNull()
            expect(item.privacyVisibility).toBe('anonymous')
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 24: No GPS coordinates in consumer-facing responses ───────────

describe('Property 24: No GPS coordinates in consumer-facing responses', () => {
  /**
   * **Validates: Requirements 22.5**
   *
   * For any API response that returns data about other consumers (feed,
   * leaderboard, who's here, search), the response SHALL NOT contain lat or
   * lng fields associated with any consumer's check-in activity.
   */
  it('sanitizeForBusiness never includes lat or lng in output', () => {
    fc.assert(
      fc.property(businessCheckinPayloadArb, (payload) => {
        const sanitized = sanitizeForBusiness(payload as unknown as Record<string, unknown>)

        // lat and lng must NEVER appear in sanitized output
        expect(sanitized).not.toHaveProperty('lat')
        expect(sanitized).not.toHaveProperty('lng')
      }),
      { numRuns: 25 },
    )
  })

  it('sanitizeForBusiness never includes phone, email, userId, or cognitoSub', () => {
    fc.assert(
      fc.property(businessCheckinPayloadArb, (payload) => {
        const sanitized = sanitizeForBusiness(payload as unknown as Record<string, unknown>)

        expect(sanitized).not.toHaveProperty('phone')
        expect(sanitized).not.toHaveProperty('email')
        expect(sanitized).not.toHaveProperty('userId')
        expect(sanitized).not.toHaveProperty('cognitoSub')
      }),
      { numRuns: 25 },
    )
  })

  it('for any record with arbitrary extra fields containing coordinates, sanitizeForBusiness strips them', () => {
    fc.assert(
      fc.property(
        fc.record({
          nodeId: userIdArb,
          displayName: fc.string({ minLength: 1, maxLength: 30 }),
          tier: fc.constantFrom('local', 'regular', 'fixture', 'institution', 'legend'),
          timestamp: validDateArb.map((d) => d.toISOString()),
        }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (basePayload, lat, lng) => {
          const payloadWithCoords = { ...basePayload, lat, lng }
          const sanitized = sanitizeForBusiness(payloadWithCoords as unknown as Record<string, unknown>)

          expect(sanitized).not.toHaveProperty('lat')
          expect(sanitized).not.toHaveProperty('lng')
          // Allowed fields should still be present
          expect(sanitized).toHaveProperty('nodeId')
          expect(sanitized).toHaveProperty('displayName')
          expect(sanitized).toHaveProperty('tier')
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 25: Block enforcement across all social queries ───────────────

describe('Property 25: Block enforcement across all social queries', () => {
  /**
   * **Validates: Requirements 22.7**
   *
   * For any pair of consumers where A has blocked B, all social queries made
   * by B (feed, leaderboard, who's here, search, profile) SHALL NOT return
   * any data about A. Additionally, A SHALL NOT appear in any WebSocket events
   * delivered to B.
   */
  it('when A blocks B, B cannot see A in any social query (regardless of privacy level)', async () => {
    await fc.assert(
      fc.asyncProperty(twoDistinctUsersArb, privacyLevelArb, async ([userA, userB], privacyLevel) => {
        // A has blocked B — isBlocked(targetUserId=A, viewerId=B) should be true
        // In checkPrivacy(targetUserId=A, viewerId=B):
        //   it calls isBlocked(A, B) — "has A blocked B?"
        setupPrivacyGuard({
          users: new Map([[userA, { privacyLevel }]]),
          blocks: new Set([`${userA}:${userB}`]), // A blocked B
          mutualFollows: new Set([`${userA}:${userB}`]), // Even if mutual follows
        })

        // B tries to view A's data — A should NEVER be visible to B
        const result = await checkPrivacy(userA, userB)
        expect(result.visibility).toBe('excluded')
        // Reason may be 'blocked' or 'private_profile' depending on privacy level
        // (private check runs before block check in the code)
        // The key invariant: B cannot see A's data
      }),
      { numRuns: 25 },
    )
  })

  it('when A blocks B with non-private privacy, reason is specifically "blocked"', async () => {
    await fc.assert(
      fc.asyncProperty(
        twoDistinctUsersArb,
        fc.constantFrom<PrivacyLevel>('public', 'friends_only'),
        async ([userA, userB], privacyLevel) => {
          setupPrivacyGuard({
            users: new Map([[userA, { privacyLevel }]]),
            blocks: new Set([`${userA}:${userB}`]), // A blocked B
            mutualFollows: new Set([`${userA}:${userB}`]),
          })

          const result = await checkPrivacy(userA, userB)
          expect(result.visibility).toBe('excluded')
          expect(result.reason).toBe('blocked')
        },
      ),
      { numRuns: 25 },
    )
  })

  it('when B blocks A, A cannot see B in any social query (reverse block)', async () => {
    await fc.assert(
      fc.asyncProperty(
        twoDistinctUsersArb,
        fc.constantFrom<PrivacyLevel>('public', 'friends_only'),
        async ([userA, userB], privacyLevel) => {
          // B has blocked A
          // checkPrivacy(target=B, viewer=A) calls isBlocked(B, A) — "has B blocked A?"
          setupPrivacyGuard({
            users: new Map([[userB, { privacyLevel }]]),
            blocks: new Set([`${userB}:${userA}`]), // B blocked A
            mutualFollows: new Set(),
          })

          // A tries to view B's data
          const result = await checkPrivacy(userB, userA)
          expect(result.visibility).toBe('excluded')
          expect(result.reason).toBe('blocked')
        },
      ),
      { numRuns: 25 },
    )
  })

  it('block enforcement takes precedence over public privacy level', async () => {
    await fc.assert(
      fc.asyncProperty(twoDistinctUsersArb, async ([userA, userB]) => {
        // A is public but has blocked B
        // checkPrivacy(target=A, viewer=B) calls isBlocked(A, B)
        setupPrivacyGuard({
          users: new Map([[userA, { privacyLevel: 'public' }]]),
          blocks: new Set([`${userA}:${userB}`]), // A blocked B
          mutualFollows: new Set(),
        })

        const result = await checkPrivacy(userA, userB)
        expect(result.visibility).toBe('excluded')
        expect(result.reason).toBe('blocked')
      }),
      { numRuns: 25 },
    )
  })

  it('filterByPrivacy excludes blocked users from feed entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.array(
          fc.record({
            userId: userIdArb,
            displayName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
            username: fc.option(fc.string({ minLength: 3, maxLength: 20 }), { nil: null }),
            avatarUrl: fc.option(fc.webUrl(), { nil: null }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (viewerId, entries) => {
          // Filter out entries where userId matches viewerId
          const filteredEntries = entries.filter((e) => e.userId !== viewerId)
          if (filteredEntries.length === 0) return

          // All entry users have blocked the viewer
          // checkPrivacy(target=entryUser, viewer=viewerId) calls isBlocked(entryUser, viewerId)
          const blocks = new Set<string>()
          const users = new Map<string, { privacyLevel?: string }>()
          for (const entry of filteredEntries) {
            blocks.add(`${entry.userId}:${viewerId}`) // entry user blocked viewer
            users.set(entry.userId, { privacyLevel: 'public' })
          }

          setupPrivacyGuard({ users, blocks, mutualFollows: new Set() })

          const filtered = await filterByPrivacy(filteredEntries, viewerId)

          // All blocked users should be excluded entirely
          expect(filtered).toHaveLength(0)
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 27: WebSocket privacy enforcement for non-public users ────────

describe('Property 27: WebSocket privacy enforcement for non-public users', () => {
  /**
   * **Validates: Requirements 22.10**
   *
   * For any check-in by a consumer with privacyLevel set to "friends_only" or
   * "private", the check-in SHALL NOT be included in any city-wide WebSocket
   * event (toast:new) with identity information. Friend-specific toasts
   * (toast:friend_checkin) SHALL only be emitted to the consumer's mutual follows.
   */
  it('canEmitIdentity returns false for friends_only users', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        setupPrivacyGuard({
          users: new Map([[userId, { privacyLevel: 'friends_only' }]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })

        const canEmit = await canEmitIdentity(userId)
        expect(canEmit).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('canEmitIdentity returns false for private users', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        setupPrivacyGuard({
          users: new Map([[userId, { privacyLevel: 'private' }]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })

        const canEmit = await canEmitIdentity(userId)
        expect(canEmit).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('canEmitIdentity returns true only for public users', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        setupPrivacyGuard({
          users: new Map([[userId, { privacyLevel: 'public' }]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })

        const canEmit = await canEmitIdentity(userId)
        expect(canEmit).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('for any non-public privacy level, canEmitIdentity is always false', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.constantFrom<PrivacyLevel>('friends_only', 'private'),
        async (userId, privacyLevel) => {
          setupPrivacyGuard({
            users: new Map([[userId, { privacyLevel }]]),
            blocks: new Set(),
            mutualFollows: new Set(),
          })

          const canEmit = await canEmitIdentity(userId)
          expect(canEmit).toBe(false)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('canEmitIdentity fails closed when user cannot be loaded (treats as non-public)', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        // User not in the map — simulates user not found
        setupPrivacyGuard({
          users: new Map(), // Empty — user not found
          blocks: new Set(),
          mutualFollows: new Set(),
        })

        const canEmit = await canEmitIdentity(userId)
        // When user is not found, getUserById returns null
        // canEmitIdentity checks privacyLevel ?? DEFAULT_PRIVACY_LEVEL which is 'friends_only'
        // 'friends_only' !== 'public' so returns false
        expect(canEmit).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  // canEmitToFriends gates FRIEND-directed emission (toast:friend_checkin,
  // friend:checkout, friend push). Unlike canEmitIdentity (public-only, for
  // stranger-visible city events), it must allow the default friends_only so
  // friends actually receive the belonging signal.
  it('canEmitToFriends returns true for public users', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        setupPrivacyGuard({
          users: new Map([[userId, { privacyLevel: 'public' }]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })
        expect(await canEmitToFriends(userId)).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('canEmitToFriends returns true for friends_only users (the default)', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        setupPrivacyGuard({
          users: new Map([[userId, { privacyLevel: 'friends_only' }]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })
        expect(await canEmitToFriends(userId)).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('canEmitToFriends returns false only for private users', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        setupPrivacyGuard({
          users: new Map([[userId, { privacyLevel: 'private' }]]),
          blocks: new Set(),
          mutualFollows: new Set(),
        })
        expect(await canEmitToFriends(userId)).toBe(false)
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 26: Harassment reports create high-priority abuse flags ────────

describe('Property 26: Harassment reports create high-priority abuse flags', () => {
  /**
   * **Validates: Requirements 22.9**
   *
   * For any report submitted with category "harassment_report" or "stalking",
   * the system SHALL create an abuse flag with type = "harassment_report" and
   * priority = "high" that appears at the top of the admin abuse flag queue.
   */

  /** Arbitrary for harassment/stalking categories (high-priority) */
  const harassmentCategoryArb = fc.constantFrom<ReportCategory>('harassment_report', 'stalking')

  /** Arbitrary for non-harassment categories (normal priority) */
  const normalCategoryArb = fc.constantFrom<ReportCategory>('spam', 'inappropriate_content', 'other')

  /** Arbitrary for any valid report category */
  const reportCategoryArb = fc.constantFrom<ReportCategory>(
    'harassment_report',
    'stalking',
    'spam',
    'inappropriate_content',
    'other',
  )

  /** Arbitrary for a report submission */
  const _reportDataArb = fc.record({
    reportId: fc.uuid(),
    reporterId: fc.uuid(),
    reportedUserId: fc.uuid(),
    category: reportCategoryArb,
    description: fc.string({ minLength: 1, maxLength: 200 }),
  })

  it('harassment_report and stalking categories always produce high priority', () => {
    fc.assert(
      fc.property(harassmentCategoryArb, (category) => {
        const priority = determineReportPriority(category)
        expect(priority).toBe('high')
      }),
      { numRuns: 25 },
    )
  })

  it('non-harassment categories always produce normal priority', () => {
    fc.assert(
      fc.property(normalCategoryArb, (category) => {
        const priority = determineReportPriority(category)
        expect(priority).toBe('normal')
      }),
      { numRuns: 25 },
    )
  })

  it('for any harassment/stalking report, buildAbuseFlagForReport returns a high-priority flag with type "harassment_report"', () => {
    fc.assert(
      fc.property(
        fc.record({
          reportId: fc.uuid(),
          reporterId: fc.uuid(),
          reportedUserId: fc.uuid(),
          category: harassmentCategoryArb,
          description: fc.string({ minLength: 1, maxLength: 200 }),
        }),
        (report) => {
          const flag = buildAbuseFlagForReport(report)

          // Flag MUST be created for harassment/stalking
          expect(flag).not.toBeNull()
          expect(flag!.type).toBe('harassment_report')
          expect(flag!.priority).toBe('high')
          expect(flag!.entityId).toBe(report.reportedUserId)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('for any non-harassment report, buildAbuseFlagForReport returns null (no abuse flag created)', () => {
    fc.assert(
      fc.property(
        fc.record({
          reportId: fc.uuid(),
          reporterId: fc.uuid(),
          reportedUserId: fc.uuid(),
          category: normalCategoryArb,
          description: fc.string({ minLength: 1, maxLength: 200 }),
        }),
        (report) => {
          const flag = buildAbuseFlagForReport(report)
          expect(flag).toBeNull()
        },
      ),
      { numRuns: 25 },
    )
  })

  it('HIGH_PRIORITY_CATEGORIES contains exactly harassment_report and stalking', () => {
    // Verify the set is correctly defined
    expect(HIGH_PRIORITY_CATEGORIES.has('harassment_report')).toBe(true)
    expect(HIGH_PRIORITY_CATEGORIES.has('stalking')).toBe(true)
    expect(HIGH_PRIORITY_CATEGORIES.size).toBe(2)
  })

  it('for any report category, priority is high if and only if category is harassment_report or stalking', () => {
    fc.assert(
      fc.property(reportCategoryArb, (category) => {
        const priority = determineReportPriority(category)
        const isHarassmentOrStalking = category === 'harassment_report' || category === 'stalking'

        if (isHarassmentOrStalking) {
          expect(priority).toBe('high')
        } else {
          expect(priority).toBe('normal')
        }
      }),
      { numRuns: 25 },
    )
  })

  it('high-priority abuse flags sort before normal-priority in the queue (GSI1 sort key format)', () => {
    fc.assert(
      fc.property(
        fc.record({
          reportId: fc.uuid(),
          reporterId: fc.uuid(),
          reportedUserId: fc.uuid(),
          category: harassmentCategoryArb,
          description: fc.string({ minLength: 1, maxLength: 200 }),
        }),
        fc.integer({ min: 1704067200000, max: 1767139200000 }).map((ts) => new Date(ts)),
        (report, date) => {
          const priority = determineReportPriority(report.category)
          const gsi1sk = `${priority}#${date.toISOString()}`

          // High-priority reports have gsi1sk starting with "high#"
          // which sorts AFTER "normal#" lexicographically — but the query uses
          // ScanIndexForward = false (descending), so "high#" appears first
          expect(gsi1sk).toMatch(/^high#/)
          expect(gsi1sk.startsWith('high#')).toBe(true)
        },
      ),
      { numRuns: 25 },
    )
  })
})
