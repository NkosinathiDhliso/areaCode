import type { PiiScanResult } from './types.js'

// ============================================================================
// PII Pattern Definitions
// ============================================================================

// UUID v4 pattern (userId, cognitoSub)
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// South African phone numbers (+27...)
const PHONE_PATTERN = /\+27\d{9,}/

// Email addresses
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

// URL patterns (avatarUrl — S3, CloudFront, or general https URLs with image extensions)
const URL_PATTERN = /https?:\/\/[^\s"',}]+/i

// Field names that indicate PII when they contain string values
const PII_FIELD_NAMES = [
  'userId',
  'cognitoSub',
  'displayName',
  'phone',
  'email',
  'avatarUrl',
]

// ============================================================================
// Scanner Implementation
// ============================================================================

/**
 * Recursively scan a parsed JSON object for PII patterns.
 * Returns field paths where PII was detected.
 */
function scanObject(obj: unknown, path: string, violations: string[]): void {
  if (obj === null || obj === undefined) return

  if (typeof obj === 'string') {
    // Check string values against PII patterns
    if (UUID_PATTERN.test(obj)) {
      violations.push(`${path}: UUID pattern detected`)
    }
    if (PHONE_PATTERN.test(obj)) {
      violations.push(`${path}: phone number pattern detected`)
    }
    if (EMAIL_PATTERN.test(obj)) {
      violations.push(`${path}: email pattern detected`)
    }
    if (URL_PATTERN.test(obj)) {
      violations.push(`${path}: URL pattern detected`)
    }
    return
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      scanObject(obj[i], `${path}[${i}]`, violations)
    }
    return
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fieldPath = path ? `${path}.${key}` : key

      // Check if the field name itself is a known PII field with a string value
      if (PII_FIELD_NAMES.includes(key) && typeof value === 'string' && value.length > 0) {
        violations.push(`${fieldPath}: PII field name with string value`)
      }

      scanObject(value, fieldPath, violations)
    }
  }
}

/**
 * Scan serialized report JSON for known PII patterns.
 *
 * Checks for:
 * - UUID format (userId, cognitoSub)
 * - Phone numbers (+27...)
 * - Email addresses
 * - URL patterns (avatarUrl)
 * - displayName-like strings in specific field paths
 *
 * @returns { clean: boolean, violations: string[] }
 */
export function scanForPii(reportJson: string): PiiScanResult {
  const violations: string[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(reportJson)
  } catch {
    // If JSON is invalid, we can't scan it — treat as clean
    // (validation should catch malformed JSON separately)
    return { clean: true, violations: [] }
  }

  scanObject(parsed, '', violations)

  // Deduplicate violations
  const uniqueViolations = [...new Set(violations)]

  return {
    clean: uniqueViolations.length === 0,
    violations: uniqueViolations,
  }
}
