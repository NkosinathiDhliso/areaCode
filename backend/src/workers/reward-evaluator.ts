import { randomBytes } from 'node:crypto'
import {
  emitRewardClaimed,
  emitRewardSlotsUpdate,
  emitToast,
  emitBusinessRewardClaimed,
} from '../shared/socket/events.js'
import { classifyLifecycle, isClaimEligible } from '../features/rewards/lifecycle.js'
import { isConditionalCheckFailedError } from '../shared/db/dynamodb.js'
import * as repo from './reward-evaluator-repository.js'

interface CheckInMessage {
  userId: string
  nodeId: string
  checkInId: string
}

/**
 * How long a generated redemption code stays valid. Set to 24h so a
 * consumer who earns a reward has a realistic window to walk up to the
 * counter and present the code — the original 10-minute TTL expired
 * before most users could reach the till, which (combined with the
 * missing consumer wallet UI) made rewards effectively unredeemable.
 */
const REDEMPTION_CODE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * SQS reward-evaluator Lambda.
 * Triggered by check-in SQS messages. Evaluates all active rewards
 * at the node for the user and auto-claims qualified ones.
 */
export async function handler(event: { Records: Array<{ body: string }> }) {
  for (const record of event.Records) {
    const msg: CheckInMessage = JSON.parse(record.body)
    await evaluateRewards(msg.userId, msg.nodeId)
  }
}

async function evaluateRewards(userId: string, nodeId: string) {
  const rewards = await repo.getActiveRewardsForNode(nodeId)
  const nowMs = Date.now()

  for (const reward of rewards) {
    const getCategory = reward.getCategory ?? 'loyalty'

    if (getCategory === 'event' || getCategory === 'offer') {
      // Event/Offer claim gate (R4.1, R4.2, R8.4). This is the consumer claim
      // mint site, so "reject 400" maps to "do not mint" — we skip the reward.
      // The lifecycle/eligibility decision is owned by the pure `isClaimEligible`
      // truth table; the worker supplies the row's lifecycle and whether a
      // qualifying check-in exists inside the Active_Window.
      const hasWindow = Boolean(reward.startsAt && reward.endsAt)
      const lifecycle = hasWindow ? classifyLifecycle(reward.startsAt!, reward.endsAt!, nowMs) : 'ended'
      const claimRequiresCheckIn = reward.claimRequiresCheckIn ?? true
      const hasQualifyingCheckIn = hasWindow
        ? await repo.hasCheckInInWindow(userId, nodeId, reward.startsAt!, reward.endsAt!)
        : false

      const eligibility = isClaimEligible({
        getCategory,
        claimRequiresCheckIn,
        lifecycle,
        hasQualifyingCheckIn,
      })

      if (!eligibility.eligible) {
        // R8.4: skip silently with a debug log (no HTTP response to return).
        console.debug(
          `[reward-evaluator] Skipping ${getCategory} get ${reward.id}: ${eligibility.code} (user=${userId} node=${nodeId} lifecycle=${lifecycle})`,
        )
        continue
      }
      // Eligible: the event/offer gate replaces the loyalty `checkQualification`
      // switch (which returns false for non-loyalty `type` values). Fall through
      // to the shared slot check + mint below.
    } else {
      const qualified = await checkQualification(userId, nodeId, reward)
      if (!qualified) continue
    }

    const slots = reward.totalSlots ?? null
    if (slots !== null && (reward.claimedCount ?? 0) >= slots) continue

    const code = generateRedemptionCode()
    const codeExpiresAt = new Date(Date.now() + REDEMPTION_CODE_TTL_MS).toISOString()

    let redemptionId: string
    try {
      const created = await repo.createRedemption({
        rewardId: reward.id,
        userId,
        redemptionCode: code,
        codeExpiresAt,
        ...(reward.node?.businessId ? { businessId: reward.node.businessId } : {}),
        nodeId,
        ...(reward.node?.name ? { nodeName: reward.node.name } : {}),
        rewardTitle: reward.title,
      })
      redemptionId = created.id
    } catch (err) {
      if (isConditionalCheckFailedError(err)) {
        // ON CONFLICT , already claimed. The unique-claim condition tripped,
        // so this reward is already minted for the user. Skip it.
        continue
      }
      // Any other failure is a real (likely transient) fault. Do not silently
      // drop an earned reward: log loudly and rethrow so the SQS message fails
      // and is retried (no-fallbacks-no-legacy.md).
      console.error(`[reward-evaluator] createRedemption failed: user=${userId} reward=${reward.id}`, err)
      throw err
    }

    // Atomic slot-cap enforcement. The read-then-check above is a fast early-out;
    // this conditional increment is the authoritative guard against over-issuing
    // when concurrent check-ins race for the last slot. If it fails, the slot was
    // taken after we minted — roll the redemption back so the cap holds.
    try {
      await repo.incrementClaimedCount(reward.id, slots)
    } catch (err) {
      if (isConditionalCheckFailedError(err)) {
        await repo.deleteRedemption(redemptionId, reward.id, userId)
        console.log(`[reward-evaluator] Slot full, rolled back: user=${userId} reward=${reward.id}`)
        continue
      }
      // Non-conditional failure: the redemption is minted but the count did not
      // advance. Roll back the mint (best-effort) and rethrow so SQS retries,
      // rather than leaving an over-cap code live.
      await repo
        .deleteRedemption(redemptionId, reward.id, userId)
        .catch((rollbackErr) =>
          console.error(
            `[reward-evaluator] redemption rollback failed: user=${userId} reward=${reward.id}`,
            rollbackErr,
          ),
        )
      console.error(`[reward-evaluator] incrementClaimedCount failed: user=${userId} reward=${reward.id}`, err)
      throw err
    }

    await emitClaimEvents(userId, nodeId, reward, code, codeExpiresAt)
    console.log(`[reward-evaluator] Claimed: user=${userId} reward=${reward.id} code=${code}`)
  }
}

