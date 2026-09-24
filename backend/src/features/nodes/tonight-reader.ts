/**
 * Reads behind the Tonight summary (proof-of-demand R8.5, task 9.2).
 *
 * One reader for all three venue reads (city payload, node detail, node public)
 * so the three can never disagree about what is on tonight. The decision lives
 * in `tonight-summary.ts`; this file only fetches what that decision needs.
 *
 * Read shape, for the map's hot path:
 *  - one schedule GetItem per DISTINCT `businessId`, not per node (Tonight scope
 *    is business-wide, `docs/decisions/proof-of-demand.md` decision 5)
 *  - one reward GetItem per DISTINCT featured get actually referenced by a
 *    resolved Tonight, which is at most one per business and usually zero
 *
 * A read failure omits that business's Tonight and logs at error level. The map
 * must not go blank because one schedule row could not be read, and an omitted
 * Tonight is the honest outcome (nothing claimed) rather than a masked wrong
 * answer: the log is the loud part, per `no-fallbacks-no-legacy.md`.
 */

import type { MusicSchedule, VenueTonight } from '@area-code/shared/types'

import { DEFAULT_SCHEDULE_ID, getSchedule } from '../music/schedule-repository.js'
import { getRewardById } from '../rewards/dynamodb-repository.js'

import { resolveTonightSlot, summariseTonight, type TonightFeaturedGet } from './tonight-summary.js'

/**
 * Tonight for every one of `businessIds` that has something published, keyed by
 * business id. Businesses with nothing on are simply absent from the map.
 */
export async function loadTonightByBusiness(
  businessIds: readonly (string | null | undefined)[],
  nowIso: string,
): Promise<Map<string, VenueTonight>> {
  const distinct = [...new Set(businessIds.filter((id): id is string => typeof id === 'string' && id !== ''))]
  const byBusiness = new Map<string, VenueTonight>()
  if (distinct.length === 0) return byBusiness

  const schedules = await Promise.all(distinct.map((id) => readSchedule(id)))

  // Resolve first, then fetch only the gets a resolved Tonight actually needs.
  const resolved = distinct.map((businessId, i) => {
    const schedule = schedules[i] ?? null
    return { businessId, schedule, tonight: resolveTonightSlot(schedule, nowIso) }
  })

  const rewardIds = [
    ...new Set(
      resolved
        .map((entry) => entry.tonight?.slot.featuredRewardId)
        .filter((id): id is string => typeof id === 'string' && id !== ''),
    ),
  ]
  const gets = await loadFeaturedGets(rewardIds)

  for (const entry of resolved) {
    if (!entry.tonight) continue
    const rewardId = entry.tonight.slot.featuredRewardId
    const summary = summariseTonight({
      schedule: entry.schedule,
      nowIso,
      featuredGet: rewardId === undefined ? null : (gets.get(rewardId) ?? null),
    })
    if (summary) byBusiness.set(entry.businessId, summary)
  }

  return byBusiness
}

/**
 * Tonight for a single business, or null. Used by the single-venue reads, where
 * batching has nothing to batch.
 */
export async function loadTonightForBusiness(
  businessId: string | null | undefined,
  nowIso: string,
): Promise<VenueTonight | null> {
  if (typeof businessId !== 'string' || businessId === '') return null
  const byBusiness = await loadTonightByBusiness([businessId], nowIso)
  return byBusiness.get(businessId) ?? null
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function readSchedule(businessId: string): Promise<MusicSchedule | null> {
  try {
    return await getSchedule(businessId, DEFAULT_SCHEDULE_ID)
  } catch (err) {
    console.error(`[tonight-reader] schedule read failed for business ${businessId}`, err)
    return null
  }
}

async function loadFeaturedGets(rewardIds: readonly string[]): Promise<Map<string, TonightFeaturedGet>> {
  const gets = new Map<string, TonightFeaturedGet>()
  if (rewardIds.length === 0) return gets

  const rewards = await Promise.all(
    rewardIds.map(async (id) => {
      try {
        return await getRewardById(id)
      } catch (err) {
        console.error(`[tonight-reader] featured get read failed for reward ${id}`, err)
        return null
      }
    }),
  )

  rewards.forEach((reward, i) => {
    if (!reward) return
    gets.set(rewardIds[i]!, {
      title: reward.title,
      isActive: reward.isActive,
      endsAt: reward.endsAt ?? null,
      expiresAt: reward.expiresAt ?? null,
    })
  })
  return gets
}
