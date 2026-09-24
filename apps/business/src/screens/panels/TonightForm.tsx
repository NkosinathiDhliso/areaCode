import { Spinner } from '@area-code/shared/components/Spinner'
import { api, type ApiError } from '@area-code/shared/lib/api'
import { isFeaturableGet } from '@area-code/shared/lib/featuredGet'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { MusicGenre, MusicSchedule, Reward } from '@area-code/shared/types'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TonightFieldError } from '../../components/TonightFieldError'
import { TonightSlotFields } from '../../components/TonightSlotFields'
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  buildTonightSubmission,
  describeTonightPublishError,
  draftForDate,
  scheduleTodayDate,
  type TonightDraft,
} from '../../lib/tonightSlot'

/* ------------------------------------------------------------------ */
/*  Tonight form (proof-of-demand R8.3).                               */
/*                                                                     */
/*  One dated programme for one night: what is on, when it starts and   */
/*  ends, the genres, and optionally one of the venue's live gets. It   */
/*  writes a Dated_Slot through the existing schedule upsert, the same  */
/*  endpoint the weekly MusicSchedulePanel uses. No second write path,  */
/*  no second declaration store.                                        */
/*                                                                     */
/*  Every rule lives in `validateMusicSchedule`; this panel renders the  */
/*  answer it gives (../../lib/tonightSlot) so the owner is told what is */
/*  wrong instead of collecting a bare 400.                             */
/* ------------------------------------------------------------------ */