async function emitClaimEvents(
  userId: string,
  nodeId: string,
  reward: Awaited<ReturnType<typeof repo.getActiveRewardsForNode>>[number],
  code: string,
  codeExpiresAt: string,
) {
  const slots = reward.totalSlots ?? null
  const slotsRemaining = slots !== null ? slots - (reward.claimedCount ?? 0) - 1 : null

  // Socket-first: emitRewardClaimed reports how many live connections it
  // reached; when the user has no live socket, fall back to a push.
  const reached = await emitRewardClaimed(userId, {
    rewardId: reward.id,
    rewardTitle: reward.title,
    redemptionCode: code,
    codeExpiresAt,
    nodeName: reward.node?.name ?? '',
  })

  if (reached === 0) {
    // Deliver via push notification (Expo / Web Push)
    const { canSendRewardPush, incrementRewardPushCount, notifyUser } =
      await import('../features/notifications/service.js')
    const canPush = await canSendRewardPush(userId)
    if (canPush) {
      await incrementRewardPushCount(userId)
      await notifyUser(userId, 'reward:claimed', {
        title: 'Reward unlocked!',
        message: `You earned "${reward.title}" , claim it before it expires.`,
        rewardId: reward.id,
        rewardTitle: reward.title,
        redemptionCode: code,
        codeExpiresAt,
      })
    }
  }

  if (slotsRemaining !== null) {
    const citySlug = reward.node?.city?.slug
    if (citySlug) {
      await emitRewardSlotsUpdate(citySlug, {
        rewardId: reward.id,
        slotsRemaining: Math.max(0, slotsRemaining),
      })

      if (slotsRemaining <= 5 && slotsRemaining >= 0) {
        await emitToast(citySlug, {
          type: 'reward_pressure',
          message: `Only ${slotsRemaining} left for ${reward.title} at ${reward.node?.name ?? 'Unknown'}`,
          nodeId,
        })
      }
    }
  }

  // Emit to business room if node is owned by a business
  if (reward.node?.businessId) {
    await emitBusinessRewardClaimed(reward.node.businessId, {
      nodeId,
      nodeName: reward.node.name,
      rewardId: reward.id,
      rewardTitle: reward.title,
      timestamp: new Date().toISOString(),
    })
  }
}

async function checkQualification(
  userId: string,
  nodeId: string,
  reward: { type: string; triggerValue?: number | null },
): Promise<boolean> {
  const trigger = reward.triggerValue ?? 1

  switch (reward.type) {
    case 'nth_checkin': {
      const count = await repo.countUserCheckInsAtNode(userId, nodeId)
      return count >= trigger
    }
    case 'daily_first': {
      const count = await repo.countCheckInsTodayAtNode(nodeId)
      return count <= trigger
    }
    case 'streak': {
      const days = await getStreakDays(userId, nodeId)
      return days >= trigger
    }
    case 'milestone': {
      const todayCount = await repo.countCheckInsTodayAtNode(nodeId)
      return todayCount >= trigger
    }
    default:
      return false
  }
}

async function getStreakDays(userId: string, nodeId: string): Promise<number> {
  const checkIns = await repo.getRecentCheckInsForStreak(userId, nodeId, 30)
  if (checkIns.length === 0) return 0

  let streak = 1
  let prevDate = toSASTDate(checkIns[0]!.checkedInAt)

  for (let i = 1; i < checkIns.length; i++) {
    const date = toSASTDate(checkIns[i]!.checkedInAt)
    const diff = (prevDate.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)
    if (Math.round(diff) === 1) {
      streak++
      prevDate = date
    } else if (Math.round(diff) === 0) {
      // Same day, skip
    } else {
      break
    }
  }
  return streak
}

function toSASTDate(date: string | Date): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  const sast = new Date(d.getTime() + 2 * 60 * 60 * 1000)
  sast.setUTCHours(0, 0, 0, 0)
  return sast
}

function generateRedemptionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i]! % chars.length]
  }
  return code
}
