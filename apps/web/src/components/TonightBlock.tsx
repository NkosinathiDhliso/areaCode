import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { VenueTonight } from '@area-code/shared/types'
import { useTranslation } from 'react-i18next'

import { GoingControl } from './GoingControl'

/**
 * Tonight block on the consumer venue detail (proof-of-demand R8.7, R8.8, R8.9).
 *
 * The one surface that answers "why go THERE, right now?" before there is a
 * crowd: what is on, when it starts, and the one get the owner put behind it.
 * Renders above `CrowdVibeSection` so the promise for the night is read before
 * the room's current reading.
 *
 * It also hosts the Going control (R9.2), which is the intent half of the same
 * question: what is on, and whether the consumer means to be there. The control
 * is always offered, including for a venue with nothing published; only what may
 * be said about other people's marks depends on the Tonight.
 *
 * Honesty rules:
 * - A venue with nothing published renders no Tonight card. No placeholder, no
 *   "quiet tonight" invention (`honest-presence.md`).
 * - The heading under-claims by default. It only reads "In the room now" when
 *   the backend resolved the venue to `crowd_live`, which is the
 *   Presence_Floor decision (R8.8); anything else, including an unknown branch
 *   while the live-vibe flags are dark, reads "Expected tonight". The headline,
 *   the time and the get render either way (R8.9).
 * - Nothing here is a crowd claim: the block never reports a count.
 *
 * The featured get is a pointer, not a second claim path. Tapping it opens the
 * get's existing reward row on this same sheet, which is where the claim
 * instructions and the check-in CTA already live.
 */
export interface TonightBlockProps {
  /** Tonight summary from the venue read; null renders no Tonight card. */
  tonight: VenueTonight | null | undefined
  /** Venue id, used to read the resolved vibe branch for the heading. */
  nodeId: string
  /**
   * Going count from the venue payload (R9.2), or null when it was not measured.
   * Seeds the control; the surfacing rule lives in `goingCountToShow`.
   */
  goingCount?: number | null
  /**
   * Opens the featured get's own reward row. Omitted when the get is not on
   * this venue's reward list, in which case the title renders as plain text
   * rather than a control that does nothing.
   */
  onOpenFeaturedGet?: () => void
  /** Routes an anonymous reader to sign-in when they tap the Going control. */
  onSignIn?: () => void
}

export function TonightBlock({ tonight, nodeId, goingCount, onOpenFeaturedGet, onSignIn }: TonightBlockProps) {
  const { t } = useTranslation()
  // Same source as `CrowdVibeSection`: the branch the backend resolved and the
  // archetype it rendered are stored together, so the two headings can never
  // disagree about whether we are describing the room or the promise.
  const branch = useMapStore((s) => s.archetypeBranches[nodeId])

  // Same i18n keys as `CrowdVibeSection`, so the promise-vs-now wording is the
  // same words on both blocks of the same sheet.
  const heading =
    branch === 'crowd_live'
      ? t('crowdVibe.inTheRoomNow', 'In the room now')
      : t('crowdVibe.expectedTonight', 'Expected tonight')

  // The Going control is offered whether or not a night is published (R9.2):
  // intent in a venue is real even when the owner has posted nothing. What
  // changes without a Tonight is what may be said about other people, and that
  // rule lives inside the control.
  const going = (
    <GoingControl
      nodeId={nodeId}
      hasTonight={Boolean(tonight)}
      seedCount={goingCount}
      // Only a night with a start still ahead of it can be reminded about; the
      // summary already reports null for a slot that is running (R9.6).
      startsAt={tonight?.startsAt ?? null}
      {...(onSignIn ? { onSignIn } : {})}
    />
  )

  if (!tonight) return going

  return (
    <>
      <div className="mb-4" data-tonight-block={nodeId}>
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-2">{heading}</h3>

        <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-col gap-1">
          <span className="text-[var(--text-primary)] text-sm font-medium" data-tonight-headline>
            {tonight.headline}
          </span>

          {tonight.startsAt && (
            <span className="text-[var(--text-secondary)] text-xs" data-tonight-starts>
              {t('tonight.startsAt', 'Starts')} {tonight.startsAt}
            </span>
          )}

          {tonight.rewardTitle &&
            (onOpenFeaturedGet ? (
              <button
                type="button"
                onClick={onOpenFeaturedGet}
                data-tonight-get
                className="mt-1 min-h-11 flex flex-row items-center text-left text-[var(--accent)] text-xs font-medium transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:underline"
              >
                {tonight.rewardTitle}
              </button>
            ) : (
              <span className="mt-1 text-[var(--text-secondary)] text-xs" data-tonight-get>
                {tonight.rewardTitle}
              </span>
            ))}
        </div>
      </div>
      {going}
    </>
  )
}
