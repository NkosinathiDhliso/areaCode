import { timingSafeEqual } from 'node:crypto'

/**
 * Single source of truth for constant-time comparison of HMAC digests.
 *
 * Compares two digest strings (hex, base64url, etc.) without leaking timing
 * information about how many leading characters matched. `timingSafeEqual`
 * requires equal-length buffers, so unequal-length inputs short-circuit to
 * `false` (a mismatch) rather than throwing.
 *
 * Used by every signature-verification path that would otherwise reach for a
 * `===` string comparison: QR check-in tokens (`check-in/service.ts`,
 * `business/service.ts`), the music OAuth state (`music/service.ts`), and the
 * campaign unsubscribe token (`campaigns/unsubscribe.ts`).
 */
export function digestsEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}
