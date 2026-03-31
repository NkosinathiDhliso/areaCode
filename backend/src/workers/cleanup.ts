import { prisma } from '../shared/db/prisma.js'

/**
 * Cleanup worker — processes right-to-erasure queue + housekeeping.
 * Runs daily via EventBridge.
 */
export async function handler() {
  console.log('[cleanup] Starting cleanup worker')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // ─── Process erasure requests older than 30 days ──────────────────────
  const pendingErasures = await prisma.erasureRequest.findMany({
    where: { status: 'pending', requestedAt: { lt: thirtyDaysAgo } },
    select: { id: true, userId: true },
  })

  let erasedCount = 0
  for (const req of pendingErasures) {
    try {
      await prisma.$transaction([
        prisma.checkIn.deleteMany({ where: { userId: req.userId } }),
        prisma.rewardRedemption.deleteMany({ where: { userId: req.userId } }),
        prisma.consentRecord.deleteMany({ where: { userId: req.userId } }),
        prisma.userPushToken.deleteMany({ where: { userId: req.userId } }),
        prisma.notificationPreference.deleteMany({ where: { userId: req.userId } }),
        prisma.userFollow.deleteMany({
          where: { OR: [{ followerId: req.userId }, { followingId: req.userId }] },
        }),
        prisma.deviceFingerprint.deleteMany({ where: { userId: req.userId } }),
        prisma.adminMessage.deleteMany({ where: { targetUserId: req.userId } }),
        prisma.report.deleteMany({ where: { reporterId: req.userId } }),
        prisma.user.delete({ where: { id: req.userId } }),
        prisma.erasureRequest.update({
          where: { id: req.id },
          data: { status: 'completed', processedAt: new Date() },
        }),
      ])
      erasedCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cleanup] Erasure failed for user ${req.userId}: ${msg}`)
    }
  }

  // ─── Clean up expired staff invites ───────────────────────────────────
  const expiredInvites = await prisma.staffInvite.deleteMany({
    where: { expiresAt: { lt: new Date() }, accepted: false },
  })

  // ─── Clean up old webhook events (90+ days) ──────────────────────────
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const oldWebhooks = await prisma.webhookEvent.deleteMany({
    where: { processedAt: { lt: ninetyDaysAgo } },
  })

  console.log(
    `[cleanup] Erased: ${erasedCount}, Expired invites: ${expiredInvites.count}, Old webhooks: ${oldWebhooks.count}`,
  )
  return {
    erasedCount,
    expiredInvites: expiredInvites.count,
    oldWebhooks: oldWebhooks.count,
  }
}
