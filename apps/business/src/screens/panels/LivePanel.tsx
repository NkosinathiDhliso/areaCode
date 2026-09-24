import type { FoundVia } from '@area-code/shared/constants/attribution'
import { useSocketRoom } from '@area-code/shared/hooks/useSocketRoom'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import type { BusinessCheckinPayload, BusinessGoingPayload, LiveGoingLine, LiveStats } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { FoundViaBadge } from '../../components/FoundViaBadge'

import { LiveZeroState } from './LiveZeroState'

interface LiveAvatar {
  username: string | undefined
  avatarUrl: string | undefined
  timestamp: string
  foundVia: FoundVia
}

/** One venue's Going count for tonight. Intent before doors, never presence. */
interface GoingLine {
  nodeName: string
  goingCount: number
}

const MAX_AVATARS = 8
const POLL_INTERVAL_MS = 30_000

/** Socket arrivals counted on top of the last polled figures. */
interface CounterBumps {
  checkIns: number
  rewards: number
}

const NO_BUMPS: CounterBumps = { checkIns: 0, rewards: 0 }

export function LivePanel() {
  const { t } = useTranslation()
  const { accessToken, businessId } = useBusinessAuthStore()
  const [avatars, setAvatars] = useState<LiveAvatar[]>([])
  const [goingByNode, setGoingByNode] = useState<Record<string, GoingLine>>({})
  // Live arrivals since the last poll resolved (R15.10). The server value is the
  // owner's number; these are the bumps that keep the tile moving between polls,
  // and they are dropped the moment a fresher server value lands, so the panel
  // can never drift into arithmetic the server would disagree with.
  const [bumps, setBumps] = useState<CounterBumps>(NO_BUMPS)

  // Fetch live stats with 30s polling
  const {
    data: stats,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['business', 'live-stats'],
    queryFn: () => api.get<LiveStats>('/v1/business/me/live-stats'),
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
    retry: 1,
  })

  // Every fresh server answer supersedes the bumps it now includes. Keyed on
  // `dataUpdatedAt` rather than on the data object so an unchanged payload still
  // clears them: a tab that woke up and re-seeded must not carry a stale bump.
  useEffect(() => {
    if (dataUpdatedAt === 0) return
    setBumps((prev) => (prev === NO_BUMPS ? prev : NO_BUMPS))
  }, [dataUpdatedAt])

  // Join business:{businessId} room with symmetric cleanup via useSocketRoom
  const room = businessId ? `business:${businessId}` : null
  useSocketRoom(room, accessToken ?? undefined)

  // Listen for business:checkin events. The arriving check-in carries its
  // Found_Via, so the badge is immediate; the split counts and their two
  // sentences are re-read from the server rather than incremented here, so the
  // Found_You fact keeps exactly one wording and one arithmetic (R4.6).
  //
  // The check-in tile does bump (R15.10): an owner watching the door must see the
  // number move as the person walks in, not 30 seconds later. The bump is dropped
  // as soon as the refetch below answers, so the server stays the arithmetic.
  const handleCheckin = useCallback(
    (payload: BusinessCheckinPayload) => {
      setBumps((prev) => ({ ...prev, checkIns: prev.checkIns + 1 }))
      setAvatars((prev) => {
        const next: LiveAvatar[] = [
          {
            username: payload.username,
            avatarUrl: payload.avatarUrl,
            timestamp: payload.timestamp,
            foundVia: payload.foundVia,
          },
          ...prev,
        ]
        return next.slice(0, MAX_AVATARS)
      })
      void refetch()
    },
    [refetch],
  )

  // Listen for business:reward_claimed events. The count itself comes from the
  // poll, which counts the day's redemption rows on the server (R15.10). Before
  // this, the panel counted socket events from zero, so a reload lost the day's
  // redemptions and showed nothing until the next claim.
  const handleRewardClaimed = useCallback(() => {
    setBumps((prev) => ({ ...prev, rewards: prev.rewards + 1 }))
    void refetch()
  }, [refetch])

  // A reconnect re-seeds from the poll (R15.10). A backgrounded iOS tab misses
  // events while the socket is dead, so the counters it holds are stale in an
  // unknown direction: the only honest move is to ask the server again and drop
  // the bumps rather than keep counting on top of a number nobody trusts.
  const handleReconnect = useCallback(() => {
    setBumps(NO_BUMPS)
    void refetch()
  }, [refetch])

  // Going, per venue (R9.5). The server sends the true count on every toggle, so
  // the panel stores it verbatim rather than incrementing: it is the owner's
  // number, not the client's arithmetic. A count of zero is stored and rendered
  // as zero, because an owner watching the pipeline before doors needs the drop
  // as much as the rise.
  //
  // No seed is invented. A venue appears only once a count for it has been
  // measured, by the server poll below or by a socket event: an unmeasured venue
  // showing "0 marked going" would be a number nobody counted
  // (`honest-presence.md`).
  const handleGoing = useCallback((payload: BusinessGoingPayload) => {
    setGoingByNode((prev) => ({
      ...prev,
      [payload.nodeId]: { nodeName: payload.nodeName, goingCount: payload.goingCount },
    }))
  }, [])

  // Seed from the live-stats poll (R9.5). Without this an owner who opens the
  // panel at 20:00 with marks already recorded sees no Going line at all until
  // somebody toggles, which reads as an empty pipeline rather than as the
  // pipeline they have.
  //
  // The socket is the fresher fact, so a venue already in state is left alone:
  // `business:going` carries the count the server computed at the moment of the
  // toggle, and a 30-second poll must never overwrite it with an older number.
  const goingSeed: LiveGoingLine[] | undefined = stats?.goingTonight
  useEffect(() => {
    if (!goingSeed || goingSeed.length === 0) return
    setGoingByNode((prev) => {
      const next = { ...prev }
      let changed = false
      for (const line of goingSeed) {
        if (line.nodeId in prev) continue
        next[line.nodeId] = { nodeName: line.nodeName, goingCount: line.goingCount }
        changed = true
      }
      return changed ? next : prev
    })
  }, [goingSeed])

  useEffect(() => {
    if (!businessId || !accessToken) return
    const socket = getSocket(accessToken)

    socket.on('business:checkin', handleCheckin)
    socket.on('business:reward_claimed', handleRewardClaimed)
    socket.on('business:going', handleGoing)
    socket.on('connect', handleReconnect)

    return () => {
      socket.off('business:checkin', handleCheckin)
      socket.off('business:reward_claimed', handleRewardClaimed)
      socket.off('business:going', handleGoing)
      socket.off('connect', handleReconnect)
    }
  }, [businessId, accessToken, handleCheckin, handleRewardClaimed, handleGoing, handleReconnect])

  return (
    <div className="p-5 flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 py-8">
        {stats === undefined ? (
          <div className="w-20 h-16 rounded-xl bg-[var(--bg-raised)] animate-pulse" />
        ) : (
          <span
            data-testid="live-checkins-today"
            className="text-[var(--text-primary)] text-6xl font-bold font-[Syne] tracking-[-0.03em]"
          >
            {stats.checkInsToday + bumps.checkIns}
          </span>
        )}
        <span className="text-[var(--text-secondary)] text-sm">{t('biz.live.checkinsToday')}</span>
      </div>

      {/* The Receipt, two lines: how many people found the venue on Area Code
          and checked in, and how many were already in the room. Both sentences
          are rendered verbatim from the API, which words them once through
          `buildReceiptCopy`. */}
      {stats && (
        <div
          data-testid="live-receipt"
          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-1"
        >
          <p data-testid="live-receipt-headline" className="text-[var(--text-primary)] text-sm font-medium">
            {stats.receiptToday.headline}
          </p>
          <p data-testid="live-receipt-walkin" className="text-[var(--text-secondary)] text-sm">
            {stats.receiptToday.walkIn}
          </p>
        </div>
      )}

      {/* Going tonight, per venue. Its own card, deliberately outside the
          aliveness row below: these people are NOT here, they said they mean to
          come (`honest-presence.md`, R9.4). The wording stays "marked going" so
          it can never be read as a headcount. */}
      {Object.keys(goingByNode).length > 0 && (
        <div
          data-testid="live-going"
          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-2"
        >
          <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">
            {t('biz.live.goingTitle', 'Going tonight')}
          </span>
          {Object.entries(goingByNode).map(([nodeId, line]) => (
            <div key={nodeId} className="flex flex-col">
              <span className="text-[var(--text-secondary)] text-xs">{line.nodeName}</span>
              <span className="text-[var(--text-primary)] text-sm" data-testid={`live-going-${nodeId}`}>
                {line.goingCount} {t('biz.live.going', 'marked going tonight')}
              </span>
            </div>
          ))}
        </div>
      )}

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

      {/* Live avatars, newest first, with the newest arrival's source badge
          under them. One badge, not one per avatar: the per-row history lives in
          the check-ins panel. */}
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

      {avatars[0] && (
        <div className="flex flex-row justify-center">
          <FoundViaBadge foundVia={avatars[0].foundVia} />
        </div>
      )}

      {/* Rewards claimed today, from the poll (the server counts the day's
          redemption rows) with live claims bumped on top until the next poll. */}
      {stats && stats.rewardsClaimed + bumps.rewards > 0 && (
        <div className="flex flex-row items-center justify-center gap-2 text-[var(--text-secondary)] text-sm">
          <span data-testid="live-rewards-claimed" className="text-[var(--accent)] font-semibold">
            {stats.rewardsClaimed + bumps.rewards}
          </span>
          <span>{t('biz.live.rewardsClaimed')}</span>
        </div>
      )}

      {stats && stats.totalCheckIns < 10 && <LiveZeroState />}
    </div>
  )
}
