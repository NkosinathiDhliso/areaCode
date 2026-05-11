import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Property 1: Delta Response Completeness and Precision
 *
 * For any set of node records with varying `signalUpdatedAt` timestamps and any
 * `since` timestamp, the delta endpoint SHALL return exactly those nodes whose
 * `signalUpdatedAt` is strictly greater than `since`, and SHALL not include any
 * node whose `signalUpdatedAt` is less than or equal to `since`.
 *
 * **Validates: Requirements 1.6, 12.4**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */

// ─── Pure filter logic (mirrors the DynamoDB GSI key condition) ─────────────

interface NodeRecord {
  nodeId: string
  signalUpdatedAt: string // ISO 8601
}

/**
 * Replicates the delta endpoint's core filtering logic:
 * `cityId = :city AND signalUpdatedAt > :since`
 *
 * Given a set of node records and a `since` timestamp, returns only those
 * nodes whose signalUpdatedAt is strictly greater than since.
 */
function filterNodesDelta(nodes: NodeRecord[], since: string): NodeRecord[] {
  return nodes.filter((node) => node.signalUpdatedAt > since)
}

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

/** Generate a random ISO timestamp within a reasonable range */
const isoTimestampArb = fc
  .integer({
    min: new Date('2024-01-01T00:00:00.000Z').getTime(),
    max: new Date('2026-12-31T23:59:59.999Z').getTime(),
  })
  .map((ts) => new Date(ts).toISOString())

/** Generate a node record with a random nodeId and signalUpdatedAt */
const nodeRecordArb: fc.Arbitrary<NodeRecord> = fc.record({
  nodeId: fc.uuid(),
  signalUpdatedAt: isoTimestampArb,
})

/** Generate an array of node records (0 to 50 nodes) */
const nodeArrayArb = fc.array(nodeRecordArb, { minLength: 0, maxLength: 50 })

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: venue-live-signals, Property 1: Delta Response Completeness and Precision', () => {
  it('returns exactly nodes with signalUpdatedAt > since, none with <= since', () => {
    fc.assert(
      fc.property(nodeArrayArb, isoTimestampArb, (nodes, since) => {
        const result = filterNodesDelta(nodes, since)

        // Completeness: every node with signalUpdatedAt > since MUST be in the result
        const expectedNodes = nodes.filter((n) => n.signalUpdatedAt > since)
        expect(result).toHaveLength(expectedNodes.length)

        for (const expected of expectedNodes) {
          expect(result).toContainEqual(expected)
        }

        // Precision: no node in the result should have signalUpdatedAt <= since
        for (const node of result) {
          expect(node.signalUpdatedAt > since).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('returns empty array when all nodes have signalUpdatedAt <= since', () => {
    fc.assert(
      fc.property(nodeArrayArb, (nodes) => {
        // Use a since value that is guaranteed to be after all node timestamps
        const since = '2099-12-31T23:59:59.999Z'
        const result = filterNodesDelta(nodes, since)

        expect(result).toHaveLength(0)
      }),
      { numRuns: 100 },
    )
  })

  it('returns all nodes when since is before all signalUpdatedAt values', () => {
    fc.assert(
      fc.property(nodeArrayArb, (nodes) => {
        // Use a since value that is guaranteed to be before all node timestamps
        const since = '2000-01-01T00:00:00.000Z'
        const result = filterNodesDelta(nodes, since)

        expect(result).toHaveLength(nodes.length)
        for (const node of nodes) {
          expect(result).toContainEqual(node)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('nodes with signalUpdatedAt exactly equal to since are excluded', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }),
        isoTimestampArb,
        (nodeIds, since) => {
          // Create nodes where some have signalUpdatedAt exactly equal to since
          const nodes: NodeRecord[] = nodeIds.map((id) => ({
            nodeId: id,
            signalUpdatedAt: since,
          }))

          const result = filterNodesDelta(nodes, since)

          // All nodes have signalUpdatedAt === since, so none should be returned
          expect(result).toHaveLength(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('preserves node data integrity — returned nodes are unmodified', () => {
    fc.assert(
      fc.property(nodeArrayArb, isoTimestampArb, (nodes, since) => {
        const result = filterNodesDelta(nodes, since)

        // Every returned node must be an exact reference from the original array
        for (const returnedNode of result) {
          const original = nodes.find(
            (n) => n.nodeId === returnedNode.nodeId && n.signalUpdatedAt === returnedNode.signalUpdatedAt,
          )
          expect(original).toBeDefined()
          expect(returnedNode).toEqual(original)
        }
      }),
      { numRuns: 100 },
    )
  })
})
