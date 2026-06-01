import { useCallback, useEffect, useState } from 'react'

import { api } from '../lib/api'
import { useRewardStore, type UnclaimedReward } from '../stores/rewardStore'

/**
 * Loads the consumer's earned-but-not-yet-redeemed rewards (their "wallet")
 * from the backend and keeps the shared reward store in sync.
 *
 * The store is also updated live by `useRewardSocket` when a `reward:claimed`
 * event arrives, so the wallet stays fresh without a manual refetch. This hook
 * is the source of truth on mount / screen focus and after a redemption.
 */
export function useUnclaimedRewards() {
  const unclaimedRewards = useRewardStore((s) => s.unclaimedRewards)
  const setUnclaimedRewards = useRewardStore((s) => s.setUnclaimedRewards)
  const removeUnclaimedReward = useRewardStore((s) => s.removeUnclaimedReward)
  const [isPending, setIsPending] = useState(true)
  const [error, setError] = useState(false)

  const fetchRewards = useCallback(async () => {
    setIsPending(true)
    setError(false)
    try {
      const items = await api.get<UnclaimedReward[]>('/v1/users/me/unclaimed-rewards')
      // Drop any locally-expired codes the server might still surface and sort
      // soonest-expiring first so the most urgent code is at the top.
      const now = Date.now()
      const live = (items ?? [])
        .filter((r) => !r.codeExpiresAt || Date.parse(r.codeExpiresAt) > now)
        .sort((a, b) => Date.parse(a.codeExpiresAt ?? '') - Date.parse(b.codeExpiresAt ?? ''))
      setUnclaimedRewards(live)
    } catch {
      setError(true)
    } finally {
      setIsPending(false)
    }
  }, [setUnclaimedRewards])

  useEffect(() => {
    void fetchRewards()
  }, [fetchRewards])

  return {
    rewards: unclaimedRewards,
    isPending,
    error,
    refetch: fetchRewards,
    dismiss: removeUnclaimedReward,
  }
}
