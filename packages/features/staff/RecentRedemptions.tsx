import { useEffect, useState } from 'react'

import { api } from '../../shared/lib/api'
import { formatRelativeTime } from '../../shared/lib/formatters'
import { Box, Row, Text } from '../../shared/components/primitives'

interface Redemption {
  code: string
  redeemedAt: string
}

export function RecentRedemptions() {
  const [redemptions, setRedemptions] = useState<Redemption[]>([])

  useEffect(() => {
    let cancelled = false

    async function fetch() {
      try {
        const res = await api.get<{ items: Redemption[] }>('/v1/staff/recent-redemptions')
        if (!cancelled) setRedemptions(res.items)
      } catch {
        // Fail silently — non-critical
      }
    }

    fetch()
    const interval = setInterval(fetch, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <Box className="flex-1 overflow-y-auto px-5 pt-4">
      <Text className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3 block">
        Recent Redemptions
      </Text>

      {redemptions.length === 0 ? (
        <Text className="text-[var(--text-muted)] text-sm">No redemptions yet</Text>
      ) : (
        <Box className="flex flex-col gap-2">
          {redemptions.map((r: Redemption) => (
            <Row
              key={r.code + r.redeemedAt}
              className="items-center justify-between bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3"
            >
              <Text className="text-[var(--text-primary)] font-mono text-sm tracking-wider">
                {r.code}
              </Text>
              <Text className="text-[var(--text-muted)] text-xs">
                {formatRelativeTime(r.redeemedAt)}
              </Text>
            </Row>
          ))}
        </Box>
      )}
    </Box>
  )
}
