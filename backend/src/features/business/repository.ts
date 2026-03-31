import { prisma } from '../../shared/db/prisma.js'
import { randomBytes } from 'node:crypto'

export async function findBusinessById(id: string) {
  return prisma.businessAccount.findUnique({ where: { id } })
}

export async function findBusinessByCognitoSub(sub: string) {
  return prisma.businessAccount.findUnique({ where: { cognitoSub: sub } })
}

export async function updateBusinessTier(
  id: string,
  tier: string,
  trialEndsAt?: Date | null,
) {
  return prisma.businessAccount.update({
    where: { id },
    data: { tier, trialEndsAt },
  })
}

export async function setPaymentGrace(id: string, until: Date | null) {
  return prisma.businessAccount.update({
    where: { id },
    data: { paymentGraceUntil: until },
  })
}

export async function deactivateBusiness(id: string) {
  return prisma.businessAccount.update({
    where: { id },
    data: { tier: 'free', isActive: false },
  })
}

export async function setYocoCustomerId(id: string, yocoId: string) {
  return prisma.businessAccount.update({
    where: { id },
    data: { yocoCustomerId: yocoId },
  })
}

// Staff management
export async function countStaffForBusiness(businessId: string) {
  return prisma.staffAccount.count({
    where: { businessId, isActive: true },
  })
}

export async function createStaffInvite(
  businessId: string,
  phone?: string,
  email?: string,
) {
  const inviteToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  return prisma.staffInvite.create({
    data: {
      businessId,
      inviteToken,
      invitedPhone: phone,
      invitedEmail: email,
      expiresAt,
    },
  })
}

export async function listStaffAccounts(businessId: string) {
  return prisma.staffAccount.findMany({
    where: { businessId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function removeStaffAccount(id: string, businessId: string) {
  return prisma.staffAccount.updateMany({
    where: { id, businessId },
    data: { isActive: false },
  })
}

// Webhook events (Yoco idempotency)
export async function findWebhookEvent(eventId: string) {
  return prisma.webhookEvent.findUnique({ where: { eventId } })
}

export async function createWebhookEvent(eventId: string, eventType: string) {
  return prisma.webhookEvent.create({
    data: { eventId, eventType },
  })
}

// QR token helpers
export async function getNodeForBusiness(nodeId: string, businessId: string) {
  return prisma.node.findFirst({
    where: { id: nodeId, businessId },
  })
}

// Deactivate all rewards for a business
export async function deactivateBusinessRewards(businessId: string) {
  return prisma.reward.updateMany({
    where: { node: { businessId }, isActive: true },
    data: { isActive: false },
  })
}
