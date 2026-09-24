/**
 * City_Nodes_Read cache key and invalidation, in one home.
 *
 * `getNodesByCitySlug` fronts the assembled city payload with a short-lived KV
 * entry so concurrent map loads share one assembly. Any write that changes what
 * the map should show must delete that entry, or the change waits out the TTL.
 *
 * The key shape lives here rather than in the service because writers outside
 * the nodes feature need it: a published Tonight is a Music_Schedule write, and
 * it has to reach the map on the next request, not 45 seconds later
 * (proof-of-demand R8.5).
 */

import { kvDel } from '../../shared/kv/dynamodb-kv.js'

import * as nodesDynamo from './dynamodb-repository.js'
import { getCityById } from './repository.js'

export function cityPayloadCacheKey(citySlug: string): string {
  return `nodes:city:${citySlug}`
}

/** Drop the assembled payload for one city. */
export async function invalidateCityPayload(citySlug: string): Promise<void> {
  await kvDel(cityPayloadCacheKey(citySlug))
}

/**
 * Drop the assembled payload for the city one node sits in.
 *
 * The node-keyed entry point every write that changes a single venue uses: the
 * writer holds a nodeId, the cache key is slug-based, so the node's `cityId` is
 * resolved here rather than at ten call sites (proof-of-demand R15.5). A node
 * with no city, or a city row that has gone missing, has no payload to drop.
 *
 * Failure is logged and swallowed for the same reason as the business-scoped
 * helper below: the worst outcome is one stale map read that ages out inside the
 * 45s TTL, and failing an owner's save because a cache key could not be deleted
 * would be worse.
 */
export async function invalidateCityPayloadForNode(nodeId: string): Promise<void> {
  try {
    const node = await nodesDynamo.getNodeById(nodeId)
    if (!node?.cityId) return
    const city = await getCityById(node.cityId)
    if (!city) return
    await invalidateCityPayload(city.slug)
  } catch (err) {
    console.error(`[nodes/cache] city payload invalidation failed for node ${nodeId}`, err)
  }
}

/**
 * Drop the assembled payload for every city this business has a venue in.
 *
 * Used by writes that are owned by the business rather than by a node, where
 * the city is not in hand: a Music_Schedule upsert is business-scoped, so the
 * venues it affects have to be looked up. A read failure here is logged and
 * swallowed deliberately: it is a cache miss at worst, and failing the owner's
 * schedule save because a cache key could not be deleted would be the worse
 * outcome.
 */
export async function invalidateCityPayloadForBusiness(businessId: string): Promise<void> {
  try {
    const nodes = await nodesDynamo.getNodesByBusinessId(businessId)
    const cityIds = [...new Set(nodes.map((node) => node.cityId).filter((id): id is string => typeof id === 'string'))]
    const cities = await Promise.all(cityIds.map((id) => getCityById(id)))
    const slugs = [...new Set(cities.filter((city) => city !== null).map((city) => city.slug))]
    await Promise.all(slugs.map((slug) => invalidateCityPayload(slug)))
  } catch (err) {
    console.error(`[nodes/cache] city payload invalidation failed for business ${businessId}`, err)
  }
}
