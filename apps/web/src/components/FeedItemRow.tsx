import { Avatar } from '@area-code/shared/components/Avatar'
import { formatRelativeTime } from '@area-code/shared/lib/formatters'
import type { NodeCategory, NodeState, Tier } from '@area-code/shared/types'
import { Trophy, Share2, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isJoinEligible, type EnrichedFeedItem } from '../lib/feedEnrichment'
import { getPulseStateColour } from '../lib/mapHelpers'
import { generateMilestoneCard, shareOrCopy } from '../lib/shareCard'

import { ArchetypeGlyph } from './ArchetypeGlyph'

interface FeedItemRowProps {
  item: EnrichedFeedItem
  /** Fly the map to this venue and open it (Focus_Signal, R11.2.2 / R12.1). */
  onFocusVenue: (nodeId: string) => void
}

/** States that earn a visual accent to draw the eye to alive spots (R11.1.2). */
const ACCENT_STATES: ReadonlySet<NodeState> = new Set<NodeState>(['buzzing', 'popping'])

/** A shareable milestone row (R11.5.2): headline, detail, and a Share button. */
function MilestoneRow({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation()
  const [sharing, setSharing] = useState(false)

  const handleShare = async () => {
    setSharing(true)
    try {
      const blob = await generateMilestoneCard(title, body)
      await shareOrCopy(blob, `${title} | ${body}`)
    } catch {
      // Best-effort: a dismissed share sheet or render failure is a no-op.
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="flex flex-row items-center gap-3 bg-[var(--bg-raised)] border border-[var(--accent)] rounded-2xl px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
        <Trophy size={16} className="text-[var(--accent)]" strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-sm font-semibold">{title}</p>
        <p className="text-[var(--text-muted)] text-xs mt-0.5">{body}</p>
      </div>
      <button
        type="button"
        onClick={() => void handleShare()}
        disabled={sharing}
        aria-label={t('feed.shareMilestone', 'Share milestone')}
        className="shrink-0 p-2 rounded-xl text-[var(--accent)] transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
      >
        <Share2 size={18} strokeWidth={1.75} />
      </button>
    </div>
  )
}

/**
 * One City Feed row. Renders a vibe-enriched check-in (pulse badge, live count,
 * venue archetype glyph, and a "Join them?" CTA when a friend is still present
 * at an alive venue), a live-get item ("Live now"), or a shareable milestone.
 */
export function FeedItemRow({ item, onFocusVenue }: FeedItemRowProps) {
  const { t } = useTranslation()

  if (item.feedType === 'milestone') {
    return <MilestoneRow title={item.title ?? ''} body={item.body ?? ''} />
  }

  if (item.feedType === 'live_get' && item.node) {
    const liveGetNode = item.node
    return (
      <button
        type="button"
        onClick={() => onFocusVenue(liveGetNode.id)}
        className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--accent)] rounded-2xl px-4 py-3 text-left transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
          <Zap size={16} className="text-[var(--accent)]" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-sm">
            <span className="font-medium">{liveGetNode.name}</span>
            {item.getTitle ? ` | ${item.getTitle}` : ''}
          </p>
          <span className="inline-flex items-center gap-1 text-[var(--accent)] text-xs font-semibold mt-0.5">
            {t('feed.liveNow', 'Live now')}
          </span>
        </div>
      </button>
    )
  }

  const user = item.user
  const node = item.node
  if (!user || !node) return null

  const accent = item.venuePulseState != null && ACCENT_STATES.has(item.venuePulseState)
  const stateColour = item.venuePulseState ? getPulseStateColour(item.venuePulseState) : null
  const joinable = isJoinEligible(item.friendStillPresent, item.venuePulseState)

  return (
    <div
      className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] rounded-2xl px-4 py-3 border"
      style={{
        borderColor: accent && stateColour ? stateColour : 'var(--border)',
        boxShadow: accent && stateColour ? `0 0 0 1px ${stateColour}33` : undefined,
      }}
    >
      <Avatar url={user.avatarUrl} displayName={user.displayName} size="sm" tier={user.tier as Tier} />

      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-sm">
          <span className="font-medium">{user.username}</span>
          {` ${t('feed.checkedInTo', 'checked in to')} `}
          <button
            type="button"
            onClick={() => onFocusVenue(node.id)}
            className="font-medium hover:text-[var(--accent)] transition-colors"
          >
            {node.name}
          </button>
        </p>

        {/* Vibe row: pulse state + live count (R11.1.1). */}
        <div className="flex items-center gap-2 mt-0.5">
          {item.venuePulseState && stateColour && (
            <span className="text-xs font-semibold capitalize" style={{ color: stateColour }}>
              {t(`pulse.state.${item.venuePulseState}`, item.venuePulseState)}
            </span>
          )}
          {item.venueCheckInCount > 0 && (
            <span className="text-[var(--text-muted)] text-xs">
              {t('feed.hereNow', { count: item.venueCheckInCount, defaultValue: '{{count}} here' })}
            </span>
          )}
          <span className="text-[var(--text-muted)] text-xs">{formatRelativeTime(item.checkedInAt)}</span>
        </div>
      </div>

      {/* Venue archetype glyph in its live pulse colour (R11.1.1). */}
      {item.venueArchetypeId && item.venuePulseState && (
        <ArchetypeGlyph
          archetypeId={item.venueArchetypeId}
          pulseState={item.venuePulseState}
          category={node.category as NodeCategory}
          size={24}
        />
      )}

      {/* "Join them?" CTA: only when the friend is still present at an alive
          venue (R11.2.1, R11.2.3). */}
      {joinable && (
        <button
          type="button"
          onClick={() => onFocusVenue(node.id)}
          className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--accent)] text-white transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {t('feed.joinThem', 'Join them?')}
        </button>
      )}
    </div>
  )
}
