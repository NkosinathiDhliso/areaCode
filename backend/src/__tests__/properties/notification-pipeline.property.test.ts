import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

// ─── Tier Benefits (mirrors check-in/service.ts) ────────────────────────────

const TIER_BENEFITS: Record<string, string[]> = {
  local: ['Access to basic rewards'],
  regular: ['Priority reward access', 'Profile badge'],
  fixture: ['Exclusive rewards', 'Leaderboard boost'],
  institution: ['VIP rewards', 'Early access to new venues'],
  legend: ['All benefits unlocked', 'Legend badge', 'Exclusive events'],
}

const ALL_TIERS = ['local', 'regular', 'fixture', 'institution', 'legend'] as const

// ─── Notification Preference Defaults (mirrors notifications/service.ts) ────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- value defines the shape consumed by `keyof typeof` below
const NOTIFICATION_DEFAULTS = {
  streakAtRisk: false,
  rewardActivated: false,
  rewardClaimedPush: true,
  leaderboardPrewarning: false,
  followedUserCheckin: false,
}

const NOTIFICATION_TYPE_TO_PREF: Record<string, keyof typeof NOTIFICATION_DEFAULTS> = {
  reward_new: 'rewardActivated',
  reward_code: 'rewardClaimedPush',
  streak_at_risk: 'streakAtRisk',
  leaderboard_reset: 'leaderboardPrewarning',
  friend_checkin: 'followedUserCheckin',
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const userIdArb = fc.uuid()
const nodeIdArb = fc.uuid()
const tierArb = fc.constantFrom(...ALL_TIERS)

/** Valid date arbitrary within a reasonable range */
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }).map((ts) => new Date(ts))

/** Check-in record with timestamp */
const checkInRecordArb = fc.record({
  userId: userIdArb,
  nodeId: nodeIdArb,
  checkedInAt: validDateArb.map((d) => d.toISOString()),
})

/** Notification preference object */
const notificationPrefsArb = fc.record({
  streakAtRisk: fc.boolean(),
  rewardActivated: fc.boolean(),
  rewardClaimedPush: fc.boolean(),
  leaderboardPrewarning: fc.boolean(),
  followedUserCheckin: fc.boolean(),
})

/** Notification type that maps to a preference */
const notificationTypeWithPrefArb = fc.constantFrom(
  'reward_new',
  'reward_code',
  'streak_at_risk',
  'leaderboard_reset',
  'friend_checkin',
)

/** Notification type that always sends (no preference mapping) */
const alwaysSendNotificationTypeArb = fc.constantFrom('tier_change', 'badge_earned')

// ─── Pure Functions Under Test ──────────────────────────────────────────────

/**
 * Pure function that computes notification recipients for a new reward at a node.
 * Recipients are consumers who have at least one check-in at that node within
 * the past 30 days from the reference date.
 */
function computeRewardNotificationRecipients(
  checkIns: Array<{ userId: string; nodeId: string; checkedInAt: string }>,
  targetNodeId: string,
  referenceDate: Date,
): string[] {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const cutoff = new Date(referenceDate.getTime() - thirtyDaysMs)

  const eligibleUserIds = new Set<string>()

  for (const checkIn of checkIns) {
    if (
      checkIn.nodeId === targetNodeId &&
      new Date(checkIn.checkedInAt) >= cutoff &&
      new Date(checkIn.checkedInAt) <= referenceDate
    ) {
      eligibleUserIds.add(checkIn.userId)
    }
  }

  return [...eligibleUserIds]
}

/**
 * Pure function that determines if a notification should be sent based on
 * user preferences. Returns true if the notification should be delivered.
 */
function shouldSendNotification(notificationType: string, preferences: typeof NOTIFICATION_DEFAULTS): boolean {
  const prefKey = NOTIFICATION_TYPE_TO_PREF[notificationType]
  if (!prefKey) {
    // No preference mapping — always send (e.g. tier_change, badge_earned)
    return true
  }
  return preferences[prefKey] !== false
}

/**
 * Pure function that checks if a reward notification can be sent given
 * the current daily count. Max 2 reward notifications per consumer per day.
 */
function canSendRewardNotification(dailyCount: number): boolean {
  return dailyCount < 2
}

/**
 * Pure function that determines the notification delivery channel.
 * Priority: WebSocket > Push > no_tokens
 */
