import { Avatar } from '@area-code/shared/components/Avatar'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { TierProgressNudge } from '@area-code/shared/components/TierProgressNudge'
import { api } from '@area-code/shared/lib/api'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import type { LeaderboardEntry, Tier, User } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { Share2 } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { resolveArchetypeDisplayName } from '../lib/archetypeDisplay'
import { buildShareCardData, generateShareCard, shareOrCopy } from '../lib/shareCard'
import type { AppRoute } from '../types'

interface CityRankEntry extends LeaderboardEntry {
  topVenueId?: string
  topVenueName?: string
  archetypeId?: string
}

interface LeaderboardResponse {
  entries: CityRankEntry[]
  userRank: { rank: number; checkInCount: number } | null
  segment: 'archetype' | 'city-wide'
}

interface LeaderboardScreenProps {
  onNavigate: (route: AppRoute) => void
}

export function LeaderboardScreen({ onNavigate }: LeaderboardScreenProps) {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const userCitySlug = user?.citySlug
  const userArchetypeId = user?.archetypeId
  const citySlug = userCitySlug ?? 'johannesburg'
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)

  // Default to archetype view when user has an archetypeId, otherwise city-wide
  const [viewMode, setViewMode] = useState<'archetype' | 'city-wide'>(userArchetypeId ? 'archetype' : 'city-wide')

  // Sync view mode if user completes preferences and gains an archetypeId
  useEffect(() => {
    if (userArchetypeId && viewMode === 'city-wide') {
      setViewMode('archetype')
    }
  }, [userArchetypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const archetypeParam = viewMode === 'archetype' && userArchetypeId ? userArchetypeId : undefined

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['leaderboard', citySlug, archetypeParam],
    queryFn: () => {
      const url = archetypeParam
        ? `/v1/leaderboard/${citySlug}?archetypeId=${encodeURIComponent(archetypeParam)}`
        : `/v1/leaderboard/${citySlug}`
      return api.get<LeaderboardResponse>(url)
    },
    staleTime: 30_000,
  })

  const handleVenueStreakTap = useCallback(
    (nodeId: string) => {
      setFocusNodeId(nodeId)
      onNavigate('map')
    },
    [setFocusNodeId, onNavigate],
  )

  // Derive the title based on segment
  const title =
    viewMode === 'archetype' && userArchetypeId
      ? t('leaderboard.archetypeTitle', {
          archetype: resolveArchetypeDisplayName(userArchetypeId).replace(/^The /, ''),
          defaultValue: `Top {{archetype}}s this week`,
        })
      : t('leaderboard.title')

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-1">{title}</h1>
      <p className="text-[var(--text-muted)] text-xs mb-3">{t('leaderboard.thisWeek')}</p>

      {/* Segment toggle */}
      <div className="flex flex-row gap-2 mb-4" role="tablist" aria-label={t('leaderboard.viewToggle', 'View toggle')}>
        <button
          role="tab"
          aria-selected={viewMode === 'archetype'}
          onClick={() => setViewMode('archetype')}
          disabled={!userArchetypeId}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-medium transition-all ${
            viewMode === 'archetype'
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]'
          } ${!userArchetypeId ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {userArchetypeId
            ? t('leaderboard.myArchetype', {
                archetype: resolveArchetypeDisplayName(userArchetypeId).replace(/^The /, ''),
                defaultValue: 'My {{archetype}}s',
              })
            : t('leaderboard.archetype', 'My Tribe')}
        </button>
        <button
          role="tab"
          aria-selected={viewMode === 'city-wide'}
          onClick={() => setViewMode('city-wide')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-medium transition-all ${
            viewMode === 'city-wide'
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]'
          }`}
        >
          {t('leaderboard.cityWide', 'City-wide')}
        </button>
      </div>

      {/* Prompt to complete preferences when no archetypeId */}
      {!userArchetypeId && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 mb-4">
          <p className="text-[var(--text-secondary)] text-xs">
            {t(
              'leaderboard.completePreferences',
              'Complete your music preferences to unlock archetype ranks and see how you stack up against your tribe.',
            )}
          </p>
          <button onClick={() => onNavigate('profile')} className="text-[var(--accent)] text-xs font-medium mt-2">
            {t('leaderboard.setPreferences', 'Set up preferences →')}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-[var(--text-muted)] text-sm text-center">
            {t('leaderboard.loadError', "Couldn't load the leaderboard. Check your connection.")}
          </p>
          <button onClick={() => void refetch()} className="text-[var(--accent)] text-sm font-medium">
            {t('common.retry', 'Retry')}
          </button>
        </div>
      ) : data?.entries && data.entries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {data.entries.map((entry) => (
            <LeaderboardRow key={entry.userId} entry={entry} onVenueStreakTap={handleVenueStreakTap} t={t} />
          ))}

          {/* Consumer's own rank card with tier-progress nudge (R10.4) and
              share affordance (R10.3). Always shown when the user has a rank,
              whether or not they are inside the top 50. */}
          {user && (data.userRank || data.entries.find((e) => e.userId === user.id)) && (
            <YourRankCard
              user={user}
              rank={data.userRank?.rank ?? data.entries.find((e) => e.userId === user.id)?.rank ?? 0}
              checkInCount={
                data.userRank?.checkInCount ?? data.entries.find((e) => e.userId === user.id)?.checkInCount ?? 0
              }
              topVenueName={data.entries.find((e) => e.userId === user.id)?.topVenueName ?? null}
              t={t}
            />
          )}
        </div>
      ) : (
        <p className="text-[var(--text-muted)] text-sm text-center py-8">{t('leaderboard.noData')}</p>
      )}
    </div>
  )
}

// ─── Your Rank Card ─────────────────────────────────────────────────────────

interface YourRankCardProps {
  user: User
  rank: number
  checkInCount: number
  topVenueName: string | null
  t: ReturnType<typeof useTranslation>['t']
}

/**
 * The consumer's own rank card: rank, check-in count, a tier-progression nudge
 * (R10.4), and a Share button (R10.3). The share card is generated client-side
 * and contains only the consumer's own data (R10.3.4 / Property 9).
 */
function YourRankCard({ user, rank, checkInCount, topVenueName, t }: YourRankCardProps) {
  const [sharing, setSharing] = useState(false)

  const handleShare = useCallback(async () => {
    setSharing(true)
    try {
      const cardData = buildShareCardData({
        rank,
        archetypeId: user.archetypeId ?? null,
        tier: user.tier,
        weeklyCheckInCount: checkInCount,
        topVenueName,
        displayName: user.displayName,
      })
      const blob = await generateShareCard(cardData)
      const text = t('leaderboard.shareText', {
        rank,
        defaultValue: `I'm #{{rank}} this week on Area Code`,
      })
      await shareOrCopy(blob, typeof text === 'string' ? text : `I'm #${rank} this week on Area Code`)
    } catch {
      // Best-effort: a failed render or dismissed share sheet is a no-op.
    } finally {
      setSharing(false)
    }
  }, [user, rank, checkInCount, topVenueName, t])

  return (
    <>
      <div className="border-t border-[var(--border)] my-2" />
      <div className="flex flex-row items-center gap-3 bg-[var(--bg-raised)] border border-[var(--accent)] rounded-2xl px-4 py-3">
        <span className="text-[var(--accent)] text-sm font-medium w-6 text-right shrink-0">{rank}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-sm font-medium">{t('leaderboard.you')}</p>
          <TierProgressNudge checkInCount={checkInCount} />
        </div>
        <span className="text-[var(--text-secondary)] text-sm font-medium shrink-0">{checkInCount}</span>
        <button
          type="button"
          onClick={() => void handleShare()}
          disabled={sharing}
          aria-label={t('leaderboard.shareRank', 'Share my rank')}
          className="shrink-0 p-2 rounded-xl text-[var(--accent)] transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        >
          <Share2 size={18} strokeWidth={1.75} />
        </button>
      </div>
    </>
  )
}

