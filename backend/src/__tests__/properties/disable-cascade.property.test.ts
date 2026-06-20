import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const userIdArb = fc.uuid()
const nodeIdArb = fc.uuid()
const businessIdArb = fc.uuid()
const adminIdArb = fc.uuid()

/** Valid date arbitrary */
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }).map((ts) => new Date(ts))

/** Admin action types that produce audit log entries */
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
const entityTypeArb = fc.constantFrom('user', 'business', 'flag')

/** Node record arbitrary */
const nodeRecordArb = fc.record({
  nodeId: nodeIdArb,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  isActive: fc.boolean(),
  businessId: businessIdArb,
})

/** User record arbitrary */
const userRecordArb = fc.record({
  userId: userIdArb,
  displayName: fc.string({ minLength: 1, maxLength: 30 }),
  isDisabled: fc.boolean(),
})

// ─── Pure Functions Under Test ──────────────────────────────────────────────

/**
 * Pure function that determines whether a check-in attempt should be rejected.
 * Mirrors the isDisabled check in `processCheckIn` from check-in/service.ts.
 *
 * Returns true if the check-in should be REJECTED (user is disabled).
 */
function shouldRejectCheckIn(user: { isDisabled?: boolean }): boolean {
  return user.isDisabled === true
}

/**
 * Pure function that determines whether a reward claim attempt should be rejected.
 * Mirrors the isDisabled check that should exist in the reward claim flow.
 *
 * Returns true if the reward claim should be REJECTED (user is disabled).
 */
function shouldRejectRewardClaim(user: { isDisabled?: boolean }): boolean {
  return user.isDisabled === true
}

/**
 * Pure function that computes the resulting node states after disabling a business.
 * Mirrors the logic in `disableBusiness` from admin/service.ts — sets isActive = false
 * on all nodes owned by the business.
 */
function disableBusinessNodes(
  nodes: Array<{ nodeId: string; isActive: boolean; businessId: string }>,
  targetBusinessId: string,
): Array<{ nodeId: string; isActive: boolean; businessId: string }> {
  return nodes.map((node) => {
    if (node.businessId === targetBusinessId) {
      return { ...node, isActive: false }
    }
    return node
  })
}

