import { api } from '@area-code/shared/lib/api'
import { useQuery } from '@tanstack/react-query'

import type { RecentClaim } from '../components/rewards/types'

/**
 * "Just claimed near you" social-proof feed. Anonymised recent claims at nearby
 * venues, refreshed often enough to feel live without hammering the endpoint.
 */
export function useRecentClaims(pos: { lat: number; lng: number } | null, enabled: boolean) {
  return useQuery({
    queryKey: ['rewards', 'claims', 'recent', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<RecentClaim[]>(`/v1/rewards/claims/recent?lat=${pos?.lat ?? -26.2041}&lng=${pos?.lng ?? 28.0473}`),
    enabled,
    staleTime: 60_000,
  })
}