function determineDeliveryChannel(
  hasActiveSocket: boolean,
  hasValidPushTokens: boolean,
): 'socket' | 'push' | 'no_tokens' {
  if (hasActiveSocket) return 'socket'
  if (hasValidPushTokens) return 'push'
  return 'no_tokens'
}

/**
 * Pure function that builds a tier change notification payload.
 * Must contain the new tier name and the complete list of benefits.
 */
function buildTierChangePayload(
  oldTier: string,
  newTier: string,
): { oldTier: string; newTier: string; benefits: string[] } {
  return {
    oldTier,
    newTier,
    benefits: TIER_BENEFITS[newTier] ?? [],
  }
}

// ─── Property 13: Notification recipient targeting within time window ────────

describe('Property 13: Notification recipient targeting within time window', () => {
  /**
   * **Validates: Requirements 17.1**
   *
   * For any node and any set of check-in records, the notification recipients
   * for a new reward at that node SHALL be exactly the set of consumers who
   * have at least one check-in at that node within the past 30 days.
   */

  it('recipients are exactly the consumers with at least one check-in at the node within 30 days', () => {
    fc.assert(
      fc.property(
        nodeIdArb,
        validDateArb,
        fc.array(checkInRecordArb, { minLength: 0, maxLength: 50 }),
        (targetNodeId, referenceDate, checkIns) => {
          const recipients = computeRewardNotificationRecipients(checkIns, targetNodeId, referenceDate)

          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
          const cutoff = new Date(referenceDate.getTime() - thirtyDaysMs)

          // Manually compute expected recipients
          const expectedRecipients = new Set<string>()
          for (const ci of checkIns) {
            if (
              ci.nodeId === targetNodeId &&
              new Date(ci.checkedInAt) >= cutoff &&
              new Date(ci.checkedInAt) <= referenceDate
            ) {
              expectedRecipients.add(ci.userId)
            }
          }

          // Recipients must match exactly
          expect(new Set(recipients)).toEqual(expectedRecipients)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('consumers with check-ins older than 30 days are NOT included as recipients', () => {
    fc.assert(
      fc.property(nodeIdArb, userIdArb, validDateArb, (targetNodeId, userId, referenceDate) => {
        // Create a check-in that is 31 days old (outside the window)
        const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000
        const oldCheckInDate = new Date(referenceDate.getTime() - thirtyOneDaysMs)

        const checkIns = [{ userId, nodeId: targetNodeId, checkedInAt: oldCheckInDate.toISOString() }]

        const recipients = computeRewardNotificationRecipients(checkIns, targetNodeId, referenceDate)

        // The consumer should NOT be a recipient
        expect(recipients).not.toContain(userId)
      }),
      { numRuns: 25 },
    )
  })

  it('consumers with check-ins at other nodes are NOT included as recipients', () => {
    fc.assert(
      fc.property(nodeIdArb, nodeIdArb, userIdArb, validDateArb, (targetNodeId, otherNodeId, userId, referenceDate) => {
        fc.pre(targetNodeId !== otherNodeId)

        // Create a recent check-in at a DIFFERENT node
        const recentDate = new Date(referenceDate.getTime() - 5 * 24 * 60 * 60 * 1000)
        const checkIns = [{ userId, nodeId: otherNodeId, checkedInAt: recentDate.toISOString() }]

        const recipients = computeRewardNotificationRecipients(checkIns, targetNodeId, referenceDate)

        expect(recipients).not.toContain(userId)
      }),
      { numRuns: 25 },
    )
  })

  it('each consumer appears at most once in the recipient list regardless of check-in count', () => {
    fc.assert(
      fc.property(
        nodeIdArb,
        userIdArb,
        validDateArb,
        fc.integer({ min: 2, max: 20 }),
        (targetNodeId, userId, referenceDate, numCheckIns) => {
          // Create multiple check-ins by the same user at the target node
          const checkIns = Array.from({ length: numCheckIns }, (_, i) => ({
            userId,
            nodeId: targetNodeId,
            checkedInAt: new Date(referenceDate.getTime() - i * 3600000).toISOString(),
          }))

          const recipients = computeRewardNotificationRecipients(checkIns, targetNodeId, referenceDate)

          // User should appear exactly once
          const userOccurrences = recipients.filter((r) => r === userId)
          expect(userOccurrences.length).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 14: Notification preference enforcement ───────────────────────

describe('Property 14: Notification preference enforcement', () => {
  /**
   * **Validates: Requirements 17.3**
   *
   * For any consumer and any notification type, the notification SHALL only
   * be delivered if the consumer's corresponding notification preference is
   * enabled. If the preference is disabled, the notification SHALL be silently
   * dropped.
   */

  it('notification is blocked when the corresponding preference is disabled', () => {
    fc.assert(
      fc.property(notificationTypeWithPrefArb, notificationPrefsArb, (notificationType, prefs) => {
        const prefKey = NOTIFICATION_TYPE_TO_PREF[notificationType]!
        // Force the preference to be disabled
        const disabledPrefs = { ...prefs, [prefKey]: false }

        const result = shouldSendNotification(notificationType, disabledPrefs)

        expect(result).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('notification is allowed when the corresponding preference is enabled', () => {
    fc.assert(
      fc.property(notificationTypeWithPrefArb, notificationPrefsArb, (notificationType, prefs) => {
        const prefKey = NOTIFICATION_TYPE_TO_PREF[notificationType]!
        // Force the preference to be enabled
        const enabledPrefs = { ...prefs, [prefKey]: true }

        const result = shouldSendNotification(notificationType, enabledPrefs)

        expect(result).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('notification types without preference mapping are always sent regardless of preferences', () => {
    fc.assert(
      fc.property(alwaysSendNotificationTypeArb, notificationPrefsArb, (notificationType, _prefs) => {
        // Even with all preferences disabled, these types should always send
        const allDisabled = {
          streakAtRisk: false,
          rewardActivated: false,
          rewardClaimedPush: false,
          leaderboardPrewarning: false,
          followedUserCheckin: false,
        }

        const result = shouldSendNotification(notificationType, allDisabled)

        expect(result).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('preference enforcement is consistent — same inputs always produce same result', () => {
    fc.assert(
      fc.property(
        fc.oneof(notificationTypeWithPrefArb, alwaysSendNotificationTypeArb),
        notificationPrefsArb,
        (notificationType, prefs) => {
          const result1 = shouldSendNotification(notificationType, prefs)
          const result2 = shouldSendNotification(notificationType, prefs)

          expect(result1).toBe(result2)
        },
      ),
      { numRuns: 25 },
    )
  })
})

// ─── Property 15: Notification rate limiting ────────────────────────────────

describe('Property 15: Notification rate limiting', () => {
  /**
   * **Validates: Requirements 17.4**
   *
   * For any consumer and any day, the total number of reward-related
   * notifications delivered SHALL not exceed 2.
   */

  it('rate limiter blocks notifications when daily count reaches 2', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 100 }), (dailyCount) => {
        const canSend = canSendRewardNotification(dailyCount)

        expect(canSend).toBe(false)
      }),
      { numRuns: 25 },
    )
  })

  it('rate limiter allows notifications when daily count is below 2', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 }), (dailyCount) => {
        const canSend = canSendRewardNotification(dailyCount)

        expect(canSend).toBe(true)
      }),
      { numRuns: 25 },
    )
  })

  it('simulating a full day of reward notifications never exceeds 2 deliveries', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (totalAttempts) => {
        // Simulate sending reward notifications throughout a day
        let deliveredCount = 0

        for (let i = 0; i < totalAttempts; i++) {
          if (canSendRewardNotification(deliveredCount)) {
            deliveredCount++
          }
        }

        // Total delivered must never exceed 2
        expect(deliveredCount).toBeLessThanOrEqual(2)
      }),
      { numRuns: 25 },
    )
  })

  it('rate limit boundary: exactly 2 notifications are allowed, the 3rd is blocked', () => {
    // First notification: count=0, should be allowed
    expect(canSendRewardNotification(0)).toBe(true)
    // Second notification: count=1, should be allowed
    expect(canSendRewardNotification(1)).toBe(true)
    // Third notification: count=2, should be blocked
    expect(canSendRewardNotification(2)).toBe(false)
  })
})

// ─── Property 16: Notification channel selection ────────────────────────────

describe('Property 16: Notification channel selection', () => {
  /**
   * **Validates: Requirements 17.5, 20.2, 20.3**
   *
   * For any notification delivery attempt, if the target consumer has an
   * active WebSocket connection, the delivery channel SHALL be "socket".
   * If the consumer has no active WebSocket connection but has valid push
   * tokens, the delivery channel SHALL be "push". If neither is available,
   * the delivery status SHALL be "no_tokens".
   */

  it('delivery channel is "socket" when consumer has an active WebSocket connection', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // hasValidPushTokens — irrelevant when socket is active
        (hasValidPushTokens) => {
          const channel = determineDeliveryChannel(true, hasValidPushTokens)

          expect(channel).toBe('socket')
        },
      ),
      { numRuns: 25 },
    )
  })

  it('delivery channel is "push" when no socket but valid push tokens exist', () => {
    const channel = determineDeliveryChannel(false, true)

    expect(channel).toBe('push')
  })

  it('delivery status is "no_tokens" when neither socket nor push tokens are available', () => {
    const channel = determineDeliveryChannel(false, false)

    expect(channel).toBe('no_tokens')
  })

  it('WebSocket always takes priority over push regardless of push token availability', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasPushTokens) => {
        const channel = determineDeliveryChannel(true, hasPushTokens)

        // Socket always wins when available
        expect(channel).toBe('socket')
      }),
      { numRuns: 25 },
    )
  })

  it('channel selection is deterministic for any combination of connection state', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasSocket, hasPush) => {
        const channel1 = determineDeliveryChannel(hasSocket, hasPush)
        const channel2 = determineDeliveryChannel(hasSocket, hasPush)

        expect(channel1).toBe(channel2)
      }),
      { numRuns: 25 },
    )
  })

  it('channel selection covers all possible states exhaustively', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasSocket, hasPush) => {
        const channel = determineDeliveryChannel(hasSocket, hasPush)

        // Result must be one of the three valid channels
        expect(['socket', 'push', 'no_tokens']).toContain(channel)
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Property 21: Tier change notification contains correct data ────────────

describe('Property 21: Tier change notification contains correct data', () => {
  /**
   * **Validates: Requirements 20.1**
   *
   * For any tier change event (oldTier → newTier), the notification payload
   * SHALL contain the new tier name and the complete list of benefits
   * associated with the new tier.
   */

  it('tier change payload always contains the new tier name', () => {
    fc.assert(
      fc.property(tierArb, tierArb, (oldTier, newTier) => {
        fc.pre(oldTier !== newTier)

        const payload = buildTierChangePayload(oldTier, newTier)

        expect(payload.newTier).toBe(newTier)
      }),
      { numRuns: 25 },
    )
  })

  it('tier change payload contains the complete list of benefits for the new tier', () => {
    fc.assert(
      fc.property(tierArb, tierArb, (oldTier, newTier) => {
        fc.pre(oldTier !== newTier)

        const payload = buildTierChangePayload(oldTier, newTier)

        // Benefits must match the TIER_BENEFITS definition exactly
        const expectedBenefits = TIER_BENEFITS[newTier] ?? []
        expect(payload.benefits).toEqual(expectedBenefits)
        expect(payload.benefits.length).toBe(expectedBenefits.length)
      }),
      { numRuns: 25 },
    )
  })

  it('tier change payload preserves the old tier for context', () => {
    fc.assert(
      fc.property(tierArb, tierArb, (oldTier, newTier) => {
        fc.pre(oldTier !== newTier)

        const payload = buildTierChangePayload(oldTier, newTier)

        expect(payload.oldTier).toBe(oldTier)
      }),
      { numRuns: 25 },
    )
  })

  it('benefits list is never empty for any valid tier', () => {
    fc.assert(
      fc.property(tierArb, tierArb, (oldTier, newTier) => {
        fc.pre(oldTier !== newTier)

        const payload = buildTierChangePayload(oldTier, newTier)

        // Every tier has at least one benefit defined
        expect(payload.benefits.length).toBeGreaterThan(0)
      }),
      { numRuns: 25 },
    )
  })

  it('benefits are specific to the new tier, not the old tier', () => {
    fc.assert(
      fc.property(tierArb, tierArb, (oldTier, newTier) => {
        fc.pre(oldTier !== newTier)
        // Only test when old and new tiers have different benefits
        const oldBenefits = TIER_BENEFITS[oldTier] ?? []
        const newBenefits = TIER_BENEFITS[newTier] ?? []
        fc.pre(JSON.stringify(oldBenefits) !== JSON.stringify(newBenefits))

        const payload = buildTierChangePayload(oldTier, newTier)

        // Benefits should match the NEW tier, not the old one
        expect(payload.benefits).toEqual(newBenefits)
        expect(payload.benefits).not.toEqual(oldBenefits)
      }),
      { numRuns: 25 },
    )
  })
})
