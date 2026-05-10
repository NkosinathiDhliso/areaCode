/**
 * Marker clustering logic for the map.
 * When > 30 markers visible, clusters low-activity markers (pulse < 11)
 * into count indicators while keeping active/buzzing/popping individually visible.
 *
 * Requirements: 30.3
 */

const CLUSTER_THRESHOLD = 30
const LOW_ACTIVITY_THRESHOLD = 11
const CLUSTER_DISTANCE_PX = 60

export interface ClusterableMarker {
  id: string
  pulseScore: number
  x: number
  y: number
}

export interface ClusterResult {
  /** Markers that remain individually visible */
  individual: ClusterableMarker[]
  /** Clusters of low-activity markers */
  clusters: MarkerCluster[]
}

export interface MarkerCluster {
  /** Center x position */
  x: number
  /** Center y position */
  y: number
  /** Number of markers in this cluster */
  count: number
  /** IDs of markers in this cluster */
  markerIds: string[]
}

/**
 * Determine if clustering should be applied.
 */
export function shouldCluster(visibleCount: number): boolean {
  return visibleCount > CLUSTER_THRESHOLD
}

/**
 * Cluster markers based on activity level and proximity.
 * - Markers with pulseScore >= 11 (active/buzzing/popping) always stay individual
 * - Markers with pulseScore < 11 (dormant/quiet) get clustered when nearby
 */
export function clusterMarkers(markers: ClusterableMarker[]): ClusterResult {
  if (!shouldCluster(markers.length)) {
    return { individual: markers, clusters: [] }
  }

  // Separate high-activity (always individual) from low-activity (clusterable)
  const highActivity: ClusterableMarker[] = []
  const lowActivity: ClusterableMarker[] = []

  for (const marker of markers) {
    if (marker.pulseScore >= LOW_ACTIVITY_THRESHOLD) {
      highActivity.push(marker)
    } else {
      lowActivity.push(marker)
    }
  }

  // Cluster low-activity markers by proximity
  const clusters: MarkerCluster[] = []
  const clustered = new Set<string>()

  for (const marker of lowActivity) {
    if (clustered.has(marker.id)) continue

    // Find nearby low-activity markers
    const nearby: ClusterableMarker[] = [marker]
    clustered.add(marker.id)

    for (const other of lowActivity) {
      if (clustered.has(other.id)) continue
      const dx = marker.x - other.x
      const dy = marker.y - other.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance <= CLUSTER_DISTANCE_PX) {
        nearby.push(other)
        clustered.add(other.id)
      }
    }

    if (nearby.length > 1) {
      // Create cluster at centroid
      const cx = nearby.reduce((sum, m) => sum + m.x, 0) / nearby.length
      const cy = nearby.reduce((sum, m) => sum + m.y, 0) / nearby.length
      clusters.push({
        x: cx,
        y: cy,
        count: nearby.length,
        markerIds: nearby.map((m) => m.id),
      })
    } else {
      // Single marker, keep individual
      highActivity.push(marker)
    }
  }

  return { individual: highActivity, clusters }
}

export { CLUSTER_THRESHOLD, LOW_ACTIVITY_THRESHOLD, CLUSTER_DISTANCE_PX }
