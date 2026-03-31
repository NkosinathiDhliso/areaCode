import { z } from 'zod'

export const pushTokenBodySchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['expo', 'web']),
  deviceId: z.string().optional(),
})

export const notificationPrefsSchema = z.object({
  streakAtRisk: z.boolean().optional(),
  rewardActivated: z.boolean().optional(),
  rewardClaimedPush: z.boolean().optional(),
  leaderboardPrewarning: z.boolean().optional(),
  followedUserCheckin: z.boolean().optional(),
}).strict()

export type PushTokenBody = z.infer<typeof pushTokenBodySchema>
export type NotificationPrefsBody = z.infer<typeof notificationPrefsSchema>
