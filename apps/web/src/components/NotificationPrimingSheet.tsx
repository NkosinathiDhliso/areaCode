import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { storage } from '@area-code/shared/lib/storage'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'

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

export function NotificationPrimingSheet({
  isOpen,
  onClose,
  lat,
  lng,
  userId,
}: NotificationPrimingSheetProps) {
  const { t } = useTranslation()
  const [nearbyEvent, setNearbyEvent] = useState<NearbyEvent | null>(null)
  const [loaded, setLoaded] = useState(false)

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
    return () => { cancelled = true }
  }, [isOpen, lat, lng])

  function handleEnable() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      onClose()
      return
    }

    void Notification.requestPermission().then(async (permission) => {
      if (permission === 'granted') {
        try {
          const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
          if (vapidKey) {
            const reg = await navigator.serviceWorker.ready
            const subscription = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: vapidKey,
            })
            // Register the subscription with the backend
            await api.post('/v1/users/me/push-token', {
              token: JSON.stringify(subscription),
              platform: 'web',
            })
          }
        } catch {
          // Push registration failed — still close the sheet
        }
      }
      onClose()
    })
  }

  function handleNotNow() {
    setDeferred(userId)
    onClose()
  }

  if (!loaded) return null

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        {nearbyEvent ? (
          <p className="text-[var(--text-primary)] text-base leading-relaxed">
            {t('notif.priming.personalized', {
              name: nearbyEvent.username,
              venue: nearbyEvent.nodeName,
              distance: formatDistance(nearbyEvent.distanceMetres),
            })}
          </p>
        ) : (
          <p className="text-[var(--text-primary)] text-base leading-relaxed">
            {t('notif.priming.generic')}
          </p>
        )}

        <button
          onClick={handleEnable}
          className="w-full bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base"
        >
          {t('notif.priming.enable')}
        </button>

        <button
          onClick={handleNotNow}
          className="w-full bg-[var(--bg-raised)] text-[var(--text-secondary)] font-semibold rounded-xl py-4 text-base border border-[var(--border)]"
        >
          {t('notif.priming.notNow')}
        </button>
      </div>
    </BottomSheet>
  )
}

export { isDeferredRecently }
