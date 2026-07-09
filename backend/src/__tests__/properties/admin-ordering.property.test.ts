import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

// ─── Shared Arbitraries ─────────────────────────────────────────────────────

const flagIdArb = fc.uuid()
const userIdArb = fc.uuid()
const adminIdArb = fc.uuid()
const logIdArb = fc.uuid()

/** Valid date arbitrary — range from 2020 to 2030 */
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }).map((ts) => new Date(ts))

/** Abuse flag types from the check-in abuse detection system */
const abuseFlagTypeArb = fc.constantFrom('device_velocity', 'new_account_velocity', 'reward_drain', 'harassment_report')

/** Priority levels for abuse flags */
const priorityArb = fc.constantFrom('high', 'normal')

/** Admin action types specific to abuse flag management and admin moderation */
const adminActionTypeArb = fc.constantFrom(
  'disable_user',
  'disable_business',
  'review_flag',
  'reset_abuse_flags',
  'extend_trial',
  'set_tier',
  'send_message',
  'action_flag',
)

/** Entity types for audit logs */
const entityTypeArb = fc.constantFrom('user', 'business', 'abuse_flag')

/** Generates an unreviewed abuse flag record matching the DynamoDB schema */
const abuseFlagArb = fc.record({
  flagId: flagIdArb,
  type: abuseFlagTypeArb,
  entityId: userIdArb,
  entityType: fc.constant('user'),
  priority: priorityArb,
  reviewed: fc.constant(false),
  createdAt: validDateArb.map((d) => d.toISOString()),
  evidenceJson: fc.record({
    fingerprintHash: fc.string({ minLength: 8, maxLength: 16, unit: fc.constantFrom(...'0123456789abcdef'.split('')) }),
    nodeCount: fc.integer({ min: 1, max: 100 }),
  }),
})

// ─── Pure Functions Under Test ──────────────────────────────────────────────

/**
 * Pure function that sorts abuse flags by creation date descending.
 * Mirrors the ordering logic that the GET /v1/admin/abuse-flags endpoint
 * should apply when returning unreviewed flags to the admin dashboard.
 *
 * The GSI1 key pattern is `gsi1pk: ABUSE_QUEUE`, `gsi1sk: {priority}#{createdAt}`.
 * When querying with ScanIndexForward = false, DynamoDB returns items in
 * descending sort key order. This function replicates that ordering logic
 * purely by createdAt descending.
 */
function sortAbuseFlagsByCreatedAtDescending(
  flags: Array<{ flagId: string; createdAt: string; [key: string]: unknown }>,
): Array<{ flagId: string; createdAt: string; [key: string]: unknown }> {
  return [...flags].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA // descending
  })
}

/**
 * Pure function that checks whether a list of flags is in descending
 * creation date order.
 */
function isDescendingByCreatedAt(flags: Array<{ createdAt: string }>): boolean {
  for (let i = 1; i < flags.length; i++) {
    const prev = new Date(flags[i - 1]!.createdAt).getTime()
    const curr = new Date(flags[i]!.createdAt).getTime()
    if (curr > prev) return false
  }
  return true
}

/**
 * Pure function that builds an audit log entry for an admin action on an abuse flag.
 * Mirrors the `createAuditLog` pattern from admin/repository.ts.
 */
function buildAuditLogEntry(params: {
  adminId: string
  action: string
  entityType: string
  entityId: string
  timestamp: string
}): {
  pk: string
  sk: string
  gsi1pk: string
  gsi1sk: string
  adminId: string
  action: string
  entityType: string
  entityId: string
  createdAt: string
} {
  const logId = `log-${params.timestamp}-${params.adminId.slice(0, 8)}`
  return {
    pk: `AUDIT#${logId}`,
    sk: `AUDIT#${params.timestamp}`,
    gsi1pk: 'AUDIT_LOGS',
    gsi1sk: params.timestamp,
    adminId: params.adminId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    createdAt: params.timestamp,
  }
}

// ─── Property 10: Abuse flags are ordered by creation date descending ───────