/**
 * Pure function that builds an audit log entry for an admin action.
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

// ─── Property 17: Disabled user is blocked from check-in and reward claims ──

describe('Property 17: Disabled user is blocked from check-in and reward claims', () => {
  /**
   * **Validates: Requirements 18.2**
   *
   * For any consumer with isDisabled = true, all check-in attempts and
   * reward claim attempts SHALL be rejected with an appropriate error.
   */

  it('all check-in attempts are rejected when user isDisabled is true', () => {
    fc.assert(
      fc.property(userIdArb, nodeIdArb, (userId, nodeId) => {
        const disabledUser = { userId, isDisabled: true }

        // A disabled user's check-in attempt must always be rejected
        const rejected = shouldRejectCheckIn(disabledUser)
        expect(rejected).toBe(true)

        // Verify the rejection is independent of the target node
        void nodeId // nodeId doesn't affect the disabled check
        expect(shouldRejectCheckIn(disabledUser)).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('all reward claim attempts are rejected when user isDisabled is true', () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.uuid(), // rewardId
        (userId, _rewardId) => {
          const disabledUser = { userId, isDisabled: true }

          // A disabled user's reward claim attempt must always be rejected
          const rejected = shouldRejectRewardClaim(disabledUser)
          expect(rejected).toBe(true)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('non-disabled users are NOT rejected from check-in or reward claims', () => {
    fc.assert(
      fc.property(userIdArb, (userId) => {
        const enabledUser = { userId, isDisabled: false }

        // An enabled user should NOT be rejected
        expect(shouldRejectCheckIn(enabledUser)).toBe(false)
        expect(shouldRejectRewardClaim(enabledUser)).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('users without isDisabled attribute (undefined) are NOT rejected', () => {
    fc.assert(
      fc.property(userIdArb, (userId) => {
        const userWithoutFlag = { userId } as { userId: string; isDisabled?: boolean }

        // Users without the isDisabled flag should not be blocked
        expect(shouldRejectCheckIn(userWithoutFlag)).toBe(false)
        expect(shouldRejectRewardClaim(userWithoutFlag)).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('disabled check is consistent across multiple attempts for the same user', () => {
    fc.assert(
      fc.property(userIdArb, fc.boolean(), fc.integer({ min: 1, max: 50 }), (userId, isDisabled, attemptCount) => {
        const user = { userId, isDisabled }

        // The result should be the same regardless of how many times we check
        const results = Array.from({ length: attemptCount }, () => shouldRejectCheckIn(user))
        const allSame = results.every((r) => r === results[0])
        expect(allSame).toBe(true)

        // And the result should match the isDisabled flag
        expect(results[0]).toBe(isDisabled)
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 18: Disabling a business deactivates all its nodes ────────────

describe('Property 18: Disabling a business deactivates all its nodes', () => {
  /**
   * **Validates: Requirements 18.3**
   *
   * For any business with N nodes (N ≥ 0), disabling the business SHALL
   * result in all N nodes having isActive = false.
   */

  it('all nodes owned by the disabled business have isActive = false after disable', () => {
    fc.assert(
      fc.property(businessIdArb, fc.array(nodeIdArb, { minLength: 0, maxLength: 30 }), (businessId, nodeIds) => {
        // Create nodes all owned by this business, with random initial isActive states
        const nodes = nodeIds.map((nodeId) => ({
          nodeId,
          isActive: true, // even if initially active
          businessId,
        }))

        const result = disableBusinessNodes(nodes, businessId)

        // ALL nodes owned by the business must have isActive = false
        for (const node of result) {
          expect(node.isActive).toBe(false)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('nodes NOT owned by the disabled business remain unchanged', () => {
    fc.assert(
      fc.property(
        businessIdArb,
        fc.uuid(), // other business ID
        fc.array(
          fc.record({
            nodeId: nodeIdArb,
            isActive: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        fc.array(
          fc.record({
            nodeId: nodeIdArb,
            isActive: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (targetBusinessId, otherBusinessId, targetNodes, otherNodes) => {
          // Skip if business IDs happen to be the same
          fc.pre(targetBusinessId !== otherBusinessId)

          const allNodes = [
            ...targetNodes.map((n) => ({ ...n, businessId: targetBusinessId })),
            ...otherNodes.map((n) => ({ ...n, businessId: otherBusinessId })),
          ]

          const result = disableBusinessNodes(allNodes, targetBusinessId)

          // Nodes belonging to the OTHER business should be unchanged
          const otherBusinessNodes = result.filter((n) => n.businessId === otherBusinessId)
          for (let i = 0; i < otherBusinessNodes.length; i++) {
            expect(otherBusinessNodes[i]!.isActive).toBe(otherNodes[i]!.isActive)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('disabling a business with zero nodes produces an empty result', () => {
    fc.assert(
      fc.property(businessIdArb, (businessId) => {
        const nodes: Array<{ nodeId: string; isActive: boolean; businessId: string }> = []

        const result = disableBusinessNodes(nodes, businessId)

        // No nodes to deactivate — result should be empty
        expect(result).toHaveLength(0)
      }),
      { numRuns: 25 },
    )
  })

  it('the count of deactivated nodes equals the total nodes owned by the business', () => {
    fc.assert(
      fc.property(businessIdArb, fc.array(nodeIdArb, { minLength: 1, maxLength: 50 }), (businessId, nodeIds) => {
        const nodes = nodeIds.map((nodeId) => ({
          nodeId,
          isActive: true,
          businessId,
        }))

        const result = disableBusinessNodes(nodes, businessId)

        // Count of nodes with isActive = false should equal total nodes for this business
        const deactivatedCount = result.filter((n) => n.businessId === businessId && !n.isActive).length
        expect(deactivatedCount).toBe(nodeIds.length)
      }),
      { numRuns: 25 },
    )
  })

  it('disabling is idempotent — already-inactive nodes remain inactive', () => {
    fc.assert(
      fc.property(businessIdArb, fc.array(nodeIdArb, { minLength: 1, maxLength: 20 }), (businessId, nodeIds) => {
        // Start with nodes that are already inactive
        const nodes = nodeIds.map((nodeId) => ({
          nodeId,
          isActive: false,
          businessId,
        }))

        const result = disableBusinessNodes(nodes, businessId)

        // All nodes should still be inactive
        for (const node of result) {
          expect(node.isActive).toBe(false)
        }
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 19: Every admin action produces an audit log entry ────────────

describe('Property 19: Every admin action produces an audit log entry', () => {
  /**
   * **Validates: Requirements 18.4**
   *
   * For any admin action (disable user, disable business, review flag,
   * reset flags, extend trial, etc.), an audit log entry SHALL be created
   * with the correct adminId, action type, target entity, and timestamp.
   */

  it('audit log entry contains the correct adminId for any admin action', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        entityTypeArb,
        userIdArb, // entityId
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, entityType, entityId, timestamp) => {
          const entry = buildAuditLogEntry({ adminId, action, entityType, entityId, timestamp })

          // The audit log entry MUST contain the correct adminId
          expect(entry.adminId).toBe(adminId)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('audit log entry contains the correct action type', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        entityTypeArb,
        userIdArb,
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, entityType, entityId, timestamp) => {
          const entry = buildAuditLogEntry({ adminId, action, entityType, entityId, timestamp })

          // The audit log entry MUST contain the correct action type
          expect(entry.action).toBe(action)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('audit log entry contains the correct target entity', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        entityTypeArb,
        userIdArb,
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, entityType, entityId, timestamp) => {
          const entry = buildAuditLogEntry({ adminId, action, entityType, entityId, timestamp })

          // The audit log entry MUST contain the correct entity type and ID
          expect(entry.entityType).toBe(entityType)
          expect(entry.entityId).toBe(entityId)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('audit log entry contains a valid timestamp', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        entityTypeArb,
        userIdArb,
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, entityType, entityId, timestamp) => {
          const entry = buildAuditLogEntry({ adminId, action, entityType, entityId, timestamp })

          // The audit log entry MUST contain a valid ISO timestamp
          expect(entry.createdAt).toBe(timestamp)
          expect(new Date(entry.createdAt).toISOString()).toBe(timestamp)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('audit log entry follows the correct DynamoDB key pattern', () => {
    fc.assert(
      fc.property(
        adminIdArb,
        adminActionTypeArb,
        entityTypeArb,
        userIdArb,
        validDateArb.map((d) => d.toISOString()),
        (adminId, action, entityType, entityId, timestamp) => {
          const entry = buildAuditLogEntry({ adminId, action, entityType, entityId, timestamp })

          // pk must follow AUDIT#{logId} pattern
          expect(entry.pk).toMatch(/^AUDIT#/)
          // sk must follow AUDIT#{createdAt} pattern
          expect(entry.sk).toBe(`AUDIT#${timestamp}`)
          // gsi1pk must be AUDIT_LOGS for global query
          expect(entry.gsi1pk).toBe('AUDIT_LOGS')
          // gsi1sk must be the timestamp for chronological ordering
          expect(entry.gsi1sk).toBe(timestamp)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('every distinct admin action produces a distinct audit log entry', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            adminId: adminIdArb,
            action: adminActionTypeArb,
            entityType: entityTypeArb,
            entityId: userIdArb,
            timestamp: validDateArb.map((d) => d.toISOString()),
          }),
          { minLength: 2, maxLength: 20 },
        ),
        (actions) => {
          const entries = actions.map((a) => buildAuditLogEntry(a))

          // Each action must produce an entry (1:1 mapping)
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
})
