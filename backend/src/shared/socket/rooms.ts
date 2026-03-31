/**
 * Socket room name helpers.
 * Centralises room naming to prevent typos.
 */

export const cityRoom = (citySlug: string) => `city:${citySlug}` as const;
export const nodeRoom = (nodeId: string) => `node:${nodeId}` as const;
export const userRoom = (userId: string) => `user:${userId}` as const;
export const businessRoom = (businessId: string) => `business:${businessId}` as const;
