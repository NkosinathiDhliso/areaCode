import { useSelectionStore } from '@area-code/shared/stores/selectionStore'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface FlickControlsProps {
  /**
   * When true, the controls render in a disabled, non-interactive state.
   * Typically set when the Carousel_Order has one or fewer venues, so there
   * is nowhere to step to. Defaults to false.
   */
  disabled?: boolean
  /** Optional extra classes for the wrapping control row. */
  className?: string
}

/**
 * Flick_Controls - the keyboard- and screen-reader-operable previous/next
 * fallback for Carousel_Swipe.
 *
 * Both controls are native `<button>` elements, so they are reachable and
 * activatable by keyboard (Requirement 8.1) and carry accessible labels that
 * identify the previous-venue and next-venue actions (Requirement 8.2). They
 * step the single Selection_Model one position in the Carousel_Order via
 * `selectionStore.step(dir)`, wrapping at the ends, which guarantees the
 * Venue_Card strip never relies on swipe as the only means of changing the
 * Active_Venue (Requirements 1.6, 8.6, 3.2, 3.3).
 *
 * The aria-live announcement of the new Active_Venue is owned by the
 * Peek_Carousel host (Requirement 8.3), not by this control row.
 */
function FlickControlsComponent({ disabled = false, className = '' }: FlickControlsProps) {
  const { t } = useTranslation()
  const step = useSelectionStore((s) => s.step)

  return (
    <div className={`flex flex-row items-center justify-between ${className}`.trim()}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={disabled}
        aria-label={t('map.flickPrev', 'Previous venue')}
        aria-disabled={disabled ? true : undefined}
        title={t('map.flickPrev', 'Previous venue')}
        className="glass-raised rounded-full w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
      >
        <ChevronLeft size={18} strokeWidth={1.75} />
      </button>
      <span className="text-[var(--text-muted)] text-xs">{t('map.flickHint', 'Tap through venues')}</span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={disabled}
        aria-label={t('map.flickNext', 'Next venue')}
        aria-disabled={disabled ? true : undefined}
        title={t('map.flickNext', 'Next venue')}
        className="glass-raised rounded-full w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
      >
        <ChevronRight size={18} strokeWidth={1.75} />
      </button>
    </div>
  )
}

export const FlickControls = memo(FlickControlsComponent)
