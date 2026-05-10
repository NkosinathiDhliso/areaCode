/**
 * Yoco Webhook Signature Verification and Timestamp Validation
 *
 * Pure functions with no database or external dependencies — safe to import in tests.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Maximum age (in ms) for a webhook event before it's rejected as stale */
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Verify the HMAC-SHA256 signature of a Yoco webhook request.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @returns true if the signature is valid, false otherwise.
 */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuffer = Buffer.from(signature, 'utf-8')
  const expectedBuffer = Buffer.from(expected, 'utf-8')
  if (sigBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(sigBuffer, expectedBuffer)
}

/**
 * Check whether a webhook event timestamp is within the acceptable tolerance window.
 * Events older than 5 minutes are rejected as potential replay attacks.
 *
 * @returns true if the event is fresh enough, false if stale or invalid.
 */
export function isWebhookTimestampValid(createdDate: string | undefined, now?: Date): boolean {
  if (!createdDate) return false
  const eventTime = new Date(createdDate).getTime()
  if (isNaN(eventTime)) return false
  const currentTime = (now ?? new Date()).getTime()
  return currentTime - eventTime <= WEBHOOK_TIMESTAMP_TOLERANCE_MS
}
