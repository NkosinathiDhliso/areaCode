import { goingCountToShow, goingPrompt, markGoing, readGoingState, unmarkGoing } from '@area-code/shared/lib/going'
import { updateNotificationPreferences } from '@area-code/shared/lib/notificationPreferences'
import { enableWebPush } from '@area-code/shared/lib/webPush'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The Going control on the consumer venue detail (proof-of-demand R9.2, R9.3).
 *
 * One tap records that the consumer means to be there tonight, and one more
 * withdraws it. That is all it is: INTENT, before doors. Nothing here reads as
 * presence and nothing here feeds one. The wording is always "marked going", so
 * neither the consumer nor the owner can mistake it for "who is here"
 * (`honest-presence.md`, R9.3).
 *
 * What it is allowed to say about other people comes from one shared rule,
 * `goingCountToShow`: a count only at or above the Going_Threshold and only when
 * the venue has a Tonight, so the card and this block can never disagree (R9.2).
 * Below that it offers the invitation and says nothing about numbers.
 *
 * The count on the city payload is a cached, shared number, so it seeds the
 * control but cannot carry the viewer's own mark. The viewer's mark is read once
 * from the venue detail, and only for a signed-in consumer: an anonymous reader
 * has no mark to show, and tapping takes them to sign-in instead.
 */
export interface GoingControlProps {
  nodeId: string
  /** Whether the venue has a published Tonight. Gates every count and the "be first" prompt. */
  hasTonight: boolean
  /** Going count from the venue payload, or null/undefined when it was not measured. */
  seedCount: number | null | undefined
  /**
   * The Tonight start as local `HH:mm`, or null when there is nothing to start
   * (no published night, or a night already running). Only a future start can be
   * reminded about, so this is what gates the offer (R9.6).
   */
  startsAt?: string | null
  /** Called instead of marking when there is no signed-in consumer. */
  onSignIn?: () => void
}

