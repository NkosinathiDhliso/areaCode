// New-reward push targeting: who hears about a get, and how often.
//
// Lives apart from `service.ts` because it is the only place that knows the
// audience rule (consumers who checked in at the node in the past 30 days) and
// the per-consumer reward-push budget. `service.ts` owns delivery; this module
// owns targeting, and calls into delivery rather than re-implementing it.

import { pushVenueUrl } from '../../shared/links/venue-arrival.js'

import { canSendRewardPush, incrementRewardPushCount, sendNotification } from './service.js'

/** The reward a fan-out is announcing. `nodeSlug` carries the push deep link. */
interface RewardFanoutTarget {
  nodeId: string
  nodeName: string
  rewardId: string
  rewardTitle: string
  nodeSlug?: string
}

/**
 * One consumer's new-reward push, subject to the 2-per-day reward-push budget.
 * The budget counter only moves when the notification actually reached the
 * consumer, so a silent drop does not spend their allowance.
 */
async function sendRewardPushToConsumer(userId: string, reward: RewardFanoutTarget): Promise<void> {
  const canSend = await canSendRewardPush(userId)
  if (!canSend) return

  const { nodeId, nodeName, rewardId, rewardTitle, nodeSlug } = reward
  const result = await sendNotification({
    userId,
    type: 'reward_new',
    title: 'New Reward Available!',
    body: `${rewardTitle} at ${nodeName}`,
    // Click-through lands on the venue card with `src=push` so the arrival
    // records a `push` Venue_Open (proof-of-demand R2.1).
    data: { rewardId, nodeId, rewardTitle, nodeName, ...pushVenueUrl(nodeSlug) },
  })

  if (result.delivered === 'socket' || result.delivered === 'push') {
    await incrementRewardPushCount(userId)
  }
}

/**
 * Notify consumers who checked in at a node within the past 30 days
 * about a new reward. Respects rate limits and notification preferences.
 *
 * This runs asynchronously (fire-and-forget) so it doesn't slow down
 * the reward creation response.
 */
export async function notifyNewRewardConsumers(
  nodeId: string,
  nodeName: string,
  rewardId: string,
  rewardTitle: string,
  nodeSlug?: string,
): Promise<void> {
  try {
    const { getCheckInsByNode } = await import('../check-in/dynamodb-repository.js')

    // Query consumers who checked in at this node within the past 30 days
    const thirtyDaysHours = 30 * 24
    let allCheckIns: Array<{ userId: string }> = []
    let cursor: string | undefined

    // Paginate through all check-ins at this node in the past 30 days
    do {
      const page = await getCheckInsByNode(nodeId, {
        hours: thirtyDaysHours,
        limit: 100,
        cursor,
      })
      allCheckIns = allCheckIns.concat(page.checkIns)
      cursor = page.nextCursor
    } while (cursor)

    // Deduplicate by userId
    const uniqueUserIds = [...new Set(allCheckIns.map((c) => c.userId))]

    // Send notification to each unique consumer
    for (const userId of uniqueUserIds) {
      try {
        await sendRewardPushToConsumer(userId, { nodeId, nodeName, rewardId, rewardTitle, nodeSlug })
      } catch {
        // Silently skip individual notification failures
        // so one bad user doesn't block the rest
      }
    }
  } catch (err) {
    // Log but don't throw — this is fire-and-forget
    console.error('Failed to send new reward notifications:', err)
  }
}
