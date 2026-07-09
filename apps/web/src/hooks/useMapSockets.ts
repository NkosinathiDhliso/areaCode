import { useNodeCreated } from '@area-code/shared/hooks/useNodeCreated'
import { useNodePulse } from '@area-code/shared/hooks/useNodePulse'
import { useRealtimeToast } from '@area-code/shared/hooks/useRealtimeToast'
import { useSocketRoom } from '@area-code/shared/hooks/useSocketRoom'
import { useStateSurge } from '@area-code/shared/hooks/useStateSurge'

/**
 * Composite hook that wires all socket subscriptions for the map screen.
 * Reduces import count in MapScreen while keeping each hook focused.
 *
 * Note: reward-claim and notification subscriptions are mounted app-wide in
 * `App.tsx` (so the wallet and notification center update on any screen), so
 * they are intentionally not duplicated here.
 */
export function useMapSockets(citySlug: string, accessToken: string | undefined, userId: string | null) {
  useSocketRoom(`city:${citySlug}`, accessToken, {
    ...(userId ? { userId } : {}),
    citySlug,
  })
  useNodePulse(accessToken, { citySlug })
  useNodeCreated(accessToken, { citySlug })
  useRealtimeToast(accessToken, userId ?? undefined)
  useStateSurge(accessToken)
}
