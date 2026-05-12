import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Check, Lock, AlertCircle } from 'lucide-react'
import { api, type ApiError } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import type { CheckInResponse } from '@area-code/shared/types'
import type { AppRoute } from '../types'

interface QrCheckInProps {
  nodeId: string
  token: string
  onNavigate: (route: AppRoute) => void
}

type Phase = 'submitting' | 'success' | 'unauthenticated' | 'error'

/**
 * Landing page for venue-printed QR codes.
 *
 * The business app generates posters whose QR encodes
 * `https://areacode.co.za/qr/{nodeId}/{token}`. When a visitor scans the
 * poster with their phone camera, the browser opens this page, which
 * posts the token to the check-in endpoint and then routes the user to
 * the map. No manual scanning inside the app is required for this path.
 */
export function QrCheckIn({ nodeId, token, onNavigate }: QrCheckInProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const [phase, setPhase] = useState<Phase>('submitting')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    if (!isAuthenticated) {
      // Stash the pending QR so we can resume after login.
      try {
        sessionStorage.setItem('pendingQrCheckIn', JSON.stringify({ nodeId, token }))
      } catch {
        // sessionStorage can throw in private-mode browsers; the fallback is
        // still useful because the user is about to sign in.
      }
      setPhase('unauthenticated')
      return
    }

    let cancelled = false
    async function submit() {
      try {
        const res = await api.post<CheckInResponse>('/v1/check-in', {
          nodeId,
          qrToken: token,
          type: 'reward',
        })
        if (cancelled) return
        setPhase('success')
        setMessage(
          res.cooldownUntil
            ? `${t('qr.checkedIn', "You're checked in.")} ${t(
                'qr.cooldownHint',
                'Come back again after your cooldown ends.',
              )}`
            : t('qr.checkedIn', "You're checked in."),
        )
        // Bounce to the map after a beat so users see they can explore.
        setTimeout(() => {
          if (!cancelled) onNavigate('map')
        }, 1800)
      } catch (err) {
        if (cancelled) return
        const apiErr = err as ApiError
        setPhase('error')
        if (apiErr.statusCode === 401) {
          setMessage(t('qr.invalidToken', 'This QR code is no longer valid. Ask the venue to reprint.'))
        } else if (apiErr.statusCode === 429) {
          setMessage(apiErr.message ?? t('qr.cooldown', 'You have already checked in here recently.'))
        } else if (apiErr.statusCode === 404) {
          setMessage(t('qr.venueGone', 'This venue is no longer listed.'))
        } else {
          setMessage(apiErr.message ?? t('qr.generic', 'Check-in failed. Please try again at the venue.'))
        }
      }
    }
    void submit()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, nodeId, token, onNavigate, t])

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-6 bg-[var(--bg-base)]">
      <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
        {phase === 'submitting' && (
          <>
            <div className="animate-pulse">
              <MapPin size={32} strokeWidth={1.5} className="text-[var(--accent)]" />
            </div>
            <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
              {t('qr.checkingIn', 'Checking you in…')}
            </h1>
          </>
        )}

        {phase === 'success' && (
          <>
            <Check size={32} strokeWidth={1.5} className="text-[var(--success)]" />
            <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
              {t('qr.success', 'Checked in')}
            </h1>
            <p className="text-[var(--text-secondary)] text-sm">{message}</p>
          </>
        )}

        {phase === 'unauthenticated' && (
          <>
            <Lock size={32} strokeWidth={1.5} className="text-[var(--accent)]" />
            <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
              {t('qr.signInTitle', 'Sign in to check in')}
            </h1>
            <p className="text-[var(--text-secondary)] text-sm">
              {t('qr.signInHint', "We'll bring you right back here after you sign in.")}
            </p>
            <button
              onClick={() => onNavigate('login')}
              className="w-full bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm mt-2"
            >
              {t('qr.signInCta', 'Sign in')}
            </button>
            <button
              onClick={() => onNavigate('signup')}
              className="w-full border border-[var(--border)] text-[var(--text-primary)] font-semibold rounded-xl py-3 text-sm"
            >
              {t('qr.signUpCta', 'Create an account')}
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <AlertCircle size={32} strokeWidth={1.5} className="text-[var(--danger)]" />
            <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
              {t('qr.errorTitle', "Couldn't check you in")}
            </h1>
            <p className="text-[var(--text-secondary)] text-sm">{message}</p>
            <button
              onClick={() => onNavigate('map')}
              className="w-full bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm mt-2"
            >
              {t('qr.openMap', 'Open the map')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
