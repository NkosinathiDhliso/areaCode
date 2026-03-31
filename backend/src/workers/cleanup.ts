import { prisma } from '../shared/db/prisma.js'

/**
 * Cleanup worker — processes right-to-erasure queue.
 * Hard-deletes soft-deleted records after 30 days.
 */
export async function handler() {
  console.log('[cleanup] Starting cleanup worker')

  // Hard-delete check-ins marked for deletion > 30 days ago
  // In production, this would query a deletion_queue table
  // For now, this is a placeholder for the erasure pipeline

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Clean up expired staff invites
  const expiredInvites = await prisma.staffInvite.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
      accepted: false,
    },
  })

  // Clean up expired webhook events older than 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const oldWebhooks = await prisma.webhookEvent.deleteMany({
    where: { processedAt: { lt: ninetyDaysAgo } },
  })

  console.log(
    `[cleanup] Expired invites: ${expiredInvites.count}, Old webhooks: ${oldWebhooks.count}`,
  )
  return {
    expiredInvites: expiredInvites.count,
    oldWebhooks: oldWebhooks.count,
  }
}
