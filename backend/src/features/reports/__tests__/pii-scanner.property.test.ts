import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { scanForPii } from '../pii-scanner'

/**
 * Property 5: PII Scanner Correctness
 *
 * For any JSON document, if the document contains a value matching a known
 * PII pattern (UUID userId, cognitoSub, displayName string, phone number,
 * email address, or avatarUrl), the PII scanner SHALL report it as not clean.
 * Conversely, if the document contains only anonymized aggregated data
 * (hashed tokens, counts, percentages, venue names), the scanner SHALL
 * report it as clean.
 *
 * **Validates: Requirements 3.3, 5.3, 13.1, 13.2**
 */

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a valid UUID v4 */
const uuidArb = fc.uuid()

/** Generate a South African phone number (+27...) */
const saPhoneArb = fc
  .array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 9, maxLength: 9 })
  .map((digits) => `+27${digits.join('')}`)

/** Generate a valid email address */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
    fc.constantFrom('com', 'co.za', 'org', 'net'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)

/** Generate a URL (avatarUrl pattern) */
const urlArb = fc
  .tuple(
    fc.constantFrom('https://s3.amazonaws.com', 'https://cdn.example.com', 'https://images.areacode.co.za'),
    fc.stringMatching(/^\/[a-z]{3,10}\/[a-z]{3,10}\.(jpg|png)$/),
  )
  .map(([base, path]) => `${base}${path}`)

/** Generate a clean aggregated-data-only document (no PII) */
const cleanDocArb = fc.record({
  totalCheckIns: fc.integer({ min: 0, max: 10000 }),
  uniqueVisitors: fc.integer({ min: 0, max: 5000 }),
  repeatRate: fc.double({ min: 0, max: 100, noNaN: true }).map((v) => Math.round(v * 100) / 100),
  peakDay: fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
  tierPercentages: fc.record({
    local: fc.double({ min: 0, max: 100, noNaN: true }).map((v) => Math.round(v * 100) / 100),
    regular: fc.double({ min: 0, max: 100, noNaN: true }).map((v) => Math.round(v * 100) / 100),
    fixture: fc.double({ min: 0, max: 100, noNaN: true }).map((v) => Math.round(v * 100) / 100),
  }),
  venueName: fc.constantFrom('The Rooftop Bar', 'Cafe Mocha', 'Jazz Corner'),
  pulseState: fc.constantFrom('dormant', 'quiet', 'active', 'buzzing', 'popping'),
  hourlyDistribution: fc.record({
    '0': fc.integer({ min: 0, max: 100 }),
    '12': fc.integer({ min: 0, max: 100 }),
    '18': fc.integer({ min: 0, max: 100 }),
  }),
})

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: venue-intelligence-reports, Property 5: PII Scanner Correctness', () => {
  it('documents containing a UUID are flagged as not clean', () => {
    fc.assert(
      fc.property(uuidArb, (uuid) => {
        const doc = JSON.stringify({ userId: uuid, count: 42 })
        const result = scanForPii(doc)
        expect(result.clean).toBe(false)
        expect(result.violations.length).toBeGreaterThan(0)
      }),
      { numRuns: 25 },
    )
  })

  it('documents containing a phone number (+27...) are flagged as not clean', () => {
    fc.assert(
      fc.property(saPhoneArb, (phone) => {
        const doc = JSON.stringify({ phone, totalCheckIns: 10 })
        const result = scanForPii(doc)
        expect(result.clean).toBe(false)
        expect(result.violations.some((v) => v.includes('phone'))).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('documents containing an email address are flagged as not clean', () => {
    fc.assert(
      fc.property(emailArb, (email) => {
        const doc = JSON.stringify({ email, peakDay: 'Monday' })
        const result = scanForPii(doc)
        expect(result.clean).toBe(false)
        expect(result.violations.some((v) => v.includes('email'))).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('documents containing a URL (avatarUrl) are flagged as not clean', () => {
    fc.assert(
      fc.property(urlArb, (url) => {
        const doc = JSON.stringify({ avatarUrl: url, count: 5 })
        const result = scanForPii(doc)
        expect(result.clean).toBe(false)
        expect(result.violations.length).toBeGreaterThan(0)
      }),
      { numRuns: 25 },
    )
  })

  it('documents containing a displayName PII field are flagged as not clean', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (name) => {
        const doc = JSON.stringify({ displayName: name, totalCheckIns: 10 })
        const result = scanForPii(doc)
        expect(result.clean).toBe(false)
        expect(result.violations.some((v) => v.includes('displayName'))).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('documents with only aggregated data (counts, percentages, venue names) are clean', () => {
    fc.assert(
      fc.property(cleanDocArb, (doc) => {
        const json = JSON.stringify(doc)
        const result = scanForPii(json)
        expect(result.clean).toBe(true)
        expect(result.violations).toEqual([])
      }),
      { numRuns: 25 },
    )
  })

  it('deeply nested PII is still detected', () => {
    fc.assert(
      fc.property(uuidArb, (uuid) => {
        const doc = JSON.stringify({
          report: {
            sections: {
              visitors: [{ userId: uuid, count: 1 }],
            },
          },
        })
        const result = scanForPii(doc)
        expect(result.clean).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  // Structural identifiers (reportId/businessId/nodeId) are legitimately
  // UUID-shaped but are not personal data. They must not be treated as PII, or
  // every report (which carries its own randomUUID reportId, businessId, and
  // node ids) would be wrongly flagged and skipped.
  it('structural identifier fields (reportId/businessId/nodeId) with UUID values are clean', () => {
    fc.assert(
      fc.property(uuidArb, uuidArb, uuidArb, (reportId, businessId, nodeId) => {
        const doc = JSON.stringify({
          reportId,
          businessId,
          nodes: [{ nodeId, nodeName: 'The Rooftop Bar' }],
          summary: { totalCheckIns: 42, pulseState: 'buzzing' },
        })
        const result = scanForPii(doc)
        expect(result.clean).toBe(true)
        expect(result.violations).toEqual([])
      }),
      { numRuns: 25 },
    )
  })

  it('a person UUID (userId) is still flagged even alongside allowed structural ids', () => {
    fc.assert(
      fc.property(uuidArb, uuidArb, (reportId, userId) => {
        const doc = JSON.stringify({ reportId, leaked: { userId } })
        const result = scanForPii(doc)
        expect(result.clean).toBe(false)
        expect(result.violations.length).toBeGreaterThan(0)
      }),
      { numRuns: 25 },
    )
  })
})
