// ============================================================================
// Proximity Classification
// ============================================================================

/**
 * Classification result for a signal based on user proximity to the node.
 * - Proximity_Report: user is within 150 metres of the node
 * - Remote_Report: user is more than 150 metres away or coordinates are missing
 */
export type ProximityClassification = 'Proximity_Report' | 'Remote_Report'

// ============================================================================
// Constants
// ============================================================================

/** Earth's mean radius in metres */
const EARTH_RADIUS_M = 6_371_000

/** Proximity threshold in metres — signals within this distance are Proximity_Reports */
export const PROXIMITY_THRESHOLD_M = 150

// ============================================================================
// Haversine Distance
// ============================================================================

/**
 * Computes the great-circle distance between two points on Earth using the
 * haversine formula.
 *
 * @param lat1 - Latitude of point 1 in degrees
 * @param lng1 - Longitude of point 1 in degrees
 * @param lat2 - Latitude of point 2 in degrees
 * @param lng2 - Longitude of point 2 in degrees
 * @returns Distance in metres
 *
 * This is a pure function with no side effects.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_M * c
}

// ============================================================================
// Proximity Classification
// ============================================================================

/**
 * Classifies a signal submission as either a Proximity_Report or Remote_Report
 * based on the haversine distance between the user's coordinates and the node's
 * coordinates.
 *
 * Rules:
 * - If userLat or userLng is undefined → Remote_Report (no coordinates provided)
 * - If haversine distance <= 150 metres → Proximity_Report
 * - If haversine distance > 150 metres → Remote_Report
 *
 * @param userLat - User's latitude (undefined if not provided)
 * @param userLng - User's longitude (undefined if not provided)
 * @param nodeLat - Node's latitude
 * @param nodeLng - Node's longitude
 * @returns ProximityClassification
 *
 * This is a pure function with no side effects.
 */
export function classifyProximity(
  userLat: number | undefined,
  userLng: number | undefined,
  nodeLat: number,
  nodeLng: number
): ProximityClassification {
  // No coordinates provided → Remote_Report
  if (userLat === undefined || userLng === undefined) {
    return 'Remote_Report'
  }

  const distance = haversineDistance(userLat, userLng, nodeLat, nodeLng)

  return distance <= PROXIMITY_THRESHOLD_M ? 'Proximity_Report' : 'Remote_Report'
}
