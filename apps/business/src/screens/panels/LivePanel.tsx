import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import { useSocketRoom } from '@area-code/shared/hooks/useSocketRoom'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import type { BusinessCheckinPayload, LiveStats } from '@area-code/shared/types'

interface LiveAvatar {
  username: string | undefined
  avatarUrl: string | undefined
  timestamp: string
}

const MAX_AVATARS = 8
const POLL_INTERVAL_MS = 30_000

export function LivePanel() {
  const { t } = useTranslation()
  const { accessToken, businessId } = useBusinessAuthStore()
  const [rewardsClaimed, setRewardsClaimed] = useState(0)
  const [avatars, setAvatars] = useState<LiveAvatar[]>([])

  // Fetch live stats with 30s polling
  const { data: stats } = useQuery({
    queryKey: ['business', 'live-stats'],
    queryFn: () => api.get<LiveStats>('/v1/business/me/live-stats'),
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
    retry: 1,
  })

  // Join business:{businessId} room with symmetric cleanup via useSocketRoom
  const room = businessId ? `business:${businessId}` : null
  useSocketRoom(room, accessToken ?? undefined)

  // Listen for business:checkin events
  const handleCheckin = useCallback((payload: BusinessCheckinPayload) => {
    setAvatars((prev) => {
      const next: LiveAvatar[] = [
        { username: payload.username, avatarUrl: payload.avatarUrl, timestamp: payload.timestamp },
        ...prev,
      ]
      return next.slice(0, MAX_AVATARS)
    })
  }, [])

  // Listen for business:reward_claimed events
  const handleRewardClaimed = useCallback(() => {
    setRewardsClaimed((prev) => prev + 1)
  }, [])

  useEffect(() => {
    if (!businessId || !accessToken) return
    const socket = getSocket(accessToken)

    socket.on('business:checkin', handleCheckin)
    socket.on('business:reward_claimed', handleRewardClaimed)

    return () => {
      socket.off('business:checkin', handleCheckin)
      socket.off('business:reward_claimed', handleRewardClaimed)
    }
  }, [businessId, accessToken, handleCheckin, handleRewardClaimed])

  return (
    <div className="p-5 flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 py-8">
        {stats === undefined ? (
          <div className="w-20 h-16 rounded-xl bg-[var(--bg-raised)] animate-pulse" />
        ) : (
          <span className="text-[var(--text-primary)] text-6xl font-bold font-[Syne] tracking-[-0.03em]">
            {stats.checkInsToday}
          </span>
        )}
        <span className="text-[var(--text-secondary)] text-sm">{t('biz.live.checkinsToday')}</span>
      </div>

      {/* Live aliveness signals: pulse score (how buzzing right now) and the
          all-time total. Pulse leads - it is the honest "how alive" readout. */}
      {stats && (
        <div className="flex flex-row items-stretch justify-center gap-3">
          {stats.pulseScore !== null && (
            <div className="flex-1 max-w-[160px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-col items-center gap-1">
              <span className="text-[var(--text-primary)] text-2xl font-bold font-[Syne]">
                {Math.round(stats.pulseScore)}
              </span>
              <span className="text-[var(--text-secondary)] text-xs">{t('biz.live.pulse', 'Pulse')}</span>
            </div>
          )}
          <div className="flex-1 max-w-[160px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-col items-center gap-1">
            <span className="text-[var(--text-primary)] text-2xl font-bold font-[Syne]">{stats.totalCheckIns}</span>
            <span className="text-[var(--text-secondary)] text-xs">{t('biz.live.totalCheckIns', 'All-time')}</span>
          </div>
        </div>
      )}

      {/* Live avatars */}
      {avatars.length > 0 && (
        <div className="flex flex-row items-center gap-2 justify-center">
          {avatars.map((a, i) => (
            <div
              key={`${a.timestamp}-${i}`}
              className="w-9 h-9 rounded-full bg-[var(--bg-raised)] border-2 border-[var(--accent)] flex items-center justify-center text-xs text-[var(--text-secondary)] overflow-hidden"
              title={a.username}
            >
              {a.avatarUrl ? (
                <img src={a.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{a.username?.charAt(0)?.toUpperCase() ?? '?'}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Rewards claimed counter */}
      {rewardsClaimed > 0 && (
        <div className="flex flex-row items-center justify-center gap-2 text-[var(--text-secondary)] text-sm">
          <span className="text-[var(--accent)] font-semibold">{rewardsClaimed}</span>
          <span>{t('biz.live.rewardsClaimed')}</span>
        </div>
      )}

      {stats && stats.totalCheckIns < 10 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5">
          <h3 className="text-[var(--text-primary)] font-medium mb-3">{t('biz.live.zeroState')}</h3>
          <ul className="flex flex-col gap-2 text-[var(--text-secondary)] text-sm">
            <li className="flex flex-row items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[var(--bg-raised)] flex items-center justify-center text-xs">
                1
              </span>
              {t('biz.live.step1')}
            </li>
            <li className="flex flex-row items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[var(--bg-raised)] flex items-center justify-center text-xs">
                2
              </span>
              {t('biz.live.step2')}
            </li>
            <li className="flex flex-row items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[var(--bg-raised)] flex items-center justify-center text-xs">
                3
              </span>
              {t('biz.live.step3')}
            </li>
            <li className="flex flex-row items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[var(--bg-raised)] flex items-center justify-center text-xs">
                4
              </span>
              {t('biz.live.step4')}
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
