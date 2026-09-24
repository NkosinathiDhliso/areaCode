/**
 * Check-in cooldown keys and durations — one home.
 *
 * Two services read this: the check-in service sets the key and refuses a
 * check-in while it is live, and the check-out service clears the presence key
 * when a consumer leaves. The key shape lives here so those two can never
 * disagree about which row they are talking about.
 */

/** A reward check-in is limited to once every four hours at a venue. */
export const REWARD_COOLDOWN_SECONDS = 14400

/** A presence check-in is limited to once an hour at a venue. */
export const PRESENCE_COOLDOWN_SECONDS = 3600

/** The two cooldowns a check-in can be subject to, keyed by check-in type. */
export type CooldownKind = 'reward' | 'presence'

/** `reward` only for an actual reward check-in; everything else is presence. */
export function cooldownKindFor(checkInType: string): CooldownKind {
  return checkInType === 'reward' ? 'reward' : 'presence'
}

/** KV key for one consumer's cooldown of one kind at one venue. */
export function checkInCooldownKey(kind: CooldownKind, userId: string, nodeId: string): string {
  return `checkin:cooldown:${kind}:${userId}:${nodeId}`
}

/** How long a cooldown of this kind lasts, in seconds. */
export function cooldownSecondsFor(kind: CooldownKind): number {
  return kind === 'reward' ? REWARD_COOLDOWN_SECONDS : PRESENCE_COOLDOWN_SECONDS
}