export function TonightForm() {
  const { t } = useTranslation()
  const businessId = useBusinessAuthStore((s) => s.businessId)
  const nodes = useBusinessStore((s) => s.nodes)
  // Presence of a venue is what the load depends on, not the node object: an
  // effect keyed on the object would re-run on every store read.
  const hasVenue = nodes.length > 0

  const [schedule, setSchedule] = useState<MusicSchedule | null>(null)
  const [gets, setGets] = useState<Reward[]>([])
  const [draft, setDraft] = useState<TonightDraft | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState<number>(0)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState<boolean>(false)

  useEffect(() => {
    if (!businessId || !hasVenue) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    Promise.all([
      api.get<MusicSchedule>(`/v1/business/${encodeURIComponent(businessId)}/music-schedule`).catch((err: ApiError) => {
        // 404 is the honest "no schedule yet" state, not a failure.
        if (err.statusCode === 404) return null
        throw err
      }),
      api.get<{ items: Reward[] }>('/v1/business/rewards'),
    ])
      .then(([loaded, rewards]) => {
        if (cancelled) return
        const todayLocal = scheduleTodayDate(loaded?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE, new Date().toISOString())
        if (todayLocal === null) {
          setLoadError(t('biz.tonight.loadFailed', "Couldn't load tonight. Please try again."))
          return
        }
        setSchedule(loaded)
        setGets(rewards.items ?? [])
        setToday(todayLocal)
        setDraft(draftForDate(loaded, todayLocal))
      })
      .catch(() => {
        if (!cancelled) setLoadError(t('biz.tonight.loadFailed', "Couldn't load tonight. Please try again."))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [businessId, hasVenue, reloadTick, t])

  // The gets an owner may feature: live only, by the same rule the schedule
  // service enforces, so the picker never offers a get the API would reject.
  const liveGets = useMemo(() => {
    const nowMs = Date.now()
    return gets.filter((get) => isFeaturableGet(get, nowMs))
  }, [gets])

  const editingSchedule: MusicSchedule = useMemo(
    () =>
      schedule ?? {
        businessId: businessId ?? '',
        scheduleId: 'default',
        timezone: DEFAULT_SCHEDULE_TIMEZONE,
        slots: [],
        updatedAt: new Date().toISOString(),
        schemaVersion: 1,
      },
    [schedule, businessId],
  )

  const submission = useMemo(() => {
    if (!draft || !today) return null
    return buildTonightSubmission({ draft, schedule: editingSchedule, todayLocalDate: today })
  }, [draft, today, editingSchedule])
  const error = submission && !submission.ok ? submission.error : null

  function patch(next: Partial<TonightDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...next } : prev))
    setServerError(null)
    setSaved(false)
  }

  function changeDate(date: string) {
    // A date that already carries a Tonight is edited, never stacked on.
    setDraft(draftForDate(schedule, date))
    setServerError(null)
    setSaved(false)
  }

  function toggleGenre(genre: MusicGenre) {
    setDraft((prev) => {
      if (!prev) return prev
      if (prev.genres.includes(genre)) return { ...prev, genres: prev.genres.filter((g) => g !== genre) }
      if (prev.genres.length >= 5) return prev
      return { ...prev, genres: [...prev.genres, genre] }
    })
    setServerError(null)
    setSaved(false)
  }

  async function handleSubmit() {
    if (!submission?.ok || submitting || !businessId) return
    setSubmitting(true)
    setServerError(null)
    try {
      const persisted = await api.post<MusicSchedule>(
        `/v1/business/${encodeURIComponent(businessId)}/music-schedule`,
        submission.schedule,
      )
      setSchedule(persisted)
      setSaved(true)
    } catch (err) {
      setServerError(describeTonightPublishError(err as ApiError, t))
    } finally {
      setSubmitting(false)
    }
  }

  if (!businessId) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3" data-testid="tonight-denied">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne] text-center">
          {t('biz.tonight.denied.title', "You don't have access to this venue's schedule")}
        </span>
      </div>
    )
  }

  if (!hasVenue) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3" data-testid="tonight-no-venue">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne] text-center">
          {t('biz.tonight.noVenue.title', 'No venue yet')}
        </span>
        <span className="text-[var(--text-muted)] text-sm text-center max-w-sm">
          {t('biz.tonight.noVenue.body', 'Add a venue in Settings first, then you can publish what is on tonight.')}
        </span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="tonight-loading">
        <Spinner size="lg" />
      </div>
    )
  }

  if (loadError || !draft || !today) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3" data-testid="tonight-load-error">
        <span className="text-[var(--danger)] text-sm text-center">
          {loadError ?? t('biz.tonight.loadFailed', "Couldn't load tonight. Please try again.")}
        </span>
        <button
          type="button"
          data-testid="tonight-retry"
          onClick={() => setReloadTick((n) => n + 1)}
          className="min-h-11 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold active:scale-95 transition-transform duration-150"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4" data-testid="tonight-panel">
      <div className="flex flex-col">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('biz.tonight.title', 'Tonight')}
        </h2>
        <span className="text-[var(--text-muted)] text-xs">
          {t('biz.tonight.subtitle', 'What is on, when it starts, and one get. This is what the map shows.')}
        </span>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-4">
        <TonightSlotFields
          draft={draft}
          today={today}
          liveGets={liveGets}
          error={error}
          onDateChange={changeDate}
          onPatch={patch}
          onToggleGenre={toggleGenre}
        />

        <TonightFieldError field="_global" error={error} />

        {serverError && (
          <span data-testid="tonight-server-error" className="text-[var(--danger)] text-xs" role="alert">
            {serverError}
          </span>
        )}
        {saved && (
          <span data-testid="tonight-saved" className="text-[var(--success)] text-xs" role="status">
            {t('biz.tonight.saved', 'Published. This is what the map shows for that night.')}
          </span>
        )}

        <button
          type="button"
          data-testid="tonight-submit"
          disabled={submitting || !submission?.ok}
          onClick={() => void handleSubmit()}
          className="min-h-11 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold active:scale-95 transition-transform duration-150 disabled:opacity-60"
        >
          {submitting ? t('biz.tonight.publishing', 'Publishing…') : t('biz.tonight.publish', 'Publish tonight')}
        </button>
        <span className="text-[var(--text-muted)] text-xs">
          {t('biz.tonight.timezoneNote', 'Times are venue-local')} ({editingSchedule.timezone})
        </span>
      </div>
    </div>
  )
}
