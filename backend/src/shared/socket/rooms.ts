/**
 * Socket room name helpers and room authorization rules.
 * Centralises room naming to prevent typos. Room membership lives on the
 * websocket-connections table (roomId attribute, RoomIndex GSI); user-directed
 * delivery uses the userId attribute (UserIndex GSI), not a room.
 */

export const cityRoom = (citySlug: string) => `city:${citySlug}` as const
export const businessRoom = (businessId: string) => `business:${businessId}` as const

/** Valid city slugs — prevents joining arbitrary rooms via citySlug. */
export const VALID_CITY_SLUGS = new Set(['johannesburg', 'cape-town', 'durban'])

/**
 * True when a connection may join `room`. Fail closed:
 *   - city:{slug}      — only whitelisted city slugs
 *   - business:{id}    — only the connection's own verified businessId
 * Everything else (including user:* — user delivery is by UserIndex, never a
 * joinable room) is denied.
 */
export function isRoomAllowed(room: string, identity: { businessId?: string | undefined }): boolean {
  if (room.startsWith('city:')) {
    return VALID_CITY_SLUGS.has(room.slice(5))
  }
  if (room.startsWith('business:')) {
    return !!identity.businessId && room === businessRoom(identity.businessId)
  }
  return false
}
