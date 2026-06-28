import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { deriveHasLiveGets } from '../lib/carouselRanking'

interface NearbyReward {
  nodeId: string
  getCategory?: 'loyalty' | 'event' | 'offer'
  lifecycle?: 'upcoming' | 'live' | 'ended'
}

/** JHB downtown fallback, matching the feed query so the cache key is shared. */
const DEFAULT_LAT = -26.2041
const DEFAULT_LNG = 28.0473

/**
 * Populates `mapStore.hasLiveGets` (the priority-4 live-gets ranking signal)
 * from the rewards-near-me feed.
 *
 * Without this the signal is always empty during browse and R5 / Property 5
 * have no observable effect on ranking. The query key and URL are shared with
 * the feed's live-gets fetch so React Query serves both from one cached fetch
 * (no extra network call, R14.2). The signal degrades gracefully to `false`
 * (no effect) when unauthenticated or when the fetch has not resolved.
 *
 * Requirements: 5.1, 5.2, 15.2
 */
export function useHasLiveGets() {
  const pos = useLocationStore((s) => s.lastKnownPosition)
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const setHasLiveGets = useMapStore((s) => s.setHasLiveGets)

  const { data } = useQuery({
    queryKey: ['rewards', 'near-me', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<NearbyReward[]>(`/v1/rewards/near-me?lat=${pos?.lat ?? DEFAULT_LAT}&lng=${pos?.lng ?? DEFAULT_LNG}`),
    enabled: isAuthenticated,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!data) return
    setHasLiveGets(deriveHasLiveGets(data))
  }, [data, setHasLiveGets])
}
