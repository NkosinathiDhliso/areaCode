/**
 * Yoco webhook signature verification: fail-closed behavior (L2).
 *
 * Validates: Requirements 4.2, 4.4
 *
 * `processYocoWebhook` must never verify a payment webhook against a dev key
 * or an empty string (`no-fallbacks-no-legacy.md`). With an empty secret the
 * HMAC is still a non-empty digest, so a `!expected` guard would not catch it;
 * verification must therefore reject BEFORE computing any HMAC when the secret
 * is absent or empty.
 *
 * Coverage:
 *   1. Secret unset  → rejects (unauthorized) AND no HMAC is computed.
 *   2. Secret empty  → rejects (unauthorized) AND no HMAC is computed.
 *   3. Secret set + valid signature   → passes (no throw).
 *   4. Secret set + invalid signature → rejects (unauthorized).
 *
 * Strategy:
 *   `processYocoWebhook` returns early in DEV_MODE, short-circuiting the whole
 *   verification path. DEV_MODE is a module-level const captured at import
 *   time, so we set `AREA_CODE_FORCE_LIVE` (env still `dev`, so `requireEnv`
 *   keeps its local defaults and nothing crashes at init) in `beforeAll` and
 *   then dynamically import the service — the same pattern as the sibling
 *   `handler.test.ts`.
 *
 *   `node:crypto` is mocked so `createHmac` delegates to the real
 *   implementation but is observable: the "no HMAC over an empty secret"
 *   guarantee is asserted by checking the spy was never called on the
 *   absent/empty-secret paths.
 *
 *   The repository is stubbed so a VALID signature short-circuits on the
 *   idempotency check (an existing event → `{ duplicate: true }`), proving the
 *   signature passed without needing a live DynamoDB connection or the
 *   downstream payment handlers.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// ─── Observable crypto: real HMAC, but call-count is inspectable ────────────
const createHmacSpy = vi.fn()
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  createHmacSpy.mockImplementation((...args: Parameters<typeof actual.createHmac>) => actual.createHmac(...args))
  return { ...actual, createHmac: createHmacSpy }
})

// ─── Repository stub: control the idempotency branch ────────────────────────
const claimWebhookEvent = vi.fn()
const markWebhookEventProcessed = vi.fn()
const markWebhookEventFailed = vi.fn()
vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, claimWebhookEvent, markWebhookEventProcessed, markWebhookEventFailed }
})

const SECRET = 'whsec_test_secret'
const EVENT_ID = 'evt_123'
const EVENT_TYPE = 'payment.succeeded'
// Non-boost payload so the duplicate-event branch does not log a boost audit line.
const PAYLOAD = { id: 'pay_1', amount: 1000 } as const
const RAW_BODY = JSON.stringify(PAYLOAD)

/**
 * Compute the expected signature via the REAL crypto (not the observable spy),
 * so building test fixtures never pollutes the `createHmacSpy` call count that
 * the fail-closed assertions rely on.
 */
async function validSignature(): Promise<string> {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto')
  return actual.createHmac('sha256', SECRET).update(RAW_BODY).digest('hex')
}

let processYocoWebhook: (typeof import('../service.js'))['processYocoWebhook']

beforeAll(async () => {
  // DEV_MODE must be OFF so the verification path actually runs. Env stays
  // `dev` so requireEnv keeps local defaults and nothing crashes at init.
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  ;({ processYocoWebhook } = await import('../service.js'))
})

beforeEach(() => {
  createHmacSpy.mockClear()
  claimWebhookEvent.mockReset()
  markWebhookEventProcessed.mockReset()
  markWebhookEventFailed.mockReset()
  delete process.env['YOCO_WEBHOOK_SECRET']
})

describe('processYocoWebhook signature verification (fail-closed)', () => {
  it('rejects and computes no HMAC when the secret is unset', async () => {
    delete process.env['YOCO_WEBHOOK_SECRET']

    await expect(
      processYocoWebhook(EVENT_ID, EVENT_TYPE, PAYLOAD, await validSignature(), RAW_BODY),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid webhook signature' })

    // Must reject BEFORE hashing: never HMAC over an absent secret.
    expect(createHmacSpy).not.toHaveBeenCalled()
    expect(claimWebhookEvent).not.toHaveBeenCalled()
  })

  it('rejects and computes no HMAC when the secret is an empty string', async () => {
    process.env['YOCO_WEBHOOK_SECRET'] = ''

    await expect(processYocoWebhook(EVENT_ID, EVENT_TYPE, PAYLOAD, 'anything', RAW_BODY)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid webhook signature',
    })

    // An empty secret still yields a non-empty digest, so it must be rejected
    // before any HMAC is computed rather than compared against.
    expect(createHmacSpy).not.toHaveBeenCalled()
    expect(claimWebhookEvent).not.toHaveBeenCalled()
  })

  it('passes for a valid signature when the secret is set', async () => {
    process.env['YOCO_WEBHOOK_SECRET'] = SECRET
    // A processed event proves the signature passed without entering payment handling.
    claimWebhookEvent.mockResolvedValue('processed')

    const result = await processYocoWebhook(EVENT_ID, EVENT_TYPE, PAYLOAD, await validSignature(), RAW_BODY)

    expect(result).toEqual({ duplicate: true })
    expect(createHmacSpy).toHaveBeenCalledTimes(1)
    expect(claimWebhookEvent).toHaveBeenCalledWith(EVENT_ID, EVENT_TYPE)
  })

  it('rejects for an invalid signature when the secret is set', async () => {
    process.env['YOCO_WEBHOOK_SECRET'] = SECRET

    await expect(processYocoWebhook(EVENT_ID, EVENT_TYPE, PAYLOAD, 'deadbeef', RAW_BODY)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid webhook signature',
    })

    // Signature was wrong, verification never reached the idempotency check.
    expect(claimWebhookEvent).not.toHaveBeenCalled()
  })
})
