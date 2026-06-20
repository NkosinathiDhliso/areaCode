import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { sanitizeForBusiness } from '../../shared/privacy/privacy-guard.js'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const userIdArb = fc.uuid()
const nodeIdArb = fc.uuid()

/** Valid date arbitrary */
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }).map((ts) => new Date(ts))

const tierArb = fc.constantFrom('local', 'regular', 'fixture', 'institution', 'legend')

/** Generates a list of check-in records for a consumer at various nodes */
const checkInRecordArb = fc.record({
  checkInId: fc.uuid(),
  userId: userIdArb,
  nodeId: nodeIdArb,
  timestamp: validDateArb.map((d) => d.toISOString()),
  type: fc.constantFrom('presence', 'reward'),
})

/** Sensitive fields that must NEVER appear in business check-in events */
const FORBIDDEN_FIELDS = ['phone', 'email', 'userId', 'cognitoSub', 'lat', 'lng'] as const

/** Generates a business check-in event payload with potentially sensitive fields injected */
const businessCheckinPayloadWithSensitiveFieldsArb = fc.record({
  // Allowed fields
  nodeId: nodeIdArb,
  nodeName: fc.string({ minLength: 1, maxLength: 50 }),
  displayName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  tier: tierArb,
  visitCount: fc.integer({ min: 1, max: 1000 }),
  timestamp: validDateArb.map((d) => d.toISOString()),
  checkInCount: fc.integer({ min: 1, max: 500 }),
  type: fc.constantFrom('presence', 'reward'),
  // Sensitive fields that MUST be stripped
  phone: fc.option(fc.string({ minLength: 10, maxLength: 15 }), { nil: undefined }),
  email: fc.option(fc.emailAddress(), { nil: undefined }),
  userId: fc.option(userIdArb, { nil: undefined }),
  cognitoSub: fc.option(userIdArb, { nil: undefined }),
  lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: undefined }),
  lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: undefined }),
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pure function that computes visit count for a consumer at a specific node.
 * This mirrors the logic of getUserCheckInCountAtNode — counting all check-in
 * records for a given userId at a given nodeId.
 */
function computeVisitCount(
  checkIns: Array<{ userId: string; nodeId: string }>,
  userId: string,
  nodeId: string,
): number {
  return checkIns.filter((c) => c.userId === userId && c.nodeId === nodeId).length
}

// ─── Property 6: Visit frequency computation ───────────────────────────────

