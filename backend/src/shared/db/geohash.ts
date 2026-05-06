// Minimal geohash encoder (base32, standard geohash algorithm).
// Used to build a sparse spatial index on DynamoDB nodes without adding a dep.
//
// Precision reference (approx):
//   5 chars ≈ 4.9 km × 4.9 km cell   ← use for city-wide nearby scans
//   6 chars ≈ 1.2 km × 0.6 km cell
//   7 chars ≈ 153 m × 153 m cell     ← use for "who is here" / walk radius
//   8 chars ≈ 38 m × 19 m cell
//
// Strategy:
//   - Store `geohash5` and `geohash7` on every node row.
//   - Geohash5Index (GSI, hash_key=geohash5, range_key=geohash7) enables
//     sub-kilometre queries by scanning ONLY cells that intersect the radius.
//   - Always query the 9-cell neighbourhood of the centre to avoid edge misses.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let minLat = -90
  let maxLat = 90
  let minLng = -180
  let maxLng = 180
  let hash = ''
  let bits = 0
  let bit = 0
  let even = true

  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2
      if (lng >= mid) {
        bits = (bits << 1) | 1
        minLng = mid
      } else {
        bits = bits << 1
        maxLng = mid
      }
    } else {
      const mid = (minLat + maxLat) / 2
      if (lat >= mid) {
        bits = (bits << 1) | 1
        minLat = mid
      } else {
        bits = bits << 1
        maxLat = mid
      }
    }
    even = !even
    bit++
    if (bit === 5) {
      hash += BASE32[bits]
      bit = 0
      bits = 0
    }
  }
  return hash
}

function decodeGeohash(hash: string): { lat: number; lng: number; latErr: number; lngErr: number } {
  let minLat = -90
  let maxLat = 90
  let minLng = -180
  let maxLng = 180
  let even = true

  for (const ch of hash) {
    const idx = BASE32.indexOf(ch)
    if (idx < 0) throw new Error(`Invalid geohash char: ${ch}`)
    for (let b = 4; b >= 0; b--) {
      const bit = (idx >> b) & 1
      if (even) {
        const mid = (minLng + maxLng) / 2
        if (bit) minLng = mid
        else maxLng = mid
      } else {
        const mid = (minLat + maxLat) / 2
        if (bit) minLat = mid
        else maxLat = mid
      }
      even = !even
    }
  }
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    latErr: (maxLat - minLat) / 2,
    lngErr: (maxLng - minLng) / 2,
  }
}

/** Return the 9 geohash cells (centre + 8 neighbours) at the given precision. */
export function neighbourCells(lat: number, lng: number, precision: number): string[] {
  const centre = encodeGeohash(lat, lng, precision)
  const { latErr, lngErr } = decodeGeohash(centre)
  const set = new Set<string>([centre])
  for (const dLat of [-2 * latErr, 0, 2 * latErr]) {
    for (const dLng of [-2 * lngErr, 0, 2 * lngErr]) {
      const la = Math.max(-90, Math.min(90, lat + dLat))
      const ln = ((lng + dLng + 540) % 360) - 180
      set.add(encodeGeohash(la, ln, precision))
    }
  }
  return Array.from(set)
}

/** Haversine distance in metres. */
export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Pick a geohash precision that yields cells large enough to cover `radiusMetres`.
 * Conservative — prefers fewer, larger cells to minimise Query count.
 */
export function pickPrecision(radiusMetres: number): 4 | 5 | 6 | 7 {
  if (radiusMetres > 20_000) return 4 // ~39km
  if (radiusMetres > 2_500) return 5 // ~4.9km
  if (radiusMetres > 600) return 6 // ~1.2km
  return 7 // ~153m
}
