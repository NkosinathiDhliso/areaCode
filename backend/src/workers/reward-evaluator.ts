import { randomBytes } from 'node:crypto'
import { redis } from '../shared/redis/client.js'
import { emitRewardClaimed, emitRewardSlotsUpdate, emitToast, emitBusinessRewardClaimed } from '../shared/socket/events.js'
import { userRoom } from '../shared/socket/rooms.js'
import { getIO } from '../shared/socket/server.js'
import { rewardNotificationsToday } from '../shared/redis/keys.js'
import * as repo from './reward-evaluator-repository.js'

interface CheckInMessage {
  userId: string
  nodeId: string
  checkInId: string
}

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

  for (const reward of rewards) {
    const qualified = await checkQualification(userId, nodeId, reward)
    if (!qualified) continue
    if (reward.totalSlots !== null && reward.claimedCount >= reward.totalSlots) continue

    const code = generateRedemptionCode()
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000)

    try {
      await repo.createRedemption({
        rewardId: reward.id, userId, redemptionCode: code, codeExpiresAt,
      })
    } catch {
      continue // ON CONFLICT — already claimed
    }

    await repo.incrementClaimedCount(reward.id)
    await emitClaimEvents(userId, nodeId, reward, code, codeExpiresAt)
    console.log(`[reward-evaluator] Claimed: user=${userId} reward=${reward.id} code=${code}`)
  }
}

async function emitClaimEvents(
  userId: string,
  nodeId: string,
  reward: Awaited<ReturnType<typeof repo.getActiveRewardsForNode>>[number],
  code: string,
  codeExpiresAt: Date,
) {
  const slotsRemaining = reward.totalSlots !== null
    ? reward.totalSlots - reward.claimedCount - 1
    : null

  const io = getIO()
  const sockets = await io.in(userRoom(userId)).fetchSockets()

  if (sockets.length > 0) {
    emitRewardClaimed(userId, {
      rewardId: reward.id,
      rewardTitle: reward.title,
      redemptionCode: code,
      codeExpiresAt: codeExpiresAt.toISOString(),
    })
  } else {
    const pushKey = rewardNotificationsToday(userId)
    const pushCount = await redis.incr(pushKey)
    if (pushCount === 1) await redis.expire(pushKey, 86400)
    if (pushCount <= 2) {
      console.log(`[reward-evaluator] Push queued: user=${userId} reward=${reward.title}`)
    }
  }

  if (slotsRemaining !== null) {
    emitRewardSlotsUpdate(nodeId, {
      rewardId: reward.id,
      slotsRemaining: Math.max(0, slotsRemaining),
    })

    if (slotsRemaining <= 5 && slotsRemaining >= 0) {
      const citySlug = reward.node.city?.slug
      if (citySlug) {
        emitToast(citySlug, {
          type: 'reward_pressure',
          message: `Only ${slotsRemaining} left for ${reward.title} at ${reward.node.name}`,
          nodeId,
        })
      }
    }
  }

  // Emit to business room if node is owned by a business
  if (reward.node.businessId) {
    emitBusinessRewardClaimed(reward.node.businessId, {
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
  reward: { type: string; triggerValue: number | null },
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

function toSASTDate(date: Date): Date {
  const sast = new Date(date.getTime() + 2 * 60 * 60 * 1000)
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