// ─── Leaderboard Row ────────────────────────────────────────────────────────

interface LeaderboardRowProps {
  entry: CityRankEntry
  onVenueStreakTap: (nodeId: string) => void
  t: ReturnType<typeof useTranslation>['t']
}

function LeaderboardRow({ entry, onVenueStreakTap, t }: LeaderboardRowProps) {
  const displayName = entry.isFriend
    ? entry.displayName || entry.username || t('leaderboard.anonymousExplorer')
    : t('leaderboard.anonymousExplorer')

  return (
    <div className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
      {/* Rank position */}
      <span className="text-[var(--text-muted)] text-sm font-medium w-6 text-right shrink-0">{entry.rank}</span>

      {/* Avatar or tier badge */}
      {entry.isFriend ? (
        <Avatar
          url={entry.avatarUrl}
          displayName={typeof displayName === 'string' ? displayName : ''}
          size="sm"
          tier={entry.tier as Tier}
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-[var(--bg-raised)] flex items-center justify-center shrink-0">
          <TierBadge tier={entry.tier as Tier} />
        </div>
      )}

      {/* Name + venue streak */}
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-sm font-medium truncate">{displayName}</p>
        {entry.topVenueName && entry.topVenueId && (
          <button
            onClick={() => onVenueStreakTap(entry.topVenueId!)}
            className="text-[var(--text-muted)] text-xs truncate hover:text-[var(--accent)] transition-colors text-left"
            aria-label={t('leaderboard.venueStreakLabel', {
              venue: entry.topVenueName,
              defaultValue: 'Go to {{venue}}',
            })}
          >
            📍 {entry.topVenueName}
          </button>
        )}
      </div>

      {/* Tier badge */}
      <TierBadge tier={entry.tier as Tier} />

      {/* Weekly check-in count */}
      <span className="text-[var(--text-secondary)] text-sm font-medium ml-1 shrink-0">{entry.checkInCount}</span>
    </div>
  )
}