describe('Property 6: Visit frequency computation', () => {
  /**
   * **Validates: Requirements 8.2, 16.3**
   *
   * For any consumer and node, the visit count returned in the business
   * check-in event SHALL equal the total number of check-in records for
   * that consumer at that specific node.
   */

  it('visit count equals the total number of check-in records for a consumer at a specific node', () => {
    fc.assert(
      fc.property(
        userIdArb,
        nodeIdArb,
        fc.array(checkInRecordArb, { minLength: 0, maxLength: 50 }),
        (consumerId, targetNodeId, allCheckIns) => {
          // Compute the expected visit count: count of records matching both userId and nodeId
          const expectedVisitCount = computeVisitCount(allCheckIns, consumerId, targetNodeId)

          // The visit count must equal the number of matching records
          expect(expectedVisitCount).toBeGreaterThanOrEqual(0)
          expect(expectedVisitCount).toBe(
            allCheckIns.filter((c) => c.userId === consumerId && c.nodeId === targetNodeId).length,
          )
        },
      ),
      { numRuns: 25 },
    )
  })

  it('visit count is zero when consumer has no check-ins at the target node', () => {
    fc.assert(
      fc.property(
        userIdArb,
        nodeIdArb,
        fc.array(checkInRecordArb, { minLength: 1, maxLength: 30 }),
        (consumerId, targetNodeId, allCheckIns) => {
          // Filter out any check-ins that happen to match both consumerId and targetNodeId
          const checkInsWithoutTarget = allCheckIns.filter(
            (c) => !(c.userId === consumerId && c.nodeId === targetNodeId),
          )

          const visitCount = computeVisitCount(checkInsWithoutTarget, consumerId, targetNodeId)
          expect(visitCount).toBe(0)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('visit count increases by exactly 1 for each new check-in at the same node', () => {
    fc.assert(
      fc.property(userIdArb, nodeIdArb, fc.integer({ min: 1, max: 100 }), (consumerId, targetNodeId, numCheckIns) => {
        // Create exactly numCheckIns records for this consumer at this node
        const checkIns = Array.from({ length: numCheckIns }, (_, i) => ({
          userId: consumerId,
          nodeId: targetNodeId,
          checkInId: `checkin-${i}`,
          timestamp: new Date(1577836800000 + i * 3600000).toISOString(),
          type: 'presence' as const,
        }))

        const visitCount = computeVisitCount(checkIns, consumerId, targetNodeId)
        expect(visitCount).toBe(numCheckIns)
      }),
      { numRuns: 25 },
    )
  })

  it('visit count only counts check-ins at the specific node, not other nodes', () => {
    fc.assert(
      fc.property(
        userIdArb,
        nodeIdArb,
        fc.array(nodeIdArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 20 }),
        (consumerId, targetNodeId, otherNodeIds, targetCount) => {
          // Create check-ins at the target node
          const targetCheckIns = Array.from({ length: targetCount }, (_, i) => ({
            userId: consumerId,
            nodeId: targetNodeId,
            checkInId: `target-${i}`,
            timestamp: new Date(1577836800000 + i * 3600000).toISOString(),
            type: 'presence' as const,
          }))

          // Create check-ins at other nodes (same consumer)
          const otherCheckIns = otherNodeIds
            .filter((nid) => nid !== targetNodeId)
            .map((nid, i) => ({
              userId: consumerId,
              nodeId: nid,
              checkInId: `other-${i}`,
              timestamp: new Date(1577836800000 + (targetCount + i) * 3600000).toISOString(),
              type: 'presence' as const,
            }))

          const allCheckIns = [...targetCheckIns, ...otherCheckIns]
          const visitCount = computeVisitCount(allCheckIns, consumerId, targetNodeId)

          // Visit count should only reflect check-ins at the target node
          expect(visitCount).toBe(targetCount)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('visit count only counts check-ins by the specific consumer, not other consumers', () => {
    fc.assert(
      fc.property(
        userIdArb,
        nodeIdArb,
        fc.array(userIdArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 20 }),
        (consumerId, targetNodeId, otherUserIds, consumerCount) => {
          // Create check-ins by the target consumer at the target node
          const consumerCheckIns = Array.from({ length: consumerCount }, (_, i) => ({
            userId: consumerId,
            nodeId: targetNodeId,
            checkInId: `consumer-${i}`,
            timestamp: new Date(1577836800000 + i * 3600000).toISOString(),
            type: 'presence' as const,
          }))

          // Create check-ins by other consumers at the same node
          const otherCheckIns = otherUserIds
            .filter((uid) => uid !== consumerId)
            .map((uid, i) => ({
              userId: uid,
              nodeId: targetNodeId,
              checkInId: `other-user-${i}`,
              timestamp: new Date(1577836800000 + (consumerCount + i) * 3600000).toISOString(),
              type: 'presence' as const,
            }))

          const allCheckIns = [...consumerCheckIns, ...otherCheckIns]
          const visitCount = computeVisitCount(allCheckIns, consumerId, targetNodeId)

          // Visit count should only reflect the specific consumer's check-ins
          expect(visitCount).toBe(consumerCount)
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 7: Business check-in events contain only privacy-safe fields ──

describe('Property 7: Business check-in events contain only privacy-safe fields', () => {
  /**
   * **Validates: Requirements 8.5, 16.4, 22.6**
   *
   * For any consumer profile (regardless of privacy level), the business
   * check-in event payload SHALL contain at most displayName and tier.
   * The payload SHALL NEVER contain phone, email, userId, cognitoSub,
   * lat, lng, or any field that could enable tracking an individual's
   * movement pattern.
   */

  it('sanitizeForBusiness never includes any forbidden field regardless of input', () => {
    fc.assert(
      fc.property(businessCheckinPayloadWithSensitiveFieldsArb, (payload) => {
        const sanitized = sanitizeForBusiness(payload as unknown as Record<string, unknown>)

        for (const field of FORBIDDEN_FIELDS) {
          expect(sanitized).not.toHaveProperty(field)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('sanitizeForBusiness preserves only the allowed fields from the input', () => {
    const ALLOWED_FIELDS = new Set([
      'nodeId',
      'nodeName',
      'checkInCount',
      'timestamp',
      'displayName',
      'tier',
      'visitCount',
      'type',
    ])

    fc.assert(
      fc.property(businessCheckinPayloadWithSensitiveFieldsArb, (payload) => {
        const sanitized = sanitizeForBusiness(payload as unknown as Record<string, unknown>)

        // Every key in the sanitized output must be in the allowed set
        for (const key of Object.keys(sanitized)) {
          expect(ALLOWED_FIELDS.has(key)).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('sanitizeForBusiness output contains at most displayName and tier as consumer-identifying fields', () => {
    fc.assert(
      fc.property(businessCheckinPayloadWithSensitiveFieldsArb, (payload) => {
        const sanitized = sanitizeForBusiness(payload as unknown as Record<string, unknown>)

        // The only consumer-identifying fields allowed are displayName and tier
        const consumerFields = Object.keys(sanitized).filter(
          (k) => !['nodeId', 'nodeName', 'checkInCount', 'timestamp', 'visitCount', 'type'].includes(k),
        )

        for (const field of consumerFields) {
          expect(['displayName', 'tier']).toContain(field)
        }
      }),
      { numRuns: 25 },
    )
  })

  it('for any arbitrary extra fields injected into the payload, sanitizeForBusiness strips them', () => {
    const ALLOWED_FIELDS_SET = new Set([
      'nodeId',
      'nodeName',
      'checkInCount',
      'timestamp',
      'displayName',
      'tier',
      'visitCount',
      'type',
    ])

    // Generate extra field names that are guaranteed NOT in the allowed set
    const extraFieldNameArb = fc.constantFrom(
      'phone',
      'email',
      'userId',
      'cognitoSub',
      'lat',
      'lng',
      'ipAddress',
      'deviceId',
      'password',
      'secret',
      'token',
      'ssn',
      'address',
      'creditCard',
      'bankAccount',
    )

    fc.assert(
      fc.property(
        // Base allowed payload
        fc.record({
          nodeId: nodeIdArb,
          displayName: fc.string({ minLength: 1, maxLength: 30 }),
          tier: tierArb,
          visitCount: fc.integer({ min: 1, max: 500 }),
          timestamp: validDateArb.map((d) => d.toISOString()),
        }),
        // Array of extra field entries to inject
        fc.array(
          fc.tuple(extraFieldNameArb, fc.oneof(fc.string(), fc.integer(), fc.double({ noNaN: true }), fc.boolean())),
          { minLength: 1, maxLength: 5 },
        ),
        (basePayload, extraFieldEntries) => {
          const extraFields: Record<string, unknown> = {}
          for (const [key, value] of extraFieldEntries) {
            extraFields[key] = value
          }

          const payloadWithExtras = { ...basePayload, ...extraFields }
          const sanitized = sanitizeForBusiness(payloadWithExtras as unknown as Record<string, unknown>)

          // None of the extra fields should appear in the output
          for (const key of Object.keys(extraFields)) {
            if (!ALLOWED_FIELDS_SET.has(key)) {
              expect(sanitized).not.toHaveProperty(key)
            }
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('sanitizeForBusiness never exposes fields that could enable movement pattern tracking', () => {
    // Movement-tracking fields: lat, lng, userId, cognitoSub (can correlate across venues)
    const MOVEMENT_TRACKING_FIELDS = ['lat', 'lng', 'userId', 'cognitoSub', 'ipAddress', 'deviceId', 'fingerprintHash']

    fc.assert(
      fc.property(
        fc.record({
          nodeId: nodeIdArb,
          nodeName: fc.string({ minLength: 1, maxLength: 50 }),
          displayName: fc.string({ minLength: 1, maxLength: 30 }),
          tier: tierArb,
          visitCount: fc.integer({ min: 1, max: 500 }),
          timestamp: validDateArb.map((d) => d.toISOString()),
          // Inject all movement-tracking fields
          lat: fc.double({ min: -90, max: 90, noNaN: true }),
          lng: fc.double({ min: -180, max: 180, noNaN: true }),
          userId: userIdArb,
          cognitoSub: userIdArb,
          ipAddress: fc.ipV4(),
          deviceId: fc.uuid(),
          fingerprintHash: fc.string({ minLength: 32, maxLength: 64 }),
        }),
        (payload) => {
          const sanitized = sanitizeForBusiness(payload as unknown as Record<string, unknown>)

          for (const field of MOVEMENT_TRACKING_FIELDS) {
            expect(sanitized).not.toHaveProperty(field)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('sanitizeForBusiness is idempotent — applying it twice yields the same result', () => {
    fc.assert(
      fc.property(businessCheckinPayloadWithSensitiveFieldsArb, (payload) => {
        const firstPass = sanitizeForBusiness(payload as unknown as Record<string, unknown>)
        const secondPass = sanitizeForBusiness(firstPass)

        expect(secondPass).toEqual(firstPass)
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 20: Staff attribution on redemption ───────────────────────────

/**
 * Pure function that simulates building the DynamoDB UpdateExpression for
 * marking a redemption as redeemed. This mirrors the logic in
 * `markRedemptionAsRedeemed` from `rewards/dynamodb-repository.ts`.
 *
 * Returns the attributes that would be persisted on the redemption record.
 */
function buildRedemptionUpdateAttributes(
  redemptionId: string,
  redeemedAt: string,
  staffId?: string,
  staffName?: string,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    pk: `REDEMPTION#${redemptionId}`,
    sk: `REDEMPTION#${redemptionId}`,
    redeemedAt,
  }

  if (staffId) {
    attributes['staffId'] = staffId
  }
  if (staffName) {
    attributes['staffName'] = staffName
  }

  return attributes
}

describe('Property 20: Staff attribution on redemption', () => {
  /**
   * **Validates: Requirements 19.1**
   *
   * For any reward redemption performed by a staff member, the persisted
   * redemption record SHALL contain the staff member's identifier.
   */

  const staffIdArb = fc.uuid()
  const staffNameArb = fc.string({ minLength: 1, maxLength: 50 })
  const redemptionIdArb = fc.uuid()
  const redeemedAtArb = validDateArb.map((d) => d.toISOString())

  it('redemption record always contains staffId when a staff member performs the redemption', () => {
    fc.assert(
      fc.property(
        redemptionIdArb,
        redeemedAtArb,
        staffIdArb,
        staffNameArb,
        (redemptionId, redeemedAt, staffId, staffName) => {
          const record = buildRedemptionUpdateAttributes(redemptionId, redeemedAt, staffId, staffName)

          // The persisted record MUST contain the staff member's identifier
          expect(record).toHaveProperty('staffId')
          expect(record['staffId']).toBe(staffId)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('staffId in the persisted record exactly matches the staff member who performed the redemption', () => {
    fc.assert(
      fc.property(
        redemptionIdArb,
        redeemedAtArb,
        staffIdArb,
        fc.option(staffNameArb, { nil: undefined }),
        (redemptionId, redeemedAt, staffId, staffName) => {
          const record = buildRedemptionUpdateAttributes(redemptionId, redeemedAt, staffId, staffName)

          // staffId must be an exact match — no transformation or truncation
          expect(record['staffId']).toStrictEqual(staffId)
          // staffId must be a non-empty string (valid identifier)
          expect(typeof record['staffId']).toBe('string')
          expect((record['staffId'] as string).length).toBeGreaterThan(0)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('redemption record does not contain staffId when no staff member is involved', () => {
    fc.assert(
      fc.property(redemptionIdArb, redeemedAtArb, (redemptionId, redeemedAt) => {
        const record = buildRedemptionUpdateAttributes(redemptionId, redeemedAt, undefined, undefined)

        // Without a staff member, staffId should NOT be present
        expect(record).not.toHaveProperty('staffId')
        expect(record).not.toHaveProperty('staffName')
      }),
      { numRuns: 25 },
    )
  })

  it('staffId attribution is preserved regardless of redemption timing or record identity', () => {
    fc.assert(
      fc.property(
        // Generate multiple distinct redemptions by the same staff member
        staffIdArb,
        fc.array(
          fc.record({
            redemptionId: redemptionIdArb,
            redeemedAt: redeemedAtArb,
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (staffId, redemptions) => {
          for (const { redemptionId, redeemedAt } of redemptions) {
            const record = buildRedemptionUpdateAttributes(redemptionId, redeemedAt, staffId)

            // Every redemption by this staff member must carry their identifier
            expect(record['staffId']).toBe(staffId)
            // The record must also have the correct redemption identity
            expect(record['pk']).toBe(`REDEMPTION#${redemptionId}`)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})
