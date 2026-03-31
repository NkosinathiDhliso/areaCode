import { prisma } from '../../shared/db/prisma.js'

export async function upsertPushToken(
  userId: string,
  token: string,
  platform: string,
  deviceId?: string,
) {
  return prisma.userPushToken.upsert({
    where: {
      userId_token: { userId, token },
    },
    create: { userId, token, platform, deviceId },
    update: { lastUsedAt: new Date(), isActive: true, platform, deviceId },
  })
}

export async function getNotificationPreferences(userId: string) {
  return prisma.notificationPreference.findUnique({
    where: { userId },
  })
}

export async function upsertNotificationPreferences(
  userId: string,
  prefs: Partial<{
    streakAtRisk: boolean
    rewardActivated: boolean
    rewardClaimedPush: boolean
    leaderboardPrewarning: boolean
    followedUserCheckin: boolean
  }>,
) {
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...prefs },
    update: { ...prefs, updatedAt: new Date() },
  })
}

export async function getActivePushTokens(userId: string) {
  return prisma.userPushToken.findMany({
    where: { userId, isActive: true },
  })
}

export async function deactivatePushToken(userId: string, token: string) {
  return prisma.userPushToken.updateMany({
    where: { userId, token },
    data: { isActive: false },
  })
}
