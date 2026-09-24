import { GENRE_LABELS, MUSIC_GENRES } from '@area-code/shared/constants/genre-weights'
import { HEADLINE_MAX_LENGTH } from '@area-code/shared/lib/schedule-validator'
import type { MusicGenre, Reward } from '@area-code/shared/types'
import { useTranslation } from 'react-i18next'

import { maxTonightDate, tonightCrossesMidnight, type TonightDraft, type TonightError } from '../lib/tonightSlot'

import { TonightFieldError } from './TonightFieldError'

/* ------------------------------------------------------------------ */
/*  The controls of the Tonight form (proof-of-demand R8.3).           */
/*                                                                     */
/*  Presentational: it holds no state, reads no API and knows no rules. */
/*  `dayOfWeek` is deliberately absent, it is derived from the date.    */
/* ------------------------------------------------------------------ */

const INPUT_CLASS =
  'min-h-11 px-3 rounded-xl bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:border-[var(--accent)] focus:outline-none'

const CHIP_CLASS =
  'min-h-11 px-3 rounded-xl text-xs font-medium border active:scale-95 transition-transform duration-150'

const NOTE_CLASS =
  'text-[var(--text-secondary)] text-xs bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2'

export interface TonightSlotFieldsProps {
  draft: TonightDraft
  /** Today in the schedule's timezone: the earliest date a Tonight can be for. */
  today: string
  /** Gets the owner may feature: live ones only, filtered by the caller. */
  liveGets: Reward[]
  error: TonightError | null
  onDateChange: (date: string) => void
  onPatch: (next: Partial<TonightDraft>) => void
  onToggleGenre: (genre: MusicGenre) => void
}

export function TonightSlotFields(props: TonightSlotFieldsProps) {
  const { draft, today, liveGets, error, onDateChange, onPatch, onToggleGenre } = props
  const { t } = useTranslation()
  const maxDate = maxTonightDate(today)
  const headlineLeft = HEADLINE_MAX_LENGTH - draft.headline.length
  // An end at or before the start is the following morning, not a typo. We say
  // the span in words, unless a time rule has already failed: the 04:00
  // rollover error is the more useful sentence and the two would disagree.
  const crossesMidnight = tonightCrossesMidnight(draft) && error?.field !== 'time'

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          {t('biz.tonight.date', 'Date')}
        </span>
        <input
          type="date"
          data-testid="tonight-date"
          value={draft.date}
          min={today}
          {...(maxDate ? { max: maxDate } : {})}
          onChange={(e) => onDateChange(e.target.value)}
          className={INPUT_CLASS}
        />
        <TonightFieldError field="date" error={error} />
      </label>

      <div className="flex flex-row gap-3">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
            {t('biz.tonight.startTime', 'Starts')}
          </span>
          <input
            type="time"
            data-testid="tonight-start"
            value={draft.startTime}
            onChange={(e) => onPatch({ startTime: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
            {t('biz.tonight.endTime', 'Ends')}
          </span>
          <input
            type="time"
            data-testid="tonight-end"
            value={draft.endTime}
            onChange={(e) => onPatch({ endTime: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      {crossesMidnight && (
        <div data-testid="tonight-cross-midnight" className={NOTE_CLASS} role="status">
          {t('biz.tonight.crossMidnight', 'This night runs past midnight. It ends at')} {draft.endTime}{' '}
          {t('biz.tonight.crossMidnightTail', 'the following morning, and stays one Tonight for this date.')}
        </div>
      )}
      <TonightFieldError field="time" error={error} />

      <label className="flex flex-col gap-1">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          {t('biz.tonight.headline', 'Headline')}
        </span>
        <input
          type="text"
          data-testid="tonight-headline"
          value={draft.headline}
          maxLength={HEADLINE_MAX_LENGTH}
          placeholder={t('biz.tonight.headlinePlaceholder', 'Amapiano with DJ Thandi')}
          onChange={(e) => onPatch({ headline: e.target.value })}
          className={INPUT_CLASS}
        />
        <span data-testid="tonight-headline-count" className="text-[var(--text-muted)] text-xs">
          {headlineLeft} {t('biz.tonight.headlineLeft', 'characters left')}
        </span>
        <TonightFieldError field="headline" error={error} />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          {t('biz.tonight.genres', 'Genres')}
        </span>
        <div className="flex flex-row flex-wrap gap-2">
          {MUSIC_GENRES.map((genre) => {
            const on = draft.genres.includes(genre)
            return (
              <button
                key={genre}
                type="button"
                data-testid={`tonight-genre-${genre}`}
                aria-pressed={on}
                onClick={() => onToggleGenre(genre)}
                className={`${CHIP_CLASS} ${
                  on
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'bg-[var(--bg-raised)] text-[var(--text-secondary)] border-[var(--border)]'
                }`}
              >
                {GENRE_LABELS[genre]}
              </button>
            )
          })}
        </div>
        <TonightFieldError field="genres" error={error} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          {t('biz.tonight.featuredGet', 'Featured get (optional)')}
        </span>
        <select
          data-testid="tonight-get"
          value={draft.featuredRewardId}
          onChange={(e) => onPatch({ featuredRewardId: e.target.value })}
          className={INPUT_CLASS}
        >
          <option value="">{t('biz.tonight.noGet', 'No get tonight')}</option>
          {liveGets.map((get) => (
            <option key={get.id} value={get.id}>
              {get.title}
            </option>
          ))}
        </select>
        <TonightFieldError field="get" error={error} />
      </label>
    </>
  )
}
