import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { api } from '@area-code/shared/lib/api'
import { storage } from '@area-code/shared/lib/storage'
import {
  enableWebPush,
  isWebPushSupported,
  needsHomeScreenInstall,
  type WebPushOutcome,
} from '@area-code/shared/lib/webPush'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface NearbyEvent {
  username: string
  nodeName: string
  distanceMetres: number
  minutesAgo: number
}

interface NearbyRecentResponse {
  event: NearbyEvent | null
}

interface NotificationPrimingSheetProps {
  isOpen: boolean
  onClose: () => void
  lat: number
  lng: number
  userId: string
}

const DEFER_KEY_PREFIX = 'notif:deferred:'
const DEFER_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function isDeferredRecently(userId: string): boolean {
  const raw = storage.get(`${DEFER_KEY_PREFIX}${userId}`)
  if (!raw) return false
  const deferredAt = parseInt(raw, 10)
  return Date.now() - deferredAt < DEFER_DURATION_MS
}

function setDeferred(userId: string): void {
  storage.set(`${DEFER_KEY_PREFIX}${userId}`, String(Date.now()))
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${metres}m`
  return `${(metres / 1000).toFixed(1)}km`
}

/**
 * The honest sentence for a Web Push outcome that is not `subscribed` (R15.20).
 *
 * Every one of these means no notification will reach this person, so none of
 * them may read as success. `denied` points at site settings because the browser
 * will not prompt a second time; `not_configured` is a deploy gap stated as an
 * error rather than offered as a choice; `failed` says nothing was turned on so
 * the sheet never claims a push that cannot be delivered.
 */
function outcomeCopy(outcome: Exclude<WebPushOutcome, 'subscribed'>): { key: string; fallback: string } {
  switch (outcome) {
    case 'denied':
      return {
        key: 'notif.priming.denied',
        fallback:
          'Notifications are blocked for this site. Turn them on in your browser site settings, then come back.',
      }
    case 'not_configured':
      return {
        key: 'notif.priming.notConfigured',
        fallback: 'Notifications are not set up in this build, so we could not turn them on.',
      }
    case 'unsupported':
      return {
        key: 'notif.priming.unsupported',
        fallback: 'This browser cannot show notifications.',
      }
    case 'failed':
      return {
        key: 'notif.priming.failed',
        fallback: 'We could not turn notifications on. Nothing changed, so nothing will reach you yet. Try again.',
      }
  }
}

export function NotificationPrimingSheet({ isOpen, onClose, lat, lng, userId }: NotificationPrimingSheetProps) {
  const { t } = useTranslation()
  const [nearbyEvent, setNearbyEvent] = useState<NearbyEvent | null>(null)
  const [loaded, setLoaded] = useState(false)
  // The last outcome that was not `subscribed`. Held so the sheet stays open and
  // says what happened; a subscribed run closes and never sets it.
  const [failedOutcome, setFailedOutcome] = useState<Exclude<WebPushOutcome, 'subscribed'> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setLoaded(false)
      return
    }

    let cancelled = false
    async function fetchNearby() {
      try {
        const res = await api.get<NearbyRecentResponse>(
          `/v1/feed/nearby-recent?lat=${lat}&lng=${lng}&radiusMetres=1000&withinMinutes=10`,
        )
        if (!cancelled) {
          setNearbyEvent(res.event)
          setLoaded(true)
        }
      } catch {
        if (!cancelled) {
          setNearbyEvent(null)
          setLoaded(true)
        }
      }
    }

    void fetchNearby()
    return () => {
      cancelled = true
    }
  }, [isOpen, lat, lng])

  // Permission, subscription and token registration all live in the one shared
  // Web Push helper, so this sheet and the Tonight_Reminder opt-in on the Going
  // control cannot drift apart (`dry-reuse-no-duplication.md`). What this sheet
  // owns is saying something true about each outcome.
  async function handleEnable() {
    if (busy) return
    setBusy(true)
    setFailedOutcome(null)
    try {
      const outcome = await enableWebPush()
      if (outcome === 'subscribed') {
        onClose()
        return
      }
      setFailedOutcome(outcome)
    } catch {
      // The helper reports rather than throws, so a throw here is the same fact
      // seen from further out: nothing was turned on. Surfaced, never swallowed.
      setFailedOutcome('failed')
    } finally {
      setBusy(false)
    }
  }

  function handleNotNow() {
    setDeferred(userId)
    onClose()
  }

  if (!loaded) return null

  // iOS Safari outside an installed PWA has no PushManager, so an Enable button
  // there would be a control that cannot work. It gets the one step that does
  // (R15.20). Any other browser without Web Push is told plainly instead of
  // being offered the same dead button.
  const installOnly = needsHomeScreenInstall()
  const cannotSubscribeHere = installOnly || !isWebPushSupported()
  // Only a `failed` run is worth a second tap: denied cannot be re-prompted by
  // the browser, and a missing VAPID key is fixed by a deploy, not by retrying.
  const canRetry = failedOutcome === 'failed'
  const failure = failedOutcome === null ? null : outcomeCopy(failedOutcome)

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
        {nearbyEvent ? (
          <p className="text-[var(--text-primary)] text-base leading-relaxed">
            {t('notif.priming.personalized', {
              name: nearbyEvent.username,
              venue: nearbyEvent.nodeName,
              distance: formatDistance(nearbyEvent.distanceMetres),
            })}
          </p>
        ) : (
          <p className="text-[var(--text-primary)] text-base leading-relaxed">{t('notif.priming.generic')}</p>
        )}

        {installOnly && (
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed" data-priming-install>
            {t('notif.priming.installIos', 'Add Area Code to your Home Screen to get notifications')}
            {'. '}
            {t('notif.priming.installIosHow', 'Tap the share control in Safari, then Add to Home Screen.')}
          </p>
        )}

        {!installOnly && cannotSubscribeHere && (
          <p className="text-[var(--danger)] text-sm leading-relaxed" data-priming-error role="alert">
            {t('notif.priming.unsupported', 'This browser cannot show notifications.')}
          </p>
        )}

        {failure !== null && (
          <p className="text-[var(--danger)] text-sm leading-relaxed" data-priming-error role="alert">
            {t(failure.key, failure.fallback)}
          </p>
        )}

        {!cannotSubscribeHere && (failedOutcome === null || canRetry) && (
          <button
            onClick={() => void handleEnable()}
            disabled={busy}
            data-priming-enable
            className={`w-full min-h-11 bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-4 text-base transition-transform duration-150 active:scale-95 ${
              busy ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            {busy
              ? t('notif.priming.enabling', 'Turning on')
              : canRetry
                ? t('notif.priming.retry', 'Try again')
                : t('notif.priming.enable', 'Enable notifications')}
          </button>
        )}

        <button
          onClick={handleNotNow}
          data-priming-dismiss
          className="w-full min-h-11 bg-[var(--bg-raised)] text-[var(--text-secondary)] font-semibold rounded-xl py-4 text-base border border-[var(--border)] transition-transform duration-150 active:scale-95"
        >
          {cannotSubscribeHere || failedOutcome !== null
            ? t('notif.priming.gotIt', 'Got it')
            : t('notif.priming.notNow', 'Not now')}
        </button>
      </div>
    </BottomSheet>
  )
}

export { isDeferredRecently }
