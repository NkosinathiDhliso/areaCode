/**
 * Helpers that reach into the API to provision and clean up data the
 * UI needs for a test (e.g. a venue with a known QR code, a published
 * reward). These call admin/business endpoints via apiAs().
 *
 * Keep these small and explicit. If a helper grows beyond ~30 lines,
 * promote it to its own file under support/.
 */

import type { APIRequestContext } from '@playwright/test'

export type SeedVenue = {
  id: string
  slug: string
  name: string
  qrCode?: string
}

export type SeedReward = {
  id: string
  title: string
  redemptionCode?: string
}

/**
 * Returns the first node from the public city listing — good enough for
 * tests that just need "any visible venue". Fall back to a freshly
 * seeded venue if you need full control.
 */
export async function firstPublicNode(api: APIRequestContext, city = 'johannesburg'): Promise<SeedVenue | null> {
  const res = await api.get(`/v1/nodes/${city}`)
  if (!res.ok()) return null
  const body = (await res.json()) as { nodes?: Array<{ id: string; slug: string; name: string }> }
  const first = body.nodes?.[0]
  if (!first) return null
  return { id: first.id, slug: first.slug, name: first.name }
}

/**
 * Generate a QR code for a node owned by the business test account.
 * Returns the secret token used by the staff scanner.
 */
export async function ensureQrForNode(business: APIRequestContext, nodeId: string): Promise<string> {
  const res = await business.post(`/v1/business/nodes/${nodeId}/qr/regenerate`)
  if (!res.ok()) throw new Error(`Failed to regenerate QR: ${res.status()}`)
  const body = (await res.json()) as { code?: string; qrCode?: string }
  const code = body.code ?? body.qrCode
  if (!code) throw new Error('QR endpoint returned no code')
  return code
}

/**
 * Create a reward as a business owner.
 */
export async function createReward(business: APIRequestContext, nodeId: string, title: string): Promise<SeedReward> {
  const res = await business.post(`/v1/business/nodes/${nodeId}/rewards`, {
    data: {
      title,
      description: 'E2E generated reward — safe to ignore',
      type: 'freebie',
      totalSlots: 100,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  })
  if (!res.ok()) throw new Error(`Failed to create reward: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as { id?: string; rewardId?: string; title?: string }
  return { id: body.id ?? body.rewardId ?? '', title: body.title ?? title }
}

/**
 * Claim a reward as a consumer. Returns the redemption code shown to
 * staff at the till.
 */
export async function claimReward(consumer: APIRequestContext, rewardId: string): Promise<string> {
  const res = await consumer.post(`/v1/rewards/${rewardId}/claim`)
  if (!res.ok()) throw new Error(`Failed to claim: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as { code?: string; redemptionCode?: string }
  const code = body.code ?? body.redemptionCode
  if (!code) throw new Error('Claim endpoint returned no code')
  return code
}
