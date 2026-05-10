/**
 * Property 15: Resource Ownership Enforcement
 *
 * For any authenticated business B and resource R (node, reward, boost, billing record, boost ROI),
 * the API SHALL return the resource if and only if `R.businessId === B.id`.
 * For any staff member S and node N, access SHALL be granted if and only if
 * `S.businessId === N.businessId`. Violations SHALL return HTTP 403.
 *
 * **Validates: Requirements 22.1, 22.2, 22.3, 22.4**
 *
 * Property 16: Admin Role Authorization
 *
 * For any admin user with role R and action A requiring minimum role level L,
 * access SHALL be granted if and only if `roleLevel(R) >= roleLevel(L)` where
 * roleLevel(super_admin) > roleLevel(support_agent) > roleLevel(content_moderator).
 *
 * **Validates: Requirements 22.5**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  verifyBusinessOwnership,
  verifyStaffBusinessLinkage,
  verifyAdminRoleLevel,
  getRoleLevel,
  ADMIN_ROLE_LEVELS,
} from '../../shared/middleware/ownership.js'
import {
  checkPermission,
  ROLE_PERMISSIONS,
  ADMIN_ROLE_LEVELS as PERM_ROLE_LEVELS,
  DESTRUCTIVE_ACTION_MIN_ROLES,
} from '../../features/admin/permissions.js'
import type { AdminRole } from '../../features/admin/types.js'

describe('Property 15: Resource Ownership Enforcement', () => {
  const businessIdArb = fc.uuid()

  it('grants access when resource.businessId === authenticatedBusiness.id', async () => {
    await fc.assert(
      fc.property(businessIdArb, (businessId) => {
        // Same businessId should NOT throw
        expect(() => verifyBusinessOwnership(businessId, businessId)).not.toThrow()
      }),
      { numRuns: 100 },
    )
  })

  it('returns 403 when resource.businessId !== authenticatedBusiness.id', async () => {
    await fc.assert(
      fc.property(businessIdArb, businessIdArb, (resourceBusinessId, authenticatedBusinessId) => {
        // Only test when IDs are different
        fc.pre(resourceBusinessId !== authenticatedBusinessId)

        try {
          verifyBusinessOwnership(resourceBusinessId, authenticatedBusinessId)
          // Should not reach here
          expect.fail('Expected AppError.forbidden to be thrown')
        } catch (err: unknown) {
          const error = err as { statusCode?: number; error?: string }
          expect(error.statusCode).toBe(403)
          expect(error.error).toBe('forbidden')
        }
      }),
      { numRuns: 100 },
    )
  })

  it('staff-to-business linkage grants access when S.businessId === N.businessId', async () => {
    await fc.assert(
      fc.property(businessIdArb, (businessId) => {
        // Same businessId should NOT throw
        expect(() => verifyStaffBusinessLinkage(businessId, businessId)).not.toThrow()
      }),
      { numRuns: 100 },
    )
  })

  it('staff-to-business linkage returns 403 when S.businessId !== N.businessId', async () => {
    await fc.assert(
      fc.property(businessIdArb, businessIdArb, (staffBusinessId, nodeBusinessId) => {
        // Only test when IDs are different
        fc.pre(staffBusinessId !== nodeBusinessId)

        try {
          verifyStaffBusinessLinkage(staffBusinessId, nodeBusinessId)
          expect.fail('Expected AppError.forbidden to be thrown')
        } catch (err: unknown) {
          const error = err as { statusCode?: number; error?: string }
          expect(error.statusCode).toBe(403)
          expect(error.error).toBe('forbidden')
        }
      }),
      { numRuns: 100 },
    )
  })

  it('ownership check is symmetric — if A owns R, then R belongs to A', async () => {
    await fc.assert(
      fc.property(businessIdArb, businessIdArb, (id1, id2) => {
        const shouldPass = id1 === id2
        if (shouldPass) {
          expect(() => verifyBusinessOwnership(id1, id2)).not.toThrow()
          expect(() => verifyBusinessOwnership(id2, id1)).not.toThrow()
        } else {
          expect(() => verifyBusinessOwnership(id1, id2)).toThrow()
          expect(() => verifyBusinessOwnership(id2, id1)).toThrow()
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('Property 16: Admin Role Authorization', () => {
  const adminRoles: AdminRole[] = ['super_admin', 'support_agent', 'content_moderator']
  const adminRoleArb = fc.constantFrom(...adminRoles)
  const userIdArb = fc.uuid()

  it('role hierarchy is strictly ordered: super_admin > support_agent > content_moderator', () => {
    expect(getRoleLevel('super_admin')).toBeGreaterThan(getRoleLevel('support_agent'))
    expect(getRoleLevel('support_agent')).toBeGreaterThan(getRoleLevel('content_moderator'))
    expect(getRoleLevel('super_admin')).toBe(3)
    expect(getRoleLevel('support_agent')).toBe(2)
    expect(getRoleLevel('content_moderator')).toBe(1)
  })

  it('access is granted if and only if roleLevel(R) >= roleLevel(L)', async () => {
    await fc.assert(
      fc.property(adminRoleArb, adminRoleArb, userIdArb, (userRole, requiredRole, userId) => {
        const userLevel = getRoleLevel(userRole)
        const requiredLevel = getRoleLevel(requiredRole)
        const resource = 'test-resource'

        if (userLevel >= requiredLevel) {
          // Should NOT throw
          expect(() => verifyAdminRoleLevel(userId, userRole, requiredRole, resource)).not.toThrow()
        } else {
          // Should throw 403
          try {
            verifyAdminRoleLevel(userId, userRole, requiredRole, resource)
            expect.fail('Expected AppError.forbidden to be thrown')
          } catch (err: unknown) {
            const error = err as { statusCode?: number; error?: string }
            expect(error.statusCode).toBe(403)
            expect(error.error).toBe('forbidden')
          }
        }
      }),
      { numRuns: 100 },
    )
  })

  it('super_admin can perform all actions that any role can perform', async () => {
    const allActions = new Set<string>()
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const action of perms) {
        allActions.add(action)
      }
    }
    const allActionsArr = [...allActions]
    const actionArb = fc.constantFrom(...allActionsArr)

    await fc.assert(
      fc.property(actionArb, (action) => {
        // super_admin should always have permission
        expect(() => checkPermission('super_admin', action)).not.toThrow()
      }),
      { numRuns: 100 },
    )
  })

  it('content_moderator cannot perform actions requiring higher role levels', async () => {
    // Actions that require support_agent or super_admin level
    const higherLevelActions = Object.entries(DESTRUCTIVE_ACTION_MIN_ROLES)
      .filter(([_, minRole]) => PERM_ROLE_LEVELS[minRole] > PERM_ROLE_LEVELS['content_moderator'])
      .map(([action]) => action)
      // Only include actions that content_moderator doesn't have in their permission set
      .filter((action) => !ROLE_PERMISSIONS['content_moderator'].has(action))

    if (higherLevelActions.length === 0) return

    const actionArb = fc.constantFrom(...higherLevelActions)

    await fc.assert(
      fc.property(actionArb, (action) => {
        try {
          checkPermission('content_moderator', action)
          expect.fail('Expected AppError.forbidden to be thrown')
        } catch (err: unknown) {
          const error = err as { statusCode?: number; error?: string }
          expect(error.statusCode).toBe(403)
          expect(error.error).toBe('forbidden')
        }
      }),
      { numRuns: 100 },
    )
  })

  it('role level function returns 0 for unknown roles', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter(
          (s) => !adminRoles.includes(s as AdminRole) && !['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'toLocaleString', 'isPrototypeOf', 'propertyIsEnumerable'].includes(s),
        ),
        (unknownRole) => {
          expect(getRoleLevel(unknownRole)).toBe(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('super_admin permissions are a superset of all other roles combined', async () => {
    // super_admin should have every permission that any role has
    const allPermissions = new Set<string>()
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const action of perms) {
        allPermissions.add(action)
      }
    }

    await fc.assert(
      fc.property(
        fc.constantFrom(...[...allPermissions]),
        (action) => {
          expect(ROLE_PERMISSIONS['super_admin'].has(action)).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })
})
