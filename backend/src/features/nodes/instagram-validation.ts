/**
 * Pure validation function for Instagram handles.
 * Separated from routes to enable property-based testing without DynamoDB dependencies.
 */

/**
 * Validates an Instagram handle.
 * Accepts alphanumeric + underscores + periods, max 30 chars.
 * Strips leading @ if present.
 */
export function validateInstagramHandle(input: string): { valid: boolean; handle: string } {
  const stripped = input.replace(/^@/, '').trim()
  if (stripped === '') return { valid: true, handle: '' }
  const valid = /^[a-zA-Z0-9_.]{1,30}$/.test(stripped)
  return { valid, handle: stripped }
}
