import { useNodePulse } from '@area-code/shared/hooks/useNodePulse'
import { useRealtimeToast } from '@area-code/shared/hooks/useRealtimeToast'
import { useStateSurge } from '@area-code/shared/hooks/useStateSurge'
import { useRewardSocket } from '@area-code/shared/hooks/useRewardSocket'
import { useSocketRoom } from '@area-code/shared/hooks/useSocketRoom'

/**
 * Composite hook that wires all socket subscriptions for the map screen.
 * Reduces import count in MapScreen while keeping each hook focused.
 */
export function useMapSockets(
  citySlug: string,
  accessToken: string | undefined,
  userId: string | null,
) {
  useSocketRoom(`city:${citySlug}`, accessToken, {
    ...(userId ? { userId } : {}),
    citySlug,
  })
  useNodePulse(accessToken, { citySlug })
  useRealtimeToast(accessToken, userId ?? undefined)
  useStateSurge(accessToken)
  useRewardSocket(accessToken)
}
