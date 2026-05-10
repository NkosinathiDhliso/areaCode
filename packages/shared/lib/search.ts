import type { NodeState } from '../types'

export interface SearchableNode {
  id: string
  name: string
  category: string
  lat: number
  lng: number
  state: NodeState
  pulseScore: number
  boostUntil?: string | null
}

export interface SearchResult {
  id: string
  name: string
  category: string
  distanceKm: number | null
  state: NodeState
  pulseScore: number
  isBoosted: boolean
}

/**
 * Haversine distance in km between two coordinates.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Client-side search filtering: case-insensitive includes() on node name and category.
 * Sorts by haversine distance when location is available.
 * Returns within 500ms (synchronous filtering on cached data).
 */
export function searchNodes(
  query: string,
  nodes: SearchableNode[],
  userLat?: number | null,
  userLng?: number | null,
): SearchResult[] {
  if (!query.trim()) return []

  const q = query.toLowerCase()

  const matches = nodes.filter(
    (node) =>
      node.name.toLowerCase().includes(q) ||
      node.category.toLowerCase().includes(q),
  )

  const results: SearchResult[] = matches.map((node) => {
    const distanceKm =
      userLat != null && userLng != null
        ? haversineKm(userLat, userLng, node.lat, node.lng)
        : null

    return {
      id: node.id,
      name: node.name,
      category: node.category,
      distanceKm,
      state: node.state,
      pulseScore: node.pulseScore,
      isBoosted: node.boostUntil ? new Date(node.boostUntil).getTime() > Date.now() : false,
    }
  })

  // Sort by distance when location available, otherwise by pulse score descending
  if (userLat != null && userLng != null) {
    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
  } else {
    results.sort((a, b) => b.pulseScore - a.pulseScore)
  }

  return results
}