export function GoingControl({ nodeId, hasTonight, seedCount, startsAt, onSignIn }: GoingControlProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)

  const [count, setCount] = useState<number | null>(typeof seedCount === 'number' ? seedCount : null)
  const [viewerGoing, setViewerGoing] = useState(false)
  // The night the server recorded the mark against, needed to withdraw it after
  // the 04:00 rollover. Null until a toggle has told us.
  const [night, setNight] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  // The reminder offer is shown only after a mark has actually landed, and only
  // when there is a start to be reminded about (R9.6). It is a second, explicit
  // tap: marking going is not consent to be sent anything.
  const [reminderOffer, setReminderOffer] = useState(false)
  const [reminderBusy, setReminderBusy] = useState(false)
  const [reminderNote, setReminderNote] = useState('')
  const canRemind = typeof startsAt === 'string' && startsAt !== ''

  // Seed the viewer's own mark from the venue detail. Only for a signed-in
  // consumer: there is nothing to read for anyone else, and the detail route is
  // the one authoritative pair (`goingCount` + `viewerGoing`).
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    readGoingState(nodeId).then(
      (read) => {
        if (cancelled) return
        setCount(read.goingCount)
        setViewerGoing(read.viewerGoing === true)
      },
      () => {
        // The seed failed. The control still works (the write is idempotent), and
        // saying nothing about the viewer's mark is honest: we do not know it.
      },
    )
    return () => {
      cancelled = true
    }
  }, [nodeId, isAuthenticated])

  async function handleToggle() {
    if (!isAuthenticated) {
      onSignIn?.()
      return
    }
    if (pending) return
    setPending(true)
    setError('')

    // Optimistic: the tap is the whole interaction, so it must read as done
    // immediately. Reverted verbatim if the server disagrees.
    const previous = { count, viewerGoing }
    const marking = !viewerGoing
    setViewerGoing(marking)
    setCount(typeof count === 'number' ? Math.max(0, count + (marking ? 1 : -1)) : null)

    try {
      const state = marking ? await markGoing(nodeId) : await unmarkGoing(nodeId, night ?? undefined)
      setCount(state.goingCount)
      setViewerGoing(state.viewerGoing)
      setNight(state.date)
      // Offer the reminder at the moment of intent, and withdraw the offer with
      // the mark: there is nothing to remind someone about once they have
      // withdrawn.
      setReminderOffer(marking && canRemind)
      if (!marking) setReminderNote('')
    } catch {
      setCount(previous.count)
      setViewerGoing(previous.viewerGoing)
      setError(t('going.failed', 'That did not save. Try again.'))
    } finally {
      setPending(false)
    }
  }

  /**
   * Accept the reminder (R9.6). Three writes, in this order: try to turn Web Push
   * on while we still have the tap, record the consent as the one notification
   * preference, then stamp the opt-in on the Going row so the transition tick can
   * find it.
   *
   * The preference and the row are written whatever the browser said, because
   * `sendNotification` delivers over the socket first and push only as a
   * fallback: a consumer whose browser cannot subscribe still gets told inside
   * the app. What changes is what we tell them, and we do not overstate it. Some
   * browsers, iOS Safari outside an installed PWA in particular, cannot show a
   * notification while Area Code is closed; the note says so rather than
   * implying a push that will never arrive.
   */
  async function handleRemind() {
    if (reminderBusy) return
    setReminderBusy(true)
    setError('')
    try {
      const outcome = await enableWebPush()
      await updateNotificationPreferences({ tonightReminder: true })
      await markGoing(nodeId, { remind: true })
      setReminderOffer(false)
      setReminderNote(
        outcome === 'subscribed'
          ? t('going.remindOn', 'We will tell you when it starts.')
          : t(
              'going.remindInAppOnly',
              'We will tell you when it starts, inside Area Code. This browser cannot show notifications while the app is closed.',
            ),
      )
    } catch {
      setReminderNote(t('going.remindFailed', 'That did not save. Try again.'))
    } finally {
      setReminderBusy(false)
    }
  }

  const shownCount = goingCountToShow(count, hasTonight)
  const prompt = goingPrompt({ goingCount: count, hasTonight, viewerGoing })
  const label =
    prompt === 'marked'
      ? t('going.marked', 'You marked going tonight')
      : prompt === 'be_first'
        ? t('going.beFirst', 'Be the first to mark going')
        : t('going.mark', 'Mark going tonight')

  return (
    <div className="mb-4 flex flex-col gap-1" data-going-control={nodeId}>
      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={pending}
        aria-pressed={viewerGoing}
        aria-label={label}
        data-going-toggle
        className={`min-h-11 w-full rounded-xl px-4 text-sm font-medium border transition-all duration-150 active:scale-95 focus:outline-none focus:border-[var(--accent)] ${
          viewerGoing
            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--bg-raised)]'
            : 'border-[var(--border)] text-[var(--text-primary)] bg-[var(--bg-raised)]'
        } ${pending ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {pending ? t('going.saving', 'Saving') : label}
      </button>

      {/* What other people did. Intent only, never a crowd claim, and only once
          the threshold makes it read as other people (R9.2). */}
      {shownCount !== null && (
        <span className="text-[var(--text-secondary)] text-xs" data-going-count={shownCount}>
          <span className="font-semibold">{shownCount}</span> {t('going.countSuffix', 'marked going tonight')}
        </span>
      )}

      {/* The reminder, offered at the moment of intent and only when a start
          time exists. A separate tap, never a side effect of marking (R9.6). */}
      {reminderOffer && (
        <div className="mt-1 flex flex-col gap-1" data-going-reminder-offer>
          <button
            type="button"
            onClick={() => void handleRemind()}
            disabled={reminderBusy}
            data-going-remind
            className={`min-h-11 w-full rounded-xl px-4 text-sm font-medium border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-primary)] transition-all duration-150 active:scale-95 focus:outline-none focus:border-[var(--accent)] ${
              reminderBusy ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            {t('going.remind', 'Remind me when it starts')}
          </button>
          <button
            type="button"
            onClick={() => setReminderOffer(false)}
            data-going-remind-dismiss
            className="min-h-11 w-full rounded-xl px-4 text-xs text-[var(--text-secondary)] transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:underline"
          >
            {t('going.remindNotNow', 'No thanks')}
          </button>
        </div>
      )}

      {reminderNote !== '' && (
        <span className="text-[var(--text-secondary)] text-xs" data-going-reminder-note>
          {reminderNote}
        </span>
      )}

      {error !== '' && (
        <span className="text-[var(--danger)] text-xs" data-going-error role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
