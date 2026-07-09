import { randomBytes } from 'node:crypto'

import { classifyLifecycle, isClaimEligible } from '../features/rewards/lifecycle.js'
import { decideMint } from '../features/rewards/repeat-policy.js'
import { getEffectiveThreshold } from '../features/rewards/threshold-lock.js'
import { isConditionalCheckFailedError } from '../shared/db/dynamodb.js'
import {
  emitRewardClaimed,
  emitRewardSlotsUpdate,
  emitToast,
  emitBusinessRewardClaimed,
} from '../shared/socket/events.js'

import * as repo from './reward-evaluator-repository.js'

interface CheckInMessage {
  userId: string
  nodeId: string
  checkInId: string
  // Present when the triggering check-in carried a device fingerprint. Threaded
  // through to the mint-site Reward_Drain flag as evidence only
  // (loyalty-repeat-redemption R4.1); the drain check itself keys on `userId`,
  // so omission never disables it (R4.4).
  fingerprintHash?: string
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
  // Single structured heartbeat per invocation so the go-live-check worker scan
  // can tell "ran quietly" (processed check-ins, no reward qualified) apart from
  // "never ran" — matching the other workers' start-of-handler log style.
  console.log(`[reward-evaluator] Starting reward evaluation for ${event.Records.length} check-in message(s)`)
  for (const record of event.Records) {
    const msg: CheckInMessage = JSON.parse(record.body)
    await evaluateRewards(msg.userId, msg.nodeId, msg.fingerprintHash)
  }
}

async function evaluateRewards(userId: string, nodeId: string, fingerprintHash?: string) {
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

    const policy = reward.repeatPolicy ?? 'once'
    let redemptionId: string
    let redemptionCount: number
    try {
      const created = await repo.createRedemption({
        rewardId: reward.id,
        userId,
        redemptionCode: code,
        codeExpiresAt,
        // Repeat_Policy resolution: absent on disk reads as `once`
        // (loyalty-repeat-redemption R1.1). The repository transcribes this
        // into the policy-specific Claim_Guard condition (R2).
        repeatPolicy: policy,
        ...(reward.node?.businessId ? { businessId: reward.node.businessId } : {}),
        nodeId,
        ...(reward.node?.name ? { nodeName: reward.node.name } : {}),
        rewardTitle: reward.title,
      })
      redemptionId = created.id
      redemptionCount = created.redemptionCount
    } catch (err) {
      if (isConditionalCheckFailedError(err)) {
        // Mint skipped by the Claim_Guard condition (R2). Recover the precise
        // rejection code from the pure `decideMint` against the current guard
        // state and emit a debug log (R8.2). Best-effort: never throw here — a
        // failed guard read or a benign race just yields a generic skip log.
        try {
          const guard = await repo.getClaimGuard(reward.id, userId)
          const decision = decideMint(policy, guard, nowMs)
          const code = decision.mint ? 'skipped' : decision.code
          console.debug(
            `[reward-evaluator] Mint skipped by guard: user=${userId} reward=${reward.id} policy=${policy} code=${code}`,
          )
        } catch (logErr) {
          console.debug(
            `[reward-evaluator] Mint skipped by guard: user=${userId} reward=${reward.id} policy=${policy}`,
            logErr,
          )
        }
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

    // Reward_Drain-on-mint (R4.1, R4.3, R8.3). The mint has succeeded and the
    // slot cap held, so this is the authoritative claim site. Count the mint
    // per (consumer, node) and, above the 24h threshold, raise a high-priority
    // abuse flag with the mint timestamps (and fingerprint when present) as
    // evidence. Never blocks the mint: the helper swallows its own failures and
    // makes no mint decision. Awaited so the counter/flag writes actually land
    // before the Lambda freezes on return (a fire-and-forget promise is lost).
    await repo.recordDrainOnMint(userId, nodeId, fingerprintHash)

    // R8.1: structured info log on a repeat mint (`per_visit`, second or later
    // code for this consumer+reward). `redemptionCount` is the running mint
    // count carried on the Claim_Guard.
    if (policy === 'per_visit' && redemptionCount > 1) {
      console.info(
        JSON.stringify({
          feature: 'loyalty-repeat-redemption',
          operation: 'repeatMint',
          rewardId: reward.id,
          nodeId,
          userId,
          policy,
          redemptionCount,
        }),
      )
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
  reward: { id: string; type: string; triggerValue?: number | null },
): Promise<boolean> {
  const trigger = reward.triggerValue ?? 1

  switch (reward.type) {
    case 'nth_checkin': {
      // R3.1/R3.4: qualify against the consumer's Effective_Threshold
      // (min(lockedThreshold, current triggerValue)), so a grandfathered lock
      // at 5 still qualifies at 5 visits after the venue raises the threshold.
      const [count, effectiveThreshold] = await Promise.all([
        repo.countQualifyingVisits(userId, nodeId),
        getEffectiveThreshold(userId, reward.id),
      ])
      return count >= effectiveThreshold
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
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i]! % chars.length]
  }
  return code
}