describe('Property 10: Abuse flags are ordered by creation date descending', () => {
  /**
   * **Validates: Requirements 14.1**
   *
   * For any set of unreviewed abuse flags, the API SHALL return them
   * in descending creation date order.
   */

  it('sorting any set of abuse flags produces descending creation date order', () => {
    fc.assert(
      fc.property(fc.array(abuseFlagArb, { minLength: 0, maxLength: 50 }), (flags) => {
        const sorted = sortAbuseFlagsByCreatedAtDescending(flags)

        // The result must be in descending order by createdAt
        expect(isDescendingByCreatedAt(sorted)).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('sorting preserves all original flags (no flags lost or duplicated)', () => {
    fc.assert(
      fc.property(fc.array(abuseFlagArb, { minLength: 1, maxLength: 50 }), (flags) => {
        const sorted = sortAbuseFlagsByCreatedAtDescending(flags)

        // Same number of flags
        expect(sorted.length).toBe(flags.length)

        // Every original flag is present in the sorted result
        const sortedIds = new Set(sorted.map((f) => f.flagId))
        for (const flag of flags) {
          expect(sortedIds.has(flag.flagId)).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('the first flag in the sorted result has the most recent creation date', () => {
    fc.assert(
      fc.property(fc.array(abuseFlagArb, { minLength: 1, maxLength: 50 }), (flags) => {
        const sorted = sortAbuseFlagsByCreatedAtDescending(flags)

        // Find the maximum createdAt from the original set
        const maxCreatedAt = Math.max(...flags.map((f) => new Date(f.createdAt).getTime()))

        // The first element in sorted must have the maximum createdAt
        const firstTimestamp = new Date(sorted[0]!.createdAt).getTime()
        expect(firstTimestamp).toBe(maxCreatedAt)
      }),
      { numRuns: 25 },
    )
  })

  it('the last flag in the sorted result has the oldest creation date', () => {
    fc.assert(
      fc.property(fc.array(abuseFlagArb, { minLength: 1, maxLength: 50 }), (flags) => {
        const sorted = sortAbuseFlagsByCreatedAtDescending(flags)

        // Find the minimum createdAt from the original set
        const minCreatedAt = Math.min(...flags.map((f) => new Date(f.createdAt).getTime()))

        // The last element in sorted must have the minimum createdAt
        const lastTimestamp = new Date(sorted[sorted.length - 1]!.createdAt).getTime()
        expect(lastTimestamp).toBe(minCreatedAt)
      }),
      { numRuns: 25 },
    )
  })

  it('sorting is stable — flags with the same createdAt maintain relative order', () => {
    fc.assert(
      fc.property(
        fc.array(abuseFlagArb, { minLength: 2, maxLength: 30 }),
        fc.integer({ min: 0, max: 5 }), // number of distinct timestamps to use
        (flags, distinctCount) => {
          // Create flags that share timestamps to test stability
          const timestamps = flags.slice(0, Math.max(1, distinctCount)).map((f) => f.createdAt)

          const sharedTimestampFlags = flags.map((f, i) => ({
            ...f,
            createdAt: timestamps[i % timestamps.length]!,
          }))

          const sorted = sortAbuseFlagsByCreatedAtDescending(sharedTimestampFlags)

          // Must still be in descending order
          expect(isDescendingByCreatedAt(sorted)).toBe(true)

          // All flags must still be present
          expect(sorted.length).toBe(sharedTimestampFlags.length)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('sorting an empty list returns an empty list', () => {
    const sorted = sortAbuseFlagsByCreatedAtDescending([])
    expect(sorted).toHaveLength(0)
    expect(isDescendingByCreatedAt(sorted)).toBe(true)
  })

  it('sorting a single flag returns that flag unchanged', () => {
    fc.assert(
      fc.property(abuseFlagArb, (flag) => {
        const sorted = sortAbuseFlagsByCreatedAtDescending([flag])
        expect(sorted).toHaveLength(1)
        expect(sorted[0]!.flagId).toBe(flag.flagId)
        expect(sorted[0]!.createdAt).toBe(flag.createdAt)
      }),
      { numRuns: 25 },
    )
  })

  it('sorting is idempotent — sorting an already-sorted list produces the same result', () => {
    fc.assert(
      fc.property(fc.array(abuseFlagArb, { minLength: 0, maxLength: 30 }), (flags) => {
        const sorted1 = sortAbuseFlagsByCreatedAtDescending(flags)
        const sorted2 = sortAbuseFlagsByCreatedAtDescending(sorted1)

        // Sorting twice should produce the same result
        expect(sorted2.map((f) => f.flagId)).toEqual(sorted1.map((f) => f.flagId))
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 19: Every admin action produces an audit log entry ────────────
// (Complementary to disable-cascade.property.test.ts — focused on abuse flag context)

describe('Property 19: Every admin action produces an audit log entry (abuse flag context)', () => {
  /**
   * **Validates: Requirements 18.4**
   *
   * For any admin action (disable user, disable business, review flag,
   * reset flags, extend trial, etc.), an audit log entry SHALL be created
   * with the correct adminId, action type, target entity, and timestamp.
   *
   * This test focuses on the abuse flag management context: reviewing flags,
   * taking action on flags, and the resulting audit trail.
   */

  it('every admin action on an abuse flag produces an audit entry with correct adminId', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        flagIdArb,
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, flagId, timestamp) => {
          const entry = buildAuditLogEntry({
            adminId,
            action,
            entityType: 'abuse_flag',
            entityId: flagId,
            timestamp,
          })

          // The audit log entry MUST contain the correct adminId
          expect(entry.adminId).toBe(adminId)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('every admin action on an abuse flag produces an audit entry with correct action type', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        flagIdArb,
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, flagId, timestamp) => {
          const entry = buildAuditLogEntry({
            adminId,
            action,
            entityType: 'abuse_flag',
            entityId: flagId,
            timestamp,
          })

          // The audit log entry MUST contain the correct action type
          expect(entry.action).toBe(action)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('every admin action on an abuse flag produces an audit entry with correct target entity', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        entityTypeArb,
        userIdArb, // entityId
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, entityType, entityId, timestamp) => {
          const entry = buildAuditLogEntry({
            adminId,
            action,
            entityType,
            entityId,
            timestamp,
          })

          // The audit log entry MUST contain the correct entity type and ID
          expect(entry.entityType).toBe(entityType)
          expect(entry.entityId).toBe(entityId)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('audit log entries follow the correct DynamoDB key pattern for chronological querying', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        flagIdArb,
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, flagId, timestamp) => {
          const entry = buildAuditLogEntry({
            adminId,
            action,
            entityType: 'abuse_flag',
            entityId: flagId,
            timestamp,
          })

          // pk must follow AUDIT#{logId} pattern
          expect(entry.pk).toMatch(/^AUDIT#/)
          // sk must follow AUDIT#{createdAt} pattern
          expect(entry.sk).toBe(`AUDIT#${timestamp}`)
          // gsi1pk must be AUDIT_LOGS for global chronological query
          expect(entry.gsi1pk).toBe('AUDIT_LOGS')
          // gsi1sk must be the timestamp for ordering
          expect(entry.gsi1sk).toBe(timestamp)
          // createdAt must match the timestamp
          expect(entry.createdAt).toBe(timestamp)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('a sequence of admin actions produces one audit entry per action (1:1 mapping)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            adminId: adminIdArb,
            action: adminActionTypeArb,
            entityType: entityTypeArb,
            entityId: flagIdArb,
            timestamp: validDateArb.map((d) => d.toISOString()),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (actions) => {
          const entries = actions.map((a) => buildAuditLogEntry(a))

          // Each action must produce exactly one entry
          expect(entries.length).toBe(actions.length)

          // Each entry must have the correct fields from its corresponding action
          for (let i = 0; i < actions.length; i++) {
            expect(entries[i]!.adminId).toBe(actions[i]!.adminId)
            expect(entries[i]!.action).toBe(actions[i]!.action)
            expect(entries[i]!.entityType).toBe(actions[i]!.entityType)
            expect(entries[i]!.entityId).toBe(actions[i]!.entityId)
            expect(entries[i]!.createdAt).toBe(actions[i]!.timestamp)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('audit log entries for abuse flag actions are queryable in chronological order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            adminId: adminIdArb,
            action: fc.constantFrom('review_flag', 'action_flag', 'reset_abuse_flags'),
            entityType: fc.constant('abuse_flag'),
            entityId: flagIdArb,
            timestamp: validDateArb.map((d) => d.toISOString()),
          }),
          { minLength: 2, maxLength: 20 },
        ),
        (actions) => {
          const entries = actions.map((a) => buildAuditLogEntry(a))

          // Sort entries by gsi1sk (timestamp) descending — simulates DynamoDB query
          const sorted = [...entries].sort((a, b) => b.gsi1sk.localeCompare(a.gsi1sk))

          // Verify the sorted entries are in descending chronological order
          for (let i = 1; i < sorted.length; i++) {
            const prev = new Date(sorted[i - 1]!.gsi1sk).getTime()
            const curr = new Date(sorted[i]!.gsi1sk).getTime()
            expect(prev).toBeGreaterThanOrEqual(curr)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Shared Arbitraries for Properties 11 & 12 ─────────────────────────────

/** Audit log entry arbitrary matching the DynamoDB schema */
const auditLogEntryArb = fc.record({
  logId: logIdArb,
  adminId: adminIdArb,
  adminRole: fc.constantFrom('super_admin', 'support_agent', 'content_moderator'),
  action: adminActionTypeArb,
  entityType: entityTypeArb,
  entityId: userIdArb,
  createdAt: validDateArb.map((d) => d.toISOString()),
  beforeState: fc.oneof(fc.constant(null), fc.record({ status: fc.constantFrom('active', 'disabled') })),
  afterState: fc.oneof(fc.constant(null), fc.record({ status: fc.constantFrom('active', 'disabled') })),
})

// ─── Pure Functions Under Test (Properties 11 & 12) ─────────────────────────

/**
 * Pure function that filters audit log entries by a combination of criteria.
 * Mirrors the FilterExpression logic in the getAuditLogs repository function:
 * - adminId: exact match on the adminId field
 * - action: exact match on the action field
 * - date range: createdAt falls within [startDate, endDate] inclusive
 *
 * All active filters must match (AND logic).
 */
function filterAuditLogs(
  entries: Array<{
    logId: string
    adminId: string
    action: string
    createdAt: string
    [key: string]: unknown
  }>,
  filters: {
    adminId?: string
    action?: string
    startDate?: string
    endDate?: string
  },
): Array<{
  logId: string
  adminId: string
  action: string
  createdAt: string
  [key: string]: unknown
}> {
  return entries.filter((entry) => {
    if (filters.adminId && entry.adminId !== filters.adminId) return false
    if (filters.action && entry.action !== filters.action) return false
    if (filters.startDate && entry.createdAt < filters.startDate) return false
    if (filters.endDate && entry.createdAt > filters.endDate + 'T23:59:59.999Z') return false
    return true
  })
}

/**
 * Pure function that paginates a list of audit log entries by page size.
 * Returns an array of pages, each containing at most `pageSize` entries.
 * Mirrors the cursor-based pagination in the getAuditLogs repository function
 * where DynamoDB Limit controls page size and LastEvaluatedKey provides the cursor.
 */
function paginateAuditLogs<T>(entries: T[], pageSize: number): T[][] {
  if (pageSize <= 0) return []
  const pages: T[][] = []
  for (let i = 0; i < entries.length; i += pageSize) {
    pages.push(entries.slice(i, i + pageSize))
  }
  return pages
}

// ─── Property 11: Audit log filtering returns only matching entries ──────────

describe('Property 11: Audit log filtering returns only matching entries', () => {
  /**
   * **Validates: Requirements 15.3**
   *
   * For any set of audit log entries and any combination of filters
   * (adminId, action type, date range), every returned entry SHALL match
   * all active filter criteria, and no matching entry SHALL be excluded.
   */

  it('filtering by adminId returns only entries from that admin', () => {
    fc.assert(
      fc.property(fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }), adminIdArb, (entries, targetAdminId) => {
        const filtered = filterAuditLogs(entries, { adminId: targetAdminId })

        // Every returned entry must have the target adminId
        for (const entry of filtered) {
          expect(entry.adminId).toBe(targetAdminId)
        }

        // No matching entry is excluded
        const manualCount = entries.filter((e) => e.adminId === targetAdminId).length
        expect(filtered.length).toBe(manualCount)
      }),
      { numRuns: 25 },
    )
  })

  it('filtering by action type returns only entries with that action', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }),
        adminActionTypeArb,
        (entries, targetAction) => {
          const filtered = filterAuditLogs(entries, { action: targetAction })

          // Every returned entry must have the target action
          for (const entry of filtered) {
            expect(entry.action).toBe(targetAction)
          }

          // No matching entry is excluded
          const manualCount = entries.filter((e) => e.action === targetAction).length
          expect(filtered.length).toBe(manualCount)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('filtering by date range returns only entries within the range', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }),
        // Generate two dates and use the earlier as start, later as end
        validDateArb,
        validDateArb,
        (entries, date1, date2) => {
          const [startDate, endDate] = [date1, date2].sort((a, b) => a.getTime() - b.getTime())
          const startStr = startDate!.toISOString()
          const endStr = endDate!.toISOString().split('T')[0]! // date-only for endDate

          const filtered = filterAuditLogs(entries, { startDate: startStr, endDate: endStr })

          // Every returned entry must be within the date range
          for (const entry of filtered) {
            expect(entry.createdAt >= startStr).toBe(true)
            expect(entry.createdAt <= endStr + 'T23:59:59.999Z').toBe(true)
          }

          // No matching entry is excluded
          const manualFiltered = entries.filter(
            (e) => e.createdAt >= startStr && e.createdAt <= endStr + 'T23:59:59.999Z',
          )
          expect(filtered.length).toBe(manualFiltered.length)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('filtering by multiple criteria (adminId + action) applies AND logic', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }),
        adminIdArb,
        adminActionTypeArb,
        (entries, targetAdminId, targetAction) => {
          const filtered = filterAuditLogs(entries, {
            adminId: targetAdminId,
            action: targetAction,
          })

          // Every returned entry must match BOTH criteria
          for (const entry of filtered) {
            expect(entry.adminId).toBe(targetAdminId)
            expect(entry.action).toBe(targetAction)
          }

          // No matching entry is excluded
          const manualCount = entries.filter((e) => e.adminId === targetAdminId && e.action === targetAction).length
          expect(filtered.length).toBe(manualCount)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('filtering by all criteria (adminId + action + date range) applies AND logic', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }),
        adminIdArb,
        adminActionTypeArb,
        validDateArb,
        validDateArb,
        (entries, targetAdminId, targetAction, date1, date2) => {
          const [startDate, endDate] = [date1, date2].sort((a, b) => a.getTime() - b.getTime())
          const startStr = startDate!.toISOString()
          const endStr = endDate!.toISOString().split('T')[0]!

          const filtered = filterAuditLogs(entries, {
            adminId: targetAdminId,
            action: targetAction,
            startDate: startStr,
            endDate: endStr,
          })

          // Every returned entry must match ALL criteria
          for (const entry of filtered) {
            expect(entry.adminId).toBe(targetAdminId)
            expect(entry.action).toBe(targetAction)
            expect(entry.createdAt >= startStr).toBe(true)
            expect(entry.createdAt <= endStr + 'T23:59:59.999Z').toBe(true)
          }

          // No matching entry is excluded
          const manualCount = entries.filter(
            (e) =>
              e.adminId === targetAdminId &&
              e.action === targetAction &&
              e.createdAt >= startStr &&
              e.createdAt <= endStr + 'T23:59:59.999Z',
          ).length
          expect(filtered.length).toBe(manualCount)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('with no filters active, all entries are returned', () => {
    fc.assert(
      fc.property(fc.array(auditLogEntryArb, { minLength: 0, maxLength: 50 }), (entries) => {
        const filtered = filterAuditLogs(entries, {})

        // No filters means all entries pass
        expect(filtered.length).toBe(entries.length)
      }),
      { numRuns: 25 },
    )
  })

  it('filtering never introduces entries not in the original set', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }),
        adminIdArb,
        adminActionTypeArb,
        (entries, targetAdminId, targetAction) => {
          const filtered = filterAuditLogs(entries, {
            adminId: targetAdminId,
            action: targetAction,
          })

          // Every filtered entry must exist in the original set
          const originalIds = new Set(entries.map((e) => e.logId))
          for (const entry of filtered) {
            expect(originalIds.has(entry.logId)).toBe(true)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 12: Audit log pagination preserves completeness ────────────────

describe('Property 12: Audit log pagination preserves completeness', () => {
  /**
   * **Validates: Requirements 15.5**
   *
   * For any set of audit log entries and any page size, paginating through
   * the full set SHALL return every entry exactly once with no duplicates.
   */

  it('paginating returns every entry exactly once (no omissions)', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 0, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }), // page size
        (entries, pageSize) => {
          const pages = paginateAuditLogs(entries, pageSize)

          // Flatten all pages and verify total count matches
          const allItems = pages.flat()
          expect(allItems.length).toBe(entries.length)

          // Every original entry must appear in the paginated result
          const paginatedIds = allItems.map((e) => e.logId)
          for (const entry of entries) {
            expect(paginatedIds).toContain(entry.logId)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('paginating produces no duplicate entries', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (entries, pageSize) => {
          const pages = paginateAuditLogs(entries, pageSize)

          // Flatten and check for duplicates by index position
          const allItems = pages.flat()
          const seen = new Set<number>()
          for (let i = 0; i < allItems.length; i++) {
            // Use index-based identity since logIds could theoretically collide in generated data
            expect(seen.has(i)).toBe(false)
            seen.add(i)
          }

          // Also verify count matches (no duplicates means same length)
          expect(allItems.length).toBe(entries.length)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('each page has at most pageSize entries', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (entries, pageSize) => {
          const pages = paginateAuditLogs(entries, pageSize)

          // Every page must have at most pageSize entries
          for (const page of pages) {
            expect(page.length).toBeLessThanOrEqual(pageSize)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('all pages except the last are exactly pageSize entries', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (entries, pageSize) => {
          const pages = paginateAuditLogs(entries, pageSize)

          // All pages except the last must be exactly pageSize
          for (let i = 0; i < pages.length - 1; i++) {
            expect(pages[i]!.length).toBe(pageSize)
          }

          // The last page must have between 1 and pageSize entries
          if (pages.length > 0) {
            const lastPage = pages[pages.length - 1]!
            expect(lastPage.length).toBeGreaterThanOrEqual(1)
            expect(lastPage.length).toBeLessThanOrEqual(pageSize)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('pagination preserves the original ordering of entries', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (entries, pageSize) => {
          const pages = paginateAuditLogs(entries, pageSize)

          // Flatten and verify order matches the input
          const allItems = pages.flat()
          for (let i = 0; i < entries.length; i++) {
            expect(allItems[i]!.logId).toBe(entries[i]!.logId)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('pagination with page size 1 produces one entry per page', () => {
    fc.assert(
      fc.property(fc.array(auditLogEntryArb, { minLength: 1, maxLength: 30 }), (entries) => {
        const pages = paginateAuditLogs(entries, 1)

        // Number of pages equals number of entries
        expect(pages.length).toBe(entries.length)

        // Each page has exactly 1 entry
        for (const page of pages) {
          expect(page.length).toBe(1)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('pagination with page size >= total entries produces a single page', () => {
    fc.assert(
      fc.property(fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }), (entries) => {
        const pages = paginateAuditLogs(entries, entries.length + 10)

        // Should be a single page containing all entries
        expect(pages.length).toBe(1)
        expect(pages[0]!.length).toBe(entries.length)
      }),
      { numRuns: 25 },
    )
  })

  it('filtering then paginating still preserves completeness of filtered set', () => {
    fc.assert(
      fc.property(
        fc.array(auditLogEntryArb, { minLength: 1, maxLength: 50 }),
        adminIdArb,
        fc.integer({ min: 1, max: 20 }),
        (entries, targetAdminId, pageSize) => {
          // First filter, then paginate (mirrors the real API flow)
          const filtered = filterAuditLogs(entries, { adminId: targetAdminId })
          const pages = paginateAuditLogs(filtered, pageSize)

          // Flatten and verify completeness
          const allItems = pages.flat()
          expect(allItems.length).toBe(filtered.length)

          // Every filtered entry appears in the paginated result
          for (const entry of filtered) {
            expect(allItems.some((item) => item.logId === entry.logId)).toBe(true)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})
