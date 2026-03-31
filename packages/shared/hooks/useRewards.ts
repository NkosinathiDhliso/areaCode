import { useCallback, useEffect, useState } from 'react'

import { api } from '../lib/api'
import type { Reward } from '../types'
import { useRewardStore } from '../stores/rewardStore'

export function useRewards(nodeId: string | null) {
  const setNodeRewards = useRewardStore((s) => s.setNodeRewards)
  const rewards = useRewardStore((s) => (nodeId ? s.activeRewards[nodeId] : undefined))
  const [isPending, setIsPending] = useState(false)

  const fetchRewards = useCallback(async () => {
    if (!nodeId) return
    setIsPending(true)
    try {
      const res = await api.get<{ items: Reward[] }>(`/v1/nodes/${nodeId}/rewards`)
      setNodeRewards(nodeId, res.items)
    } catch {
      // Fail silently
    } finally {
      setIsPending(false)
    }
  }, [nodeId, setNodeRewards])

  useEffect(() => {
    fetchRewards()
  }, [fetchRewards])

  return { rewards: rewards ?? [], isPending, refetch: fetchRewards }
}
