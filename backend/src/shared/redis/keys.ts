/**
 * All Redis key patterns as typed functions.
 * Single source of truth for key naming — never construct keys inline.
 */

// Check-in cooldowns
export const checkinCooldownReward = (userId: string, nodeId: string) =>
  `checkin:cooldown:reward:${userId}:${nodeId}` as const;

export const checkinCooldownPresence = (userId: string, nodeId: string) =>
  `checkin:cooldown:presence:${userId}:${nodeId}` as const;

// Daily check-in counter per node
export const checkinToday = (nodeId: string) =>
  `checkin:today:${nodeId}` as const;

// Node active state (pulse score in sorted set)
export const nodeActive = (nodeId: string) =>
  `node:active:${nodeId}` as const;

// Toast queue per city
export const toastQueue = (cityId: string) =>
  `toast:queue:${cityId}` as const;

// User consent cache
export const userConsent = (userId: string) =>
  `user:consent:${userId}` as const;

// Surge toast cooldown per user per node
export const toastSurgeSeen = (userId: string, nodeId: string) =>
  `toast:surge:seen:${userId}:${nodeId}` as const;

// OTP rate limiting
export const otpCooldown = (phone: string) =>
  `otp:cooldown:${phone}` as const;

export const otpHourlyCount = (phone: string) =>
  `otp:hourly:${phone}` as const;

// Cognito auth session (stored between initiate and verify)
export const otpSession = (phone: string) =>
  `otp:session:${phone}` as const;

// Leaderboard sorted set per city per week
export const leaderboard = (cityId: string) =>
  `leaderboard:${cityId}:week` as const;

// Pulse scores sorted set per city
export const nodesPulse = (cityId: string) =>
  `nodes:pulse:${cityId}` as const;

// Reward notification daily limit
export const rewardNotificationsToday = (userId: string) =>
  `reward_notifications_today:${userId}` as const;

// Notification deferral
export const notifDeferred = (userId: string) =>
  `notif:deferred:${userId}` as const;

// Rate limiting generic
export const rateLimit = (key: string, identifier: string) =>
  `ratelimit:${key}:${identifier}` as const;

// Unique users today per node
export const uniqueUsersToday = (nodeId: string) =>
  `node:unique_users:${nodeId}` as const;

// Active rewards count per node (cached)
export const activeRewardsCount = (nodeId: string) =>
  `node:active_rewards:${nodeId}` as const;
