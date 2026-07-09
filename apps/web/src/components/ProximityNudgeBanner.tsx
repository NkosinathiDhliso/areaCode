/**
 * Banner shown when the consumer arrives at a venue they've previously
 * checked into. Wires up the shared `useProximityNudge` hook with the
 * data sources the consumer web has on hand: location store +
 * /v1/users/me/visited.
 *
 * Defends against the §1.4 Starbucks "queue forms before staff can
 * pitch" failure (see docs/CHURN_DEFENSES.md).
 */

import { useProximityNudge, type VisitedNode } from '@area-code/shared/hooks/useProximityNudge'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { MapPin, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AppRoute } from '../types'

interface VisitedResponse {
  items: VisitedNode[]
}

interface ProximityNudgeBannerProps {
  onNavigate: (route: AppRoute) => void
}

export function ProximityNudgeBanner({ onNavigate }: ProximityNudgeBannerProps) {
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const position = useLocationStore((s) => s.lastKnownPosition)
  const privacyLevel = useUserStore((s) => s.user?.privacyLevel ?? 'friends_only')
  const proximityEnabled = useUserStore((s) => s.user?.proximityNudgesEnabled ?? true)
  const [visited, setVisited] = useState<VisitedNode[]>([])

  // Refresh the visited-list once an hour. Cheap and doesn't churn the API.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    const fetchVisited = () =>
      api
        .get<VisitedResponse>('/v1/users/me/visited')
        .then((res) => {
          if (!cancelled) setVisited(res.items ?? [])
        })
        .catch(() => {
          // Failure is silent - the proximity feature simply doesn't fire.
        })
    void fetchVisited()
    const id = setInterval(fetchVisited, 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [isAuthenticated])

  const enabled = isAuthenticated && privacyLevel !== 'private' && proximityEnabled
  const { current, dismiss } = useProximityNudge({ position, visited, enabled })

  if (!current) return null

  const venueName = current.node.name ?? 'this venue'

  return (
    <div
      data-testid="proximity-nudge-banner"
      role="status"
      className="absolute left-3 right-3 z-30 bg-[var(--bg-raised)] border border-[var(--accent)] rounded-2xl p-3 shadow-lg flex flex-row items-center gap-3"
      style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <MapPin size={20} strokeWidth={1.5} className="text-[var(--accent)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-sm font-medium truncate">You're at {venueName}</p>
        <p className="text-[var(--text-muted)] text-xs">Check in to keep your streak going.</p>
      </div>
      <button
        onClick={() => {
          dismiss()
          onNavigate('map')
        }}
        className="bg-[var(--accent-cta)] text-white text-xs font-medium rounded-xl px-3 py-1.5 shrink-0"
      >
        Check in
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="text-[var(--text-muted)] shrink-0">
        <X size={18} strokeWidth={1.5} />
      </button>
    </div>
  )
}
