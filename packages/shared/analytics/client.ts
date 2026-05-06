// Shared Analytics Client
// Enforces a strict object_action event taxonomy for consistent product analytics.

type EventMap = {
  // Auth & Onboarding
  signup_completed: { method: 'phone' | 'email' | 'google'; role: string }
  login_completed: { method: 'phone' | 'email' | 'google'; role: string }
  onboarding_completed: never
  profile_updated: { field: string }

  // Core Loop: Check-in & Map
  map_viewed: { citySlug: string; filterApplied?: string }
  node_selected: { nodeId: string; category: string; tier: string }
  checkin_started: { nodeId: string; method: 'gps' | 'qr' }
  checkin_completed: { nodeId: string; type: 'presence' | 'reward'; success: boolean }

  // Rewards & Economy
  reward_viewed: { rewardId: string; nodeId: string }
  reward_claimed: { rewardId: string; nodeId: string }
  reward_redeemed: { rewardId: string; businessId: string }

  // Social
  profile_viewed: { targetUserId: string; source: 'search' | 'feed' | 'leaderboard' }
  friend_followed: { targetUserId: string }
  friend_unfollowed: { targetUserId: string }
  feed_viewed: never
  leaderboard_viewed: { citySlug: string }

  // Music & Profile
  music_connected: { provider: 'spotify' | 'apple_music' }
  music_genres_updated: { count: number }
  crowd_vibe_viewed: { nodeId: string }
}

export type EventName = keyof EventMap

class AnalyticsClient {
  private static instance: AnalyticsClient
  private enabled = false
  private userId: string | null = null

  private constructor() {
    this.enabled = typeof process !== 'undefined' && process.env?.['AREA_CODE_ENV'] === 'prod'
  }

  public static getInstance(): AnalyticsClient {
    if (!AnalyticsClient.instance) {
      AnalyticsClient.instance = new AnalyticsClient()
    }
    return AnalyticsClient.instance
  }

  public identify(userId: string, traits?: Record<string, unknown>) {
    this.userId = userId
    if (!this.enabled) {
      console.debug('[Analytics] identify:', { userId, traits })
      return
    }
    // Integrate with PostHog, Mixpanel, Segment, etc. here
    // e.g., window.posthog?.identify(userId, traits)
  }

  public track<K extends keyof EventMap>(eventName: K, ...properties: EventMap[K] extends never ? [] : [EventMap[K]]) {
    const props = properties[0] || {}

    if (!this.enabled) {
      console.debug(`[Analytics Track] ${eventName}`, { userId: this.userId, ...props })
      return
    }

    // Validate object_action format
    if (!eventName.includes('_')) {
      console.warn(`[Analytics] Event name "${eventName}" violates object_action format.`)
    }

    // Integrate with tracking provider here
    // e.g., window.posthog?.capture(eventName, { ...props, timestamp: new Date().toISOString() })
  }
}

export const analytics = AnalyticsClient.getInstance()
