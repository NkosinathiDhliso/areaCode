// Service layer for Music_Schedule writes.
//
// Feature: proof-of-demand (R8.4)
//
// The schedule handler used to call the repository directly because there was
// nothing to decide between them. A Dated_Slot's `featuredRewardId` changes
// that: it is a cross-domain reference, and whether it is allowed can only be
// answered by reading the rewards domain. That check belongs here, one layer
// above the repository and one below the route, so the repository stays a pure
// table accessor and the route stays a translator of HTTP.
//
// The reference is rejected, never quietly dropped. An owner who picked a get
// for tonight and got a schedule back without it would believe the get is
// showing when it is not, and the map would be telling consumers something the
// owner did not publish.

import { featuredGetHasEnded } from '@area-code/shared/lib/featuredGet'
import type { MusicSchedule, ScheduleSlot } from '@area-code/shared/types'

import { AppError } from '../../shared/errors/AppError.js'
import { invalidateCityPayloadForBusiness } from '../nodes/cache.js'
import { getRewardById } from '../rewards/repository.js'

import { deleteScheduleSlot, upsertSchedule } from './schedule-repository.js'

/**
 * Every distinct `featuredRewardId` referenced by the schedule's dated slots.
 * Weekly slots never carry one (the field only reaches disk through a
 * Dated_Slot), so this is the whole set to check.
 */
function referencedRewardIds(slots: ScheduleSlot[]): string[] {
  const ids = new Set<string>()
  for (const slot of slots) {
    if (slot.featuredRewardId !== undefined) ids.add(slot.featuredRewardId)
  }
  return [...ids]
}

/**
 * Validate every `featuredRewardId` on the schedule against the rewards
 * domain: the get must exist, be active, not have ended, and sit at a node
 * this business owns (R8.4).
 *
 * Ownership is resolved through the reward's node rather than any id the client
 * sent, so a guessed reward id from another venue is a 400 and not a way to
 * advertise someone else's get. Fails closed: a reward whose node cannot be
 * resolved is rejected, because an unowned get is exactly the case this guards.
 *
 * @throws 400 naming the offending id and the reason.
 */
export async function assertFeaturedRewardsUsable(
  schedule: MusicSchedule,
  businessId: string,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const nowMs = new Date(nowIso).getTime()

  for (const rewardId of referencedRewardIds(schedule.slots)) {
    const reward = await getRewardById(rewardId)
    if (!reward) {
      throw AppError.badRequest(`That get no longer exists, so it cannot be tonight's featured get (${rewardId}).`)
    }
    if (reward.node?.businessId !== businessId) {
      // Reported the same way as a missing get: the endpoint must not confirm
      // that someone else's reward id is real.
      throw AppError.badRequest(`That get no longer exists, so it cannot be tonight's featured get (${rewardId}).`)
    }
    if (reward.isActive === false) {
      throw AppError.badRequest(`That get is switched off. Turn it back on, or pick another one (${rewardId}).`)
    }
    if (featuredGetHasEnded(reward, nowMs)) {
      throw AppError.badRequest(`That get has already ended, so it cannot be tonight's featured get (${rewardId}).`)
    }
  }
}

/**
 * Upsert a Music_Schedule for a business after checking every Dated_Slot's
 * featured get (R8.4). The schedule itself has already been validated by the
 * caller; the repository re-validates it on the way to disk regardless.
 *
 * The write then drops the cached city payload for every city this business has
 * a venue in (R8.5). The map reads Tonight off that cached payload, so without
 * this an owner who publishes Tonight would watch their own card stay blank for
 * the length of the cache TTL and reasonably conclude the feature is broken.
 */
export async function upsertScheduleForBusiness(schedule: MusicSchedule, businessId: string): Promise<MusicSchedule> {
  await assertFeaturedRewardsUsable(schedule, businessId)
  const written = await upsertSchedule(schedule)
  await invalidateCityPayloadForBusiness(businessId)
  return written
}

/**
 * Remove one Schedule_Slot and drop the affected city payload caches (R8.5).
 *
 * Deleting the slot that was Tonight has to reach the map as fast as publishing
 * it did: a Tonight line for a night the owner called off is a claim about
 * something that is not happening.
 */
export async function deleteScheduleSlotForBusiness(
  businessId: string,
  scheduleId: string,
  slotId: string,
): Promise<MusicSchedule> {
  const updated = await deleteScheduleSlot(businessId, scheduleId, slotId)
  await invalidateCityPayloadForBusiness(businessId)
  return updated
}
