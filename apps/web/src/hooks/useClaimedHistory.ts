import { api } from '@area-code/shared/lib/api'
import { useQuery } from '@tanstack/react-query'

import type { ClaimedGet } from '../components/rewards/types'

/** The viewer's own claimed-and-used get history (redeemed gets, newest first). */
export function useClaimedHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['rewards', 'claimed-history'],
    queryFn: () => api.get<ClaimedGet[]>('/v1/users/me/claimed-rewards'),
    enabled,
    staleTime: 60_000,
  })
}
