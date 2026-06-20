/**
 * QR parsing for the map check-in QR_Fallback path.
 *
 * Pure, total logic core: extracts a venue's `{ nodeId, token }` from an
 * Area Code venue QR payload of the form `…/qr/{nodeId}/{token}`, and returns
 * `null` for anything that does not match. It never throws.
 *
 * See design.md Properties 20 (valid round-trip) and 21 (invalid rejection).
 *
 * This feature is strictly client-side UI: no backend call is made here, and
 * the QR path carries no phone number or SMS — it only proves venue presence.
 */

export interface VenueQr {
  nodeId: string
  token: string
}

/**
 * Matches the trailing `/qr/{nodeId}/{token}` of a payload.
 *
 * - `{nodeId}` and `{token}` are each one-or-more characters that are not a
 *   path separator (`/`), query (`?`), or fragment (`#`) marker, so both
 *   segments are guaranteed non-empty.
 * - `{token}` must be the final path segment: an optional trailing slash and
 *   an optional query string and/or fragment may follow, but no further path
 *   segment may.
 *
 * The leading `…` is intentionally unanchored so full URLs
 * (`https://host/qr/{id}/{token}`) and bare paths (`/qr/{id}/{token}`) both
 * parse identically.
 */
const VENUE_QR_PATTERN = /\/qr\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/

/**
 * Extracts `{ nodeId, token }` from a venue QR payload.
 *
 * @param input the scanned QR contents (URL or path).
 * @returns the parsed venue QR, or `null` when the input does not match the
 *   Area Code venue QR pattern.
 */
export function parseVenueQr(input: string): VenueQr | null {
  if (typeof input !== 'string') return null

  const match = VENUE_QR_PATTERN.exec(input.trim())
  if (!match) return null

  const [, nodeId, token] = match
  if (!nodeId || !token) return null

  return { nodeId, token }
}
